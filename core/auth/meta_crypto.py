# -*- coding: utf-8 -*-
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
