"""验证零依赖本地服务器和前端关键能力没有被意外移除。"""

from __future__ import annotations

import re
import threading
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import server


ROOT = Path(__file__).resolve().parents[1]


class IdCollector(HTMLParser):
    """收集页面元素 ID，用于校验脚本选择器与 HTML 一致。"""

    def __init__(self) -> None:
        """初始化标准库解析器和 ID 列表。"""

        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """记录每个开始标签上的 ID 属性。"""

        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(str(attributes["id"]))


class ServerTests(unittest.TestCase):
    """检查静态服务响应和浏览器安全策略。"""

    @classmethod
    def setUpClass(cls) -> None:
        """使用随机空闲端口启动一次测试服务器。"""

        cls.httpd = server.create_server(port=0)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        """关闭测试服务器并等待监听线程退出。"""

        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def test_index_and_assets_are_served_without_cache(self) -> None:
        """首页及资源必须可访问，并允许当前页面使用摄像头。"""

        with urlopen(f"{self.base_url}/", timeout=2) as response:
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Permissions-Policy"], "camera=(self)")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertIn("摄像头录像工具", body)
        with urlopen(f"{self.base_url}/assets/app.js", timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("javascript", response.headers.get_content_type())

    def test_server_does_not_publish_repository_files(self) -> None:
        """本地服务只能公开页面资源，不能读取 Git 或 Python 项目文件。"""

        for path in ("/.git/config", "/server.py", "/README.md", "/assets/"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as raised:
                urlopen(f"{self.base_url}{path}", timeout=2)
            self.assertEqual(raised.exception.code, 404)

    def test_frontend_contains_native_and_software_zoom_paths(self) -> None:
        """驱动变焦和会进入录像的软件裁切路径必须同时存在。"""

        script = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("getCapabilities", script)
        self.assertIn("applyConstraints", script)
        self.assertIn("zoom = true", script)
        self.assertIn("previewCanvas.captureStream", script)
        self.assertIn("sourceWidth / zoom", script)
        self.assertIn("MediaRecorder", script)
        self.assertIn("showSaveFilePicker", script)
        self.assertIn("驱动变焦", page)
        self.assertIn("软件变焦", page)
        self.assertIn("initializeRecordingFormat();", script)
        self.assertNotIn('<span id="filenameExtension">.webm</span>', page)

    def test_project_has_no_python_dependency_manifest(self) -> None:
        """应用仅使用标准库，不应新增 pip 依赖清单。"""

        self.assertFalse((ROOT / "requirements.txt").exists())
        self.assertFalse((ROOT / "pyproject.toml").exists())

    def test_javascript_id_selectors_exist_and_html_ids_are_unique(self) -> None:
        """前端脚本引用的控件必须存在，页面元素 ID 不能重复。"""

        script = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        parser = IdCollector()
        parser.feed(page)
        self.assertEqual(len(parser.ids), len(set(parser.ids)))
        selected_ids = set(re.findall(r'querySelector\("#([A-Za-z][A-Za-z0-9_-]*)"\)', script))
        self.assertTrue(selected_ids)
        self.assertEqual(selected_ids - set(parser.ids), set())


if __name__ == "__main__":
    unittest.main()
