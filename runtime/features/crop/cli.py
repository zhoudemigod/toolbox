"""按授权图片和实际像素选区裁剪，输出独立 PNG，不覆盖原文件。"""
import argparse
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

from common.limits import MAX_IMAGE_PIXELS, MAX_MEDIA_BYTES
from common.paths import resolve_output_path

MAX_BYTES = MAX_MEDIA_BYTES
MAX_PIXELS = MAX_IMAGE_PIXELS
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def crop_image(manifest, target):
    if set(manifest) != {"files", "mediaKind", "crop", "outputName"} or manifest["mediaKind"] != "image" or not isinstance(manifest["files"], list) or len(manifest["files"]) != 1:
        raise ValueError("请只选择一张图片")
    item, box = manifest["files"][0], manifest["crop"]
    if not isinstance(item, dict) or set(item) != {"input"} or not isinstance(item["input"], str):
        raise ValueError("文件参数无效，请重新选择")
    if not isinstance(box, dict) or set(box) != {"x", "y", "width", "height"} or any(type(value) is not int for value in box.values()):
        raise ValueError("裁剪选区无效")
    x, y, width, height = (box[key] for key in ("x", "y", "width", "height"))
    if min(x, y) < 0 or min(width, height) < 1 or width * height > MAX_PIXELS:
        raise ValueError("裁剪选区无效或过大")
    source = Path(item["input"]).resolve(strict=True)
    formats = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
    if source.suffix.lower() not in formats or not 0 < source.stat().st_size <= MAX_BYTES:
        raise ValueError("请选择不超过 256 MB 的 PNG、JPG 或 WebP 图片")
    if source == target:
        raise ValueError("不能覆盖原文件")
    with Image.open(source) as original:
        if original.format != formats[source.suffix.lower()] or getattr(original, "n_frames", 1) != 1:
            raise ValueError("文件格式不正确或包含多帧，请选择静态图片")
        if original.width * original.height > MAX_PIXELS:
            raise ValueError("图片不能超过 4000 万像素")
        image = ImageOps.exif_transpose(original)
        if x + width > image.width or y + height > image.height:
            raise ValueError("裁剪选区超出图片范围，请重新调整")
        result = image.crop((x, y, x + width, y + height)).convert("RGBA")
        result.info.clear()
        result.save(target, "PNG")
    if target.stat().st_size > MAX_BYTES:
        raise ValueError("导出图片超过 256 MB，请缩小选区")
    return width, height


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    target = None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        target = resolve_output_path(manifest_path, manifest, "0.crop.png")
        width, height = crop_image(manifest, target)
        event = {"type": "file", "index": 0, "status": "cleaned", "message": "裁剪完成，可另存 PNG", "width": width, "height": height, "bytesOut": target.stat().st_size}
    except Exception as error:
        if target is not None:
            target.unlink(missing_ok=True)
        event = {"type": "file", "index": 0, "status": "failed", "message": (str(error) if isinstance(error, ValueError) else "裁剪失败，请检查图片是否完整或重新选择")[:250], "bytesOut": 0, "width": 0, "height": 0}
    print(json.dumps(event, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
