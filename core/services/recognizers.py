"""识别模型单例服务：全图鉴图标识别器全局唯一，试炼关卡分类器按试炼懒加载。"""
import os

import config
from core.vision.stage_classifier import StageClassifier
from core.vision.recognizer import ImageRecognizer
from core.infra.logger import logger
from core.services.trials import get_trial_or_default


class _ModelRegistry:
    """进程内模型注册表，避免重复加载大模型。"""

    def __init__(self):
        self._icon_recognizer = None
        self._stage_classifiers = {}
        # DINO backbone 共享会话：图标识别器与关卡分类器复用同一个 ONNX session，
        # 避免同一份 dino_backbone.onnx（约 84MB）在内存里常驻两份。
        self._dino_session = None

    def _get_dino_session(self):
        """按需创建并缓存唯一的 DINO backbone ONNX 会话（图标/标题共用）。"""
        if self._dino_session is not None:
            return self._dino_session

        model_path = config.DINO[0]
        try:
            from core.infra.ort_session import create_inference_session
            if not os.path.exists(model_path):
                logger.warning(f"DINO backbone 模型文件不存在: {model_path}")
                return None
            logger.info(f"加载共享 DINO backbone 会话: {model_path}")
            # 优先 GPU（DirectML/CUDA），不可用时自动降级 CPU
            self._dino_session = create_inference_session(model_path)
        except Exception as e:
            logger.error(f"共享 DINO backbone 会话加载失败: {e}", exc_info=True)
            self._dino_session = None
        return self._dino_session

    def get_icon_recognizer(self):
        """ImageRecognizer（全图鉴图标特征匹配）全局单例。固定使用 dino_full。"""
        if self._icon_recognizer is not None:
            return self._icon_recognizer

        scheme = "DINOv2"
        model_path, feature_path = config.DINO
        if not feature_path or not os.path.exists(feature_path):
            logger.warning(f"全图鉴图标特征库不存在: {feature_path}，跳过加载")
            return None

        try:
            logger.info(f"正在加载 icon 识别器 backend={scheme}: 模型={model_path}, 特征库={feature_path}")
            self._icon_recognizer = ImageRecognizer(
                model_path, feature_path, session=self._get_dino_session()
            )
            logger.info(f"全图鉴图标特征库加载成功！(backend={scheme})")
            return self._icon_recognizer
        except Exception as e:
            logger.error(f"全图鉴图标特征库加载失败: {e}", exc_info=True)
            self._icon_recognizer = None
            return None

    def get_stage_classifier(self, trial_key="grass"):
        """StageClassifier（试炼关卡判定：关卡标题识别，图1-3）单例，按试炼隔离。"""
        if trial_key in self._stage_classifiers:
            return self._stage_classifiers[trial_key]

        trial = get_trial_or_default(trial_key)
        feature_path = trial.get("title_feature_path")
        if not feature_path or not os.path.exists(feature_path):
            logger.warning(f"试炼 {trial_key} 的地图标题特征库不存在: {feature_path}，跳过加载")
            self._stage_classifiers[trial_key] = None
            return None

        try:
            logger.info(f"试炼 {trial_key} 地图分类器未初始化，执行懒加载...")
            # title 识别也统一用 DINOv2 backbone（自动适配 518 输入），不再用 resnet50；
            # 复用与图标识别器相同的 DINO backbone 会话，避免重复加载同一份模型。
            classifier = StageClassifier(
                config.DINO_BACKBONE,
                feature_path,
                session=self._get_dino_session(),
            )
            self._stage_classifiers[trial_key] = classifier
            return classifier
        except Exception as e:
            logger.error(f"试炼 {trial_key} 地图分类器加载失败: {e}", exc_info=True)
            self._stage_classifiers[trial_key] = None
            return None


# 全局单例
models = _ModelRegistry()


def reset_inference_singletons() -> None:
    """丢弃全部已建会话与识别器（GPU 加速开关变化后调用）。

    只做丢弃，不重建：下次识别时按新的后端偏好懒加载。级联清空各识别器持有的
    session 引用，避免旧会话继续被复用。
    """
    registry = models
    for name in ("_icon_recognizer", "_dino_session"):
        obj = getattr(registry, name, None)
        if obj is not None and hasattr(obj, "session"):
            try:
                obj.session = None
            except Exception:  # noqa: BLE001
                pass
        setattr(registry, name, None)
    for classifier in (getattr(registry, "_stage_classifiers", {}) or {}).values():
        if classifier is not None and hasattr(classifier, "session"):
            try:
                classifier.session = None
            except Exception:  # noqa: BLE001
                pass
    registry._stage_classifiers = {}
    logger.info("已清空识别器/共享会话单例，等待按新后端重建")
