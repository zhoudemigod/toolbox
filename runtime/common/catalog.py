"""加载前后端共用的平台能力目录。"""

import json

from .paths import CONFIG_ROOT


def load_source_catalog() -> list[dict]:
    """读取受版本控制的平台目录，不接受运行时自定义路径。"""
    return json.loads((CONFIG_ROOT / "source-platforms.json").read_text(encoding="utf-8"))
