"""接入 remove-ai-watermarks 的离线画面修复；所有模型和程序均按资源相对路径加载。"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess

from common.limits import MAX_IMAGE_PIXELS
from common.paths import RESOURCE_ROOT

# 固定模型摘要与下载锁一致，禁止在用户电脑上隐式下载或更换模型。
MODEL_SHA256 = "593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae"
_session = None
# Windows 原生运行库目录句柄必须在任务生命周期中保持打开。
_dll_directory = None
_original_migan = None


def fill_enclosing_region(image, mask):
    """封闭已定位字形的边界并保留小幅外扩，避免原文字边缘参与修复后重新出现。"""
    import numpy as np
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return image.copy()
    # WHY: 稀疏字形掩膜可能漏掉抗锯齿边缘；不对未检测区域执行整图重绘。
    enclosed = np.zeros_like(mask)
    x0, x1 = max(0, int(xs.min()) - 6), min(mask.shape[1], int(xs.max()) + 7)
    y0, y1 = max(0, int(ys.min()) - 6), min(mask.shape[0], int(ys.max()) + 7)
    enclosed[y0:y1, x0:x1] = 255
    return _original_migan(image, enclosed)


def bundled_session():
    """惰性加载本地 MI-GAN；缺失或损坏时明确失败，不退回联网下载。"""
    global _session
    if _session is None:
        # 1. 校验随包模型，错误不能伪装成已经修复。
        model = RESOURCE_ROOT / "models/migan/migan.onnx"
        if not model.is_file() or hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA256:
            raise ValueError("本地修复模型缺失或损坏，请重新准备随包依赖")
        # 2. 使用 CPU 推理，控制线程数量，普通电脑不需要 CUDA。
        import onnxruntime as ort
        settings = ort.SessionOptions()
        settings.intra_op_num_threads = 2
        _session = ort.InferenceSession(str(model), sess_options=settings, providers=["CPUExecutionProvider"])
    return _session


def configure_visible_runtime() -> None:
    """为固定上游版本替换离线加载接缝，不修改第三方源文件。"""
    global _dll_directory
    # 1. 先登记随包微软运行库，不依赖用户机器预装 Visual C++。
    if os.name == "nt" and _dll_directory is None:
        native = RESOURCE_ROOT / "native/msvc"
        if not native.is_dir():
            raise ValueError("本地原生运行库缺失，请重新准备随包依赖")
        _dll_directory = os.add_dll_directory(str(native))
    from remove_ai_watermarks import region_eraser
    # WHY: 上游默认首次使用会访问模型站；桌面版必须从随包相对目录离线加载。
    region_eraser._get_migan_session = bundled_session
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["PATH"] = str(RESOURCE_ROOT / "ffmpeg")


def video_timestamps(source: Path) -> tuple[float, ...]:
    """用随包 ffprobe 的 JSON 读取时间戳，兼容 CSV 混入 SEI 附加信息的视频。"""
    result = subprocess.run([str(RESOURCE_ROOT / "ffmpeg/ffprobe.exe"), "-v", "error",
        "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(source)],
        capture_output=True, text=True, encoding="utf-8", check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    timestamps = tuple(float(frame["best_effort_timestamp_time"]) for frame in json.loads(result.stdout)["frames"])
    if not timestamps or not all(math.isfinite(value) for value in timestamps):
        raise ValueError("视频时间戳无效，无法保留原时间轴")
    return timestamps


def repair_image(source: Path, output: Path, platforms: list[str], catalog: list[dict]) -> dict:
    """检测、修复并复检单张图片；具体平台只处理其规则，自动模式使用上游完整规则。"""
    global _original_migan
    from PIL import Image
    from remove_ai_watermarks import image_io, remove_visible_detailed, visible_provenance, watermark_registry
    # 1. 限制解码内存，不将多帧图片悄悄转换成一帧。
    with Image.open(source) as original:
        if original.width * original.height > MAX_IMAGE_PIXELS:
            raise ValueError("画面修复目前支持不超过 4000 万像素的图片")
        if getattr(original, "n_frames", 1) != 1:
            raise ValueError("暂不支持多帧图片，请选择单帧图片")
    configure_visible_runtime()
    from remove_ai_watermarks import region_eraser
    if _original_migan is None:
        _original_migan = region_eraser.erase_migan
        region_eraser.erase_migan = fill_enclosing_region
    # 2. 自动模式直接调用上游详细 API，保留残留/无法验证的真实结果。
    if platforms == ["auto"]:
        report = remove_visible_detailed(source, output, backend="migan", strip_metadata=False)
        return {"status": report.status, "marks": [mark.key for mark in report.marks]}
    # 3. 单选平台限定检测集合；不使用强制擦除或凭平台名绕过检测。
    keys = [key for entry in catalog if entry["id"] in platforms for key in entry.get("imageMarks", [])]
    if not keys:
        shutil.copyfile(source, output)
        return {"status": "unsupported", "marks": []}
    image, alpha = image_io.read_bgr_and_alpha(source)
    if image is None:
        raise ValueError("当前图片不能进行画面修复，请改用 PNG、JPG 或 WebP")
    provenance = visible_provenance(source)
    changed = []
    statuses = []
    for key in keys:
        mark = watermark_registry.get_mark(key)
        confirmed = key in provenance
        detection = mark.detect(image, provenance=confirmed)
        localization = mark.localize(image, provenance=confirmed, detection=detection)
        if localization.mask is None or not localization.mask.any():
            continue
        image = watermark_registry.fill(image, localization.mask, backend="migan")
        changed.append(key)
        # 4. 复检仅验证已修复区域；检测异常和残留均不能报告为全部成功。
        try:
            after = mark.detect(image, provenance=confirmed)
            x, y, width, height = detection.region
            ax, ay, aw, ah = after.region
            overlaps = max(x, ax) < min(x + width, ax + aw) and max(y, ay) < min(y + height, ay + ah)
            statuses.append("partial" if after.detected and overlaps else "cleaned")
        except Exception:
            statuses.append("unvalidated")
    if changed:
        if not image_io.write_bgr_with_alpha(output, image, alpha, display_tags_from=source, orientation_applied=False):
            raise ValueError("无法写入修复后的图片")
    else:
        shutil.copyfile(source, output)
    status = "partial" if "partial" in statuses else "unvalidated" if "unvalidated" in statuses else "cleaned" if changed else "no_watermark"
    return {"status": status, "marks": changed}


def repair_video(source: Path, output: Path, platforms: list[str], catalog: list[dict]) -> dict:
    """使用上游稳定跨帧检测和修复，复制音轨；无命中时保留原视频字节。"""
    from remove_ai_watermarks import remove_video_visible
    configure_visible_runtime()
    from remove_ai_watermarks import video_visible
    # WHY: 不能因 CSV 输出版本差异把可变帧率视频降级成固定帧率。
    video_visible.probe_video_timestamps = video_timestamps
    # 1. 视频只扫描所选支持规则；自动模式由上游选择稳定命中的一个平台。
    keys = ["auto"] if platforms == ["auto"] else list(dict.fromkeys(
        key for entry in catalog if entry["id"] in platforms for key in entry.get("videoMarks", [])
    ))
    if not keys:
        shutil.copyfile(source, output)
        return {"status": "unsupported", "marks": []}
    current = source
    changed = []
    intermediates = []
    try:
        # 2. 逐项执行当前平台的规则，中间文件固定在本次任务目录，原文件只读。
        for index, key in enumerate(keys):
            candidate = output.with_name(f"visible-pass-{index}{source.suffix.lower()}")
            intermediates.append(candidate)
            report = remove_video_visible(current, candidate, mark=key, backend="migan", strip_metadata=False)
            if report.output is not None and report.removed_frames:
                current = candidate
                changed.append(report.mark)
        shutil.copyfile(current, output)
    finally:
        for candidate in intermediates:
            candidate.unlink(missing_ok=True)
    # 视频接口尚无修复后的跨帧复检，不把“已执行修复”宣称为验证通过。
    return {"status": "unvalidated" if changed else "no_watermark", "marks": changed}
