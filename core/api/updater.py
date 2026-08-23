import hashlib
import os
import subprocess
import shutil
import time

import py7zr
import requests
from py7zr.exceptions import UnsupportedCompressionMethodError

import config
from flask import Blueprint, request
from core.logger import logger
from core.version import get_update_info
import threading

bp = Blueprint("updater", __name__)

combined_zip = "RocoKingdomReg_Update_Package.7z"
inner_zip = "RocoKingdomRecognizer.7z"
delta_zip = "RocoKingdomRecognizer_delta.7z"
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
        self.mode = "full"  # full=整包 / delta=增量包
        self.download_target = combined_zip  # 下载合并后的目标包名
        self.force_full = False  # 用户选择强制整包更新

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
        if os.path.exists(updater.download_target):
            os.remove(updater.download_target)
        updater.status = "stopped"
        updater.progress = 0
        logger.info("下载已停止并清理临时文件")
    except Exception as e:
        logger.info(f"清理失败: {e}")


def build_download_plan():
    """决定本次下载增量包还是整包。返回 (mode, base_url, files) 或 None。"""
    latest = updater.latest_info or {}
    deltas = latest.get("deltas") or []
    if not deltas and latest.get("delta"):
        # 兼容旧的单个 delta 字段
        deltas = [latest["delta"]]

    match = None
    if not updater.force_full:
        for d in deltas:
            if (
                d.get("base_version") == config.APP_VERSION
                and d.get("url")
                and d.get("md5")
            ):
                match = d
                break

    if match and os.path.exists(config.MANIFEST_FILE):
        url = match["url"].rstrip("/")
        name = url.rsplit("/", 1)[-1]
        logger.info(
            f"当前版本 {config.APP_VERSION} 匹配增量包 base {match['base_version']}，走增量更新"
        )
        return "delta", url.rsplit("/", 1)[0] + "/", [
            {"name": name, "md5": match["md5"], "size": match.get("size", 0)}
        ]

    auto_update = latest.get("auto_update") or {}
    files = auto_update.get("files") or []
    base_url = auto_update.get("base_url", "")
    if not files:
        return None
    logger.info("增量包不适用（版本不匹配或缺少本地文件清单），回退整包更新")
    return "full", base_url, files


def real_download_logic():
    updater.status = "downloading"
    updater.error_msg = ""
    updater.stop_requested = False
    updater.pause_requested = False

    logger.info("开始执行更新下载流程")

    try:
        plan = build_download_plan()
        if plan is None:
            updater.status = "error"
            updater.error_msg = "更新配置无效：未找到可用的下载地址。"
            return
        mode, base_url, files = plan
        updater.mode = mode
        updater.download_target = delta_zip if mode == "delta" else combined_zip
        logger.info(
            f"下载配置: 模式={'增量包' if mode == 'delta' else '整包'}, "
            f"文件数={len(files)}, 基地址={base_url}"
        )

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
        target = updater.download_target
        with open(target, "wb") as outfile:
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

def create_update_ps1(update_mode="full"):
    """生成 PowerShell 更新脚本：自定义美观窗口（无黑框 cmd），整包/增量通用。"""
    exe_name = config.APP_EXE_NAME
    exe_stem = os.path.splitext(exe_name)[0]
    ps1_path = os.path.abspath("update.ps1")

    # 整包更新：先清掉旧 exe/libs，避免残留旧文件
    clear_old = (
        f"Remove-Item -LiteralPath 'libs' -Recurse -Force -ErrorAction SilentlyContinue\n"
        f"Remove-Item -LiteralPath '{exe_name}' -Force -ErrorAction SilentlyContinue"
        if update_mode == "full"
        else ""
    )

    template = r"""$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Set-Location -LiteralPath $PSScriptRoot

# ---- 结束残留进程 ----
Stop-Process -Name '{{EXE_STEM}}' -Force -ErrorAction SilentlyContinue
Stop-Process -Name 'msedgewebview2' -Force -ErrorAction SilentlyContinue

# ---- 更新窗口 ----
$form = $null
try {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = '正在更新'
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'None'
    $form.Size = New-Object System.Drawing.Size(400, 180)
    $form.BackColor = [System.Drawing.Color]::FromArgb(31, 78, 121)
    $form.ShowInTaskbar = $true
    $form.TopMost = $true

    # 圆角
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 24
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($form.Width - $d, 0, $d, $d, 270, 90)
    $path.AddArc($form.Width - $d, $form.Height - $d, $d, $d, 0, 90)
    $path.AddArc(0, $form.Height - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $form.Region = New-Object System.Drawing.Region($path)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = '洛克王国草系徽章助手'
    $title.Font = New-Object System.Drawing.Font('Microsoft YaHei', 14, [System.Drawing.FontStyle]::Bold)
    $title.ForeColor = 'White'
    $title.AutoSize = $false
    $title.Size = New-Object System.Drawing.Size(356, 42)
    $title.Location = New-Object System.Drawing.Point(22, 20)
    $title.TextAlign = 'MiddleLeft'
    $form.Controls.Add($title)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = '正在准备更新...'
    $status.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9)
    $status.ForeColor = 'White'
    $status.AutoSize = $false
    $status.Size = New-Object System.Drawing.Size(356, 26)
    $status.Location = New-Object System.Drawing.Point(22, 66)
    $form.Controls.Add($status)

    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Size = New-Object System.Drawing.Size(356, 18)
    $bar.Location = New-Object System.Drawing.Point(22, 104)
    $bar.Minimum = 0
    $bar.Maximum = 100
    $bar.Style = 'Continuous'
    $form.Controls.Add($bar)

    $form.Show()
} catch {
    $form = $null
}

function Set-Progress([string]$text, [int]$pct) {
    if ($null -ne $form) {
        try {
            $status.Text = $text
            $bar.Value = $pct
            $form.Refresh()
        } catch {}
    }
    Start-Sleep -Milliseconds 200
}

Set-Progress '正在结束旧进程...' 8

# ---- 应用新文件（整包先清旧文件，增量只覆盖变更）----
Set-Progress '正在应用更新文件...' 25
$copied = $false
for ($i = 0; $i -lt 10; $i++) {
{{CLEAR_OLD}}
    Copy-Item -Path 'new_version_files\*' -Destination '.' -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath '{{EXE_NAME}}') {
        $copied = $true
        break
    }
    Start-Sleep -Milliseconds 600
}

# ---- 删除本版本移除的旧文件（增量包携带 removed.txt）----
Set-Progress '正在清理旧文件...' 55
if (Test-Path -LiteralPath 'new_version_files\removed.txt') {
    Get-Content -LiteralPath 'new_version_files\removed.txt' | ForEach-Object {
        $p = $_.Trim()
        if ($p -and (Test-Path -LiteralPath $p)) {
            Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath 'new_version_files\removed.txt' -Force -ErrorAction SilentlyContinue
}

# ---- 清理临时文件 ----
Set-Progress '正在清理临时文件...' 78
Remove-Item -LiteralPath 'removed.txt' -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'new_version_files' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'RocoKingdomRecognizer_delta.7z' -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'RocoKingdomReg_Update_Package.7z' -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'RocoKingdomRecognizer.7z' -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'update.bat' -Force -ErrorAction SilentlyContinue

# ---- 启动应用 ----
Set-Progress '正在启动应用...' 95
Start-Process -FilePath (Join-Path (Get-Location) '{{EXE_NAME}}') -ErrorAction SilentlyContinue

if ($null -ne $form) {
    try { $form.Close() } catch {}
}

# 延迟自删本脚本
$self = $PSCommandPath
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', "Start-Sleep -Milliseconds 800; Remove-Item -LiteralPath '$self' -Force") -WindowStyle Hidden -ErrorAction SilentlyContinue
"""

    content = (
        template
        .replace("{{EXE_NAME}}", exe_name)
        .replace("{{EXE_STEM}}", exe_stem)
        .replace("{{CLEAR_OLD}}", clear_old)
    )
    # 必须带 BOM（utf-8-sig），否则 Windows PowerShell 5.1 读中文会乱码
    with open(ps1_path, "w", encoding="utf-8-sig") as f:
        f.write(content)
    logger.debug(f"更新窗口脚本创建完成: {ps1_path}")
    return ps1_path


def apply_update():
    """
    解压并准备更新脚本
    成功时启动 update.ps1 并退出进程；失败时返回错误信息字符串。
    """
    logger.info("开始应用更新：解压并准备安装脚本")
    try:
        if updater.mode == "delta":
            if not os.path.exists(delta_zip):
                return "未找到增量更新包文件，请重新下载"
            if os.path.exists(temp_extract_dir):
                shutil.rmtree(temp_extract_dir)
            logger.debug("增量模式：直接解压增量包到临时目录")
            with py7zr.SevenZipFile(delta_zip, 'r') as z:
                z.extractall(temp_extract_dir)
            ps1_path = create_update_ps1(update_mode="delta")
        else:
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

            # 3. 创建更新窗口脚本
            ps1_path = create_update_ps1(update_mode="full")

        # 4. 启动脚本并退出
        # 用隐藏方式启动 powershell（CREATE_NO_WINDOW 不会出现黑色控制台窗口），
        # 更新进度由 PowerShell 自绘的美观窗口展示。
        logger.info("启动更新脚本并退出当前进程")
        try:
            subprocess.Popen(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1_path],
                creationflags=subprocess.CREATE_NO_WINDOW,
                close_fds=True,
            )
        except Exception as e:
            logger.error(f"启动更新脚本失败: {e}", exc_info=True)
            return f"启动更新脚本失败: {e}"
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

    # 前端设置里选择的更新方式：auto=自动增量（默认），full=强制整包
    mode = (request.args.get("mode") or "auto").lower()
    updater.force_full = mode == "full"
    logger.info(f"[API] 更新方式: {mode}, force_full={updater.force_full}")

    if updater.status == "downloading":
        logger.debug("[API] 已在下载中，跳过")
        return {"status": "downloading"}

    # 开启新线程下载，防止阻塞 Flask 响应
    thread = threading.Thread(target=real_download_logic)
    thread.start()

    return {"status": "downloading"}


@bp.route('/api/speed_test')
def speed_test_api():
    """从实际更新地址下载约 5 秒，测出真实下载速度（用于预估更新时间）。"""
    logger.info("[API] 开始网速测试")

    # 优先测增量包地址，否则用整包第一个分片
    latest = updater.latest_info or {}
    deltas = latest.get("deltas") or []
    if not deltas and latest.get("delta"):
        deltas = [latest["delta"]]

    url = None
    for d in deltas:
        if d.get("base_version") == config.APP_VERSION and d.get("url"):
            url = d["url"]
            break
    if not url:
        auto_update = latest.get("auto_update") or {}
        files = auto_update.get("files") or []
        if files:
            url = auto_update.get("base_url", "") + files[0]["name"]

    if not url:
        return {"status": "error", "message": "未找到可用的测速地址，请先检查更新"}

    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    try:
        start = time.time()
        total = 0
        with requests.get(url, headers=headers, stream=True, timeout=12) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_content(chunk_size=65536):
                total += len(chunk)
                if time.time() - start >= 5.0:
                    break
        duration = max(time.time() - start, 0.001)
        speed_bps = int(total / duration)
        logger.info(
            f"[API] 测速完成: {total / 1024 / 1024:.1f}MB / {duration:.1f}s -> "
            f"{speed_bps / 1024 / 1024:.1f} MB/s"
        )
        return {
            "status": "success",
            "speed_bps": speed_bps,
            "tested_bytes": total,
            "duration": round(duration, 2),
        }
    except Exception as e:
        logger.error(f"[API] 测速失败: {e}", exc_info=True)
        return {"status": "error", "message": f"测速失败: {e}"}

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
