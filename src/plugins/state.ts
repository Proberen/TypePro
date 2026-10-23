import { normalizeNetworkOrigins, normalizePluginFiles, PACKAGE_LIMITS } from './packages.ts';
import type { ExtensionEntry, ExtensionState, InstalledPlugin, JsonValue, PluginInstallation } from '../lib/types';

export const EXTENSION_LIMITS = { bytes: 32 * 1024 * 1024, entries: 20000, installs: 128 } as const;
const encoder = new TextEncoder();
const ID = /^[a-z][a-z0-9._-]{2,63}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
let memoryDeviceId: string | undefined;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export const emptyExtensions = (): ExtensionState => ({ entries: [], installs: [] });
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('插件同步记录格式无效');
  return value as Record<string, unknown>;
}
function string(value: unknown, limit: number): string {
  if (typeof value !== 'string' || encoder.encode(value).byteLength > limit) throw new Error('插件同步字段无效或过长');
  return value;
}
function identifier(value: unknown, pattern: RegExp): string {
  const result = string(value, 128);
  if (!pattern.test(result) || UNSAFE.has(result)) throw new Error('插件同步标识无效');
  return result;
}
function timestamp(value: unknown): string {
  const result = string(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)) throw new Error('插件同步时间无效');
  return result;
}
function json(value: unknown, ancestors = new Set<object>(), depth = 0): JsonValue {
  if (depth > 64) throw new Error('插件数据嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('插件数据必须是有效 JSON');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('插件数据必须是有效 JSON');
  ancestors.add(value);
  let result: JsonValue;
  if (Array.isArray(value)) result = Array.from(value, item => json(item, ancestors, depth + 1));
  else {
    const record: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      if (UNSAFE.has(key)) throw new Error('插件数据含保留字段');
      record[key] = json((value as Record<string, unknown>)[key], ancestors, depth + 1);
    }
    result = record;
  }
  ancestors.delete(value);
  return result;
}
function metadata(value: unknown) {
  const record = value as Record<string, unknown>;
  if (record.deleted !== undefined && typeof record.deleted !== 'boolean') throw new Error('插件删除标记无效');
  return { updatedAt: timestamp(record.updatedAt), deviceId: identifier(record.deviceId, UUID), ...(record.deleted === undefined ? {} : { deleted: record.deleted }) };
}
function manifest(value: unknown): InstalledPlugin['manifest'] {
  const item = object(value, ['id', 'name', 'version', 'description', 'apiVersion', 'permissions', 'networkOrigins']);
  const id = identifier(item.id, ID), name = string(item.name, 240), version = string(item.version, 40);
  if (!name.trim() || Array.from(name).length > 60 || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || (item.apiVersion !== 1 && item.apiVersion !== 2 && item.apiVersion !== 3)) throw new Error('同步插件清单无效');
  if (!Array.isArray(item.permissions) || item.permissions.length > 64 || item.permissions.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(value)) || new Set(item.permissions).size !== item.permissions.length) throw new Error('同步插件权限无效');
  const description = item.description === undefined ? undefined : string(item.description, 1200);
  if (description !== undefined && Array.from(description).length > 300) throw new Error('插件说明过长');
  const networkOrigins = normalizeNetworkOrigins(item.networkOrigins);
  if (item.networkOrigins !== undefined && (item.apiVersion !== 3 || !item.permissions.includes('network'))) throw new Error('同步插件网络权限无效');
  return { id, name, version, apiVersion: item.apiVersion, ...(item.networkOrigins === undefined ? {} : { networkOrigins }), permissions: [...item.permissions].sort(), ...(description === undefined ? {} : { description }) };
}
function installation(raw: unknown): PluginInstallation {
  const item = object(raw, ['id', 'manifest', 'source', 'code', 'files', 'sha256', 'size', 'downloadUrl', 'updatedAt', 'deviceId', 'deleted']);
  const id = identifier(item.id, ID), details = manifest(item.manifest), meta = metadata(item);
  if (id !== details.id) throw new Error('插件同步身份不一致');
  if (item.source === 'local') {
    if (item.sha256 !== undefined || item.size !== undefined || item.downloadUrl !== undefined) throw new Error('本地插件不能包含市场下载信息');
    const code = string(item.code, PACKAGE_LIMITS.code);
    const files = normalizePluginFiles(item.files);
    if (files && details.apiVersion !== 3) throw new Error('同步插件资源需要 API 3');
    if (encoder.encode(code + JSON.stringify(details) + Object.values(files ?? {}).join('')).length > PACKAGE_LIMITS.bytes) throw new Error('同步插件包过大');
    if (!code.trim() && !meta.deleted) throw new Error('同步插件代码为空');
    return { id, manifest: details, source: 'local', code: meta.deleted ? '' : code, ...(!meta.deleted && files ? { files } : {}), ...meta };
  }
  if (item.source !== 'market' || item.code !== undefined || item.files !== undefined || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || Number(item.size) < 1 || Number(item.size) > PACKAGE_LIMITS.bytes) throw new Error('市场插件同步信息无效');
  const downloadUrl = string(item.downloadUrl, 2048);
  const url = new URL(downloadUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/Proberen\/typepro-plugins\/releases\/download\/[^/]+\/[^/]+\.zip$/.test(url.pathname)) throw new Error('插件下载地址不受支持');
  return { id, manifest: details, source: 'market', sha256: item.sha256, size: item.size as number, downloadUrl, ...meta };
}

/** All synchronized plugin data is explicit, bounded JSON; credentials use native secure storage. */
export function normalizeExtensions(input: unknown): ExtensionState {
  if (input === undefined) return emptyExtensions();
  const value = object(input, ['entries', 'installs']);
  if (!Array.isArray(value.entries) || value.entries.length > EXTENSION_LIMITS.entries || !Array.isArray(value.installs) || value.installs.length > EXTENSION_LIMITS.installs) throw new Error('插件同步记录超过数量限制');
  const ids = new Set<string>();
  const entries = value.entries.map(raw => {
    const item = object(raw, ['pluginId', 'key', 'value', 'updatedAt', 'deviceId', 'deleted']);
    const pluginId = identifier(item.pluginId, ID), key = identifier(item.key, KEY), meta = metadata(item);
    const identity = `${pluginId}:${key}`;
    if (ids.has(identity)) throw new Error('插件同步记录重复');
    ids.add(identity);
    if (meta.deleted && item.value !== null) throw new Error('已删除插件数据必须为空');
    return { pluginId, key, value: json(item.value), ...meta };
  }).sort((a, b) => compare(`${a.pluginId}:${a.key}`, `${b.pluginId}:${b.key}`));
  ids.clear();
  const installs = value.installs.map(raw => {
    const result = installation(raw);
    if (ids.has(result.id)) throw new Error('插件安装记录重复');
    ids.add(result.id);
    return result;
  }).sort((a, b) => compare(a.id, b.id));
  const result = { entries, installs };
  if (encoder.encode(JSON.stringify(result)).byteLength > EXTENSION_LIMITS.bytes) throw new Error('插件数据超过 32 MB 同步限制');
  return result;
}

function mergeRecords<T extends { updatedAt: string; deviceId: string }>(base: T[], local: T[], remote: T[], key: (item: T) => string): T[] {
  const b = new Map(base.map(item => [key(item), item])), l = new Map(local.map(item => [key(item), item])), r = new Map(remote.map(item => [key(item), item]));
  return [...new Set([...b.keys(), ...l.keys(), ...r.keys()])].flatMap(id => {
    const left = l.get(id), right = r.get(id), before = b.get(id);
    // Absence is never a deletion: only explicit tombstones propagate removals.
    if (!left || !right) return [left || right || before!];
    const ls = JSON.stringify(left), rs = JSON.stringify(right), bs = JSON.stringify(before);
    if (ls === rs || rs === bs) return [left];
    if (ls === bs) return [right];
    const order = Date.parse(left.updatedAt) - Date.parse(right.updatedAt) || compare(left.deviceId, right.deviceId) || compare(ls, rs);
    return [order >= 0 ? left : right];
  });
}
export function mergeExtensions(base: ExtensionState | undefined, local: ExtensionState | undefined, remote: ExtensionState | undefined): ExtensionState {
  const b = normalizeExtensions(base), l = normalizeExtensions(local), r = normalizeExtensions(remote);
  return normalizeExtensions({ entries: mergeRecords(b.entries, l.entries, r.entries, item => `${item.pluginId}:${item.key}`), installs: mergeRecords(b.installs, l.installs, r.installs, item => item.id) });
}

function newDeviceId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function extensionDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const existing = localStorage.getItem('typepro.extensions.device');
    if (existing && UUID.test(existing)) return memoryDeviceId = existing;
    const id = newDeviceId();
    localStorage.setItem('typepro.extensions.device', id);
    return memoryDeviceId = id;
  } catch { return memoryDeviceId = newDeviceId(); }
}
function nextTimestamp(previous?: { updatedAt: string }): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
}
export function getPluginData(state: ExtensionState | undefined, pluginId: string, key: string): JsonValue | undefined {
  identifier(pluginId, ID); identifier(key, KEY);
  const entry = state?.entries.find(item => item.pluginId === pluginId && item.key === key);
  return entry && !entry.deleted ? json(entry.value) : undefined;
}
export function putPluginData(state: ExtensionState | undefined, pluginId: string, key: string, value: JsonValue): ExtensionState {
  const normalized = normalizeExtensions(state), previous = normalized.entries.find(item => item.pluginId === pluginId && item.key === key);
  const data = json(value);
  if (previous && !previous.deleted && JSON.stringify(previous.value) === JSON.stringify(data)) return normalized;
  const entry: ExtensionEntry = { pluginId, key, value: data, updatedAt: nextTimestamp(previous), deviceId: extensionDeviceId() };
  return normalizeExtensions({ ...normalized, entries: [...normalized.entries.filter(item => item !== previous), entry] });
}
export function removePluginData(state: ExtensionState | undefined, pluginId: string, key: string): ExtensionState {
  const normalized = normalizeExtensions(state), previous = normalized.entries.find(item => item.pluginId === pluginId && item.key === key);
  if (previous?.deleted) return normalized;
  const entry: ExtensionEntry = { pluginId, key, value: null, updatedAt: nextTimestamp(previous), deviceId: extensionDeviceId(), deleted: true };
  return normalizeExtensions({ ...normalized, entries: [...normalized.entries.filter(item => item !== previous), entry] });
}
export function recordInstallation(state: ExtensionState | undefined, plugin: InstalledPlugin | null, id = plugin?.manifest.id): ExtensionState {
  const normalized = normalizeExtensions(state), previous = normalized.installs.find(item => item.id === id);
  if (!id || (!plugin && !previous)) return normalized;
  const value = plugin ? { id, manifest: plugin.manifest, ...(plugin.market ? { source: 'market' as const, ...plugin.market } : { source: 'local' as const, code: plugin.code, ...(plugin.files ? { files: plugin.files } : {}) }) } : { ...previous!, ...(previous!.source === 'local' ? { code: '', files: undefined } : {}), deleted: true };
  const record = installation({ ...value, updatedAt: previous?.updatedAt || new Date().toISOString(), deviceId: previous?.deviceId || extensionDeviceId() });
  if (previous && JSON.stringify(previous) === JSON.stringify(record)) return normalized;
  const next = { ...record, updatedAt: nextTimestamp(previous), deviceId: extensionDeviceId() };
  return normalizeExtensions({ ...normalized, installs: [...normalized.installs.filter(item => item !== previous), next] });
}
