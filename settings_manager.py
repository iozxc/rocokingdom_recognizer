import json
import os
from logger import logger
import config


class SettingsManager:
    _instance = None
    _initialized: bool = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _init(self):
        """懒加载初始化，仅执行一次，第一次get/set才调用"""
        if self._initialized:
            return

        self.settings_file = config.DATA_FILE
        self._runtime_config = {
            "capture_mode": config.CAPTURE_MODE
        }
        self.load_from_file()
        self._initialized = True
        logger.info(f"配置初始化完成，当前截图模式: {self.capture_mode}")

    def load_from_file(self):
        if not os.path.exists(self.settings_file):
            logger.debug("配置文件不存在，将使用默认配置")
            return

        try:
            with open(self.settings_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            app_settings = data.get("appSettings", {})
            if not isinstance(app_settings, dict):
                logger.warning("appSettings 格式异常，忽略加载")
                return

            for key in self._runtime_config:
                if key in app_settings:
                    self._runtime_config[key] = app_settings[key]

        except json.JSONDecodeError:
            logger.warning("配置文件格式损坏，将使用默认配置")
        except Exception as e:
            logger.warning(f"配置文件加载失败: {e}")

    def _save_to_file(self):
        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = {}

            if "appSettings" not in data or not isinstance(data["appSettings"], dict):
                data["appSettings"] = {}

            for key, value in self._runtime_config.items():
                data["appSettings"][key] = value

            with open(self.settings_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

        except Exception as e:
            logger.error(f"配置文件保存失败: {e}")

    def get(self, key: str):
        self._init()
        return self._runtime_config.get(key)

    def set(self, key: str, value) -> tuple[bool, str]:
        self._init()
        if key not in self._runtime_config:
            return False, f"不支持的配置项: {key}"
        self._runtime_config[key] = value
        self._save_to_file()
        return True, "success"

    @property
    def capture_mode(self) -> str:
        return str(self.get("capture_mode")).strip().lower()

    def set_capture_mode(self, mode: str) -> tuple[bool, str]:
        valid_modes = ["grab", "hwnd"]
        mode = mode.strip().lower()
        if mode not in valid_modes:
            return False, f"非法模式，可选值: {valid_modes}"
        return self.set("capture_mode", mode)


# 仅创建实例，导入阶段不会读文件、不会打日志
settings = SettingsManager()
