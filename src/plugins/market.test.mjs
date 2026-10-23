import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { addedPermissions, compareVersions, parseMarketCatalog, prepareMarketInstall } from './market.ts';

const manifest = (overrides = {}) => ({ id: 'date.tool', name: '日期工具', version: '1.1.0', apiVersion: 1, permissions: ['editor.insert'], ...overrides });
const bytesFor = value => zipSync({ 'manifest.json': strToU8(JSON.stringify(value)), 'main.js': strToU8('await notebook.editor.insert("today");') });
const entryFor = (value = manifest()) => ({ ...value, downloadUrl: `https://github.com/Proberen/typepro-plugins/releases/download/date.tool-v${value.version}/date.tool-${value.version}.zip`, sha256: 'a'.repeat(64), size: bytesFor(value).length });
const catalog = plugins => ({ schemaVersion: 1, updatedAt: '2026-10-22T00:00:00.000Z', plugins });
const previous = (overrides = {}) => ({ manifest: manifest({ version: '1.0.0' }), code: 'old code', enabled: true, ...overrides });

test('versions use numeric release and prerelease precedence without integer rounding', () => {
  const sorted = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-beta', '1.0.0', '1.0.1', '1.2.0', '1.10.0', '2.0.0'];
  for (let i = 0; i < sorted.length; i++) for (let j = 0; j < sorted.length; j++) assert.equal(compareVersions(sorted[i], sorted[j]), Math.sign(i - j));
  assert.equal(compareVersions('1.0.0-2', '1.0.0-alpha'), -1);
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  for (const value of ['01.0.0', '1.0', 'v1.0.0', '1.0.0-a..b', '1.0.0-01', '1.0.0+build']) assert.equal(compareVersions(value, '1.0.0'), null);
});

test('catalog validates manifest, package metadata, unique ids and exact public release origin', () => {
  const entry = entryFor();
  assert.deepEqual(parseMarketCatalog(catalog([entry])).plugins[0], entry);
  const api2 = entryFor(manifest({ apiVersion: 2, permissions: ['storage', 'assistant', 'notes.read'] }));
  assert.deepEqual(parseMarketCatalog(catalog([api2])).plugins[0], api2);
  assert.throws(() => parseMarketCatalog(catalog([{ ...api2, apiVersion: 1 }])));
  assert.throws(() => parseMarketCatalog(catalog([entry, entry])), /重复/);
  for (const override of [{ size: 0 }, { size: 2097153 }, { sha256: 'A'.repeat(64) }, { apiVersion: 3 }, { permissions: ['network'] }, { version: '01.0.0' }]) assert.throws(() => parseMarketCatalog(catalog([{ ...entry, ...override }])));
  for (const downloadUrl of ['http://github.com/Proberen/typepro-plugins/releases/download/v1/a.zip', 'https://example.com/a.zip', 'https://github.com/another/repo/releases/download/v1/a.zip', `${entry.downloadUrl}?token=secret`, `https://name@github.com${new URL(entry.downloadUrl).pathname}`]) assert.throws(() => parseMarketCatalog(catalog([{ ...entry, downloadUrl }])));
});

test('downloaded metadata must exactly match the reviewed catalog entry', () => {
  for (const overrides of [{ id: 'other.tool' }, { name: '其他名称' }, { version: '1.2.0' }, { description: 'changed' }, { permissions: ['notes.read'] }]) {
    const bytes = bytesFor(manifest(overrides));
    assert.throws(() => prepareMarketInstall({ ...entryFor(), size: bytes.length }, bytes), /不一致/);
  }
  const bytes = bytesFor(manifest());
  assert.throws(() => prepareMarketInstall({ ...entryFor(), size: bytes.length + 1 }, bytes), /大小/);
});

test('install and update never enable new permissions implicitly and retain previous object', () => {
  const old = previous();
  const bytes = bytesFor(manifest());
  assert.equal(prepareMarketInstall(entryFor(), bytes).enabled, false);
  assert.equal(prepareMarketInstall(entryFor(), bytes, old).enabled, true);
  assert.equal(prepareMarketInstall(entryFor(), bytes, previous({ enabled: false })).enabled, false);
  const expanded = manifest({ permissions: ['notes.read', 'editor.insert'] });
  assert.deepEqual(addedPermissions(old, expanded), ['notes.read']);
  assert.equal(prepareMarketInstall(entryFor(expanded), bytesFor(expanded), old).enabled, false);
  assert.deepEqual(old, previous());
});

test('updates reject same version, downgrade, incomparable legacy version and different id', () => {
  const entry = entryFor(), bytes = bytesFor(manifest());
  for (const overrides of [{ version: '1.1.0' }, { version: '2.0.0' }, { version: '01.0.0' }, { id: 'other.tool' }]) assert.throws(() => prepareMarketInstall(entry, bytes, previous({ manifest: manifest(overrides) })), /版本已变化/);
});
