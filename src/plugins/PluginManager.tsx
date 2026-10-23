import { useState } from 'react';
import type { InstalledPlugin } from '../lib/types';
import { parsePluginPackage, PERMISSIONS } from './packages';
import './plugins.css';

export interface PluginManagerProps {
  plugins: InstalledPlugin[];
  onChange: (plugins: InstalledPlugin[]) => void | Promise<void>;
  onImport: () => Promise<{ name: string; bytes: Uint8Array } | null>;
}

export function PluginManager({ plugins, onChange, onImport }: PluginManagerProps) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  async function change(next: InstalledPlugin[]) {
    setBusy(true); setError('');
    try { await onChange(next); setPending(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function install() {
    setBusy(true); setError('');
    try {
      const file = await onImport();
      if (!file) return;
      const plugin = parsePluginPackage(file.name, file.bytes);
      if (plugins.some(p => p.manifest.id === plugin.manifest.id)) throw new Error('已安装相同 id 的插件。请先移除旧版');
      if (plugins.length >= 24) throw new Error('最多安装 24 个插件');
      await onChange([...plugins, plugin]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="plugin-manager" aria-label="插件管理">
    <div className="plugin-manager-top"><span>{plugins.length ? `${plugins.length} 个插件` : '尚未安装插件'}</span><button type="button" disabled={busy} onClick={install}>导入插件</button></div>
    {error && <p className="plugin-error" role="alert">{error}</p>}
    <div className="plugin-list">{plugins.map(plugin => <article className="plugin-item" key={plugin.manifest.id}>
      <div className="plugin-item-heading"><strong>{plugin.manifest.name}</strong><span>{plugin.manifest.version}</span></div>
      {plugin.manifest.description && <p>{plugin.manifest.description}</p>}
      <div className="plugin-permissions">{plugin.manifest.permissions.length ? plugin.manifest.permissions.map(p => <span key={p}>{PERMISSIONS[p as keyof typeof PERMISSIONS] ?? p}</span>) : <span>无需笔记权限</span>}</div>
      <div className="plugin-item-actions"><span className={plugin.enabled ? 'plugin-enabled' : ''}>{plugin.enabled ? '已启用' : '已停用'}</span>
        <button type="button" disabled={busy} onClick={() => plugin.enabled ? change(plugins.map(p => p === plugin ? { ...p, enabled: false } : p)) : setPending(plugin.manifest.id)}>{plugin.enabled ? '停用' : '启用'}</button>
        <button type="button" disabled={busy} onClick={() => change(plugins.filter(p => p !== plugin))}>移除</button>
      </div>
      {pending === plugin.manifest.id && <div className="plugin-confirm"><p>允许此插件使用上方权限？只启用你信任的插件。</p><button type="button" disabled={busy} onClick={() => change(plugins.map(p => p === plugin ? { ...p, enabled: true } : p))}>允许并启用</button><button type="button" disabled={busy} onClick={() => setPending(null)}>取消</button></div>}
    </article>)}</div>
  </section>;
}

export default PluginManager;
