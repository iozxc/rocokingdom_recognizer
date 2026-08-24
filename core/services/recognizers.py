"""识别模型单例服务：全图鉴图标识别器全局唯一，地图分类器按试炼懒加载。"""
import os

import config
from core.map_classifier import MapClassifier
from core.recognizer import ImageRecognizer
from core.logger import logger
from core.services.trials import get_trial_or_default


class _ModelRegistry:
    """进程内模型注册表，避免重复加载大模型。"""

    def __init__(self):
        self._icon_recognizer = None
        self._map_classifiers = {}

    def get_icon_recognizer(self):
        """ImageRecognizer（全图鉴图标特征匹配）全局单例，不再按试炼区分。"""
        if self._icon_recognizer is not None:
            return self._icon_recognizer

        feature_path = config.FEATURES_ICON
        if not feature_path or not os.path.exists(feature_path):
            logger.warning(f"全图鉴图标特征库不存在: {feature_path}，跳过加载")
            return None

        try:
            logger.info(f"正在加载全图鉴图标特征库: {feature_path}")
            self._icon_recognizer = ImageRecognizer(config.RESNET50, feature_path)
            logger.info("全图鉴图标特征库加载成功！")
            return self._icon_recognizer
        except Exception as e:
            logger.error(f"全图鉴图标特征库加载失败: {e}", exc_info=True)
            self._icon_recognizer = None
            return None

    def get_map_classifier(self, trial_key="grass"):
        """MapClassifier（地图识别）单例，按试炼隔离。"""
        if trial_key in self._map_classifiers:
            return self._map_classifiers[trial_key]

        trial = get_trial_or_default(trial_key)
        feature_path = trial.get("title_feature_path")
        if not feature_path or not os.path.exists(feature_path):
            logger.warning(f"试炼 {trial_key} 的地图标题特征库不存在: {feature_path}，跳过加载")
            self._map_classifiers[trial_key] = None
            return None

        try:
            logger.info(f"试炼 {trial_key} 地图分类器未初始化，执行懒加载...")
            classifier = MapClassifier(config.RESNET50, feature_path)
            self._map_classifiers[trial_key] = classifier
            return classifier
        except Exception as e:
            logger.error(f"试炼 {trial_key} 地图分类器加载失败: {e}", exc_info=True)
            self._map_classifiers[trial_key] = None
            return None


# 全局单例
models = _ModelRegistry()
