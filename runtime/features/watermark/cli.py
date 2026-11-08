#!/usr/bin/env python3
"""使用相对路径的 remove-ai-watermarks 和本地模型修复图片、视频角标。"""

from __future__ import annotations

import argparse
import json
import os
import logging
import shutil
import sys
from pathlib import Path

from common.catalog import load_source_catalog
from common.limits import MAX_MEDIA_BYTES
from common.paths import resolve_output_path

# WHY: 主进程按 UTF-8 解析结果，不能依赖 Windows 控制台的默认代码页。
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# WHY: 不从宿主 PATH 寻找视频程序；适配层只启用随包 FFmpeg 和离线模型。
os.environ["PATH"] = ""

# 上游日志不进入用户界面；标准输出只传递结构化业务结果。
logging.disable(logging.CRITICAL)

# 同一份本地规则清单同时供界面和 Python 使用，避免平台列表漂移。
SOURCE_CATALOG = load_source_catalog()
PLATFORMS = tuple(source["id"] for source in SOURCE_CATALOG)
# 支持范围与桌面端保持一致，不把任意文本或办公文档当媒体处理。
IMAGE_EXTENSIONS = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP", ".avif": "AVIF", ".heic": "HEIF", ".bmp": "BMP", ".gif": "GIF", ".tif": "TIFF", ".tiff": "TIFF"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v"}
MAX_BYTES = MAX_MEDIA_BYTES


def clean_one(item: dict, index: int, platforms: list[str], destination: Path, media_kind: str, options: dict) -> dict:
    """处理一个文件并返回简短业务结果；源文件只读，输出限制在任务目录中。"""
    # 1. 再次检查实际输入，防止选择后文件被替换或改大。
    job_root = destination.parent
    source = Path(item["input"]).resolve(strict=True)
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_BYTES:
        raise ValueError("文件必须非空且不超过 256 MB")
    if source == destination.resolve() or destination.exists():
        raise ValueError("输出位置已被占用，请重新处理")
    with source.open("rb") as stream:
        header = stream.read(64)
    # 画面处理和隐藏来源处理独立计数，不能用元数据变化冒充角标修复。
    visible = {"status": "not_requested", "marks": []}
    metadata_changed = False
    metadata_remaining = {}
    # 2. 同时核对扩展名和签名，不把伪装成图片的视频或任意文本交给错误解析器。
    if source.suffix.lower() in IMAGE_EXTENSIONS:
        if media_kind != "image":
            raise ValueError("当前选择视频模式，请重新选择视频")
        from PIL import Image, UnidentifiedImageError
        try:
            with Image.open(source) as image:
                detected_format = image.format
        except (UnidentifiedImageError, OSError) as cause:
            raise ValueError("无法解码图片，请选择有效且受支持的图片") from cause
        if detected_format != IMAGE_EXTENSIONS[source.suffix.lower()]:
            raise ValueError("无法识别图片或扩展名与内容不符，请选择有效的图片")
    elif source.suffix.lower() in VIDEO_EXTENSIONS:
        if media_kind != "video":
            raise ValueError("当前选择图片模式，请重新选择图片")
        if header[4:8] != b"ftyp":
            raise ValueError("仅支持有效的 MP4、MOV、M4V 视频")
    else:
        raise ValueError("不支持此文件格式")
    # 3. 在画面修复前读取来源证据，以涵盖编码器已随修复去除的标记。
    from features.watermark.service import (
        configure_visible_runtime,
        repair_image,
        repair_video,
    )
    original_markers = {}
    if options["removeSourceMetadata"]:
        configure_visible_runtime()
        from remove_ai_watermarks.metadata import get_ai_metadata
        original_markers = get_ai_metadata(source)
    if options["removeVisibleMarks"]:
        repair = repair_image if media_kind == "image" else repair_video
        visible = repair(source, destination, platforms, SOURCE_CATALOG)
    else:
        shutil.copyfile(source, destination)
    # 4. 使用当前上游的元数据清理及复查接口，保留普通字段和原文件。
    if options["removeSourceMetadata"]:
        metadata_output = job_root / f"{index}.metadata{source.suffix.lower()}"
        if media_kind == "video":
            from remove_ai_watermarks import remove_video_metadata
            metadata_remaining = remove_video_metadata(destination, metadata_output, keep_standard=True).remaining
        else:
            from remove_ai_watermarks.metadata import strip_and_verify
            _, metadata_remaining = strip_and_verify(destination, metadata_output, keep_standard=True)
        # WHY: 编码器重写文件字节不代表清除了来源，必须有处理前的标记证据。
        metadata_changed = bool(original_markers and not metadata_remaining)
        metadata_output.replace(destination)
    # 5. 只根据实际修复的画面规则汇报平台，不根据用户选择推断来源。
    detected = [entry["id"] for entry in SOURCE_CATALOG if any(key in visible["marks"] for key in entry["imageMarks" if media_kind == "image" else "videoMarks"])]
    matched = None if platforms == ["auto"] or not options["removeVisibleMarks"] else any(platform in detected for platform in platforms)
    status = "partial" if metadata_remaining or visible["status"] in ("partial", "unvalidated", "unsupported") else "cleaned" if visible["marks"] or metadata_changed else "unchanged"
    # WHY: 画面修复独立汇报；没有检测到水印不能等同于图片没有任何水印。
    visual_messages = {"not_requested": "未启用画面水印处理", "no_watermark": "未检测到符合规则的画面水印",
        "cleaned": "已修复检测到的画面水印并通过本地复检", "partial": "已执行画面修复，但仍检测到残留，请核对",
        "unvalidated": "已执行画面修复，结果尚未通过完整复检，请预览核对", "unsupported": "所选平台暂无画面水印规则，可切换自动识别"}
    messages = [visual_messages[visible["status"]]] if options["removeVisibleMarks"] else []
    if options["removeSourceMetadata"]:
        messages.append("仍有隐藏来源信息残留，请核对结果" if metadata_remaining else "已清理隐藏来源信息并通过复查" if metadata_changed else "未发现可清理的隐藏来源信息")
    message = "；".join(messages)
    if matched is False:
        message += "；未匹配到任一所选来源的标记"
    return {
        "type": "file", "index": index, "status": status, "message": message,
        "bytesOut": destination.stat().st_size, "detectedPlatforms": detected,
        "platformMatch": matched,
        "visibleStatus": visible["status"], "removedMarks": visible["marks"],
    }


def main() -> int:
    """读取主进程生成的单文件清单，输出 JSON 业务结果，不保存日志。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platforms", choices=tuple(PLATFORMS), nargs="+", default=["auto"], help="图片或视频生成平台：单选")
    parser.add_argument("--manifest", type=Path, required=True, help="本次任务清单")
    arguments = parser.parse_args()
    if len(arguments.platforms) != 1:
        parser.error("生成平台只能选择一个")
    # 1. 任务输出始终固定在清单的同级目录，不接受任意输出路径。
    manifest_path = arguments.manifest.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = manifest["files"]
    if not isinstance(items, list) or len(items) != 1:
        raise ValueError("目前每次只能处理一个文件")
    media_kind = manifest.get("mediaKind")
    if media_kind not in ("image", "video"):
        raise ValueError("请选择图片或视频模式")
    options = manifest.get("options", {"removeVisibleMarks": True, "removeSourceMetadata": True})
    if isinstance(options, dict):
        options = {"removeSourceMetadata": False, **options}
    if not isinstance(options, dict) or set(options) != {"removeVisibleMarks", "removeSourceMetadata"} or any(type(value) is not bool for value in options.values()) or not any(options.values()):
        raise ValueError("请至少选择一项有效的清理操作")
    # 2. 只处理当前文件，失败时返回结构化结果，允许用户重新选择或重试。
    for index, item in enumerate(items):
        destination = None
        extension = Path(item["input"]).suffix.lower() if isinstance(item, dict) and isinstance(item.get("input"), str) else ""
        try:
            destination = resolve_output_path(manifest_path, manifest, f"{index}.cleaned{extension}")
            event = clean_one(item, index, arguments.platforms, destination, media_kind, options)
        except Exception as cause:
            # 删除本次未完成结果，保留原文件。
            if destination is not None:
                destination.unlink(missing_ok=True)
            message = str(cause) if isinstance(cause, ValueError) else "文件处理失败，请检查文件是否完整或仍可读取"
            event = {"type": "file", "index": index, "status": "failed", "message": message[:250],
                     "bytesOut": 0, "detectedPlatforms": [], "platformMatch": None,
                     "visibleStatus": "not_requested", "removedMarks": []}
        finally:
            # 只删除本次元数据中间结果，源文件及用户导出文件保持只读。
            for intermediate in manifest_path.parent.glob(f"{index}.metadata.*"):
                intermediate.unlink(missing_ok=True)
        print(json.dumps(event, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
