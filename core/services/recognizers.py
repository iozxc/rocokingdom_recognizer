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
            self._icon_recognizer = ImageRecognizer(model_path, feature_path)
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
            # title 识别也统一用 DINOv2 backbone（自动适配 518 输入），不再用 resnet50
            classifier = StageClassifier(config.DINO_BACKBONE, feature_path)
            self._stage_classifiers[trial_key] = classifier
            return classifier
        except Exception as e:
            logger.error(f"试炼 {trial_key} 地图分类器加载失败: {e}", exc_info=True)
            self._stage_classifiers[trial_key] = None
            return None


# 全局单例
models = _ModelRegistry()
