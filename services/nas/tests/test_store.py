"""Run without building or starting a service: python3 -B -m unittest discover -s tests."""

import copy
import hashlib
import tempfile
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from app.store import Store, StoreError


def identifier():
    return str(uuid.uuid4())


def book(id, revision=0, action="put", name="笔记", cover=None):
    op = {"kind": "notebook", "id": id, "baseRevision": revision, "action": action}
    if action == "put":
        op["value"] = {"name": name, "cover": cover}
    return op


def document(id, parent, revision=0, action="put", markdown="正文", assets=None):
    op = {"kind": "document", "id": id, "baseRevision": revision, "action": action}
    if action == "put":
        op["value"] = {"notebookId": parent, "title": "文档", "markdown": markdown, "assetIds": assets or []}
    return op


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(self.directory.name)
        self.notebook, self.document = identifier(), identifier()

    def tearDown(self):
        self.directory.cleanup()

    def commit(self, *operations, **extra):
        return self.store.commit({"deviceId": "mac", "operationId": identifier(), "operations": list(operations), **extra})

    def seed(self, markdown="正文"):
        return self.commit(book(self.notebook), document(self.document, self.notebook, markdown=markdown))

    def error(self, code, function, *args, **kwargs):
        with self.assertRaises(StoreError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_create_reverse_order_and_original_markdown_bytes(self):
        markdown = "# 你好\r\n\r\ntext\n"
        result = self.commit(document(self.document, self.notebook, markdown=markdown), book(self.notebook))
        self.assertEqual(result["cursor"], 2)
        self.assertEqual(self.store.get_item("document", self.document)["value"]["markdown"], markdown)
        self.assertEqual(self.store.status()["notebookCount"], 1)
        self.assertEqual(self.store.status()["documentCount"], 1)
        self.assertIn(markdown.encode(), [p.read_bytes() for p in Path(self.directory.name).rglob("*.md")])

    def test_source_and_content_time_are_separate(self):
        op = book(self.notebook)
        op["updatedAt"] = "2026-10-21T12:00:00+08:00"
        first = self.commit(op, source="我的 Mac")["items"][0]
        self.assertEqual(first["updatedAt"], "2026-10-21T04:00:00.000Z")
        self.assertEqual(first["source"], {"deviceId": "mac", "name": "我的 Mac"})
        self.assertTrue(first["syncedAt"].endswith("Z"))
        removed = self.commit(book(self.notebook, 1, "delete"), deviceId="android", source="手机")["items"][0]
        restored = self.commit(book(self.notebook, 2, "restore"))["items"][0]
        self.assertEqual(removed["updatedAt"], first["updatedAt"])
        self.assertEqual(restored["updatedAt"], first["updatedAt"])
        self.assertEqual(restored["source"], {"deviceId": "mac", "name": "mac"})
        self.assertEqual(self.store.status()["lastChangeAt"], restored["syncedAt"])

    def test_timestamp_never_bypasses_revision(self):
        self.seed()
        op = document(self.document, self.notebook, revision=0)
        op["updatedAt"] = "2099-01-01T00:00:00Z"
        self.error("revision_conflict", self.commit, op)
        for invalid in ("2026-10-21", "2026-10-21T10:00:00", "no", None, "9999-12-31T23:59:59-23:00"):
            op["updatedAt"] = invalid
            self.error("invalid_input", self.commit, op)

    def test_conflict_rolls_back_whole_batch(self):
        self.seed()
        new_book = identifier()
        self.error("revision_conflict", self.commit, book(new_book), document(self.document, self.notebook, revision=0))
        self.error("not_found", self.store.get_item, "notebook", new_book)
        self.assertEqual(self.store.snapshot()["cursor"], 2)

    def test_structure_failure_rolls_back_after_file_write(self):
        self.error("parent_invalid", self.commit, document(self.document, self.notebook))
        self.assertEqual(self.store.snapshot()["items"], [])
        self.assertEqual(self.store.changes()["cursor"], 0)

    def test_idempotent_original_result_after_further_updates(self):
        payload = {"deviceId": "mac", "operationId": "stable", "source": "Mac",
                   "operations": [book(self.notebook), document(self.document, self.notebook, markdown="old")]}
        original = self.store.commit(payload)
        self.commit(document(self.document, self.notebook, revision=1, markdown="new"))
        self.assertEqual(self.store.commit(copy.deepcopy(payload)), original)
        different = copy.deepcopy(payload)
        different["source"] = "different"
        self.error("idempotency_conflict", self.store.commit, different)
        self.assertEqual(self.store.snapshot()["cursor"], 3)
        self.assertEqual(self.store.get_item("document", self.document)["value"]["markdown"], "new")

    def test_concurrent_writers_one_revision_wins(self):
        self.seed()
        barrier = threading.Barrier(2)

        def writer(name):
            store = Store(self.directory.name)
            barrier.wait(timeout=10)
            try:
                return store.commit({"deviceId": name, "operationId": identifier(),
                                     "operations": [document(self.document, self.notebook, revision=1, markdown=name)]})
            except StoreError as error:
                return error

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(writer, ("mac", "android")))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual([r.code for r in results if isinstance(r, StoreError)], ["revision_conflict"])
        self.assertEqual(self.store.snapshot()["cursor"], 3)

    def test_delete_restore_parent_rules(self):
        self.seed()
        self.error("notebook_not_empty", self.commit, book(self.notebook, 1, "delete"))
        self.commit(book(self.notebook, 1, "delete"), document(self.document, self.notebook, 1, "delete"))
        self.error("parent_invalid", self.commit, document(self.document, self.notebook, 2, "restore"))
        self.error("state_conflict", self.commit, document(self.document, self.notebook, 2))
        self.commit(document(self.document, self.notebook, 2, "restore"), book(self.notebook, 2, "restore"))
        self.assertEqual(self.store.status()["deletedCount"], 0)
        self.assertEqual(self.store.get_item("document", self.document)["value"]["markdown"], "正文")

    def test_move_document_and_delete_old_parent_in_one_batch(self):
        self.seed()
        target = identifier()
        self.commit(book(self.notebook, 1, "delete"), document(self.document, target, 1), book(target))
        self.assertEqual(self.store.get_item("document", self.document)["value"]["notebookId"], target)

    def test_history_and_pagination_preserve_every_version(self):
        self.seed("first")
        for revision in range(1, 5):
            self.commit(document(self.document, self.notebook, revision, markdown=str(revision)))
        position, events = 0, []
        with patch("app.store.MAX_CHANGE_PAGE_BYTES", 1):
            while True:
                page = self.store.changes(position, 200)
                events.extend(page["changes"])
                self.assertGreater(page["cursor"], position)
                position = page["cursor"]
                if not page["hasMore"]:
                    break
        self.assertEqual([event["cursor"] for event in events], list(range(1, 7)))
        self.assertEqual([event["item"]["value"]["markdown"] for event in events if event["item"]["kind"] == "document"],
                         ["first", "1", "2", "3", "4"])
        self.assertEqual(self.store.changes(position)["cursor"], position)
        self.error("cursor_invalid", self.store.changes, position + 1)

    def test_snapshot_is_consistent_when_another_writer_commits(self):
        self.seed()
        other = Store(self.directory.name)
        real_cursor = self.store._cursor

        def read_then_write(db):
            position = real_cursor(db)
            other.commit({"deviceId": "android", "operationId": identifier(), "operations": [book(self.notebook, 1, name="new")]})
            return position

        with patch.object(self.store, "_cursor", side_effect=read_then_write):
            snapshot = self.store.snapshot()
        self.assertEqual(snapshot["cursor"], 2)
        self.assertEqual(next(item for item in snapshot["items"] if item["kind"] == "notebook")["value"]["name"], "笔记")
        self.assertEqual(other.snapshot()["cursor"], 3)
        self.assertNotIn("markdown", next(item for item in snapshot["items"] if item["kind"] == "document")["value"])

    def test_restart_keeps_instance_cursor_history_and_idempotency(self):
        self.seed("first")
        self.commit(document(self.document, self.notebook, 1, markdown="second"))
        info = self.store.info()
        self.store = Store(self.directory.name)
        self.assertEqual(self.store.info()["instanceId"], info["instanceId"])
        self.assertEqual(self.store.get_item("document", self.document)["revision"], 2)
        self.assertEqual(self.store.changes()["changes"][1]["item"]["value"]["markdown"], "first")
        self.assertEqual(self.store.snapshot()["cursor"], 3)

    def test_asset_hash_name_safety_and_immutable_metadata(self):
        data = b"image-content"
        asset = hashlib.sha256(data).hexdigest() + ".png"
        metadata = self.store.put_asset(asset, data, "封面.png")
        self.assertEqual(self.store.put_asset(asset, data, "other.png"), metadata)
        self.assertEqual(self.store.get_asset(asset)[1].read_bytes(), data)
        self.error("hash_mismatch", self.store.put_asset, asset, b"changed", "x.png")
        for invalid in ("../x.png", "x/y.png", "x\\y.png", "bad\rname.png"):
            self.error("invalid_input", self.store.put_asset, asset, data, invalid)
        for invalid in ("../asset.png", asset.upper(), "0" * 64 + ".png/../../x", "0" * 64 + "." + "a" * 11):
            self.error("invalid_input", self.store.get_asset, invalid)

    def test_document_and_cover_references_must_exist(self):
        data = b"asset"
        asset = hashlib.sha256(data).hexdigest() + ".png"
        markdown = f"![x](../../assets/{asset})"
        self.error("asset_missing", self.commit, book(self.notebook), document(self.document, self.notebook, markdown=markdown))
        self.error("asset_missing", self.commit, book(self.notebook, cover=f"../../assets/{asset}"))
        self.store.put_asset(asset, data, "x.png")
        self.commit(book(self.notebook, cover=f"../../assets/{asset}"), document(self.document, self.notebook, markdown=markdown, assets=[asset]))
        self.assertEqual(self.store.list_assets()["total"], 1)
        self.error("invalid_input", self.commit, document(self.document, self.notebook, 1, markdown="![x](../../assets/../../secret)", assets=[]))

    def test_limits_and_malformed_input(self):
        store = Store(self.directory.name, max_document_bytes=4, max_upload_bytes=3, max_batch_operations=1)
        self.error("batch_too_large", store.commit, {"deviceId": "a", "operationId": "b", "operations": [book(identifier()), book(identifier())]})
        self.error("document_too_large", store.commit, {"deviceId": "a", "operationId": "b", "operations": [document(self.document, self.notebook, markdown="你好")]})
        self.error("asset_too_large", store.put_asset, hashlib.sha256(b"long").hexdigest() + ".txt", b"long", "x.txt")
        for invalid in (self.notebook.upper(), self.notebook.replace("-", ""), "../x", None, 1):
            self.error("invalid_input", self.store.get_item, "notebook", invalid)
        self.error("invalid_input", self.commit, book(self.notebook), book(self.notebook))
        self.error("invalid_input", self.commit, {**book(self.notebook), "baseRevision": True})
        self.error("invalid_input", self.store.changes, 2 ** 80)
        self.error("invalid_input", self.store.list_items, limit=201)

    def test_search_pagination_and_recycle_lists(self):
        for name in ("100%", "other", "三"):
            self.commit(book(identifier(), name=name))
        self.assertEqual(self.store.list_items(search="%")["total"], 1)
        first = self.store.list_items(limit=2)
        second = self.store.list_items(offset=2, limit=2)
        self.assertEqual(first["total"], 3)
        self.assertEqual(len({item["id"] for item in first["items"] + second["items"]}), 3)
        removed_id = first["items"][0]["id"]
        self.commit(book(removed_id, 1, "delete"))
        self.assertEqual(self.store.list_items(deleted=True)["total"], 1)
        self.assertEqual(self.store.list_items()["total"], 2)

    def test_symlink_cannot_redirect_markdown_or_asset_storage(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        assets = Path(self.directory.name) / "assets"
        assets.rmdir()
        assets.symlink_to(outside.name, target_is_directory=True)
        data = b"test"
        self.error("storage_invalid", self.store.put_asset, hashlib.sha256(data).hexdigest() + ".txt", data, "x.txt")
        self.assertEqual(list(Path(outside.name).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
