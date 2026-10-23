"""HTTP boundary for the single-user TypePro NAS service."""

from __future__ import annotations

import hmac
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

from .store import Store, StoreError


DEFAULT_JSON_LIMIT = 32 * 1024 * 1024
FORBIDDEN_QUERY_KEYS = frozenset({"token", "access_token", "authorization", "api_key", "apikey"})
SECURITY_HEADERS = {
    "content-security-policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    ),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store",
}
RASTER_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    error = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    headers = dict(SECURITY_HEADERS)
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return JSONResponse({"error": error}, status_code=status, headers=headers)


def positive_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        raise RuntimeError(f"{name} must be a positive integer") from None
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


def load_token(provided: str | None) -> bytes:
    token = provided
    if token is None:
        inline = os.environ.get("TYPEPRO_TOKEN")
        token_file = os.environ.get("TYPEPRO_TOKEN_FILE")
        if inline and token_file:
            raise RuntimeError("Configure only one token source")
        if token_file:
            try:
                with Path(token_file).open("rb") as handle:
                    raw = handle.read(4099)
                if len(raw) > 4098:
                    raise RuntimeError("The configured token file is too large")
                token = raw.decode("utf-8").rstrip("\r\n")
            except (OSError, UnicodeError):
                raise RuntimeError("Cannot read the configured token file") from None
        else:
            token = inline
    if not isinstance(token, str) or not 32 <= len(token) <= 4096:
        raise RuntimeError("A token containing at least 32 characters is required")
    if any(character.isspace() or ord(character) < 33 or ord(character) > 126 for character in token):
        raise RuntimeError("The token must contain printable ASCII characters without spaces")
    return token.encode("ascii")


def canonical_origin(value: str) -> tuple[str, str, int]:
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        return parsed.scheme, parsed.hostname.lower(), port
    except ValueError:
        raise ValueError("Invalid HTTP origin") from None


class SecurityMiddleware:
    """Authenticate API routes before reading bodies and apply headers to all responses."""

    def __init__(self, app: Any, token: bytes, public_origin: tuple[str, str, int] | None):
        self.app = app
        self.token = token
        self.public_origin = public_origin

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def secured_send(message: dict) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower().decode("latin-1") not in SECURITY_HEADERS
                ]
                headers.extend((name.encode("ascii"), value.encode("ascii")) for name, value in SECURITY_HEADERS.items())
                message = {**message, "headers": headers}
            await send(message)

        request = Request(scope)
        if any(key.lower() in FORBIDDEN_QUERY_KEYS for key in request.query_params):
            await error_response(400, "token_in_url", "Pass credentials in the Authorization header only")(scope, receive, secured_send)
            return

        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            authorization = [value for name, value in scope.get("headers", []) if name.lower() == b"authorization"]
            valid = False
            if len(authorization) == 1:
                scheme, separator, candidate = authorization[0].partition(b" ")
                valid = bool(separator) and scheme.lower() == b"bearer" and hmac.compare_digest(candidate, self.token)
            if not valid:
                await error_response(401, "unauthorized", "A valid Bearer token is required")(scope, receive, secured_send)
                return

            if scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
                origins = request.headers.getlist("origin")
                allowed = request.headers.get("sec-fetch-site") != "cross-site"
                if origins:
                    try:
                        expected = self.public_origin or canonical_origin(str(request.base_url))
                        allowed = allowed and len(origins) == 1 and canonical_origin(origins[0]) == expected
                    except ValueError:
                        allowed = False
                if not allowed:
                    await error_response(403, "cross_origin_forbidden", "Cross-origin writes are not allowed")(scope, receive, secured_send)
                    return

        try:
            await self.app(scope, receive, secured_send)
        except Exception:
            if started:
                raise
            await error_response(500, "internal_error", "The service could not complete this request")(scope, receive, secured_send)


async def bounded_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            size = int(declared)
        except ValueError:
            raise ApiError(400, "invalid_content_length", "Invalid Content-Length") from None
        if size < 0:
            raise ApiError(400, "invalid_content_length", "Invalid Content-Length")
        if size > limit:
            raise ApiError(413, "body_too_large", "Request body exceeds the configured limit")
    parts = []
    size = 0
    async for part in request.stream():
        size += len(part)
        if size > limit:
            raise ApiError(413, "body_too_large", "Request body exceeds the configured limit")
        parts.append(part)
    return b"".join(parts)


def json_pairs(pairs: list[tuple[str, Any]]) -> dict:
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("Duplicate JSON key")
    return result


def invalid_json_constant(value: str) -> Any:
    raise ValueError("Non-finite JSON number")


def decode_json(raw: bytes) -> dict:
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=json_pairs, parse_constant=invalid_json_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise ApiError(400, "invalid_json", "Expected a valid UTF-8 JSON object") from None
    if not isinstance(payload, dict):
        raise ApiError(400, "invalid_json", "Expected a JSON object")
    return payload


def raster_media_type(asset_id: str, metadata: dict, path: Path) -> str | None:
    expected = RASTER_TYPES.get(Path(asset_id).suffix)
    if expected is None or metadata.get("mediaType") != expected:
        return None
    with path.open("rb") as handle:
        signature = handle.read(16)
    matches = {
        "image/png": signature.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": signature.startswith(b"\xff\xd8\xff"),
        "image/gif": signature.startswith((b"GIF87a", b"GIF89a")),
        "image/webp": signature.startswith(b"RIFF") and signature[8:12] == b"WEBP",
    }
    return expected if matches[expected] else None


def create_app(store: Store | None = None, token: str | None = None) -> FastAPI:
    secret = load_token(token)
    public_url = os.environ.get("TYPEPRO_PUBLIC_URL", "").strip()
    try:
        public_origin = canonical_origin(public_url) if public_url else None
    except ValueError:
        raise RuntimeError("TYPEPRO_PUBLIC_URL must be an HTTP(S) origin without a path") from None
    json_limit = positive_env("TYPEPRO_MAX_JSON_BYTES", DEFAULT_JSON_LIMIT)
    if store is None:
        store = Store(
            os.environ.get("TYPEPRO_DATA_DIR", "/data"),
            max_document_bytes=positive_env("TYPEPRO_MAX_DOCUMENT_BYTES", 16 * 1024 * 1024),
            max_upload_bytes=positive_env("TYPEPRO_MAX_UPLOAD_BYTES", 32 * 1024 * 1024),
            max_batch_operations=positive_env("TYPEPRO_MAX_BATCH_OPERATIONS", 200),
        )
    upload_limit = store.info()["limits"]["maxUploadBytes"]
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, debug=False)
    app.state.store = store
    app.add_middleware(SecurityMiddleware, token=secret, public_origin=public_origin)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(StoreError)
    async def store_error(request: Request, exc: StoreError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(422, "invalid_request", "Request parameters are invalid")

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return error_response(exc.status_code, "not_found" if exc.status_code == 404 else "http_error", "Resource not found" if exc.status_code == 404 else "Request is not allowed")

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # Never serialize an exception: it may contain local paths or request data.
        return error_response(500, "internal_error", "The service could not complete this request")

    @app.get("/healthz")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/v1/info")
    async def info() -> dict:
        return await run_in_threadpool(store.info)

    @app.get("/api/v1/status")
    async def status() -> dict:
        return await run_in_threadpool(store.status)

    @app.get("/api/v1/items")
    async def items(kind: str | None = None, notebookId: str | None = None, deleted: bool = False, search: str = "", offset: int = 0, limit: int = 100) -> dict:
        return await run_in_threadpool(store.list_items, kind=kind, notebook_id=notebookId, deleted=deleted, search=search, offset=offset, limit=limit)

    @app.get("/api/v1/items/{kind}/{item_id}")
    async def item(kind: str, item_id: str) -> dict:
        return await run_in_threadpool(store.get_item, kind, item_id)

    @app.get("/api/v1/snapshot")
    async def snapshot() -> dict:
        return await run_in_threadpool(store.snapshot)

    @app.get("/api/v1/changes")
    async def changes(cursor: int = 0, limit: int = 50) -> dict:
        return await run_in_threadpool(store.changes, cursor=cursor, limit=limit)

    @app.post("/api/v1/commit")
    async def commit(request: Request) -> dict:
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise ApiError(415, "unsupported_media_type", "Use application/json for commits")
        payload = decode_json(await bounded_body(request, json_limit))
        return await run_in_threadpool(store.commit, payload)

    @app.get("/api/v1/assets")
    async def assets(search: str = "", offset: int = 0, limit: int = 100) -> dict:
        return await run_in_threadpool(store.list_assets, search=search, offset=offset, limit=limit)

    @app.put("/api/v1/assets/{asset_id}")
    async def put_asset(asset_id: str, request: Request) -> dict:
        raw_name = request.headers.get("x-filename", asset_id)
        if len(raw_name) > 4096 or re.search(r"%(?![0-9a-fA-F]{2})", raw_name):
            raise ApiError(400, "invalid_filename", "Invalid encoded filename")
        try:
            name = unquote(raw_name, encoding="utf-8", errors="strict")
        except UnicodeError:
            raise ApiError(400, "invalid_filename", "Invalid UTF-8 filename") from None
        data = await bounded_body(request, upload_limit)
        return await run_in_threadpool(store.put_asset, asset_id, data, name)

    @app.get("/api/v1/assets/{asset_id}")
    async def get_asset(asset_id: str, inline: bool = False) -> FileResponse:
        metadata, path = await run_in_threadpool(store.get_asset, asset_id)
        media_type = await run_in_threadpool(raster_media_type, asset_id, metadata, path) if inline else None
        disposition = "inline" if media_type else "attachment"
        filename = quote(metadata.get("name", asset_id), safe="")
        headers = {"Content-Disposition": f'{disposition}; filename="{asset_id}"; filename*=UTF-8\'\'{filename}'}
        return FileResponse(path, media_type=media_type or "application/octet-stream", headers=headers)

    # Keep the static mount last, so it cannot shadow protected API routes.
    web_root = Path(__file__).resolve().parent.parent / "web"
    app.mount("/", StaticFiles(directory=web_root, html=True, check_dir=False), name="web")
    return app
