import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Node strips TypeScript types; match Vite's extension resolution for this test.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
} });
const { synchronizeGithubWorkspace } = await import("./useGithubSync.ts");
const { createSyncSnapshot, toSyncWorkspace } = await import("./model.ts");
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const time = "2026-10-21T10:00:00.000Z", successfulSyncTime = "2026-10-21T11:00:00.000Z";
const source = { deviceId: id(100), name: "Android", platform: "android" };
const doc = (value = 10, markdown = "base") => ({ id: id(value), title: `文档 ${value}`, markdown, updatedAt: time });
const workspace = (...documents) => ({ version: 1, notebooks: [{ id: id(1), name: "笔记", documents }], plugins: [{ manifest: { id: "local-plugin" }, enabled: true, code: "local" }] });
const snapshot = value => createSyncSnapshot(value, source, time);
const find = (value, valueId = 10) => value.notebooks.flatMap(book => book.documents).find(document => document.id === id(valueId));

function fixture(local, base = local, remote = local) {
  const current = { current: structuredClone(local) };
  const calls = { reads: 0, published: [], checkpoints: [], flushes: 0, applies: 0 };
  const options = { current, ready: true, collect() {}, async flush() { calls.flushes++; }, apply(notebooks, extensions) { calls.applies++; current.current = { ...current.current, notebooks, ...(extensions === undefined ? {} : { extensions }) }; } };
  let checkpointSnapshot = remote ? snapshot(remote) : null;
  const api = {
    async readRemote() { calls.reads++; return { head: "a".repeat(40), base: base ? snapshot(base) : null, remote: remote ? snapshot(remote) : null }; },
    async publish(expectedHead, value) { assert.equal(expectedHead, "a".repeat(40)); assert.deepEqual(Object.keys(value), value.extensions ? ["version", "notebooks", "extensions"] : ["version", "notebooks"]); const result = { head: "b".repeat(40), snapshot: snapshot(value) }; calls.published.push(result); return result; },
    async checkpoint(head, value) { calls.checkpoints.push({ head, snapshot: structuredClone(value) }); checkpointSnapshot = value; },
    async status() { return { clientId: "Iv1.test", appSlug: "typepro", deviceName: "Mac", deviceId: id(101), intervalMinutes: 5, connected: true, account: { login: "owner", avatarUrl: "" }, repository: { owner: "owner", name: "typepro-notes", url: "https://github.com/owner/typepro-notes", defaultBranch: "main" }, lastSyncedAt: successfulSyncTime, lastSource: checkpointSnapshot?.source || null }; },
  };
  return { options, api, calls, run: () => synchronizeGithubWorkspace(() => options, api) };
}

test("complete native wire snapshots enter the real merge flow and refresh successful-sync metadata", async () => {
  const base = workspace(doc(), doc(11));
  const local = structuredClone(base), remote = structuredClone(base);
  find(local).markdown = "Mac edit";
  find(remote, 11).markdown = "Android edit";
  const f = fixture(local, base, remote);
  const result = await f.run();
  assert.equal(find(f.options.current.current).markdown, "Mac edit");
  assert.equal(find(f.options.current.current, 11).markdown, "Android edit");
  assert.deepEqual(f.options.current.current.plugins, local.plugins);
  assert.equal(f.calls.published.length, 1);
  assert.deepEqual(f.calls.checkpoints[0].snapshot, f.calls.published[0].snapshot);
  assert.equal(result.status.lastSyncedAt, successfulSyncTime);
  assert.notEqual(result.status.lastSyncedAt, f.calls.checkpoints[0].snapshot.syncedAt);
});

test("edits made while publication awaits remain local and do not enter the published baseline", async () => {
  const base = workspace(doc());
  const local = structuredClone(base); find(local).markdown = "published edit";
  const f = fixture(local, base, base);
  const publish = f.api.publish;
  f.api.publish = async (...args) => {
    const result = await publish(...args);
    f.options.current.current = workspace(doc(10, "typed during upload"));
    return result;
  };
  await f.run();
  assert.equal(find(f.options.current.current).markdown, "typed during upload");
  assert.equal(find(f.calls.checkpoints[0].snapshot).markdown, "published edit");
});

test("a debounced keystroke collected after async merge invalidates CAS before local apply", async () => {
  const base = workspace(doc(), doc(11));
  const remote = structuredClone(base); find(remote, 11).markdown = "remote edit";
  const f = fixture(base, base, remote);
  let collections = 0;
  f.options.collect = () => {
    if (++collections === 4) f.options.current.current = workspace(doc(10, "debounced typing"), doc(11));
  };
  await f.run();
  assert.ok(collections >= 6);
  assert.equal(find(f.options.current.current).markdown, "debounced typing");
  assert.equal(find(f.options.current.current, 11).markdown, "remote edit");
  assert.equal(find(f.calls.checkpoints[0].snapshot).markdown, "base");
});

test("unchanged remote avoids a commit but checkpoints its exact snapshot", async () => {
  const value = workspace(doc());
  const f = fixture(value);
  await f.run();
  assert.equal(f.calls.published.length, 0);
  assert.equal(f.calls.applies, 0);
  assert.deepEqual(f.calls.checkpoints[0], { head: "a".repeat(40), snapshot: snapshot(value) });
});

test("concurrent HEAD failures retry at most three times without local apply or baseline changes", async () => {
  const base = workspace(doc()), local = workspace(doc(10, "edit"));
  const f = fixture(local, base, base);
  let attempts = 0;
  f.api.publish = async () => { attempts++; throw new Error("REMOTE_CHANGED:updated"); };
  await assert.rejects(f.run(), /REMOTE_CHANGED/);
  assert.equal(attempts, 3);
  assert.equal(f.calls.reads, 3);
  assert.equal(f.calls.applies, 0);
  assert.equal(f.calls.checkpoints.length, 0);
  assert.deepEqual(f.options.current.current, local);
});

test("download failure preserves local data and never publishes or checkpoints", async () => {
  const local = workspace(doc(10, "local"));
  const f = fixture(local);
  f.api.readRemote = async () => { throw new Error("network failed"); };
  await assert.rejects(f.run(), /network failed/);
  assert.deepEqual(f.options.current.current, local);
  assert.equal(f.calls.published.length, 0);
  assert.equal(f.calls.checkpoints.length, 0);
});

test("local save failure after merge keeps the published baseline unadvanced", async () => {
  const base = workspace(doc()), remote = workspace(doc(10, "remote"));
  const f = fixture(base, base, remote);
  f.options.flush = async () => { if (++f.calls.flushes > 1) throw new Error("disk full"); };
  await assert.rejects(f.run(), /disk full/);
  assert.equal(find(f.options.current.current).markdown, "remote");
  assert.equal(f.calls.checkpoints.length, 0);
});

test("cancellation after a download prevents local apply and baseline writes", async () => {
  const local = workspace(doc()), remote = workspace(doc(10, "remote"));
  const f = fixture(local, local, remote);
  let cancelled = false;
  const read = f.api.readRemote;
  f.api.readRemote = async () => { const value = await read(); cancelled = true; return value; };
  await assert.rejects(synchronizeGithubWorkspace(() => f.options, f.api, () => { if (cancelled) throw new Error("CANCELLED"); }), /CANCELLED/);
  assert.deepEqual(toSyncWorkspace(f.options.current.current), toSyncWorkspace(local));
  assert.equal(f.calls.applies, 0);
  assert.equal(f.calls.checkpoints.length, 0);
});

test("plugin data written during publication survives and plugin execution grants remain local", async () => {
  const extension = (key, value, minute = 0) => ({ pluginId: "notebook.assistant", key, value, updatedAt: `2026-10-22T00:0${minute}:00.000Z`, deviceId: id(100) });
  const base = { ...workspace(doc()), extensions: { entries: [extension("settings", { model: "base" })], installs: [] } };
  const local = structuredClone(base), remote = structuredClone(base);
  local.extensions.entries.push(extension("session.local", { text: "local conversation" }, 1));
  remote.extensions.entries.push(extension("session.remote", { text: "remote conversation" }, 2));
  const f = fixture(local, base, remote);
  const publish = f.api.publish;
  f.api.publish = async (...args) => {
    const result = await publish(...args);
    f.options.current.current = { ...f.options.current.current, extensions: { ...f.options.current.current.extensions, entries: [...f.options.current.current.extensions.entries, extension("session.during", { text: "typed during upload" }, 3)] } };
    return result;
  };
  await f.run();
  assert.deepEqual(f.options.current.current.extensions.entries.map(entry => entry.key), ["session.during", "session.local", "session.remote", "settings"]);
  assert.deepEqual(f.calls.checkpoints[0].snapshot.extensions.entries.map(entry => entry.key), ["session.local", "session.remote", "settings"]);
  assert.deepEqual(f.options.current.current.plugins, local.plugins);
});
