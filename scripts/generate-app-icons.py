"""将界面 Logo 转为 Windows 安装包图标。"""
from pathlib import Path

from PIL import Image

# 图标统一来自界面已使用的品牌图片，避免窗口与安装包各用一套图案。
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/renderer/src/assets/logo.png"
DESTINATION = ROOT / "src/renderer/src/assets"


def generate() -> None:
    """生成 Windows 多尺寸 ICO；其他平台启用后再增加对应产物。"""
    DESTINATION.mkdir(parents=True, exist_ok=True)
    # 使用透明画布，系统可按显示缩放选择清晰的小图。
    with Image.open(SOURCE) as source:
        image = source.convert("RGBA")
        windows = image.resize((256, 256), Image.Resampling.LANCZOS)
        windows.save(DESTINATION / "icon.ico", format="ICO",
                     sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])


if __name__ == "__main__":
    generate()
