"""识别模型单例服务：图标特征识别器与地图分类器只加载一次。"""
import config
from core.map_classifier import MapClassifier
from core.recognizer import ImageRecognizer
from logger import logger


class _ModelRegistry:
    """进程内模型注册表，避免重复加载大模型。"""

    def __init__(self):
        self._icon_recognizer = None
        self._map_classifier = None

    def get_icon_recognizer(self):
        """ImageRecognizer（图标特征匹配）单例。"""
        try:
            if self._icon_recognizer is None:
                logger.info(f"正在加载图标特征库: {config.FEATURES_DB}")
                self._icon_recognizer = ImageRecognizer(config.RESNET50, config.FEATURES_DB)
                logger.info("图标特征库加载成功！")
            return self._icon_recognizer
        except Exception as e:
            logger.error(f"图标特征库加载失败: {e}", exc_info=True)
            return None

    def get_map_classifier(self):
        """MapClassifier（地图识别）单例。"""
        if self._map_classifier is None:
            logger.info("地图分类器未初始化，执行懒加载...")
            self._map_classifier = MapClassifier(config.RESNET50, config.FEATURES2_DB)
        return self._map_classifier


# 全局单例
models = _ModelRegistry()
