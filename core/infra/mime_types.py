"""静态资源 MIME 类型兜底。

Windows 上 CPython 的 ``mimetypes`` 会读取注册表 ``HKEY_CLASSES_ROOT`` 下对应
扩展名的 "Content Type" 值，并且**覆盖**内置默认值（``add_type`` 的语义就是"已存在的扩展名
会被替换"）。一旦第三方软件（下载器 / 编辑器 / 安全软件 / 精简系统镜像等）把
``.js`` 的 Content Type 改成 ``text/plain`` 之类，Flask/Werkzeug 发送前端 bundle
时就会带上错误的 Content-Type；而 Chromium 对 ``<script type="module">`` 强制校验
MIME，会直接拒绝执行脚本 —— 表现就是"CSS 正常、页面全白"的白屏
（``<link rel="stylesheet">`` 不校验 MIME，所以背景样式照常生效）。

这里在进程启动阶段把关键扩展名强制注册为正确 MIME，覆盖注册表带来的污染，
与具体是哪台机器无关。
"""

import mimetypes

# 需要强制保证的静态资源 MIME：既用于 add_type 兜底，也用于
# core/api/main.py 里 send_from_directory 的显式覆盖。
STATIC_MIME_TYPES = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
}


def ensure_static_mime_types() -> None:
    """把关键扩展名强制注册为正确 MIME（重复调用无副作用）。

    ``strict=True`` 写入 ``guess_type(strict=True)`` 使用的那张表；``add_type``
    对已存在的扩展名是覆盖语义，因此能盖掉注册表里的错误值。
    """
    for ext, mime in STATIC_MIME_TYPES.items():
        mimetypes.add_type(mime, ext, strict=True)