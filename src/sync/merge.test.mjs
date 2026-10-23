import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncSnapshot, parseSyncSnapshot, parseSyncWorkspace, toSyncWorkspace } from './model.ts';
import { mergeWorkspaces } from './merge.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-10-21T10:00:00.000Z';
const document = (n = 10, markdown = '# 文档', title = '文档') => ({ id: id(n), title, markdown, updatedAt: time });
const book = (n = 1, documents = [document()]) => ({ id: id(n), name: `笔记 ${n}`, cover: 'preset:0', documents });
const workspace = (...notebooks) => ({ version: 1, notebooks });
const clone = value => structuredClone(value);
const find = (value, n = 10) => value.notebooks.flatMap(book => book.documents).find(document => document.id === id(n));
const source = { deviceId: id(100), name: 'Mac', platform: 'macos' };

test('first sync unions notebook/document UUIDs and ignores timestamp-only differences', async () => {
  const local = workspace(book(1, [document(10), document(11, 'local')]));
  const remote = workspace(book(1, [{ ...document(10), updatedAt: '2026-10-21T12:00:00.000Z' }, document(12, 'remote')]), book(2, []));
  const result = await mergeWorkspaces(null, local, remote);
  assert.equal(result.conflicts, 0);
  assert.deepEqual(result.workspace.notebooks.map(book => book.id), [id(1), id(2)]);
  assert.deepEqual(result.workspace.notebooks[0].documents.map(document => document.id), [id(10), id(11), id(12)]);
  assert.equal(find(result.workspace).updatedAt, '2026-10-21T12:00:00.000Z');
  assert.deepEqual(local.notebooks[0].documents.map(document => document.id), [id(10), id(11)]);
});

test('different documents and independent title/content edits merge without conflicts', async () => {
  const base = workspace(book(1, [document(10), document(11)]));
  const local = clone(base), remote = clone(base);
  find(local).markdown = 'local edit';
  find(remote).title = 'remote rename';
  find(remote, 11).markdown = 'other edit';
  const result = await mergeWorkspaces(base, local, remote);
  assert.equal(result.conflicts, 0);
  assert.equal(find(result.workspace).markdown, 'local edit');
  assert.equal(find(result.workspace).title, 'remote rename');
  assert.equal(find(result.workspace, 11).markdown, 'other edit');
});

test('same-document conflict keeps local UUID and makes one stable remote copy across retries', async () => {
  const base = workspace(book());
  const local = clone(base), remote = clone(base);
  find(local).markdown = 'local'; find(remote).markdown = 'remote';
  const first = await mergeWorkspaces(base, local, remote);
  assert.equal(first.conflicts, 1);
  assert.equal(find(first.workspace).markdown, 'local');
  const copy = first.workspace.notebooks[0].documents[1];
  assert.equal(copy.markdown, 'remote');
  assert.equal(copy.title, '文档（内容冲突）');
  assert.match(copy.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual((await mergeWorkspaces(base, first.workspace, remote)).workspace, first.workspace);
  assert.deepEqual((await mergeWorkspaces(base, local, remote)).workspace, first.workspace);
});

test('edited conflict copies survive a stale retry and the extra preserved version is stable', async () => {
  const base = workspace(book());
  const local = clone(base), remote = clone(base);
  find(local).markdown = 'local'; find(remote).markdown = 'remote';
  const first = await mergeWorkspaces(base, local, remote);
  first.workspace.notebooks[0].documents[1].markdown = 'edited conflict copy';
  const second = await mergeWorkspaces(base, first.workspace, remote);
  assert.deepEqual(second.workspace.notebooks[0].documents.map(document => document.markdown), ['local', 'edited conflict copy', 'remote']);
  assert.deepEqual((await mergeWorkspaces(base, second.workspace, remote)).workspace, second.workspace);
});

test('two devices retrying concurrent publication converge to two versions without duplicate copies', async () => {
  const base = workspace(book());
  const left = clone(base), right = clone(base);
  find(left).markdown = 'device A'; find(right).markdown = 'device B';
  const publishedA = (await mergeWorkspaces(base, left, right)).workspace;
  const publishedB = (await mergeWorkspaces(base, right, publishedA)).workspace;
  assert.deepEqual(publishedB.notebooks[0].documents.map(document => document.markdown), ['device B', 'device A']);
  const nextA = await mergeWorkspaces(publishedA, publishedA, publishedB);
  assert.deepEqual(nextA.workspace, publishedB);
  assert.equal(nextA.conflicts, 0);
});

test('deletion wins against unchanged content even when only the timestamp changes', async () => {
  const base = workspace(book());
  const remote = clone(base); find(remote).updatedAt = '2026-10-22T10:00:00.000Z';
  for (const [local, other] of [[workspace(book(1, [])), remote], [remote, workspace(book(1, []))]]) {
    const result = await mergeWorkspaces(base, local, other);
    assert.equal(result.conflicts, 0); assert.equal(find(result.workspace), undefined);
  }
});

test('delete-versus-edit preserves the edited content in a stable named conflict copy', async () => {
  const base = workspace(book());
  const changed = clone(base); find(changed).markdown = 'unsynced edit';
  for (const [local, remote] of [[workspace(book(1, [])), changed], [changed, workspace(book(1, []))]]) {
    const result = await mergeWorkspaces(base, local, remote);
    assert.equal(result.conflicts, 1);
    assert.equal(find(result.workspace), undefined);
    assert.equal(result.workspace.notebooks[0].documents[0].markdown, 'unsynced edit');
    assert.equal(result.workspace.notebooks[0].documents[0].title, '文档（删除冲突）');
    assert.deepEqual((await mergeWorkspaces(base, result.workspace, remote)).workspace, result.workspace);
  }
});

test('a deleted notebook cannot discard a concurrently edited document', async () => {
  const base = workspace(book(1, [document(10), document(11)]));
  const remote = clone(base); find(remote).markdown = 'still editing';
  const result = await mergeWorkspaces(base, workspace(), remote);
  assert.equal(result.workspace.notebooks.length, 1);
  assert.equal(result.workspace.notebooks[0].name, '笔记 1（删除冲突）');
  assert.equal(result.workspace.notebooks[0].documents.length, 1);
  assert.equal(result.workspace.notebooks[0].documents[0].markdown, 'still editing');
  assert.deepEqual((await mergeWorkspaces(base, result.workspace, remote)).workspace, result.workspace);
});

test('a concurrent notebook rename is preserved when the other side deletes the notebook', async () => {
  const base = workspace(book(1, []));
  const remote = clone(base); remote.notebooks[0].name = 'renamed';
  const result = await mergeWorkspaces(base, workspace(), remote);
  assert.equal(result.workspace.notebooks[0].name, 'renamed（删除冲突）');
  assert.equal(result.conflicts, 1);
});

test('document move combines with an independent remote edit, without duplication', async () => {
  const base = workspace(book(), book(2, []));
  const local = clone(base), remote = clone(base);
  local.notebooks[1].documents.push(local.notebooks[0].documents.pop());
  find(remote).markdown = 'remote edited after move';
  const result = await mergeWorkspaces(base, local, remote);
  assert.equal(result.conflicts, 0);
  assert.equal(result.workspace.notebooks[0].documents.length, 0);
  assert.equal(result.workspace.notebooks[1].documents[0].markdown, 'remote edited after move');
});

test('conflicting moves preserve both placements and content', async () => {
  const base = workspace(book(), book(2, []), book(3, []));
  const local = clone(base), remote = clone(base);
  local.notebooks[1].documents.push(local.notebooks[0].documents.pop());
  remote.notebooks[2].documents.push(remote.notebooks[0].documents.pop());
  const result = await mergeWorkspaces(base, local, remote);
  assert.equal(result.conflicts, 1);
  assert.equal(result.workspace.notebooks[1].documents[0].id, id(10));
  assert.equal(result.workspace.notebooks[2].documents[0].title, '文档（内容冲突）');
});

test('second merge applies published changes to the latest edit captured during network activity', async () => {
  const beforeNetwork = workspace(book(1, [document(10), document(11)]));
  const remote = clone(beforeNetwork); find(remote, 11).markdown = 'other device';
  const published = (await mergeWorkspaces(beforeNetwork, beforeNetwork, remote)).workspace;
  const latest = clone(beforeNetwork); find(latest).markdown = 'typed while network was pending';
  const result = await mergeWorkspaces(beforeNetwork, latest, published);
  assert.equal(find(result.workspace).markdown, 'typed while network was pending');
  assert.equal(find(result.workspace, 11).markdown, 'other device');
  assert.equal(result.conflicts, 0);
});

test('missing remote snapshot never deletes an existing local workspace', async () => {
  const base = workspace(book());
  assert.deepEqual((await mergeWorkspaces(base, base, null)).workspace, base);
});

test('concurrent notebook metadata edits preserve local preference and count the conflict', async () => {
  const base = workspace(book()), local = clone(base), remote = clone(base);
  local.notebooks[0].name = 'local'; remote.notebooks[0].name = 'remote';
  const result = await mergeWorkspaces(base, local, remote);
  assert.equal(result.conflicts, 1); assert.equal(result.workspace.notebooks[0].name, 'local');
});

test('snapshot only contains notes, preserves canonical asset references, and does not mutate input', () => {
  const reference = `../../assets/${id(200)}.png`;
  const local = { ...workspace(book()), plugins: [{ code: 'do not sync' }], locations: ['/local-only'] };
  local.notebooks[0].cover = reference;
  find(local).markdown = `![图](${reference}) <img src="${reference}" width="200">`;
  const snapshot = createSyncSnapshot(local, source, time);
  assert.equal(snapshot.notebooks[0].cover, reference);
  assert.equal(find(snapshot).markdown, find(local).markdown);
  assert.equal('plugins' in snapshot, false); assert.equal('locations' in snapshot, false);
  snapshot.notebooks[0].documents[0].markdown = 'independent clone';
  assert.match(find(local).markdown, /assets/);
  assert.deepEqual(toSyncWorkspace(local).notebooks, local.notebooks);
});

test('untrusted snapshots reject unsupported format, source, timestamps, and injected fields', () => {
  const valid = createSyncSnapshot(workspace(book()), source, time);
  for (const invalid of [
    { ...valid, format: 'other' }, { ...valid, version: 2 }, { ...valid, plugins: [] },
    { ...valid, source: { ...source, privateKey: 'secret' } },
    { ...valid, source: { ...source, deviceId: '../device' } },
    { ...valid, source: { ...source, name: '\n' } },
    { ...valid, source: { ...source, platform: '' } },
    { ...valid, syncedAt: '2026-02-31T10:00:00.000Z' }, { ...valid, syncedAt: 'yesterday' },
    { ...valid, notebooks: [{ ...book(), path: '/private' }] },
    { ...valid, notebooks: [{ ...book(), documents: [{ ...document(), pluginCode: 'no' }] }] },
  ]) assert.throws(() => parseSyncSnapshot(invalid));
});

test('workspace validation rejects duplicate parent/child IDs, traversal covers and UTF-8 size overflow', () => {
  for (const invalid of [
    { version: 2, notebooks: [] }, { version: 1, notebooks: [book(), book()] },
    workspace(book(1, [document(1)])), workspace(book(1, [document(10), document(10)])),
    workspace({ ...book(), id: id(1).toUpperCase().replace(/00000000/, 'ABCDEF00') }),
    workspace({ ...book(), cover: '../../assets/../../../etc/passwd' }),
    workspace({ ...book(), cover: 'https://example.com/a.png' }),
    workspace({ ...book(), name: '字'.repeat(342) }),
    workspace(book(1, [{ ...document(), title: '字'.repeat(342) }])),
    workspace(book(1, [{ ...document(), markdown: 'x'.repeat(16 * 1024 * 1024 + 1) }])),
    workspace(...Array.from({ length: 1001 }, (_, n) => book(n + 1, []))),
    workspace(book(1, Array.from({ length: 5001 }, (_, n) => document(n + 10)))),
  ]) assert.throws(() => parseSyncWorkspace(invalid));
});
