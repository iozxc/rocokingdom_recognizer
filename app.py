from core import create_app
from webview import create_window, start
from threading import Thread

app = create_app()

def start_server():
    # 必须关闭 reloader (use_reloader=False)，否则在线程中启动会报错
    app.run(host='127.0.0.1', port=5000, threaded=True, debug=False, use_reloader=False)


def start_webview():
    # 获取绝对路径的 webview_data
    def start_logic():
        # 启动 Flask 服务器线程
        t = Thread(target=start_server)
        t.daemon = True
        t.start()

    window = create_window(
        '洛克王国草系徽章试炼',
        'http://127.0.0.1:5000',  # 直接传入 Flask app 对象
        width=1500,
        height=1000,
        min_size=(1200, 700)
    )

    start(start_logic)


if __name__ == '__main__':
    start_webview()
