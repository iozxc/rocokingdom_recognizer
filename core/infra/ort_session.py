"""ONNX Runtime 会话统一配置（避免多个推理会话线程过度订阅）。

桌面端同一时刻会加载 DINO（图标/标题）、YOLO、OCR 等多个 ONNX 会话。
如果每个会话都让 ORT 默认开满逻辑核，串行识别时多个线程池会互相争抢 CPU，
表现为识别瞬间 CPU 100%、整机卡顿。这里统一把 intra-op 线程收敛到“逻辑核一半”
（通常即物理核数），并关闭 inter-op 并行，保证多会话串行执行时不会互相抢核。

另外这里统一负责「执行后端（Execution Provider）」的选择：
优先 GPU（DirectML / CUDA / OpenVINO），不可用时自动降级 CPU，
调用方不再各处写死 providers=['CPUExecutionProvider']。
"""
import os

_GPU_EP_ORDER = ("CUDAExecutionProvider", "DmlExecutionProvider", "OpenVINOExecutionProvider")

# 已经成功建过会话的后端列表：第一次探测出结果后，后续会话直接复用，避免反复试错
_ACTIVE_PROVIDERS: list | None = None
# 最近一次会话实际生效的 EP（session.get_providers()[0]，ORT 可能把请求的 GPU 静默换成 CPU）
_LAST_ACTUAL_PROVIDER: str | None = None
# GPU 真机可用性结论（缓存）：{"usable": bool, "reason": str, "provider": str}
_GPU_VERDICT: dict | None = None
# 真机验证时创建的会话（(模型路径, session)）：验证通过后直接复用，避免同一模型建两份会话
_PROBE_SESSION: tuple | None = None


def get_ort_intra_threads() -> int:
    """intra-op 线程数：默认取逻辑核数的一半，可用 ROCO_ORT_INTRA_THREADS 覆盖。"""
    env = (os.environ.get("ROCO_ORT_INTRA_THREADS") or "").strip()
    if env:
        try:
            return max(1, int(env))
        except ValueError:
            pass
    cpus = os.cpu_count() or 4
    return max(1, cpus // 2)


def create_session_options():
    """构建统一 SessionOptions；延迟 import onnxruntime，避免拖慢启动。"""
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = get_ort_intra_threads()
    so.inter_op_num_threads = 1
    return so


def get_ep_mode() -> str:
    """后端偏好：auto(默认，能用 GPU 就用) / dml / cuda / openvino / cpu。

    优先级：环境变量 ROCO_INFER_EP（显式指定，排查问题用） > 用户设置里的
    「GPU 加速」开关（默认开启） > auto。
    """
    forced = env_ep_override()
    if forced:
        return forced
    return "auto" if user_gpu_enabled() else "cpu"


def env_ep_override() -> str | None:
    """ROCO_INFER_EP 显式指定后端时返回它（auto/空 = 未指定）。"""
    env = (os.environ.get("ROCO_INFER_EP") or "").strip().lower()
    if env in ("dml", "cuda", "openvino"):
        return env
    if env in ("0", "false", "off"):
        return "cpu"
    if env == "cpu":
        return "cpu"
    return None


def user_gpu_enabled() -> bool:
    """用户设置里的「GPU 加速」开关（appSettings.gpuAcceleration，缺省=开启）。

    关闭后所有推理会话都会用 CPU 建立；开关变化时 user_storage 会清掉已建会话，
    下次识别即按新设置重建。
    """
    try:
        from core.services.user_storage import user_storage

        settings = user_storage.get_app_settings() or {}
        value = settings.get("gpuAcceleration", True)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() not in ("0", "false", "off", "no", "")
        return True
    except Exception:
        return True


def reset_provider_cache() -> None:
    """忘掉已探测到的后端（设置变更后调用，让下次建会话重新按新偏好选择）。"""
    global _ACTIVE_PROVIDERS, _PROBE_CACHE, _GPU_VERDICT, _LAST_ACTUAL_PROVIDER, _PROBE_SESSION
    _ACTIVE_PROVIDERS = None
    _PROBE_CACHE = None
    _GPU_VERDICT = None
    _LAST_ACTUAL_PROVIDER = None
    _PROBE_SESSION = None


def get_available_providers() -> set:
    """当前 onnxruntime 安装里可用的 EP 集合。"""
    try:
        import onnxruntime as ort

        return set(ort.get_available_providers())
    except Exception:
        return set()


def provider_candidates(mode: str | None = None) -> list:
    """按偏好给出「依次尝试」的 providers 列表（最后一个一定是纯 CPU 兜底）。

    - cpu  : 只用 CPU
    - dml/cuda/openvino : 指定后端优先，失败仍会降级 CPU
    - auto : 可用即用，顺序 CUDA -> DirectML -> OpenVINO -> CPU

    每个候选都把 CPUExecutionProvider 放在末尾：ORT 会把 GPU 不支持的算子
    自动切给 CPU（分区执行），不会因为个别算子不支持而整场失败。
    """
    mode = mode or get_ep_mode()
    avail = get_available_providers()

    if mode == "cpu":
        return [["CPUExecutionProvider"]]

    # GPU 真机验证没通过（老显卡/驱动不支持 D3D12/显存不足/用户关掉了开关）就直接纯 CPU：
    # 避免出现「会话建得起来、一推理就报设备错误」这种识别不可用的状态。
    verdict = gpu_verdict()
    if not verdict.get("usable"):
        return [["CPUExecutionProvider"]]

    if mode == "auto":
        order = [ep for ep in _GPU_EP_ORDER if ep in avail]
    else:
        wanted = {
            "dml": "DmlExecutionProvider",
            "cuda": "CUDAExecutionProvider",
            "openvino": "OpenVINOExecutionProvider",
        }.get(mode)
        # 显式指定后端时：可用的排在最先，其余 GPU 后端依次兜底（尽量还是用上 GPU），
        # 最后一定是纯 CPU（provider_candidates 会追加）。真正"只想用 CPU"用 ROCO_INFER_EP=cpu。
        order = ([wanted] if (wanted and wanted in avail) else []) + [
            ep for ep in _GPU_EP_ORDER if ep in avail and ep != wanted
        ]

    candidates = [[ep, "CPUExecutionProvider"] for ep in order]
    candidates.append(["CPUExecutionProvider"])
    # 去重（保持顺序）
    uniq = []
    for c in candidates:
        if c not in uniq:
            uniq.append(c)
    return uniq


def _shape_is_concrete(shape) -> bool:
    """除 batch 维外都是具体整数时，才敢按它造空输入做前向验证。"""
    return all(isinstance(d, int) and d > 0 for d in list(shape)[1:])


def _smoke_forward(session) -> None:
    """对会话跑一次全零输入，确认「不仅能建会话，还能真的推理」。"""
    import numpy as np

    inp = session.get_inputs()[0]
    dims = [
        d if isinstance(d, int) and d > 0 else (1 if i == 0 else 32)
        for i, d in enumerate(inp.shape)
    ]
    session.run(None, {inp.name: np.zeros(dims, dtype=np.float32)})


def mark_gpu_unusable(reason: str) -> None:
    """把 GPU 标记为不可用：后续所有会话（含 OCR/YOLO）直接用 CPU，不再反复试错。"""
    global _GPU_VERDICT, _ACTIVE_PROVIDERS, _LAST_ACTUAL_PROVIDER, _PROBE_SESSION
    _GPU_VERDICT = {"usable": False, "reason": reason, "provider": ""}
    _ACTIVE_PROVIDERS = None
    _LAST_ACTUAL_PROVIDER = None
    _PROBE_SESSION = None


def gpu_verdict(force: bool = False) -> dict:
    """真机验证 GPU 到底能不能用（结果缓存）。

    只看 get_available_providers() 不够：老显卡 / 老驱动（D3D12 特性级别不足）/
    显存不足 / 远程桌面(WARP) 等场景下，GPU 会话可能「建得起来，一推理就报设备错误」。
    所以这里真的跑一次前向，跑通才算可用。

    探测模型优先用【识别主模型】（DINO）：它的空间维是固定 518×518，能安全地造空输入；
    而且它就是识别真正依赖的模型，拿它验证最贴近实际。
    注意：不能用 OCR 的 cls/rec 当探测对象 —— 它们的输入是动态形状（真实尺寸分别是
    48×192 / 48×N），喂错尺寸会抛错，会把健康显卡误判成不可用。
    """
    global _GPU_VERDICT, _PROBE_SESSION
    if _GPU_VERDICT is not None and not force:
        return _GPU_VERDICT

    import onnxruntime as ort

    from core.infra.logger import logger

    gpu_eps = [ep for ep in _GPU_EP_ORDER if ep in get_available_providers()]
    if env_ep_override() == "cpu" or not user_gpu_enabled():
        _GPU_VERDICT = {"usable": False, "reason": "已关闭 GPU 加速", "provider": ""}
        return _GPU_VERDICT
    if not gpu_eps:
        _GPU_VERDICT = {"usable": False, "reason": "当前推理库不含 GPU 执行后端", "provider": ""}
        return _GPU_VERDICT

    model = _recognizer_probe_model() or _probe_model_path()
    if not model:
        _GPU_VERDICT = {"usable": True, "reason": "缺少验证用模型，跳过真机验证", "provider": gpu_eps[0]}
        return _GPU_VERDICT

    last_reason = ""
    for ep in gpu_eps:
        try:
            session = ort.InferenceSession(model, providers=[ep, "CPUExecutionProvider"])
            providers = session.get_providers() or []
            actual = providers[0] if providers else ""
            if actual != ep:
                last_reason = f"{ep} 未真正生效（实际 {actual or '未知'}，通常是缺少可用的 D3D12 设备）"
                logger.warning(f"GPU 验证不通过：{last_reason}")
                continue
            if _shape_is_concrete(session.get_inputs()[0].shape):
                _smoke_forward(session)
                _PROBE_SESSION = (str(model), session)
                logger.info(f"GPU 可用性验证通过（含前向）：{ep}")
            else:
                logger.info(f"{ep} 会话创建成功；该模型是动态输入形状，跳过空输入前向验证")
            _GPU_VERDICT = {"usable": True, "reason": f"{ep} 真机验证通过", "provider": ep}
            return _GPU_VERDICT
        except Exception as e:  # noqa: BLE001
            last_reason = f"{ep} 验证失败：{type(e).__name__}: {e}"
            logger.warning(f"GPU 验证失败，将回退 CPU：{last_reason}")
    _GPU_VERDICT = {"usable": False, "reason": last_reason or "GPU 不可用", "provider": ""}
    return _GPU_VERDICT


def create_inference_session(model_path, sess_options=None, mode: str | None = None):
    """创建 ONNX 会话：优先 GPU，失败自动降级 CPU。

    与原来的 `ort.InferenceSession(path, sess_options=..., providers=['CPUExecutionProvider'])`
    行为一致（CPU 环境结果相同），只是多了 GPU 优先与失败回退。
    """
    import onnxruntime as ort

    from core.infra.logger import logger

    if sess_options is None:
        sess_options = create_session_options()

    global _ACTIVE_PROVIDERS, _LAST_ACTUAL_PROVIDER
    # 真机验证时已经为这个模型建过会话（并跑通前向），直接复用，避免同模型两份会话常驻内存
    if sess_options is None and _PROBE_SESSION and _PROBE_SESSION[0] == str(model_path):
        _LAST_ACTUAL_PROVIDER = (_PROBE_SESSION[1].get_providers() or ["CPUExecutionProvider"])[0]
        return _PROBE_SESSION[1]
    tried = []
    # 已经探测成功的后端排最前，避免每个会话都重新试一遍失败的 GPU
    planned = ([_ACTIVE_PROVIDERS] if _ACTIVE_PROVIDERS else []) + [
        c for c in provider_candidates(mode) if c != _ACTIVE_PROVIDERS
    ]
    last_err = None
    for providers in planned:
        if not providers:
            continue
        tried.append(providers[0])
        try:
            session = ort.InferenceSession(str(model_path), sess_options=sess_options, providers=providers)
            actual = (session.get_providers() or [providers[0]])[0]
            # ORT 可能在内部把请求的 GPU 静默换成 CPU（设备创建失败）——必须认出来
            if providers[0] in _GPU_EP_ORDER and actual != providers[0]:
                logger.warning(f"请求 {providers[0]} 实际生效 {actual}，判定 GPU 不可用，改用 CPU")
                mark_gpu_unusable(f"请求 {providers[0]} 实际生效 {actual}")
                continue
            # 形状明确时再真机前向一次：老显卡常见「能建会话、一跑就报设备错误」
            if actual in _GPU_EP_ORDER and _shape_is_concrete(session.get_inputs()[0].shape):
                try:
                    _smoke_forward(session)
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"{actual} 前向验证失败（{type(e).__name__}: {e}），改用 CPU 重建")
                    mark_gpu_unusable(f"{actual} 前向失败：{type(e).__name__}: {e}")
                    continue
            if _ACTIVE_PROVIDERS != providers:
                _ACTIVE_PROVIDERS = providers
                logger.info(f"ONNX 推理后端: {actual}（providers={providers}）")
            _LAST_ACTUAL_PROVIDER = actual
            return session
        except Exception as e:  # noqa: BLE001 - 任何后端问题都应降级而不是让识别挂掉
            last_err = e
            if providers[0] in _GPU_EP_ORDER:
                mark_gpu_unusable(f"{providers[0]} 建会话失败：{type(e).__name__}: {e}")
            logger.warning(f"ONNX 后端 {providers[0]} 建会话失败，降级下一个：{type(e).__name__}: {e}")

    # 兜底：所有候选都失败时抛出最后一次错误（保持与原来直接抛出的行为一致）
    raise last_err if last_err else RuntimeError(f"无法创建 ONNX 会话: {model_path}")


def describe_active_ep() -> str:
    """当前生效的推理后端描述（日志/自检用）。"""
    if _ACTIVE_PROVIDERS:
        return _ACTIVE_PROVIDERS[0]
    avail = get_available_providers()
    for ep in _GPU_EP_ORDER:
        if ep in avail:
            return f"{ep}(待首次使用)"
    return "CPUExecutionProvider"


def ocr_use_gpu() -> bool:
    """OCR（RapidOCR）是否走 GPU：ROCO_OCR_GPU=auto/1/0 控制，默认跟随「GPU 加速」开关。"""
    env = (os.environ.get("ROCO_OCR_GPU") or "auto").strip().lower()
    if env in ("0", "false", "off", "cpu"):
        return False
    if env in ("1", "true", "on", "gpu"):
        return True
    if not user_gpu_enabled():
        return False
    # 跟随 GPU 真机结论：老显卡/驱动不支持时这里也要回 CPU
    return bool(gpu_verdict().get("usable"))


def ocr_ep_kwargs() -> dict:
    """给 RapidOCR 的 GPU 开关（DirectML 优先；CUDA 环境用 CUDA）。

    RapidOCR 自己会校验 EP 可用性，不可用时自动回落 CPU；这里只负责表达意图。
    """
    if not ocr_use_gpu():
        return {}
    avail = get_available_providers()
    if "DmlExecutionProvider" in avail:
        return {"det_use_dml": True, "cls_use_dml": True, "rec_use_dml": True}
    if "CUDAExecutionProvider" in avail:
        return {"det_use_cuda": True, "cls_use_cuda": True, "rec_use_cuda": True}
    return {}


# --------------------------------------------------------------------------- #
# 运行时状态（给前端展示「当前用的是 GPU 还是 CPU」）
# --------------------------------------------------------------------------- #
_PROBE_CACHE: dict | None = None


def _recognizer_probe_model() -> str | None:
    """识别主模型（DINO backbone）：空间维固定，适合做真机前向验证。"""
    try:
        import config

        dino = getattr(config, "DINO", None)
        path = dino[0] if dino else None
        if path and os.path.exists(path):
            return path
    except Exception:
        pass
    return None


def _probe_model_path() -> str | None:
    """用一个很小的模型做真机探测（cls 只有 0.5MB，建会话快）。"""
    try:
        import config

        for p in (getattr(config, "CLS_MODEL", None), getattr(config, "DET_MODEL", None)):
            if p and os.path.exists(p):
                return p
    except Exception:
        pass
    return None


def _ep_label(provider: str | None) -> str:
    if not provider:
        return "未检测"
    if provider == "DmlExecutionProvider":
        return "GPU · DirectML"
    if provider == "CUDAExecutionProvider":
        return "GPU · CUDA"
    if provider == "OpenVINOExecutionProvider":
        return "GPU/CPU · OpenVINO"
    if provider == "CPUExecutionProvider":
        return "CPU"
    return provider


def _ep_short_label(provider: str | None) -> str:
    """简短标签：界面上只区分「GPU / CPU」，具体是 DirectML 还是 CUDA 放到悬浮提示里。"""
    if not provider:
        return "未知"
    return "GPU" if provider in _GPU_EP_ORDER else "CPU"


def probe_runtime(force: bool = False) -> dict:
    """真机探测一次「能不能用 GPU」，结果缓存；force=True 时重新探测。

    注意：只看 get_available_providers() 不够 —— 驱动/显卡不支持 D3D12、显存不足、
    远程桌面等情况下列表里照样有 DmlExecutionProvider，但建会话会失败。
    所以这里真的建一次小会话，拿到的才是"确实能用"的结论。
    """
    global _PROBE_CACHE, _ACTIVE_PROVIDERS, _LAST_ACTUAL_PROVIDER
    if _PROBE_CACHE is not None and not force:
        return _PROBE_CACHE

    import onnxruntime as ort

    avail = sorted(get_available_providers())
    gpu_eps = [ep for ep in _GPU_EP_ORDER if ep in avail]
    model = _recognizer_probe_model() or _probe_model_path()
    active = None
    error = None

    if force:
        _ACTIVE_PROVIDERS = None  # 清掉记忆，让它重新按候选顺序试
        _LAST_ACTUAL_PROVIDER = None

    verdict = gpu_verdict(force=force)
    if _LAST_ACTUAL_PROVIDER:
        active = _LAST_ACTUAL_PROVIDER
    elif verdict.get("usable"):
        active = verdict.get("provider") or None
    if active is None:
        active = "CPUExecutionProvider"
    if not verdict.get("usable"):
        error = verdict.get("reason") or error

    _PROBE_CACHE = {
        "mode": get_ep_mode(),
        "gpuEnabled": user_gpu_enabled(),
        "envOverride": env_ep_override() or "",
        "gpuAvailable": bool(gpu_eps),
        "gpuUsable": bool(verdict.get("usable")),
        "gpuReason": verdict.get("reason", ""),
        "gpuEps": gpu_eps,
        "availableProviders": avail,
        "active": active,
        "activeLabel": _ep_label(active),
        "activeShort": _ep_short_label(active),
        "isGpu": active not in (None, "CPUExecutionProvider") and active in _GPU_EP_ORDER,
        "ocrGpu": ocr_use_gpu(),
        "onnxruntime": getattr(ort, "__version__", ""),
        "device": ort.get_device(),
        "probeModel": os.path.basename(model) if model else None,
        "error": error,
    }
    # 硬件信息（显卡型号/显存/CPU）一并带上，前端展示用；失败不影响状态本身
    try:
        from core.infra.gpu_info import hardware_summary

        hw = hardware_summary()
        _PROBE_CACHE.update({
            "gpuName": hw.get("gpuName", ""),
            "gpuVramMB": hw.get("gpuVramMB", 0),
            "gpuCount": hw.get("gpuCount", 0),
            "gpuAdapters": [a["name"] for a in hw.get("adapters", [])],
            "cpuName": hw.get("cpuName", ""),
        })
    except Exception as e:  # noqa: BLE001
        _PROBE_CACHE.update({"gpuName": "", "gpuVramMB": 0, "gpuCount": 0, "gpuAdapters": [], "cpuName": ""})
    return _PROBE_CACHE


def runtime_status(force: bool = False) -> dict:
    """给前端的状态快照：当前后端、可选后端、ONNX Runtime 版本等。"""
    return dict(probe_runtime(force=force))
