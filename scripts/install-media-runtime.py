"""安装已校验的模型和原生媒体资源；Python 包由 uv 直接安装。"""
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "runtime"
LOCK = json.loads((RUNTIME / "media-runtime.lock.json").read_text(encoding="utf-8"))
CACHE = ROOT / ".artifacts/media-runtime"
SITE = RUNTIME / "embedded/Lib/site-packages"


def verified(entry: dict) -> Path:
    """再次核对缓存摘要，防止下载后被意外覆盖。"""
    path = CACHE / Path(urlparse(entry["url"]).path).name
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
        raise ValueError("缓存摘要不匹配：" + path.name)
    return path


def install() -> None:
    """将模型和程序恢复到应用相对资源目录。"""
    required = ("remove_ai_watermarks", "imageio_ffmpeg", "onnxruntime", "cv2")
    missing = [name for name in required if not (SITE / name).exists()]
    if missing:
        raise ValueError("uv 依赖未完整安装：" + ", ".join(missing))

    model = RUNTIME / LOCK["model"]["path"]
    model.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(verified(LOCK["model"]), model)

    binary_root = RUNTIME / "ffmpeg"
    binary_root.mkdir(parents=True, exist_ok=True)
    ffmpeg = next((SITE / "imageio_ffmpeg/binaries").glob("*.exe"))
    if hashlib.sha256(ffmpeg.read_bytes()).hexdigest() != LOCK["ffmpegSha256"]:
        raise ValueError("FFmpeg 摘要不匹配")
    shutil.copyfile(ffmpeg, binary_root / "ffmpeg.exe")
    ffmpeg.unlink()

    with tarfile.open(verified(LOCK["ffprobe"])) as archive:
        for source, destination in (
            ("package/ffprobe.exe", "ffprobe.exe"),
            ("package/README.md", "ffprobe-README.md"),
            ("package/package.json", "ffprobe-package.json"),
        ):
            stream = archive.extractfile(source)
            if stream is None:
                raise ValueError("FFprobe 归档缺少：" + source)
            (binary_root / destination).write_bytes(stream.read())
    if hashlib.sha256((binary_root / "ffprobe.exe").read_bytes()).hexdigest() != LOCK["ffprobe"]["binarySha256"]:
        raise ValueError("FFprobe 摘要不匹配")

    install_msvc()
    for pattern in ("*.lib", "*.pdb", "*.pyc"):
        for artifact in SITE.rglob(pattern):
            artifact.unlink(missing_ok=True)
    for cache in sorted(SITE.rglob("__pycache__"), reverse=True):
        shutil.rmtree(cache, ignore_errors=True)
    print("媒体依赖已准备，应用运行时无需联网下载")


def install_msvc() -> None:
    """从锁定的微软官方包提取可再分发 DLL，不执行安装器。"""
    extractor = CACHE / "7za.exe"
    with tarfile.open(verified(LOCK["extractor"])) as archive:
        stream = archive.extractfile("package/win/x64/7za.exe")
        if stream is None:
            raise ValueError("解压工具归档结构不符")
        extractor.write_bytes(stream.read())
    work = CACHE / "msvc-extracted"
    work.mkdir(exist_ok=True)

    def unpack(archive_path: Path, destination: Path) -> None:
        result = subprocess.run(
            [str(extractor), "x", str(archive_path), "-o" + str(destination), "-y"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if result.returncode not in (0, 1):
            raise ValueError("微软运行库解压失败")

    data = verified(LOCK["msvc"]).read_bytes()
    offset = 0
    cabinets = []
    while True:
        start = data.find(b"MSCF", offset)
        if start < 0:
            break
        offset = start + 4
        size = struct.unpack_from("<I", data, start + 8)[0]
        if 36 < size <= len(data) - start:
            cabinet = work / f"outer-{len(cabinets)}.cab"
            cabinet.write_bytes(data[start : start + size])
            cabinets.append(cabinet)
    if len(cabinets) != 2:
        raise ValueError("锁定微软运行库的归档结构不符")
    unpack(cabinets[1], work / "payloads")
    unpack(work / "payloads/a12", work / "native")

    destination = RUNTIME / "native/msvc"
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected in LOCK["msvc"]["files"].items():
        source = work / "native" / (name + "_amd64")
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise ValueError("微软运行库 DLL 摘要不符：" + name)
        shutil.copyfile(source, destination / name)


if __name__ == "__main__":
    install()
