"""Transactional metadata and immutable, human-readable Markdown/asset files."""

import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


VERSION = "0.1.0"
ASSET_ID = re.compile(r"[0-9a-f]{64}\.[a-z0-9]{1,10}\Z")
ASSET_REFERENCE = re.compile(r"\.\./\.\./assets/([^\s\"'<>()[\]{}\\]+)")
MAX_CHANGE_PAGE_BYTES = 32 * 1024 * 1024


class StoreError(Exception):
    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def _fail(message, code="invalid_input", status=422, details=None):
    raise StoreError(status, code, message, details)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _timestamp(value):
    _text(value, "updatedAt", 64)
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
        if parsed.tzinfo is None or "T" not in value:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError):
        _fail("updatedAt 必须为带时区的 ISO 8601 时间")


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _text(value, field, maximum, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        _fail(f"{field} 格式无效")
    try:
        value.encode("utf-8")
    except UnicodeError:
        _fail(f"{field} 必须为有效 UTF-8 文本")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        _fail(f"{field} 不能包含控制字符")
    return value


def _uuid(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError()
    except (ValueError, AttributeError):
        _fail("标识必须为小写标准 UUID")
    return value


def _kind(value):
    if value not in ("notebook", "document"):
        _fail("kind 必须为 notebook 或 document")
    return value


def _asset_id(value):
    if not isinstance(value, str) or not ASSET_ID.fullmatch(value):
        _fail("附件标识格式无效")
    return value


def _integer(value, field, minimum=0, maximum=9223372036854775807):
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        _fail(f"{field} 格式无效")
    return value


def _fields(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        _fail("请求字段无效")


class Store:
    def __init__(self, root, max_document_bytes=16777216, max_upload_bytes=33554432, max_batch_operations=200):
        self.max_document_bytes = _integer(max_document_bytes, "maxDocumentBytes", 1)
        self.max_upload_bytes = _integer(max_upload_bytes, "maxUploadBytes", 1)
        self.max_batch_operations = _integer(max_batch_operations, "maxBatchOperations", 1)
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for folder in ("documents", "assets"):
            path = self._path(folder)
            path.mkdir(exist_ok=True)
        self.database = self._path("metadata.sqlite3")
        with self._transaction(write=True) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS items (
                    kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
                    deleted INTEGER NOT NULL, updated_at TEXT NOT NULL,
                    synced_at TEXT NOT NULL, source_json TEXT NOT NULL,
                    value_json TEXT NOT NULL, markdown_file TEXT,
                    PRIMARY KEY (kind,id)
                );
                CREATE TABLE IF NOT EXISTS changes (
                    cursor INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
                    operation_id TEXT NOT NULL, item_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS requests (
                    device_id TEXT NOT NULL, operation_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL, result_json TEXT NOT NULL,
                    PRIMARY KEY (device_id,operation_id)
                );
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, media_type TEXT NOT NULL,
                    size INTEGER NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS items_deleted_kind ON items(deleted,kind);
            """)
            db.execute("INSERT OR IGNORE INTO settings VALUES ('instanceId',?)", (str(uuid.uuid4()),))

    def _path(self, relative):
        relative = Path(relative)
        if relative.is_absolute() or ".." in relative.parts:
            _fail("存储路径无效", "storage_invalid", 500)
        path = self.root / relative
        # Never follow a link to a different directory, including links at a leaf.
        current = path
        while current != self.root:
            if current.is_symlink():
                _fail("存储路径不可使用符号链接", "storage_invalid", 500)
            current = current.parent
        if not path.resolve().is_relative_to(self.root):
            _fail("存储路径无效", "storage_invalid", 500)
        return path

    @contextmanager
    def _transaction(self, write=False):
        # One connection per call: safe across FastAPI worker threads and processes.
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _immutable_file(self, relative, data):
        path = self._path(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            if path.read_bytes() != data:
                _fail("已有存储文件与内容不一致", "storage_corrupt", 500)
            return
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".pending-", delete=False) as file:
                temporary = Path(file.name)
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != data:
                    _fail("已有存储文件与内容不一致", "storage_corrupt", 500)
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _item(self, row, markdown=True):
        result = {"kind": row["kind"], "id": row["id"], "revision": row["revision"],
                  "deleted": bool(row["deleted"]), "updatedAt": row["updated_at"],
                  "syncedAt": row["synced_at"], "source": json.loads(row["source_json"]),
                  "value": json.loads(row["value_json"])}
        if row["kind"] == "document" and markdown:
            result["value"]["markdown"] = self._read_markdown(row["markdown_file"])
        return result

    def _read_markdown(self, relative):
        try:
            return self._path(relative).read_bytes().decode("utf-8")
        except (OSError, UnicodeError):
            _fail("文档文件无法读取，请检查存储", "storage_corrupt", 500)

    def _history(self, record):
        item = json.loads(record)
        relative = item.pop("markdownFile", None)
        if item["kind"] == "document":
            item["value"]["markdown"] = self._read_markdown(relative)
        return item

    @staticmethod
    def _cursor(db):
        return db.execute("SELECT COALESCE(MAX(cursor),0) FROM changes").fetchone()[0]

    @staticmethod
    def _instance(db):
        return db.execute("SELECT value FROM settings WHERE key='instanceId'").fetchone()[0]

    def info(self):
        with self._transaction() as db:
            return {"service": "TypePro NAS", "version": VERSION, "protocolVersion": 1,
                    "instanceId": self._instance(db), "serverTime": _now(), "limits": {
                        "maxUploadBytes": self.max_upload_bytes, "maxDocumentBytes": self.max_document_bytes,
                        "maxBatchOperations": self.max_batch_operations}}

    def status(self):
        with self._transaction() as db:
            counts = {(row["kind"], row["deleted"]): row["n"] for row in
                      db.execute("SELECT kind,deleted,COUNT(*) n FROM items GROUP BY kind,deleted")}
            latest = db.execute("SELECT item_json FROM changes ORDER BY cursor DESC LIMIT 1").fetchone()
            # Includes the DB and retained history, not only currently referenced files.
            storage_bytes = 0
            for path in self.root.rglob("*"):
                try:
                    if path.is_file() and not path.is_symlink():
                        storage_bytes += path.stat().st_size
                except FileNotFoundError:
                    # A concurrent immutable write may just have removed its temp file.
                    continue
            return {"notebookCount": counts.get(("notebook", 0), 0), "documentCount": counts.get(("document", 0), 0),
                    "deletedCount": sum(n for (kind, deleted), n in counts.items() if deleted),
                    "assetCount": db.execute("SELECT COUNT(*) FROM assets").fetchone()[0],
                    "storageBytes": storage_bytes, "cursor": self._cursor(db),
                    "lastChangeAt": json.loads(latest[0])["syncedAt"] if latest else None, "serverTime": _now()}

    @staticmethod
    def _page(offset, limit):
        return _integer(offset, "offset"), _integer(limit, "limit", 1, 200)

    def list_items(self, kind=None, notebook_id=None, deleted=False, search="", offset=0, limit=100):
        offset, limit = self._page(offset, limit)
        if kind is not None:
            _kind(kind)
        if notebook_id is not None:
            _uuid(notebook_id)
        if type(deleted) is not bool:
            _fail("deleted 必须为布尔值")
        _text(search, "search", 512, empty=True)
        where, params = ["deleted=?"], [int(deleted)]
        if kind:
            where.append("kind=?")
            params.append(kind)
        if notebook_id:
            where.append("kind='document' AND json_extract(value_json,'$.notebookId')=?")
            params.append(notebook_id)
        if search:
            where.append("instr(lower(COALESCE(json_extract(value_json,'$.name'),json_extract(value_json,'$.title'))),lower(?))>0")
            params.append(search)
        clause = " AND ".join(where)
        with self._transaction() as db:
            total = db.execute("SELECT COUNT(*) FROM items WHERE " + clause, params).fetchone()[0]
            rows = db.execute("SELECT * FROM items WHERE " + clause + " ORDER BY synced_at DESC,kind,id LIMIT ? OFFSET ?",
                              params + [limit, offset]).fetchall()
            return {"items": [self._item(row, markdown=False) for row in rows], "total": total}

    def get_item(self, kind, id):
        _kind(kind)
        _uuid(id)
        with self._transaction() as db:
            row = db.execute("SELECT * FROM items WHERE kind=? AND id=?", (kind, id)).fetchone()
            if row is None:
                _fail("对象不存在", "not_found", 404)
            return self._item(row)

    def snapshot(self):
        with self._transaction() as db:
            # The cursor and all items are read from the same SQLite snapshot.
            cursor = self._cursor(db)
            return {"instanceId": self._instance(db), "cursor": cursor,
                    "items": [self._item(row, markdown=False) for row in db.execute("SELECT * FROM items ORDER BY kind,id")]}

    def changes(self, cursor=0, limit=50):
        _integer(cursor, "cursor")
        _integer(limit, "limit", 1, 200)
        with self._transaction() as db:
            latest = self._cursor(db)
            if cursor > latest:
                _fail("cursor 超过服务端最新位置", "cursor_invalid", 409)
            changes, byte_count, position = [], 0, cursor
            for row in db.execute("SELECT * FROM changes WHERE cursor>? ORDER BY cursor LIMIT ?", (cursor, limit)):
                entry = {"cursor": row["cursor"], "deviceId": row["device_id"], "operationId": row["operation_id"],
                         "item": self._history(row["item_json"])}
                size = len(_json(entry).encode("utf-8"))
                if changes and byte_count + size > MAX_CHANGE_PAGE_BYTES:
                    break
                changes.append(entry)
                byte_count += size
                position = row["cursor"]
            return {"instanceId": self._instance(db), "cursor": position, "hasMore": position < latest, "changes": changes}

    def _value(self, kind, value):
        if kind == "notebook":
            _fields(value, ("name", "cover"))
            _text(value["name"], "name", 256)
            cover = value["cover"]
            if cover is not None:
                _text(cover, "cover", 256)
                if cover.startswith("../../assets/"):
                    _asset_id(cover[len("../../assets/"):])
                elif not re.fullmatch(r"builtin:[^/\\\s:]{1,64}", cover):
                    _fail("cover 必须为内置封面或附件引用")
            return dict(value)
        _fields(value, ("notebookId", "title", "markdown", "assetIds"))
        _uuid(value["notebookId"])
        _text(value["title"], "title", 512)
        markdown = value["markdown"]
        if not isinstance(markdown, str):
            _fail("markdown 必须为字符串")
        try:
            size = len(markdown.encode("utf-8"))
        except UnicodeError:
            _fail("markdown 必须为有效 UTF-8 文本")
        if size > self.max_document_bytes:
            _fail("文档超过容量限制", "document_too_large", 413)
        if not isinstance(value["assetIds"], list) or len(value["assetIds"]) > 10000:
            _fail("assetIds 格式无效")
        assets = [_asset_id(asset) for asset in value["assetIds"]]
        if len(set(assets)) != len(assets):
            _fail("assetIds 不能重复")
        references = set(ASSET_REFERENCE.findall(markdown))
        for reference in references:
            _asset_id(reference)
        if not references.issubset(set(assets)):
            _fail("正文附件引用必须列入 assetIds", "asset_missing", 409)
        return dict(value)

    def commit(self, payload):
        _fields(payload, ("deviceId", "operationId", "operations"), ("source",))
        device = _text(payload["deviceId"], "deviceId", 128)
        operation = _text(payload["operationId"], "operationId", 128)
        source = {"deviceId": device, "name": _text(payload.get("source", device), "source", 128)}
        operations = payload["operations"]
        if not isinstance(operations, list) or not operations:
            _fail("operations 必须为非空数组")
        if len(operations) > self.max_batch_operations:
            _fail("批次操作数量超过限制", "batch_too_large", 413)
        seen = set()
        for op in operations:
            _fields(op, ("kind", "id", "baseRevision", "action"), ("value", "updatedAt"))
            key = (_kind(op["kind"]), _uuid(op["id"]))
            if key in seen:
                _fail("同一批次不能重复修改同一对象")
            seen.add(key)
            _integer(op["baseRevision"], "baseRevision")
            if "updatedAt" in op:
                _timestamp(op["updatedAt"])
            if op["action"] not in ("put", "delete", "restore"):
                _fail("action 无效")
            if op["action"] == "put":
                self._value(op["kind"], op.get("value"))
            elif "value" in op:
                _fail("delete/restore 不接收 value")
        fingerprint = hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()
        with self._transaction(write=True) as db:
            previous = db.execute("SELECT * FROM requests WHERE device_id=? AND operation_id=?", (device, operation)).fetchone()
            if previous:
                if previous["payload_hash"] != fingerprint:
                    _fail("幂等键已用于不同请求", "idempotency_conflict", 409)
                # The original response references immutable Markdown versions.
                result = json.loads(previous["result_json"])
                result["items"] = [self._history(_json(item)) for item in result["items"]]
                return result
            pending, timestamp = {}, _now()
            for op in operations:
                key = (op["kind"], op["id"])
                row = db.execute("SELECT * FROM items WHERE kind=? AND id=?", key).fetchone()
                revision = row["revision"] if row else 0
                if revision != op["baseRevision"]:
                    _fail("对象版本已变化，请重新拉取", "revision_conflict", 409,
                          {"kind": key[0], "id": key[1], "revision": revision})
                if row is None and op["action"] != "put":
                    _fail("对象不存在", "not_found", 404)
                if row and ((op["action"] in ("put", "delete") and row["deleted"]) or
                            (op["action"] == "restore" and not row["deleted"])):
                    _fail("对象当前状态不允许此操作", "state_conflict", 409)
                value = dict(op["value"]) if op["action"] == "put" else json.loads(row["value_json"])
                relative = row["markdown_file"] if row else None
                if key[0] == "document" and op["action"] == "put":
                    markdown_bytes = value.pop("markdown").encode("utf-8")
                    relative = f"documents/{key[1]}/{hashlib.sha256(markdown_bytes).hexdigest()}.md"
                    self._immutable_file(relative, markdown_bytes)
                updated_at = (_timestamp(op["updatedAt"]) if "updatedAt" in op else timestamp) if op["action"] == "put" else row["updated_at"]
                pending[key] = {"kind": key[0], "id": key[1], "revision": revision + 1,
                                "deleted": op["action"] == "delete", "updatedAt": updated_at,
                                "syncedAt": timestamp, "source": source,
                                "value": value, "markdownFile": relative}
            self._validate_relationships(db, pending)
            result_items = []
            for item in pending.values():
                db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET "
                           "revision=excluded.revision,deleted=excluded.deleted,updated_at=excluded.updated_at,"
                           "synced_at=excluded.synced_at,source_json=excluded.source_json,"
                           "value_json=excluded.value_json,markdown_file=excluded.markdown_file",
                           (item["kind"], item["id"], item["revision"], int(item["deleted"]), item["updatedAt"],
                            item["syncedAt"], _json(item["source"]),
                            _json(item["value"]), item["markdownFile"]))
                db.execute("INSERT INTO changes(device_id,operation_id,item_json) VALUES (?,?,?)", (device, operation, _json(item)))
                result_items.append(item)
            stored_result = {"cursor": self._cursor(db), "items": result_items}
            db.execute("INSERT INTO requests VALUES (?,?,?,?)", (device, operation, fingerprint, _json(stored_result)))
            return {"cursor": stored_result["cursor"], "items": [self._history(_json(item)) for item in result_items]}

    def _validate_relationships(self, db, pending):
        for item in pending.values():
            assets = item["value"].get("assetIds", [])
            cover = item["value"].get("cover")
            if cover and cover.startswith("../../assets/"):
                assets = [*assets, cover[len("../../assets/"):]]
            for asset in assets:
                if db.execute("SELECT 1 FROM assets WHERE id=?", (asset,)).fetchone() is None:
                    _fail("引用的附件尚未上传", "asset_missing", 409, {"assetId": asset})
        # Validate the final batch state, independent of the order of operations.
        for parent in pending.values():
            if parent["kind"] != "notebook" or not parent["deleted"]:
                continue
            for row in db.execute("SELECT id FROM items WHERE kind='document' AND deleted=0 "
                                  "AND json_extract(value_json,'$.notebookId')=?", (parent["id"],)):
                if ("document", row["id"]) not in pending:
                    _fail("笔记仍有活动文档，请先处理文档", "notebook_not_empty", 409)
        for item in pending.values():
            if item["kind"] != "document" or item["deleted"]:
                continue
            notebook_id = item["value"]["notebookId"]
            parent = pending.get(("notebook", notebook_id))
            if parent is None:
                parent = db.execute("SELECT deleted FROM items WHERE kind='notebook' AND id=?", (notebook_id,)).fetchone()
            if parent is None or parent["deleted"]:
                _fail("活动文档必须属于活动笔记", "parent_invalid", 409, {"notebookId": notebook_id})

    def list_assets(self, search="", offset=0, limit=100):
        offset, limit = self._page(offset, limit)
        _text(search, "search", 512, empty=True)
        with self._transaction() as db:
            params = (search, search)
            clause = "instr(lower(name),lower(?))>0 OR instr(id,?)>0"
            total = db.execute("SELECT COUNT(*) FROM assets WHERE " + clause, params).fetchone()[0]
            rows = db.execute("SELECT * FROM assets WHERE " + clause + " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
                              (*params, limit, offset))
            return {"assets": [self._asset(row) for row in rows], "total": total}

    @staticmethod
    def _asset(row):
        return {"id": row["id"], "name": row["name"], "mediaType": row["media_type"],
                "size": row["size"], "createdAt": row["created_at"]}

    def put_asset(self, asset_id, data, name):
        _asset_id(asset_id)
        if not isinstance(data, bytes):
            _fail("附件必须为字节内容")
        if len(data) > self.max_upload_bytes:
            _fail("附件超过容量限制", "asset_too_large", 413)
        if hashlib.sha256(data).hexdigest() != asset_id.split(".", 1)[0]:
            _fail("附件 SHA-256 与标识不匹配", "hash_mismatch", 422)
        _text(name, "name", 255)
        if "/" in name or "\\" in name or name in (".", ".."):
            _fail("附件文件名不能包含路径")
        media_type = mimetypes.guess_type(asset_id)[0] or "application/octet-stream"
        with self._transaction(write=True) as db:
            self._immutable_file(f"assets/{asset_id}", data)
            db.execute("INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?)", (asset_id, name, media_type, len(data), _now()))
            return self._asset(db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone())

    def get_asset(self, asset_id):
        _asset_id(asset_id)
        with self._transaction() as db:
            row = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if row is None:
                _fail("附件不存在", "not_found", 404)
            path = self._path(f"assets/{asset_id}")
            if not path.is_file() or path.stat().st_size != row["size"]:
                _fail("附件文件无法读取，请检查存储", "storage_corrupt", 500)
            return self._asset(row), path

