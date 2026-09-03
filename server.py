"""使用 Python 标准库为摄像头录像网页提供本地 HTTP 服务。"""

from __future__ import annotations

import argparse
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
PUBLIC_PATHS = {"/", "/index.html", "/assets/app.js", "/assets/styles.css"}


class WebcamAppHandler(SimpleHTTPRequestHandler):
    """仅提供项目静态文件，并增加摄像头与缓存相关响应头。"""

    def __init__(self, *args: object, **kwargs: object) -> None:
        """固定静态目录，避免启动位置影响资源加载。"""

        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        """允许同源页面访问摄像头，并避免开发期间读取旧缓存。"""

        self.send_header("Permissions-Policy", "camera=(self)")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802 - 标准库处理器接口固定使用该命名
        """只公开网页运行所需资源，避免本地项目文件被 HTTP 读取。"""

        if urlsplit(self.path).path not in PUBLIC_PATHS:
            self.send_error(404, "Not Found")
            return
        super().do_GET()


def create_server(host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    """创建可并发处理浏览器资源请求的本地服务器。"""

    return ThreadingHTTPServer((host, port), WebcamAppHandler)


def parse_args() -> argparse.Namespace:
    """解析监听地址、端口和是否自动打开浏览器。"""

    parser = argparse.ArgumentParser(description="启动浏览器摄像头录像工具")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认仅本机访问")
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    return parser.parse_args()


def main() -> None:
    """启动服务器，并在本机监听时打开默认浏览器。"""

    args = parse_args()
    server = create_server(args.host, args.port)
    display_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    url = f"http://{display_host}:{server.server_port}/"
    print(f"摄像头录像工具已启动：{url}")
    print("按 Ctrl+C 停止服务。")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止服务……")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
