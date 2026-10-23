import type { InstalledPlugin } from '../lib/types';
import { parsePluginPackage, validatePlugin } from './packages.ts';

export type MarketPlugin = InstalledPlugin['manifest'] & {
  downloadUrl: string;
  sha256: string;
  size: number;
};
export interface MarketCatalog {
  schemaVersion: 1;
  updatedAt: string;
  plugins: MarketPlugin[];
}

function versionParts(version: string): string[][] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match || version.length > 40) return null;
  const release = match.slice(1, 4);
  const prerelease = match[4]?.split('.') || [];
  if ([...release, ...prerelease.filter(value => /^\d+$/.test(value))].some(value => value.length > 1 && value[0] === '0') || prerelease.some(value => !value)) return null;
  return [release, prerelease];
}
function compareNumber(a: string, b: string): number {
  return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
}

// null keeps legacy versions that cannot be ordered out of the update path.
export function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    const order = compareNumber(left[0][index], right[0][index]);
    if (order) return order;
  }
  const [l, r] = [left[1], right[1]];
  if (!l.length || !r.length) return l.length === r.length ? 0 : l.length ? -1 : 1;
  for (let index = 0; index < Math.max(l.length, r.length); index++) {
    if (l[index] === undefined || r[index] === undefined) return l[index] === undefined ? -1 : 1;
    if (l[index] === r[index]) continue;
    const numericLeft = /^\d+$/.test(l[index]), numericRight = /^\d+$/.test(r[index]);
    if (numericLeft && numericRight) return compareNumber(l[index], r[index]);
    if (numericLeft !== numericRight) return numericLeft ? -1 : 1;
    return l[index] < r[index] ? -1 : 1;
  }
  return 0;
}

export function parseMarketCatalog(input: unknown): MarketCatalog {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('插件目录格式不正确');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || typeof value.updatedAt !== 'string' || value.updatedAt.length > 40 || !Number.isFinite(Date.parse(value.updatedAt)) || !Array.isArray(value.plugins) || value.plugins.length > 500) throw new Error('插件目录格式不正确');
  const ids = new Set<string>();
  const plugins = value.plugins.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('插件信息不完整');
    const entry = item as Record<string, unknown>;
    const manifest = validatePlugin({ manifest: entry, code: 'metadata' }).manifest;
    if (manifest.name !== entry.name || !versionParts(manifest.version) || ids.has(manifest.id)) throw new Error('插件目录包含重复或无效版本');
    ids.add(manifest.id);
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 2 * 1024 * 1024) throw new Error('插件安装包信息不完整');
    if (typeof entry.downloadUrl !== 'string') throw new Error('插件下载地址无效');
    const url = new URL(entry.downloadUrl);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !/^\/Proberen\/typepro-plugins\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.zip$/.test(url.pathname)) throw new Error('插件下载地址无效');
    return { ...manifest, downloadUrl: entry.downloadUrl, sha256: entry.sha256, size: entry.size };
  });
  return { schemaVersion: 1, updatedAt: value.updatedAt, plugins };
}

export function addedPermissions(previous: InstalledPlugin | undefined, next: Pick<MarketPlugin, 'permissions'>): string[] {
  return next.permissions.filter(permission => !previous?.manifest.permissions.includes(permission));
}

// The native downloader verifies the pinned SHA-256 before returning bytes.
export function prepareMarketInstall(entry: MarketPlugin, bytes: Uint8Array, previous?: InstalledPlugin): InstalledPlugin {
  if (bytes.length !== entry.size) throw new Error('安装包大小与目录不一致，请刷新后重试');
  const plugin = parsePluginPackage(`${entry.id}.zip`, bytes);
  const actual = plugin.manifest;
  const samePermissions = [...actual.permissions].sort().join('\n') === [...entry.permissions].sort().join('\n');
  if (actual.id !== entry.id || actual.version !== entry.version || actual.name !== entry.name || actual.apiVersion !== entry.apiVersion || (actual.description || '') !== (entry.description || '') || !samePermissions) throw new Error('安装包与插件目录不一致，请刷新后重试');
  if (previous && (previous.manifest.id !== entry.id || compareVersions(entry.version, previous.manifest.version) !== 1)) throw new Error('插件版本已变化，请刷新后重试');
  return { ...plugin, enabled: !!previous?.enabled && addedPermissions(previous, entry).length === 0 };
}
