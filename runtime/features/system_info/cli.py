"""读取本机基础配置，输出 JSON；仅使用标准库，不联网或保存硬件信息。"""
import ctypes
import json
import os
import platform
import sys
import uuid


def attempt(reader, default):
    try:
        return reader()
    except (OSError, ValueError, AttributeError, KeyError):
        return default


def windows_registry(path, name):
    import winreg
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path, 0,
                        winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
        return winreg.QueryValueEx(key, name)[0]


def windows_memory():
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    installed = ctypes.c_ulonglong()
    read_memory = kernel.GetPhysicallyInstalledSystemMemory
    read_memory.argtypes = [ctypes.POINTER(ctypes.c_ulonglong)]
    read_memory.restype = wintypes.BOOL
    if read_memory(ctypes.byref(installed)) and installed.value:
        return installed.value * 1024

    class MemoryStatus(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
            (name, ctypes.c_ulonglong) for name in (
                "totalPhys", "availPhys", "totalPageFile", "availPageFile",
                "totalVirtual", "availVirtual", "availExtendedVirtual")]

    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    kernel.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MemoryStatus)]
    kernel.GlobalMemoryStatusEx.restype = wintypes.BOOL
    return status.totalPhys if kernel.GlobalMemoryStatusEx(ctypes.byref(status)) else None


def windows_gpus():
    """枚举当前存在的显示适配器，支持未连接显示器的独立显卡。"""
    from ctypes import wintypes

    class Guid(ctypes.Structure):
        _fields_ = [("data1", wintypes.DWORD), ("data2", wintypes.WORD),
                    ("data3", wintypes.WORD), ("data4", ctypes.c_ubyte * 8)]

    class DeviceInfo(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("classGuid", Guid),
                    ("devInst", wintypes.DWORD), ("reserved", ctypes.c_void_p)]

    api = ctypes.WinDLL("setupapi", use_last_error=True)
    api.SetupDiGetClassDevsW.argtypes = [ctypes.POINTER(Guid), wintypes.LPCWSTR,
                                        wintypes.HWND, wintypes.DWORD]
    api.SetupDiGetClassDevsW.restype = wintypes.HANDLE
    api.SetupDiEnumDeviceInfo.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                         ctypes.POINTER(DeviceInfo)]
    api.SetupDiEnumDeviceInfo.restype = wintypes.BOOL
    api.SetupDiGetDeviceRegistryPropertyW.argtypes = [
        wintypes.HANDLE, ctypes.POINTER(DeviceInfo), wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(ctypes.c_ubyte),
        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    api.SetupDiGetDeviceRegistryPropertyW.restype = wintypes.BOOL
    api.SetupDiDestroyDeviceInfoList.argtypes = [wintypes.HANDLE]
    api.SetupDiDestroyDeviceInfoList.restype = wintypes.BOOL
    display_class = Guid.from_buffer_copy(uuid.UUID("4d36e968-e325-11ce-bfc1-08002be10318").bytes_le)
    handle = api.SetupDiGetClassDevsW(ctypes.byref(display_class), None, None, 2)  # DIGCF_PRESENT
    if handle == ctypes.c_void_p(-1).value:
        return []
    names = []
    try:
        for index in range(64):
            device = DeviceInfo()
            device.cbSize = ctypes.sizeof(device)
            if not api.SetupDiEnumDeviceInfo(handle, index, ctypes.byref(device)):
                break
            for prop in (12, 0):  # SPDRP_FRIENDLYNAME, SPDRP_DEVICEDESC
                buffer = ctypes.create_unicode_buffer(1024)
                if api.SetupDiGetDeviceRegistryPropertyW(
                        handle, ctypes.byref(device), prop, None,
                        ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)),
                        ctypes.sizeof(buffer), None):
                    name = buffer.value.strip()[:200]
                    if name and name not in names:
                        names.append(name)
                    break
    finally:
        api.SetupDiDestroyDeviceInfoList(handle)
    return names[:16]


def collect():
    system = platform.system()
    machine = platform.machine().lower()
    result = {
        "osName": system or "未知系统",
        "osVersion": platform.release()[:160],
        "architecture": {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64"}.get(machine, machine) or "未知",
        "cpuName": platform.processor().strip()[:200] or "未识别",
        "logicalCores": os.cpu_count() or 1,
        "gpus": [],
        "memoryTotalBytes": None,
    }
    if system == "Windows":
        current_version = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"
        product = attempt(lambda: windows_registry(current_version, "ProductName"), "Windows")
        build = sys.getwindowsversion().build
        if build >= 22000 and product.startswith("Windows 10"):
            product = product.replace("Windows 10", "Windows 11", 1)
        display_version = attempt(lambda: windows_registry(current_version, "DisplayVersion"), "")
        revision = attempt(lambda: windows_registry(current_version, "UBR"), 0)
        result["osName"] = str(product)[:160]
        result["osVersion"] = f"{display_version} ({build}.{revision})".strip()[:160]
        result["cpuName"] = attempt(lambda: windows_registry(
            r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString").strip()[:200], result["cpuName"])
        result["memoryTotalBytes"] = attempt(windows_memory, None)
        result["gpus"] = attempt(windows_gpus, [])
    elif system == "Linux":
        def linux_cpu():
            with open("/proc/cpuinfo", encoding="utf-8") as file:
                for line in file.read(65536).splitlines():
                    if line.startswith("model name"):
                        return line.split(":", 1)[1].strip()[:200]
            return result["cpuName"]
        result["cpuName"] = attempt(linux_cpu, result["cpuName"])
        result["memoryTotalBytes"] = attempt(
            lambda: os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"), None)
    return result


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(collect(), ensure_ascii=False), flush=True)
