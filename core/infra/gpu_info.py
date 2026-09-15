"""显卡/CPU 信息（只读，给界面展示用）。

Windows 上用 DXGI 枚举适配器（ctypes 直调 dxgi.dll，不引入任何新依赖），
拿到的正是 DirectML 实际会用的那块卡（含显存容量、是否软件适配器/WARP）。
非 Windows 或调用失败时返回空列表，调用方按"未知"处理即可。
"""
from __future__ import annotations

import ctypes
import os
import sys
import uuid

from core.infra.logger import logger

_CACHE: dict | None = None

# DXGI_ADAPTER_FLAG_SOFTWARE：软件适配器（WARP，走 CPU 模拟，GPU 加速实际不可用）
_DXGI_ADAPTER_FLAG_SOFTWARE = 0x2
_DXGI_ERROR_NOT_FOUND = 0x887A0002


class _LUID(ctypes.Structure):
    _fields_ = [("LowPart", ctypes.c_ulong), ("HighPart", ctypes.c_long)]


class _DXGI_ADAPTER_DESC1(ctypes.Structure):
    _fields_ = [
        ("Description", ctypes.c_wchar * 128),
        ("VendorId", ctypes.c_uint),
        ("DeviceId", ctypes.c_uint),
        ("SubSysId", ctypes.c_uint),
        ("Revision", ctypes.c_uint),
        ("DedicatedVideoMemory", ctypes.c_size_t),
        ("DedicatedSystemMemory", ctypes.c_size_t),
        ("SharedSystemMemory", ctypes.c_size_t),
        ("AdapterLuid", _LUID),
        ("Flags", ctypes.c_uint),
    ]


def _com_call(obj, index: int, restype, *argtypes):
    """调用 COM 接口第 index 个虚函数（vtable 直调）。"""
    vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    func = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(vtable[index])
    return func


def list_adapters() -> list:
    """枚举显卡：[{index, name, vendorId, deviceId, vramMB, sharedMemoryMB, software}]。"""
    if sys.platform != "win32":
        return []
    adapters: list = []
    try:
        dxgi = ctypes.WinDLL("dxgi", use_last_error=True)
        # IDXGIFactory1 = {770AAE78-F26F-4DBA-A829-253C83D1B387}
        # bytes_le 就是 COM 需要的 GUID 内存布局（Data1/2/3 小端 + Data4 原序）
        iid_factory1 = (ctypes.c_ubyte * 16)(
            *uuid.UUID("{770AAE78-F26F-4DBA-A829-253C83D1B387}").bytes_le
        )
        dxgi.CreateDXGIFactory1.argtypes = [
            ctypes.POINTER(ctypes.c_ubyte * 16),
            ctypes.POINTER(ctypes.c_void_p),
        ]
        dxgi.CreateDXGIFactory1.restype = ctypes.c_long
        factory = ctypes.c_void_p()
        hr = dxgi.CreateDXGIFactory1(ctypes.byref(iid_factory1), ctypes.byref(factory))
        if hr < 0 or not factory:
            logger.debug(f"CreateDXGIFactory1 失败: hr=0x{hr & 0xFFFFFFFF:08X}")
            return []
        try:
            enum_adapters1 = _com_call(
                factory, 12, ctypes.c_long, ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p)
            )
            index = 0
            while True:
                adapter = ctypes.c_void_p()
                if enum_adapters1(factory, index, ctypes.byref(adapter)) < 0 or not adapter:
                    break
                try:
                    desc = _DXGI_ADAPTER_DESC1()
                    get_desc1 = _com_call(
                        adapter, 10, ctypes.c_long, ctypes.POINTER(_DXGI_ADAPTER_DESC1)
                    )
                    if get_desc1(adapter, ctypes.byref(desc)) >= 0:
                        name = (desc.Description or "").strip()
                        if name:
                            adapters.append({
                                "index": index,
                                "name": name,
                                "vendorId": int(desc.VendorId),
                                "deviceId": int(desc.DeviceId),
                                "vramMB": int(desc.DedicatedVideoMemory // (1024 * 1024)),
                                "sharedMemoryMB": int(desc.SharedSystemMemory // (1024 * 1024)),
                                "software": bool(desc.Flags & _DXGI_ADAPTER_FLAG_SOFTWARE),
                            })
                finally:
                    release = _com_call(adapter, 2, ctypes.c_ulong)
                    release(adapter)
                index += 1
                if index > 16:  # 防御：正常机器不会超过这个数
                    break
        finally:
            release = _com_call(factory, 2, ctypes.c_ulong)
            release(factory)
    except Exception as e:  # noqa: BLE001
        logger.debug(f"Dxgi 枚举显卡失败（忽略）: {e}")
        return []
    return adapters


def cpu_name() -> str:
    """CPU 型号（注册表读取，失败返回空串）。"""
    if sys.platform != "win32":
        return ""
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
        )
        try:
            return str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
        finally:
            winreg.CloseKey(key)
    except Exception:
        return ""


def hardware_summary(force: bool = False) -> dict:
    """硬件概要（结果缓存）：显卡列表 + 主显卡 + CPU 型号。

    gpuName/gpuVramMB 取第一块【非软件】适配器 —— 也就是 DirectML 默认会用的那块。
    """
    global _CACHE
    if _CACHE is not None and not force:
        return _CACHE

    # 去重 + 丢掉软件适配器（Microsoft Basic Render Driver / WARP，展示上没意义）：
    # DXGI 有时会把同一块卡枚举两次（显示适配器 + 驱动副本）。
    seen = set()
    real = []
    for a in list_adapters():
        if a.get("software"):
            continue
        key = (a["name"], a["deviceId"], a["vramMB"])
        if key in seen:
            continue
        seen.add(key)
        real.append(a)
    primary = real[0] if real else None
    _CACHE = {
        "cpuName": cpu_name(),
        "adapters": real,
        "gpuName": primary["name"] if primary else "",
        "gpuVramMB": primary["vramMB"] if primary else 0,
        "gpuCount": len(real),
        "softwareOnly": bool(list_adapters()) and primary is None,
    }
    return _CACHE
