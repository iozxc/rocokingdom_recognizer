"""文件 MD5 工具：文本文件按 LF 归一化计算。

Git 在 Windows 上默认 autocrlf=true：本地工作区文件是 CRLF，而仓库与 Gitee
的 raw 地址实际存储/提供的是 LF。为避免文本文件因换行符差异导致 md5 永远对不上，
这里统一对文本文件先做 CRLF->LF 归一化再计算 md5/size；二进制文件保持字节级 md5。
供 tools/pack_update.py（生成数据清单）与 core/services/data_updater.py（下载校验）共用。
"""
import hashlib
import os

# 需要按 LF 归一化后再计算 md5 的文本扩展名；二进制/打包产物保持字节级 md5。
TEXT_EXTENSIONS = {".json", ".txt", ".md", ".yaml", ".yml", ".csv", ".tsv"}


def is_text_file(path):
    return os.path.splitext(path)[1].lower() in TEXT_EXTENSIONS


def _raw_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def file_digest(path):
    """返回 (md5, size)；文本文件先做 CRLF->LF 归一化，二进制文件保持原样。"""
    if not is_text_file(path):
        return _raw_md5(path), os.path.getsize(path)
    with open(path, "rb") as f:
        data = f.read()
    data = data.replace(b"\r\n", b"\n")
    return hashlib.md5(data).hexdigest(), len(data)


def file_md5(path):
    """只返回 md5（文本文件 LF 归一化）。"""
    return file_digest(path)[0]
