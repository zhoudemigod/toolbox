"""使用随包 BiRefNet Lite ONNX 模型离线抠图；不联网、不覆盖原文件。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from common.limits import MAX_IMAGE_PIXELS, MAX_MEDIA_BYTES
from common.paths import RESOURCE_ROOT, resolve_output_path

MAX_BYTES = MAX_MEDIA_BYTES
MAX_PIXELS = MAX_IMAGE_PIXELS
# 保留句柄直到进程退出，确保 Windows 原生推理依赖可加载。
DLL_HANDLES = []
if os.name == "nt" and (RESOURCE_ROOT / "native/msvc").is_dir():
    DLL_HANDLES.append(os.add_dll_directory(str(RESOURCE_ROOT / "native/msvc")))


def load_session():
    lock = json.loads((RESOURCE_ROOT / "cutout-model.lock.json").read_text(encoding="utf-8-sig"))
    model = RESOURCE_ROOT / lock["path"]
    if not model.is_file():
        raise ValueError("抠图模型缺失，请重新安装应用或修复本地资源")
    if model.stat().st_size != lock["size"]:
        raise ValueError("抠图模型不完整，请修复本地资源后重试")
    with model.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != lock["sha256"]:
        raise ValueError("抠图模型校验失败，请重新准备模型")
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    if session.get_inputs()[0].shape != [1, 3, 1024, 1024]:
        raise ValueError("抠图模型输入不匹配，请重新准备模型")
    return session


def predict_alpha(session, image):
    import numpy as np
    from PIL import Image
    rgb = image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    # 与上游 BiRefNet 通用模型适配保持一致：RGB / 255、ImageNet 归一化、NCHW。
    tensor = np.asarray(rgb, dtype=np.float32) / 255.0
    tensor = (tensor - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    tensor = np.ascontiguousarray(tensor.transpose(2, 0, 1)[None])
    logits = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    if logits.shape != (1, 1, 1024, 1024) or not np.isfinite(logits).all():
        raise ValueError("抠图模型返回无效结果，请重新尝试")
    probabilities = 1.0 / (1.0 + np.exp(-np.clip(logits[0, 0], -80, 80)))
    low, high = float(probabilities.min()), float(probabilities.max())
    if high - low <= 1e-6:
        raise ValueError("未能分离主体与背景，请尝试主体更清晰的图片")
    probabilities = (probabilities - low) / (high - low)
    mask = Image.fromarray((probabilities * 255).astype(np.uint8)).resize(image.size, Image.Resampling.LANCZOS)
    return mask


def cutout(source: Path, destination: Path):
    from PIL import Image, ImageOps, ImageChops
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    formats = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
    if source.suffix.lower() not in formats:
        raise ValueError("抠图暂支持 PNG、JPG 和 WebP 图片")
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_BYTES:
        raise ValueError("图片必须非空且不超过 256 MB")
    with Image.open(source) as original:
        if original.format != formats[source.suffix.lower()]:
            raise ValueError("图片内容与文件格式不符，请重新选择")
        if getattr(original, "n_frames", 1) != 1:
            raise ValueError("暂不支持动图抠图，请选择静态图片")
        if original.width * original.height > MAX_PIXELS:
            raise ValueError("图片不能超过 4000 万像素，请缩小后重试")
        image = ImageOps.exif_transpose(original).convert("RGBA")
    original_alpha = image.getchannel("A")
    if original_alpha.getextrema()[1] == 0:
        raise ValueError("图片完全透明，没有可识别的主体")
    session = load_session()
    alpha = predict_alpha(session, image)
    image.putalpha(ImageChops.multiply(original_alpha, alpha))
    # 不携带原图 EXIF/文本信息，不重新缩放原始像素尺寸。
    image.info.clear()
    image.save(destination, "PNG")
    if destination.stat().st_size > MAX_BYTES:
        raise ValueError("导出图片超过 256 MB，请缩小原图后重试")
    return image.size


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        load_session()
        print("BiRefNet Lite CPU model ready")
        return 0
    if not args.manifest:
        parser.error("--manifest is required")
    manifest_path = args.manifest.resolve()
    destination = None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        if set(manifest) != {"files", "mediaKind", "outputName"} or manifest["mediaKind"] != "image" or not isinstance(manifest["files"], list) or len(manifest["files"]) != 1:
            raise ValueError("抠图只支持单张图片")
        item = manifest["files"][0]
        if set(item) != {"input"} or not isinstance(item["input"], str):
            raise ValueError("图片参数不正确，请重新选择")
        source = Path(item["input"]).resolve(strict=True)
        destination = resolve_output_path(manifest_path, manifest, "0.cutout.png")
        if source == destination:
            raise ValueError("不能覆盖原文件")
        width, height = cutout(source, destination)
        event = {"type": "file", "index": 0, "status": "cleaned", "message": "抠图完成，可预览并另存透明 PNG", "bytesOut": destination.stat().st_size, "width": width, "height": height}
    except Exception as error:
        if destination is not None:
            destination.unlink(missing_ok=True)
        message = str(error) if isinstance(error, ValueError) else "抠图失败，请检查图片是否完整以及本地模型和运行环境是否可用"
        event = {"type": "file", "index": 0, "status": "failed", "message": message[:250], "bytesOut": 0, "width": 0, "height": 0}
    print(json.dumps(event, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
