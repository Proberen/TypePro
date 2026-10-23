import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyExtensions, getPluginData, mergeExtensions, normalizeExtensions, putPluginData, recordInstallation, removePluginData } from './state.ts';

const device = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const entry = (key, value, time = 1, source = 1) => ({ pluginId: 'notebook.activity', key, value, updatedAt: `2026-10-22T00:00:0${time}.000Z`, deviceId: device(source) });
const state = (...entries) => ({ entries, installs: [] });
const plugin = { manifest: { id: 'notebook.activity', name: '每日打卡', version: '1.0.0', apiVersion: 2, permissions: ['storage', 'notes.read'] }, code: 'await notebook.notes.list();', enabled: true };

test('device-separated activity records union and repeat synchronization is idempotent', () => {
  const local = state(entry('activity.2026-10-22.mac', { added: 12, removed: 4 }));
  const remote = state(entry('activity.2026-10-22.android', { added: 6, removed: 1 }, 2, 2));
  const merged = mergeExtensions(undefined, local, remote);
  assert.equal(merged.entries.length, 2);
  assert.deepEqual(mergeExtensions(local, merged, remote), merged);
  assert.deepEqual(mergeExtensions(undefined, remote, local), merged);
});

test('independent values merge, timestamp ties converge, and tombstones prevent stale resurrection', () => {
  const base = state(entry('settings', { model: 'one' }));
  const local = state(entry('settings', { model: 'two' }, 2, 1));
  const remote = state(entry('settings', { model: 'three' }, 2, 2));
  assert.deepEqual(mergeExtensions(base, local, remote), mergeExtensions(base, remote, local));
  const removed = state({ ...entry('settings', null, 3), deleted: true });
  assert.equal(mergeExtensions(base, removed, base).entries[0].deleted, true);
  assert.equal(mergeExtensions(undefined, removed, base).entries[0].deleted, true);
});

test('local helpers isolate JSON values, retain deletions, and synchronized installations omit execution grants', () => {
  const input = { text: 'hello' };
  const written = putPluginData(undefined, plugin.manifest.id, 'settings', input);
  input.text = 'outside';
  assert.deepEqual(getPluginData(written, plugin.manifest.id, 'settings'), { text: 'hello' });
  const copy = getPluginData(written, plugin.manifest.id, 'settings'); copy.text = 'outside';
  assert.deepEqual(getPluginData(written, plugin.manifest.id, 'settings'), { text: 'hello' });
  const removed = removePluginData(written, plugin.manifest.id, 'settings');
  assert.equal(getPluginData(removed, plugin.manifest.id, 'settings'), undefined);
  assert.equal(removed.entries[0].deleted, true);
  const installed = recordInstallation(written, plugin);
  assert.equal(installed.installs[0].source, 'local');
  assert.equal(installed.installs[0].code, plugin.code);
  assert.equal('enabled' in installed.installs[0], false);
  const uninstalled = recordInstallation(installed, null, plugin.manifest.id);
  assert.equal(uninstalled.installs[0].deleted, true);
  assert.equal(uninstalled.installs[0].code, '');
  assert.equal(recordInstallation(uninstalled, plugin).installs[0].deleted, undefined);
});

test('market installations pin immutable bytes without synchronizing executable code', () => {
  const market = { sha256: 'a'.repeat(64), size: 100, downloadUrl: 'https://github.com/Proberen/typepro-plugins/releases/download/plugin-v1/plugin.zip' };
  const result = recordInstallation(undefined, { ...plugin, market });
  assert.equal(result.installs[0].source, 'market');
  assert.equal(result.installs[0].sha256, market.sha256);
  assert.equal('code' in result.installs[0], false);
  assert.deepEqual(recordInstallation(result, { ...plugin, market }), result);
});

test('malformed and ambiguous JSON, duplicate identities, unexpected fields and unsupported URL schemes are rejected', () => {
  assert.deepEqual(normalizeExtensions(undefined), emptyExtensions());
  for (const value of [NaN, undefined, new Date(), { constructor: 'x' }, JSON.parse('{"__proto__":1}')]) {
    assert.throws(() => normalizeExtensions(state(entry('settings', value))));
  }
  assert.throws(() => normalizeExtensions(state(entry('settings', 1), entry('settings', 2))));
  assert.throws(() => normalizeExtensions({ ...state(), apiKey: 'never synchronized' }));
  assert.throws(() => normalizeExtensions(state({ ...entry('settings', 1), updatedAt: '2026-02-30T00:00:00Z' })));
  assert.throws(() => recordInstallation(undefined, { ...plugin, market: { sha256: 'a'.repeat(64), size: 100, downloadUrl: 'http://github.com/Proberen/typepro-plugins/releases/download/v1/plugin.zip' } }));
});

test('API3 imported resource bytes and network origins synchronize without runtime grants', () => {
  const resourcePlugin = { ...plugin, manifest: { ...plugin.manifest, apiVersion: 3, permissions: ['ui', 'network'], networkOrigins: ['https://api.example.com'] }, files: { 'ui.js': 'document.body.textContent="hello";', 'ui.css': 'body{color:var(--tp-text)}' } };
  const result = recordInstallation(undefined, resourcePlugin);
  assert.deepEqual(result.installs[0].files, resourcePlugin.files);
  assert.deepEqual(result.installs[0].manifest.networkOrigins, resourcePlugin.manifest.networkOrigins);
  const removed = recordInstallation(result, null, plugin.manifest.id);
  assert.equal(removed.installs[0].files, undefined);
  assert.equal(removed.installs[0].deleted, true);
  assert.equal('enabled' in result.installs[0], false);
  assert.throws(() => recordInstallation(undefined, { ...resourcePlugin, files: { '../ui.js': 'bad' } }));
});
