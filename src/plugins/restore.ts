import { command } from '../lib/bridge.ts';
import type { InstalledPlugin, PluginInstallation, Workspace } from '../lib/types';
import { parseMarketCatalog, prepareMarketInstall, type MarketPlugin } from './market.ts';
import { normalizePluginFiles, validatePlugin } from './packages.ts';

export interface RestorePluginOptions {
  getWorkspace: () => Workspace | null;
  apply: (plugins: InstalledPlugin[]) => Promise<void>;
  isCancelled?: () => boolean;
  download?: (entry: MarketPlugin) => Promise<Uint8Array>;
  onError?: (message: string) => void;
}

const snapshot = (value: unknown) => JSON.stringify(value);
const manifestIdentity = (plugin: Pick<InstalledPlugin, 'manifest'>) => snapshot([
  plugin.manifest.id, plugin.manifest.name, plugin.manifest.version,
  plugin.manifest.apiVersion, plugin.manifest.description ?? '',
  [...plugin.manifest.permissions].sort(), [...(plugin.manifest.networkOrigins ?? [])].sort(),
]);
const sameFiles = (left: InstalledPlugin['files'], right: InstalledPlugin['files']) => snapshot(normalizePluginFiles(left)) === snapshot(normalizePluginFiles(right));
const sameManifest = (plugin: InstalledPlugin, record: PluginInstallation) => manifestIdentity(plugin) === manifestIdentity(record);
const samePin = (plugin: InstalledPlugin, record: PluginInstallation) => !!plugin.market
  && plugin.market.sha256 === record.sha256 && plugin.market.size === record.size
  && plugin.market.downloadUrl === record.downloadUrl;

function marketEntry(record: PluginInstallation): MarketPlugin {
  return parseMarketCatalog({ schemaVersion: 1, updatedAt: record.updatedAt, plugins: [{
    ...record.manifest, sha256: record.sha256, size: record.size, downloadUrl: record.downloadUrl,
  }] }).plugins[0];
}

/** Restore synchronized installation records without copying another device's permission grant. */
export async function restoreSyncedPlugins(options: RestorePluginOptions): Promise<{ restored: number; removed: number }> {
  const result = { restored: 0, removed: 0 };
  const records = [...(options.getWorkspace()?.extensions?.installs ?? [])]
    .sort((a, b) => Number(!!b.deleted) - Number(!!a.deleted));
  const download = options.download ?? (async (entry: MarketPlugin) => new Uint8Array(
    await command<number[]>('plugin_market_restore', { entry }),
  ));

  for (const record of records) {
    if (options.isCancelled?.()) break;
    const initial = options.getWorkspace();
    if (!initial) break;
    const recordSnapshot = snapshot(record);
    if (snapshot(initial.extensions?.installs.find(item => item.id === record.id)) !== recordSnapshot) continue;
    const previous = initial.plugins.find(plugin => plugin.manifest.id === record.id);
    const slotSnapshot = snapshot(previous);
    // Include enabled state and code in the guard: a concurrent local choice wins.
    const latestUnchanged = () => {
      if (options.isCancelled?.()) return null;
      const current = options.getWorkspace();
      if (!current || snapshot(current.extensions?.installs.find(item => item.id === record.id)) !== recordSnapshot
        || snapshot(current.plugins.find(plugin => plugin.manifest.id === record.id)) !== slotSnapshot) return null;
      return current;
    };

    try {
      if (record.id !== record.manifest.id) throw new Error('插件同步身份不一致');
      if (record.deleted) {
        if (!previous) continue;
        const current = latestUnchanged();
        if (!current) continue;
        await options.apply(current.plugins.filter(plugin => plugin.manifest.id !== record.id));
        if (options.isCancelled?.()) break;
        const saved = options.getWorkspace();
        if (saved && snapshot(saved.extensions?.installs.find(item => item.id === record.id)) === recordSnapshot
          && !saved.plugins.some(plugin => plugin.manifest.id === record.id)) result.removed++;
        continue;
      }

      if (previous && sameManifest(previous, record)
        && (record.source === 'local' ? previous.code === record.code && sameFiles(previous.files, record.files) && !previous.market : samePin(previous, record))) continue;

      let next: InstalledPlugin;
      if (record.source === 'market') {
        const entry = marketEntry(record);
        const bytes = await download(entry);
        if (!latestUnchanged()) continue;
        // Restoration can target an older immutable release. No update/downgrade policy applies here.
        next = prepareMarketInstall(entry, bytes);
      } else {
        next = validatePlugin({ manifest: record.manifest, code: record.code, files: record.files });
      }
      if (previous && manifestIdentity(previous) === manifestIdentity(next) && previous.code === next.code && sameFiles(previous.files, next.files)) {
        // Identical locally approved bytes may acquire their missing market provenance.
        next = { ...next, enabled: previous.enabled };
      } else next = { ...next, enabled: false };

      const current = latestUnchanged();
      if (!current) continue;
      if (!previous && current.plugins.length >= 24) throw new Error('最多安装 24 个插件，请先移除其他插件');
      const plugins = previous
        ? current.plugins.map(plugin => plugin.manifest.id === record.id ? next : plugin)
        : [...current.plugins, next];
      await options.apply(plugins);
      if (options.isCancelled?.()) break;
      const saved = options.getWorkspace();
      if (saved && snapshot(saved.extensions?.installs.find(item => item.id === record.id)) === recordSnapshot
        && snapshot(saved.plugins.find(plugin => plugin.manifest.id === record.id)) === snapshot(next)) result.restored++;
    } catch (error) {
      // Stale/cancelled work must not replace the newer selection with an obsolete error.
      if (latestUnchanged()) options.onError?.(`${record.manifest.name} 恢复失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
