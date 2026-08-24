"""识别模型单例服务：图标特征识别器与地图分类器按试炼懒加载一次。"""
import os

import config
from core.map_classifier import MapClassifier
from core.recognizer import ImageRecognizer
from core.logger import logger
from core.services.trials import get_trial_or_default


class _ModelRegistry:
    """进程内模型注册表，避免重复加载大模型。"""

    def __init__(self):
        self._icon_recognizers = {}
        self._map_classifiers = {}

    def get_icon_recognizer(self, trial_key="grass"):
        """ImageRecognizer（图标特征匹配）单例，按试炼隔离。"""
        if trial_key in self._icon_recognizers:
            return self._icon_recognizers[trial_key]

        trial = get_trial_or_default(trial_key)
        feature_path = trial.get("icon_feature_path")
        if not feature_path or not os.path.exists(feature_path):
            logger.warning(f"试炼 {trial_key} 的图标特征库不存在: {feature_path}，跳过加载")
            self._icon_recognizers[trial_key] = None
            return None

        try:
            logger.info(f"正在加载图标特征库({trial_key}): {feature_path}")
            recognizer = ImageRecognizer(config.RESNET50, feature_path)
            logger.info(f"试炼 {trial_key} 图标特征库加载成功！")
            self._icon_recognizers[trial_key] = recognizer
            return recognizer
        except Exception as e:
            logger.error(f"试炼 {trial_key} 图标特征库加载失败: {e}", exc_info=True)
            self._icon_recognizers[trial_key] = None
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
