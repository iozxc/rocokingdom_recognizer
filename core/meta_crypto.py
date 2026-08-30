# -*- coding: utf-8 -*-
"""resources/meta.bin 的加解密（纯标准库，无额外依赖）。

把“可能会变”的地址（授权服务器、飞书 webhook 等）加密成二进制文件放在
resources/meta.bin，客户端启动时拉取并解密。仓库 raw 上不再是明文 JSON，
避免直接暴露内网地址/机器码等运营信息。

注意：本模块的对称密钥（META_PASSPHRASE）在客户端源码里，开源环境下只是“混淆”，
并非真正保密；目的只是让 raw 文件无法被直接当作文本浏览/复制。

格式：
    RKMC1 | nonce(16) | tag(32) | ct
    - tag = HMAC-SHA256(key, nonce || ct)  完整性校验（可发现篡改/错钥）
    - ct  = pt XOR keystream；keystream 由 HMAC-SHA256(key, nonce || counter) 生成
"""
import hashlib
import hmac
import json
import os
import struct

_HEADER = b"RKMC1"
_NONCE_LEN = 16
_TAG_LEN = 32

# 加密口令（客户端与 tools/meta_config.py 共用）。要“换密钥”就改这里并重新生成 meta.bin。
META_PASSPHRASE = "roco-meta-20260830-a91f7c4e-2b8f5d19-77da1c4b"  # 仅混淆，勿当真正机密


def _derive_key(passphrase: str) -> bytes:
    return hashlib.sha256(passphrase.encode("utf-8")).digest()


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    """HMAC-SHA256 CTR 伪随机流。block_i = HMAC(key, nonce || i)。"""
    out = bytearray()
    i = 0
    while len(out) < length:
        out += hmac.new(key, nonce + struct.pack(">Q", i), hashlib.sha256).digest()
        i += 1
    return bytes(out[:length])


def encrypt(data: bytes, passphrase: str = META_PASSPHRASE) -> bytes:
    key = _derive_key(passphrase)
    nonce = os.urandom(_NONCE_LEN)
    ct = bytes(a ^ b for a, b in zip(data, _keystream(key, nonce, len(data))))
    tag = hmac.new(key, nonce + ct, hashlib.sha256).digest()
    return _HEADER + nonce + tag + ct


def decrypt(blob: bytes, passphrase: str = META_PASSPHRASE) -> bytes:
    if not blob or not blob.startswith(_HEADER):
        raise ValueError("bad meta header")
    off = len(_HEADER)
    nonce = blob[off:off + _NONCE_LEN]
    tag = blob[off + _NONCE_LEN:off + _NONCE_LEN + _TAG_LEN]
    ct = blob[off + _NONCE_LEN + _TAG_LEN:]
    expect = hmac.new(_derive_key(passphrase), nonce + ct, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expect):
        raise ValueError("meta integrity fail (wrong key or tampered)")
    return bytes(a ^ b for a, b in zip(ct, _keystream(_derive_key(passphrase), nonce, len(ct))))


def dump_meta_to_file(data: dict, path: str, passphrase: str = META_PASSPHRASE) -> None:
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    with open(path, "wb") as f:
        f.write(encrypt(raw, passphrase))


def load_meta_bytes(blob: bytes, passphrase: str = META_PASSPHRASE) -> dict:
    raw = decrypt(blob, passphrase)
    data = json.loads(raw.decode("utf-8"))
    return data if isinstance(data, dict) else {}


def load_meta_local(path: str, passphrase: str = META_PASSPHRASE) -> dict:
    """读本地 resources/meta.bin（工具用），失败返回 {}。"""
    try:
        with open(path, "rb") as f:
            return load_meta_bytes(f.read(), passphrase)
    except Exception:
        return {}


def load_meta_remote(url: str, timeout: float = 2.5, passphrase: str = META_PASSPHRASE):
    """从远程拉取并解密 resources/meta.bin。

    返回 (data, reached)：
      - data   解密后的 dict，失败为 {}
      - reached True 表示确实从远端拿到过响应（即客户端有正常外网/仓库可达），
        用于把“授权服务器故障”和“用户主动断网”区分开。
    """
    try:
        import requests
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        resp = requests.get(url, timeout=timeout, verify=False)
        if resp.status_code == 200:
            try:
                return load_meta_bytes(resp.content, passphrase), True
            except Exception:
                # 能连上但内容异常：仍视为“可达”，不误判为用户断网
                return {}, True
        return {}, False
    except Exception:
        return {}, False
