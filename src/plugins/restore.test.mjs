import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { restoreSyncedPlugins } from './restore.ts';
import { parsePluginPackage } from './packages.ts';

const deviceId = '11111111-1111-4111-8111-111111111111';
const updatedAt = '2026-10-22T12:00:00.000Z';
const local = (id = 'test.local', version = '1.0.0') => ({ manifest: { id, name: id, version, apiVersion: 1, permissions: ['commands'] }, code: 'const installed = true;', enabled: true });
const install = plugin => ({ id: plugin.manifest.id, manifest: plugin.manifest, source: 'local', code: plugin.code, deviceId, updatedAt });
function harness(records, plugins = []) {
  let workspace = { version: 1, notebooks: [], plugins, extensions: { entries: [], installs: records } };
  const errors = [];
  let applies = 0;
  return {
    get workspace() { return workspace; },
    set workspace(value) { workspace = value; },
    get applies() { return applies; }, errors,
    options: { getWorkspace: () => workspace, apply: async plugins => { applies++; workspace = { ...workspace, plugins }; }, onError: error => errors.push(error) },
  };
}
const bytes = new Uint8Array(readFileSync(new URL('../../examples/date-and-count.zip', import.meta.url)));
const packaged = parsePluginPackage('sample.zip', bytes);
const marketRecord = () => ({ id: packaged.manifest.id, manifest: packaged.manifest, source: 'market',
  sha256: 'a'.repeat(64), size: bytes.length,
  downloadUrl: 'https://github.com/Proberen/typepro-plugins/releases/download/test-fixture/example.zip',
  deviceId, updatedAt });

test('restores local records disabled while preserving identical local grants and unrelated legacy plugins', async () => {
  const first = local(), legacy = local('test.legacy');
  const h = harness([install(first)], [legacy]);
  assert.deepEqual(await restoreSyncedPlugins(h.options), { restored: 1, removed: 0 });
  assert.equal(h.workspace.plugins[1].enabled, false);
  h.workspace.plugins[1].enabled = true;
  await restoreSyncedPlugins(h.options);
  assert.equal(h.workspace.plugins[1].enabled, true);
  assert.equal(h.applies, 1);
  assert.equal(h.workspace.plugins[0], legacy);
});

test('changed versions and permissions restore disabled and tombstones retain plugin data', async () => {
  const previous = local(), newer = local('test.local', '2.0.0');
  newer.manifest.permissions.push('notes.read');
  const h = harness([install(newer)], [previous]);
  await restoreSyncedPlugins(h.options);
  assert.equal(h.workspace.plugins[0].manifest.version, '2.0.0');
  assert.equal(h.workspace.plugins[0].enabled, false);
  const entry = { pluginId: 'test.local', key: 'saved', value: 'content', deviceId, updatedAt };
  h.workspace.extensions.entries.push(entry);
  h.workspace.extensions.installs[0] = { ...install(newer), deleted: true, code: '' };
  assert.deepEqual(await restoreSyncedPlugins(h.options), { restored: 0, removed: 1 });
  assert.deepEqual(h.workspace.plugins, []);
  assert.equal(h.workspace.extensions.entries[0], entry);
});

test('market restoration uses exact package metadata and skips the network when the same pin is present', async () => {
  const record = marketRecord(), h = harness([record]);
  let calls = 0;
  const options = { ...h.options, download: async entry => { calls++; assert.equal(entry.sha256, record.sha256); return bytes; } };
  await restoreSyncedPlugins(options);
  assert.equal(h.workspace.plugins[0].enabled, false);
  h.workspace.plugins[0].enabled = true;
  await restoreSyncedPlugins(options);
  assert.equal(calls, 1);
  assert.equal(h.workspace.plugins[0].enabled, true);
});

test('download failure preserves the old installed code and reports the error', async () => {
  const record = marketRecord(), old = { ...packaged, code: 'old', enabled: true };
  const h = harness([record], [old]);
  await restoreSyncedPlugins({ ...h.options, download: async () => { throw new Error('offline'); } });
  assert.equal(h.workspace.plugins[0], old);
  assert.equal(h.applies, 0);
  assert.match(h.errors[0], /offline/);
});

test('package metadata mismatch preserves the old code and unrelated changes made during download survive', async () => {
  const record = marketRecord(), old = { ...packaged, code: 'old', enabled: true };
  const mismatched = { ...record, manifest: { ...record.manifest, name: '另一个名称' } };
  const bad = harness([mismatched], [old]);
  await restoreSyncedPlugins({ ...bad.options, download: async () => bytes });
  assert.equal(bad.workspace.plugins[0], old);
  assert.match(bad.errors[0], /不一致/);
  const h = harness([record]);
  const unrelated = local('test.added');
  await restoreSyncedPlugins({ ...h.options, download: async () => {
    h.workspace = { ...h.workspace, plugins: [unrelated] };
    return bytes;
  } });
  assert.equal(h.workspace.plugins[0], unrelated);
  assert.equal(h.workspace.plugins[1].manifest.id, record.id);
});

test('download completion cannot overwrite a newer sync record or a concurrent local grant change', async () => {
  for (const change of ['record', 'slot', 'cancel']) {
    const record = marketRecord(), old = { ...packaged, code: 'old', enabled: true };
    const h = harness([record], [old]);
    let cancelled = false;
    await restoreSyncedPlugins({ ...h.options, isCancelled: () => cancelled, download: async () => {
      if (change === 'record') h.workspace.extensions.installs[0] = { ...record, updatedAt: '2026-10-22T12:00:01.000Z', deleted: true };
      if (change === 'slot') h.workspace = { ...h.workspace, plugins: [{ ...old, enabled: false }] };
      if (change === 'cancel') cancelled = true;
      return bytes;
    } });
    assert.equal(h.applies, 0, change);
    assert.equal(h.errors.length, 0, change);
  }
});

test('capacity is checked against the latest list and tombstones free a slot before installation', async () => {
  const plugins = Array.from({ length: 24 }, (_, index) => local(`test.item-${index}`));
  const added = local('test.added'), removed = { ...install(plugins[0]), deleted: true, code: '' };
  const h = harness([install(added), removed], plugins);
  assert.deepEqual(await restoreSyncedPlugins(h.options), { restored: 1, removed: 1 });
  assert.equal(h.workspace.plugins.length, 24);
  assert.equal(h.errors.length, 0);
  const full = harness([install(local('test.other'))], h.workspace.plugins);
  await restoreSyncedPlugins(full.options);
  assert.equal(full.applies, 0);
  assert.match(full.errors[0], /24/);
});

test('changed API3 view resources are restored disabled even when worker and manifest match', async () => {
  const previous = { ...local(), manifest: { ...local().manifest, apiVersion: 3, permissions: ['ui'] }, files: { 'ui.js': 'old UI' } };
  const record = { ...install(previous), files: { 'ui.js': 'new UI' } };
  const h = harness([record], [previous]);
  await restoreSyncedPlugins(h.options);
  assert.equal(h.workspace.plugins[0].files['ui.js'], 'new UI');
  assert.equal(h.workspace.plugins[0].enabled, false);
  h.workspace.plugins[0].enabled = true;
  await restoreSyncedPlugins(h.options);
  assert.equal(h.workspace.plugins[0].enabled, true);
});
