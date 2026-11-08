"""集中解析应用资源路径，功能包不得各自推断目录层级。"""

from pathlib import Path


RESOURCE_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = RESOURCE_ROOT
CONFIG_ROOT = RESOURCE_ROOT / "config"


def runtime_path(*parts: str) -> Path:
    """返回内置运行资源路径；调用方仍需校验文件存在性和摘要。"""
    return RUNTIME_ROOT.joinpath(*parts)


def resolve_output_path(manifest_path: Path, manifest: dict, fallback: str) -> Path:
    """按主进程指定的文件名解析结果位置，只允许清单同级目录内的纯文件名。"""
    if not isinstance(manifest, dict):
        raise ValueError("输出文件名无效")
    name = manifest.get("outputName", fallback)
    if not isinstance(name, str) or not name or name in (".", ".."):
        raise ValueError("输出文件名无效")
    target = manifest_path.parent / name
    # 绝对路径、目录穿越和覆盖清单本身都必须拒绝。
    if target.parent != manifest_path.parent or target == manifest_path:
        raise ValueError("输出文件名无效")
    return target
