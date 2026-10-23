import { useState } from 'react';
import { ArrowLeft, Eye, Pencil, Plus, Puzzle } from 'lucide-react';
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
  const [pending, setPending] = useState<{ id: string; enable: boolean } | null>(null);
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
  const selected = plugins.find(plugin => plugin.manifest.id === pending?.id);
  return <section className="plugin-manager" aria-label="插件管理">
    {selected ? <>
      <button className="plugin-back" type="button" disabled={busy} onClick={() => setPending(null)}><ArrowLeft aria-hidden="true" />已安装的插件</button>
      <div className="plugin-item plugin-permission-heading"><span className="plugin-mark"><Puzzle aria-hidden="true" /></span><div className="plugin-info"><h3>{selected.manifest.name}<small>{selected.manifest.version}</small></h3>{selected.manifest.description && <p>{selected.manifest.description}</p>}</div></div>
      <h3 className="plugin-permission-label">{pending?.enable ? '允许以下操作' : '声明的权限'}</h3>
      <div className="plugin-permissions">{selected.manifest.permissions.length ? selected.manifest.permissions.map(permission => {
        const Icon = permission === 'notes.read' ? Eye : permission === 'notes.write' || permission === 'editor.insert' ? Pencil : Puzzle;
        return <div className="plugin-permission" key={permission}><Icon aria-hidden="true" /><span>{PERMISSIONS[permission as keyof typeof PERMISSIONS] ?? permission}</span></div>;
      }) : <p className="plugin-empty">无需笔记权限</p>}</div>
      <div className="plugin-permission-actions"><button className="plugin-outline" type="button" disabled={busy} onClick={() => setPending(null)}>{pending?.enable ? '取消' : '返回'}</button>{pending?.enable && <button className="plugin-primary" type="button" disabled={busy} onClick={() => change(plugins.map(plugin => plugin === selected ? { ...plugin, enabled: true } : plugin))}>允许并启用</button>}</div>
    </> : <>
      <div className="plugin-manager-top"><span>已安装 · {plugins.length}</span><button className="plugin-outline" type="button" disabled={busy} onClick={install}><Plus aria-hidden="true" />导入插件</button></div>
      <div className="plugin-list">{plugins.map(plugin => <article className="plugin-item" key={plugin.manifest.id}>
        <span className="plugin-mark"><Puzzle aria-hidden="true" /></span>
        <div className="plugin-info"><h3>{plugin.manifest.name}<small>{plugin.manifest.version}</small></h3>
          {plugin.manifest.description && <p>{plugin.manifest.description}</p>}
          <div className="plugin-item-actions"><button type="button" disabled={busy} onClick={() => setPending({ id: plugin.manifest.id, enable: false })}>权限</button><button type="button" disabled={busy} onClick={() => change(plugins.filter(p => p !== plugin))}>移除</button></div>
        </div>
        <button className={`plugin-toggle ${plugin.enabled ? 'plugin-on' : ''}`} type="button" role="switch" aria-checked={plugin.enabled} aria-label={`${plugin.enabled ? '停用' : '启用'} ${plugin.manifest.name}`} disabled={busy} onClick={() => plugin.enabled ? change(plugins.map(p => p === plugin ? { ...p, enabled: false } : p)) : setPending({ id: plugin.manifest.id, enable: true })} />
      </article>)}</div>
      {!plugins.length && <p className="plugin-empty">暂无插件</p>}
    </>}
    {error && <p className="plugin-error" role="alert">{error}</p>}
  </section>;
}

export default PluginManager;
