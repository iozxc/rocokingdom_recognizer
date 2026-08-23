import hashlib
import os
import subprocess
import shutil
import time

import py7zr
import requests
from py7zr.exceptions import UnsupportedCompressionMethodError

import config
from flask import Blueprint
from core.logger import logger
from core.version import get_update_info
import threading

bp = Blueprint("updater", __name__)

combined_zip = "RocoKingdomReg_Update_Package.7z"
inner_zip = "RocoKingdomRecognizer.7z"
temp_extract_dir = "new_version_files"

# py7zr 不支持的常见 7z 压缩方法/过滤器（用于给出可读的错误提示）
UNSUPPORTED_METHOD_NAMES = {
    b"\x0a": "Zstandard（7-Zip 21.02+ 原生）",
    b"\x03\x03\x01\x1b": "BCJ2（7-Zip 高压缩模式，压缩等级选得过高）",
    b"\x04\xf7\x11\x01": "Zstandard（插件版）",
    b"\x04\xf7\x11\x02": "Brotli",
    b"\x04\xf7\x11\x04": "LZ4",
}


# 用于存放当前的下载状态
class UpdateManager:
    def __init__(self):
        self.latest_info = None  # 存储最近一次 check_update 拿到的数据
        self.progress = 0  # 已下载字节数
        self.total_bytes = 0  # 全部分片总字节
        self.status = "idle"  # idle, downloading, verifying, ready, error, merging, paused
        self.error_msg = ""
        self.stop_requested = False
        self.pause_requested = False

        # 用于计算下载速度
        self.speed_bps = 0  # 字节/秒
        self._last_bytes = 0  # 上一次的已下载字节
        self._last_time = 0.0  # 上一次采样时间戳

updater = UpdateManager()


def verify_md5(file_path, expected_md5):
    """校验文件的 MD5 值"""
    hash_md5 = hashlib.md5()
    try:
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hash_md5.update(chunk)
        result = hash_md5.hexdigest().lower() == expected_md5.lower()
        logger.debug(f"MD5校验: {os.path.basename(file_path)} -> {'通过' if result else '失败'}")
        return result
    except Exception as e:
        logger.error(f"MD5校验异常 {file_path}: {e}", exc_info=True)
        return False


def handle_cleanup(temp_dir):
    """清理函数：删除下载到一半的文件"""
    try:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        if os.path.exists(combined_zip):
            os.remove(combined_zip)
        updater.status = "stopped"
        updater.progress = 0
        logger.info("下载已停止并清理临时文件")
    except Exception as e:
        logger.info(f"清理失败: {e}")


def real_download_logic():
    updater.status = "downloading"
    updater.error_msg = ""
    updater.stop_requested = False
    updater.pause_requested = False

    logger.info("开始执行更新下载流程")

    try:
        auto_update_cfg = updater.latest_info.get('auto_update')
        files = auto_update_cfg['files']
        base_url = auto_update_cfg['base_url']
        logger.info(f"下载配置: 分片数={len(files)}, 基地址={base_url}")

        temp_dir = "update_temp"
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)

        file_size_map = {}
        is_resume = updater.status == "paused" and updater.total_bytes > 0

        logger.info(f"下载模式: {'断点续传' if is_resume else '全新下载'}")

        if not is_resume:
            # 全新下载：HEAD 请求获取分片大小，重置进度
            updater.progress = 0
            updater.total_bytes = 0
            headers_head = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            for file_item in files:
                download_url = base_url + file_item['name']
                try:
                    resp_head = requests.head(download_url, headers=headers_head, timeout=10, allow_redirects=True)
                    resp_head.raise_for_status()
                    size = int(resp_head.headers["content-length"])
                except Exception:
                    logger.warning(f"HEAD请求失败，改用GET获取大小: {file_item['name']}")
                    resp_head = requests.get(download_url, headers=headers_head, stream=True, timeout=10)
                    resp_head.close()
                    resp_head.raise_for_status()
                    size = int(resp_head.headers["content-length"])
                file_size_map[file_item['name']] = size
                updater.total_bytes += size
            logger.info(f"更新包总大小: {updater.total_bytes / 1024 / 1024:.1f} MB")
        else:
            # -------- 断点恢复：不再发HEAD请求，从内存读取旧的file_size_map不存在，重新构建size_map --------
            for file_item in files:
                # 恢复模式下必须依赖上一次保存的total_bytes；如果进程重启，is_resume=False，会重新HEAD
                file_size_map[file_item['name']] = file_item["size"]

        finished_part_bytes = 0
        for file_item in files:
            fname = file_item['name']
            fpath = os.path.join(temp_dir, fname)
            fsize = file_size_map[fname]
            if os.path.exists(fpath) and os.path.getsize(fpath) == fsize:
                finished_part_bytes += fsize
        updater.progress = finished_part_bytes
        if finished_part_bytes > 0:
            logger.info(f"断点续传: 已完成 {finished_part_bytes / 1024 / 1024:.1f} MB / {updater.total_bytes / 1024 / 1024:.1f} MB")

        # 速度统计初始化，使用当前已下载字节，避免恢复瞬间速度异常
        updater.speed_bps = 0
        updater._last_bytes = updater.progress
        updater._last_time = time.time()

        for i, file_item in enumerate(files):
            if updater.stop_requested:
                handle_cleanup(temp_dir)
                return
            if updater.pause_requested:
                updater.status = "paused"
                updater.speed_bps = 0
                logger.info("下载已暂停，保留本地分片文件")
                return

            file_name = file_item['name']
            expected_md5 = file_item['md5']
            download_url = base_url + file_name
            save_path = os.path.join(temp_dir, file_name)
            this_file_total_size = file_size_map[file_name]

            existing_size = 0
            if os.path.exists(save_path):
                existing_size = os.path.getsize(save_path)

            if existing_size == this_file_total_size:
                logger.debug(f"分片 {file_name} 已存在且完整，跳过下载")
                updater.status = f"verifying_{i + 1}"
                if not verify_md5(save_path, expected_md5):
                    updater.status = "error"
                    updater.error_msg = f"文件 {file_name} 校验失败，请重试。"
                    updater.speed_bps = 0
                    logger.error(f"分片校验失败: {file_name}")
                    return
                updater.status = "downloading"
                finished_part_bytes += this_file_total_size
                updater.progress = finished_part_bytes
                continue

            logger.info(f"开始下载分片 [{i+1}/{len(files)}]: {file_name} "
                       f"({this_file_total_size / 1024 / 1024:.1f} MB, 断点={existing_size > 0})")

            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
            if existing_size > 0:
                headers["Range"] = f"bytes={existing_size}-"

            response = requests.get(
                download_url,
                stream=True,
                headers=headers,
                timeout=15
            )
            if response.status_code not in (200, 206):
                response.raise_for_status()

            open_mode = "ab" if existing_size > 0 else "wb"
            with open(save_path, open_mode) as f:
                current_file_downloaded = existing_size

                for data in response.iter_content(chunk_size=65536):
                    if updater.stop_requested:
                        f.close()
                        updater.speed_bps = 0
                        handle_cleanup(temp_dir)
                        return
                    if updater.pause_requested:
                        f.close()
                        updater.status = "paused"
                        updater.speed_bps = 0
                        logger.info("下载已暂停")
                        return

                    chunk_len = len(data)
                    current_file_downloaded += chunk_len
                    f.write(data)

                    # 全局已下载字节
                    updater.progress = finished_part_bytes + current_file_downloaded

                    # ------------------计算瞬时下载速度------------------
                    now = time.time()
                    delta_time = now - updater._last_time
                    # 每200ms采样一次，避免频繁计算
                    if delta_time >= 0.2:
                        delta_bytes = updater.progress - updater._last_bytes
                        updater.speed_bps = delta_bytes / delta_time
                        updater._last_bytes = updater.progress
                        updater._last_time = now

            if updater.stop_requested:
                updater.speed_bps = 0
                handle_cleanup(temp_dir)
                return
            if updater.pause_requested:
                updater.speed_bps = 0
                updater.status = "paused"
                return

            updater.status = f"verifying_{i + 1}"
            if not verify_md5(save_path, expected_md5):
                updater.status = "error"
                updater.error_msg = f"文件 {file_name} 校验失败，请重试。"
                updater.speed_bps = 0
                logger.error(f"分片下载后校验失败: {file_name}")
                return

            updater.status = "downloading"
            finished_part_bytes += this_file_total_size
            updater.progress = finished_part_bytes
            logger.info(f"分片下载完成 [{i+1}/{len(files)}]: {file_name}")

        # 全部完成
        updater.status = "merging"
        updater.speed_bps = 0
        logger.info("所有分片下载完成，开始合并...")
        combined_zip = "RocoKingdomReg_Update_Package.7z"
        with open(combined_zip, "wb") as outfile:
            for file_item in files:
                part_path = os.path.join(temp_dir, file_item['name'])
                with open(part_path, "rb") as infile:
                    outfile.write(infile.read())

        shutil.rmtree(temp_dir)
        updater.progress = updater.total_bytes
        updater.status = "ready"
        logger.info("所有分包下载、校验并合并完成！")

    except requests.exceptions.RequestException as e:
        updater.status = "error"
        updater.error_msg = f"网络连接失败: {str(e)}"
        updater.speed_bps = 0
        logger.error(f"更新下载网络异常: {e}", exc_info=True)
    except Exception as e:
        updater.status = "error"
        updater.error_msg = f"更新失败: {str(e)}"
        updater.speed_bps = 0
        logger.error(f"更新下载异常: {e}", exc_info=True)

def create_bat_script(temp_dir):
    exe_name = config.APP_EXE_NAME

    logger.debug("创建更新批处理脚本 update.bat")
    bat_path = os.path.abspath("update.bat")

    # 批处理脚本内容
    # ping 127.0.0.1 -n 3 用于等待 2 秒（比 timeout 更兼容）
    bat_content = f"""@echo off
setlocal enabledelayedexpansion

:: 切换到脚本所在目录，避免工作目录不一致导致找不到文件
cd /d "%~dp0"

:: 设置最大重试次数
set /a retry_count=0
set /a max_retries=10

echo [1/4] 正在强制结束残留进程...
:: 强制杀掉主程序（不带 /T，避免误杀正在执行本脚本的 cmd 进程树）
taskkill /f /im {exe_name} >nul 2>nul
:: 如果有特定的 webview 进程也可以杀掉
taskkill /f /im msedgewebview2.exe /t >nul 2>nul

:retry_delete
echo [2/4] 正在尝试清理旧版本文件 (第 !retry_count! 次尝试)...
ping 127.0.0.1 -n 2 > nul

:: 尝试删除主程序
if exist {exe_name} (
    del /f /q {exe_name} >nul 2>nul
)

:: 尝试删除 libs 文件夹
if exist libs (
    rd /s /q libs >nul 2>nul
)

:: 检查是否还存在（即删除是否成功）
if exist {exe_name} (
    set /a retry_count+=1
    if !retry_count! geq !max_retries! (
        goto failed
    )
    echo 文件仍被占用，正在等待重试...
    goto retry_delete
)

echo [3/4] 正在应用新版本文件...
xcopy /s /y /e "new_version_files\\*" "." >nul

echo [4/4] 清理临时文件并启动...
rd /s /q "new_version_files"
del /f /q RocoKingdomRecognizer.7z
del /f /q RocoKingdomReg_Update_Package.7z

start "" "{exe_name}"
echo 更新成功！
goto end

:failed
echo [错误] 无法覆盖文件。请手动关闭所有相关程序，或尝试以管理员身份运行。
pause

:end
(goto) 2>nul & del "%~f0"
"""
    # 必须使用 gbk 编码，否则 Windows 批处理显示中文会乱码
    with open(bat_path, "w", encoding="gbk") as f:
        f.write(bat_content)
    logger.debug(f"更新批处理脚本创建完成: {bat_path}")
    return bat_path


def apply_update():
    """
    解压并准备更新脚本
    成功时启动 update.bat 并退出进程；失败时返回错误信息字符串。
    """
    logger.info("开始应用更新：解压并准备安装脚本")
    try:
        if not os.path.exists(combined_zip):
            return "未找到更新包文件，请重新下载"

        # 1. 第一层解压：提取出内部的 RocoKingdomRecognizer.7z
        logger.debug("第一层解压: 提取内部更新包")
        with py7zr.SevenZipFile(combined_zip, 'r') as z:
            z.extract(path=".", targets=[inner_zip])

        # 2. 第二层解压：将 RocoKingdomRecognizer.7z 解压到临时目录
        if os.path.exists(temp_extract_dir):
            shutil.rmtree(temp_extract_dir)

        logger.debug("第二层解压: 解压到临时目录")
        with py7zr.SevenZipFile(inner_zip, 'r') as z:
            z.extractall(temp_extract_dir)

        # 3. 创建批处理脚本
        bat_path = create_bat_script(temp_extract_dir)

        # 4. 启动脚本并退出
        # 打包后的 exe 是无控制台窗口的 GUI 进程，直接用 Popen(bat, shell=True)
        # 启动 cmd 需要新建控制台，父进程一退出它就可能卡住/被连带结束，导致 bat 不执行。
        # 因此用 os.startfile 让 bat 完全脱离当前进程运行；失败时降级为隐藏窗口方式。
        logger.info("启动更新脚本并退出当前进程")
        try:
            os.startfile(bat_path)
        except OSError as e:
            logger.warning(f"os.startfile 启动更新脚本失败，改用隐藏窗口方式: {e}")
            subprocess.Popen(
                ["cmd", "/c", bat_path],
                creationflags=subprocess.CREATE_NO_WINDOW,
                close_fds=True,
            )
        os._exit(0)  # 强制关闭当前 Python 进程

    except UnsupportedCompressionMethodError as e:
        # 典型场景：更新包用 7-Zip 的 Zstandard 或高压缩模式（BCJ2）打包，
        # py7zr 只支持 LZMA/LZMA2/BZip2/Deflate/Copy。
        logger.error(f"更新包压缩算法不受支持: {e}", exc_info=True)
        method = e.args[0] if e.args else b""
        if isinstance(method, (bytes, bytearray)):
            method = bytes(method)
        name = UNSUPPORTED_METHOD_NAMES.get(method, f"未知算法({method!r})")
        return (f"更新包使用了 py7zr 无法解析的压缩算法：{name}。"
                "请用 7-Zip 以 LZMA2（压缩等级不要选最大/极致）重新打包更新包，"
                "或运行 tools/pack_update.py 自动生成。")
    except Exception as e:
        # === 修复 === 增加 exc_info
        logger.error(f"解压或启动更新脚本失败: {e}", exc_info=True)
        return f"安装失败: {e}"


@bp.route('/api/check_update')
def check_update_api():
    logger.info("[API] 检查更新")
    info = get_update_info()
    updater.latest_info = info
    has_update = info.get("has_update", False)
    latest = info.get("latest_version", "未知")
    logger.info(f"[API] 检查更新结果: has_update={has_update}, latest={latest}")
    return info

@bp.route('/api/start_download')
def start_download_api():
    logger.info(f"[API] 请求开始下载, 当前状态={updater.status}")
    if not updater.latest_info:
        logger.warning("[API] 开始下载失败: latest_info为空")
        return {"status": "error", "message": "无效操作"}

    if updater.status == "downloading":
        logger.debug("[API] 已在下载中，跳过")
        return {"status": "downloading"}

    # 开启新线程下载，防止阻塞 Flask 响应
    thread = threading.Thread(target=real_download_logic)
    thread.start()

    return {"status": "downloading"}

@bp.route('/api/download_progress')
def get_progress():
    return {
        "progress": updater.progress,
        "total_bytes": updater.total_bytes,
        "status": updater.status,
        "speed_bps": round(updater.speed_bps, 1),  # 字节/秒，保留一位小数
        "error": updater.error_msg
    }

@bp.route('/api/apply_update', methods=['GET'])
def apply_update_api():
    """开始安装"""
    logger.info("[API] 请求应用更新（安装）")
    error_msg = apply_update()
    if error_msg:
        updater.status = "error"
        updater.error_msg = error_msg
        return {"status": "error", "message": error_msg}
    return {"status": "install"}

@bp.route('/api/stop_download', methods=['GET'])
def stop_download():
    """停止下载信号"""
    logger.info("[API] 请求暂停下载")
    updater.pause_requested = True
    return {"status": "stopped"}

@bp.route('/api/delete_download', methods=['GET'])
def delete_download():
    """删除已下载的更新文件（无论是下完的还是没下完的）"""
    logger.info("[API] 请求删除已下载的更新文件")
    # 如果正在下载，先发停止信号
    updater.stop_requested = True
    updater.pause_requested = False
    handle_cleanup("update_temp")
    updater.status = "idle"  # 重置回空闲状态
    return {"status": "deleted"}
