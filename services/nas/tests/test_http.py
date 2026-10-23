"""Transport/security tests; no listening server or additional HTTP client is used."""

import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


if importlib.util.find_spec("fastapi") is None:
    raise unittest.SkipTest("FastAPI is not installed; do not install dependencies for local validation")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app  # noqa: E402


TOKEN = "test-only-token-0123456789abcdef0123456789abcdef"


class FakeStore:
    def __init__(self, root):
        self.root = Path(root)
        self.commits = []
        self.uploads = []
        self.fail_status = False
        self.metadata = {"id": "0" * 64 + ".png", "name": "picture.png", "mediaType": "image/png"}

    def info(self):
        return {"limits": {"maxUploadBytes": 64, "maxDocumentBytes": 32, "maxBatchOperations": 200}}

    def status(self):
        if self.fail_status:
            raise RuntimeError("/private/secret-path " + TOKEN)
        return {"cursor": 0}

    def commit(self, payload):
        self.commits.append(payload)
        return {"cursor": 1, "items": []}

    def put_asset(self, asset_id, data, name):
        self.uploads.append((asset_id, data, name))
        return {"id": asset_id, "name": name, "size": len(data)}

    def get_asset(self, asset_id):
        return self.metadata, self.root / "asset"


class HttpTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = FakeStore(self.directory.name)
        environment = patch.dict(os.environ, {"TYPEPRO_PUBLIC_URL": "https://testserver", "TYPEPRO_MAX_JSON_BYTES": "64"})
        environment.start()
        self.addCleanup(environment.stop)
        self.app = create_app(store=self.store, token=TOKEN)

    async def request(self, path, method="GET", body=b"", headers=None, authorized=True, chunks=None):
        path, _, query = path.partition("?")
        request_headers = [(b"host", b"testserver")]
        if authorized:
            request_headers.append((b"authorization", ("Bearer " + TOKEN).encode()))
        request_headers.extend((key.lower().encode(), value.encode()) for key, value in (headers or {}).items())
        chunks = list(chunks) if chunks is not None else [body]
        messages = []

        async def receive():
            if chunks:
                return {"type": "http.request", "body": chunks.pop(0), "more_body": bool(chunks)}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        await self.app(
            {
                "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                "http_version": "1.1", "method": method, "scheme": "https", "path": path,
                "raw_path": path.encode(), "query_string": query.encode(), "root_path": "",
                "headers": request_headers, "server": ("testserver", 443), "client": ("127.0.0.1", 1234),
            },
            receive,
            send,
        )
        start = next(message for message in messages if message["type"] == "http.response.start")
        response_headers = {key.decode(): value.decode() for key, value in start["headers"]}
        response_body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
        return start["status"], response_headers, response_body

    async def test_health_is_public_but_api_requires_bearer(self):
        status, _, body = await self.request("/healthz", authorized=False)
        self.assertEqual((status, json.loads(body)), (200, {"status": "ok"}))
        status, headers, body = await self.request("/api/v1/status", authorized=False)
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)["error"]["code"], "unauthorized")
        self.assertEqual(headers["www-authenticate"], "Bearer")

    async def test_credentials_in_query_are_rejected(self):
        status, _, body = await self.request("/api/v1/status?token=" + TOKEN)
        self.assertEqual(status, 400)
        self.assertNotIn(TOKEN.encode(), body)

    async def test_cross_origin_writes_are_rejected_before_store(self):
        status, _, _ = await self.request("/api/v1/commit", "POST", b"{}", {"Content-Type": "application/json", "Origin": "https://other.example"})
        self.assertEqual(status, 403)
        self.assertEqual(self.store.commits, [])

    async def test_configured_public_origin_allows_same_origin_writes(self):
        status, _, body = await self.request("/api/v1/commit", "POST", b'{"source":"Mac"}', {"Content-Type": "application/json", "Origin": "https://testserver"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["cursor"], 1)
        self.assertEqual(self.store.commits, [{"source": "Mac"}])

    async def test_actual_body_limit_does_not_trust_content_length(self):
        status, _, body = await self.request("/api/v1/commit", "POST", headers={"Content-Type": "application/json", "Content-Length": "1"}, chunks=[b"x" * 40, b"y" * 40])
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(body)["error"]["code"], "body_too_large")
        self.assertEqual(self.store.commits, [])

    async def test_invalid_json_is_not_forwarded(self):
        for body in [b'{"x":1,"x":2}', b'{"x":NaN}', b"[]", b"\xff"]:
            with self.subTest(body=body):
                status, _, result = await self.request("/api/v1/commit", "POST", body, {"Content-Type": "application/json"})
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(result)["error"]["code"], "invalid_json")
        self.assertEqual(self.store.commits, [])

    async def test_attachment_upload_limit_and_encoded_filename(self):
        status, _, _ = await self.request("/api/v1/assets/asset", "PUT", b"x" * 65)
        self.assertEqual(status, 413)
        self.assertEqual(self.store.uploads, [])
        status, _, _ = await self.request("/api/v1/assets/asset", "PUT", b"abc", {"X-Filename": "%E5%9B%BE%E7%89%87.png"})
        self.assertEqual(status, 200)
        self.assertEqual(self.store.uploads, [("asset", b"abc", "图片.png")])

    async def test_inline_requires_bitmap_extension_mime_and_signature(self):
        asset = Path(self.directory.name) / "asset"
        asset.write_bytes(b"<svg onload='alert(1)'></svg>")
        path = "/api/v1/assets/" + "0" * 64 + ".png?inline=true"
        status, headers, _ = await self.request(path)
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-disposition"].startswith("attachment;"))
        self.assertEqual(headers["content-type"], "application/octet-stream")
        asset.write_bytes(b"\x89PNG\r\n\x1a\n" + b"image")
        status, headers, _ = await self.request(path)
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-disposition"].startswith("inline;"))
        self.assertEqual(headers["content-type"], "image/png")

    async def test_unexpected_errors_are_sanitized_and_have_security_headers(self):
        self.store.fail_status = True
        status, headers, body = await self.request("/api/v1/status")
        self.assertEqual(status, 500)
        self.assertEqual(json.loads(body)["error"]["code"], "internal_error")
        self.assertNotIn(b"secret-path", body)
        self.assertNotIn(TOKEN.encode(), body)
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertNotIn("access-control-allow-origin", headers)

    def test_short_token_is_rejected_before_startup(self):
        with self.assertRaises(RuntimeError):
            create_app(store=self.store, token="too-short")


if __name__ == "__main__":
    unittest.main()
