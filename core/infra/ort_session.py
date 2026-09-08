"""ONNX Runtime 会话统一配置（避免多个推理会话线程过度订阅）。

桌面端同一时刻会加载 DINO（图标/标题）、YOLO、OCR 等多个 ONNX 会话。
如果每个会话都让 ORT 默认开满逻辑核，串行识别时多个线程池会互相争抢 CPU，
表现为识别瞬间 CPU 100%、整机卡顿。这里统一把 intra-op 线程收敛到“逻辑核一半”
（通常即物理核数），并关闭 inter-op 并行，保证多会话串行执行时不会互相抢核。
"""
import os


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
