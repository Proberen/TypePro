import assert from "node:assert/strict";
import test from "node:test";
import { watchDownloadStatus } from "./download-monitor.js";
import { newerDownloadState } from "./policy.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (status, revision, version = "1.7.5") => ({
  version, status, revision, downloaded: status === "ready" ? 100 : 10, total: 100, error: null,
});

// Exercise the real polling loop with controllable IPC replies; no app startup or compilation.
test("an initial IPC failure recovers an already running native task after a lost start acknowledgement", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const replies = [new Error("IPC disconnected"), snapshot("downloading", 2), snapshot("verifying", 3), snapshot("ready", 4)];
  const states = [];
  const errors = [];
  let requests = 0;
  const stop = watchDownloadStatus(async () => {
    requests++;
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  }, value => states.push(value.status), error => errors.push(error.message));
  await settle();
  assert.deepEqual(errors, ["IPC disconnected"]);
  assert.equal(requests, 1);
  t.mock.timers.tick(4_999);
  await settle();
  assert.equal(requests, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(states, ["downloading"]);
  t.mock.timers.tick(500);
  await settle();
  t.mock.timers.tick(500);
  await settle();
  assert.deepEqual(states, ["downloading", "verifying", "ready"]);
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(requests, 4, "a completed native task stops polling");
  stop();
});

test("cleanup ignores an in-flight reply and removes its future polling", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve;
  let requests = 0;
  const states = [];
  const stop = watchDownloadStatus(() => {
    requests++;
    return new Promise(done => { resolve = done; });
  }, state => states.push(state), error => { throw error; });
  stop();
  resolve(snapshot("downloading", 1));
  await settle();
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(requests, 1);
  assert.deepEqual(states, []);
});

test("slow IPC is serialized and late download progress cannot overwrite a command's cancellation result", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve;
  let requests = 0;
  let accepted = snapshot("downloading", 1);
  const stop = watchDownloadStatus(() => {
    requests++;
    return new Promise(done => { resolve = done; });
  }, state => { accepted = newerDownloadState(accepted, state); }, error => { throw error; });
  t.mock.timers.tick(10_000);
  assert.equal(requests, 1, "no timer runs until the pending IPC finishes");
  accepted = snapshot("cancelled", 3);
  resolve(snapshot("downloading", 2));
  await settle();
  assert.equal(accepted.status, "cancelled");
  assert.equal(accepted.revision, 3);
  stop();
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(requests, 1);
});
