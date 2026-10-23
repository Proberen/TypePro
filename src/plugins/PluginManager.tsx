import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Eye, Pencil, Plus, Puzzle, RefreshCw, Search } from 'lucide-react';
import { command, native, openLink } from '../lib/bridge';
import type { InstalledPlugin } from '../lib/types';
import { addedPermissions, compareVersions, parseMarketCatalog, prepareMarketInstall, type MarketCatalog, type MarketPlugin } from './market';
import { parsePluginPackage, PERMISSIONS } from './packages';
import './plugins.css';

export interface PluginManagerProps {
  plugins: InstalledPlugin[];
  onChange: (plugins: InstalledPlugin[]) => void | Promise<void>;
  onImport: () => Promise<{ name: string; bytes: Uint8Array } | null>;
}
type Tab = 'market' | 'installed';
type Pending = { kind: 'permissions'; id: string; enable: boolean } | { kind: 'market'; entry: MarketPlugin };

function Permissions({ permissions, added = [] }: { permissions: string[]; added?: string[] }) {
  return <div className="plugin-permissions">{permissions.length ? permissions.map(permission => {
    const Icon = permission === 'notes.read' ? Eye : permission === 'notes.write' || permission === 'editor.insert' ? Pencil : Puzzle;
    return <div className="plugin-permission" key={permission}><Icon aria-hidden="true" /><span>{PERMISSIONS[permission as keyof typeof PERMISSIONS] ?? permission}</span>{added.includes(permission) && <small>新增</small>}</div>;
  }) : <p className="plugin-empty">无需笔记权限</p>}</div>;
}

export function PluginManager({ plugins, onChange, onImport }: PluginManagerProps) {
  const [tab, setTab] = useState<Tab>('market');
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<MarketCatalog | null>(null);
  const [loading, setLoading] = useState(native);
  const [marketError, setMarketError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef({ plugins, onChange });
  current.current = { plugins, onChange };
  const mounted = useRef(true), operating = useRef(false);
  const catalogRequest = useRef<Promise<MarketCatalog> | null>(null);
  const id = useId();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!native || tab !== 'market' || pending) return;
    let active = true, waiting = false;
    let interval: number | undefined;
    async function refresh() {
      if (waiting || document.hidden) return;
      waiting = true; setLoading(true); setMarketError('');
      const request = catalogRequest.current ?? command<unknown>('plugin_market_catalog').then(parseMarketCatalog);
      catalogRequest.current = request;
      try {
        const next = await request;
        if (active) setCatalog(next);
      } catch (cause) {
        if (active) setMarketError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (catalogRequest.current === request) catalogRequest.current = null;
        waiting = false;
        if (active) setLoading(false);
      }
    }
    function visible() {
      window.clearInterval(interval);
      if (document.hidden) return;
      void refresh();
      interval = window.setInterval(() => void refresh(), 60_000);
    }
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [tab, pending, refreshToken]);

  async function run(operation: () => Promise<void>) {
    if (operating.current || !mounted.current) return;
    operating.current = true; setBusy(true); setError(''); setStatus('');
    try { await operation(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { operating.current = false; if (mounted.current) setBusy(false); }
  }
  async function change(transform: (previous: InstalledPlugin[]) => InstalledPlugin[]) {
    await run(async () => {
      await current.current.onChange(transform(current.current.plugins));
      if (mounted.current) setPending(null);
    });
  }
  async function importLocal() {
    await run(async () => {
      const file = await onImport();
      if (!file || !mounted.current) return;
      const plugin = parsePluginPackage(file.name, file.bytes);
      const previous = current.current.plugins;
      if (previous.some(value => value.manifest.id === plugin.manifest.id)) throw new Error('已安装相同 id 的插件。请先移除旧版');
      if (previous.length >= 24) throw new Error('最多安装 24 个插件');
      await current.current.onChange([...previous, plugin]);
      if (mounted.current) { setTab('installed'); setStatus('已导入'); }
    });
  }
  async function installMarket(entry: MarketPlugin) {
    await run(async () => {
      const bytes = await command<number[]>('plugin_market_download', { id: entry.id, version: entry.version, sha256: entry.sha256 });
      if (!mounted.current) return;
      const previous = current.current.plugins;
      const installed = previous.find(plugin => plugin.manifest.id === entry.id);
      if (!installed && previous.length >= 24) throw new Error('最多安装 24 个插件');
      const plugin = prepareMarketInstall(entry, new Uint8Array(bytes), installed);
      const next = installed ? previous.map(value => value.manifest.id === entry.id ? plugin : value) : [...previous, plugin];
      await current.current.onChange(next);
      if (mounted.current) {
        setPending(null); setTab('installed');
        setStatus(plugin.enabled ? '已更新' : installed ? '已更新，启用后可使用' : '已安装，启用后可使用');
      }
    });
  }
  function review(next: Pending) { setError(''); setStatus(''); setPending(next); }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'market' : event.key === 'End' ? 'installed' : tab === 'market' ? 'installed' : 'market';
    setTab(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-plugin-tab="${next}"]`)?.focus();
  }
  const selected = pending?.kind === 'permissions' ? plugins.find(plugin => plugin.manifest.id === pending.id) : undefined;
  const entry = pending?.kind === 'market' ? pending.entry : undefined;
  const installed = entry ? plugins.find(plugin => plugin.manifest.id === entry.id) : undefined;
  const canInstall = !!entry && (installed ? compareVersions(entry.version, installed.manifest.version) === 1 : plugins.length < 24);
  const permissionChanges = entry && installed ? addedPermissions(installed, entry) : [];
  const search = query.trim().toLocaleLowerCase();
  const matches = catalog?.plugins.filter(plugin => `${plugin.name}\n${plugin.description || ''}\n${plugin.id}`.toLocaleLowerCase().includes(search)) || [];
  const manifest = entry || selected?.manifest;

  return <section className="plugin-manager" aria-label="插件管理" aria-busy={busy}>
    {manifest ? <>
      <button className="plugin-back" type="button" disabled={busy} onClick={() => { setPending(null); setError(''); }}><ArrowLeft aria-hidden="true" />{tab === 'market' ? '插件市场' : '已安装的插件'}</button>
      <div className="plugin-item plugin-permission-heading"><span className="plugin-mark"><Puzzle aria-hidden="true" /></span><div className="plugin-info"><h3>{manifest.name}<small>{installed && installed.manifest.version !== manifest.version ? `${installed.manifest.version} → ` : ''}{manifest.version}</small></h3>{manifest.description && <p>{manifest.description}</p>}</div></div>
      <h3 className="plugin-permission-label">{pending?.kind === 'permissions' && pending.enable ? '允许以下操作' : '声明的权限'}</h3>
      <Permissions permissions={manifest.permissions} added={permissionChanges} />
      {permissionChanges.length > 0 && <p className="plugin-update-note">新增权限，更新后需重新启用</p>}
      <div className="plugin-permission-actions"><button className="plugin-outline" type="button" disabled={busy} onClick={() => { setPending(null); setError(''); }}>取消</button>
        {entry ? <button className="plugin-primary" type="button" disabled={busy || !native || !canInstall} onClick={() => void installMarket(entry)}>{busy ? '正在安装…' : installed ? canInstall ? '更新' : '已安装' : '安装'}</button>
          : pending?.kind === 'permissions' && pending.enable && selected && <button className="plugin-primary" type="button" disabled={busy} onClick={() => void change(previous => previous.map(plugin => plugin.manifest.id === selected.manifest.id ? { ...plugin, enabled: true } : plugin))}>允许并启用</button>}
      </div>
    </> : <>
      <div className="plugin-tabs" role="tablist" aria-label="插件分类">
        {(['market', 'installed'] as const).map(value => <button key={value} id={`${id}-${value}-tab`} data-plugin-tab={value} role="tab" aria-selected={tab === value} aria-controls={`${id}-${value}-panel`} tabIndex={tab === value ? 0 : -1} className={tab === value ? 'active' : ''} type="button" disabled={busy} onKeyDown={tabKey} onClick={() => { setTab(value); setError(''); }}>{value === 'market' ? '插件市场' : '已安装'}{value === 'installed' && <small>{plugins.length}</small>}</button>)}
      </div>
      {tab === 'market' ? <div id={`${id}-market-panel`} role="tabpanel" aria-labelledby={`${id}-market-tab`}>
        <div className="plugin-market-tools"><label className="plugin-search"><Search aria-hidden="true" /><input type="search" aria-label="搜索插件" placeholder="搜索插件" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" className="plugin-outline" disabled={loading || busy || !native} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw aria-hidden="true" />刷新</button></div>
        {!native ? <p className="plugin-empty">请在 Mac 或 Android 应用中浏览和安装插件。</p> : <>
          {marketError && <p className="plugin-error" role="alert">{marketError}</p>}
          {loading && !catalog && <p className="plugin-empty" role="status">正在获取插件…</p>}
          <div className="plugin-list">{matches.map(plugin => {
            const local = plugins.find(value => value.manifest.id === plugin.id);
            const update = local && compareVersions(plugin.version, local.manifest.version) === 1;
            return <article className="plugin-item" key={plugin.id}><span className="plugin-mark"><Puzzle aria-hidden="true" /></span><div className="plugin-info"><h3>{plugin.name}<small>{plugin.version}</small></h3>{plugin.description && <p>{plugin.description}</p>}<div className="plugin-item-actions"><button type="button" disabled={busy} onClick={() => review({ kind: 'market', entry: plugin })}>{plugin.permissions.length ? `${plugin.permissions.length} 项权限` : '无需笔记权限'}</button>{local && <span className="plugin-installed-version">已安装 {local.manifest.version}</span>}</div></div>
              {!local || update ? <button type="button" className="plugin-outline plugin-market-action" disabled={busy || (!local && plugins.length >= 24)} onClick={() => review({ kind: 'market', entry: plugin })}><Download aria-hidden="true" />{update ? '更新' : '安装'}</button> : <span className="plugin-installed-mark"><Check aria-hidden="true" />已安装</span>}
            </article>;
          })}</div>
          {catalog && !matches.length && <p className="plugin-empty">{search ? '未找到插件' : '暂无插件'}</p>}
        </>}
        <div className="plugin-market-footer"><span>{loading && catalog ? '正在刷新…' : 'TypePro 插件'}</span><button type="button" onClick={() => void openLink('https://github.com/Proberen/typepro-plugins').catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); })}>GitHub<ExternalLink aria-hidden="true" /></button></div>
      </div> : <div id={`${id}-installed-panel`} role="tabpanel" aria-labelledby={`${id}-installed-tab`}>
        <div className="plugin-manager-top"><span>已安装 · {plugins.length}</span><button className="plugin-outline" type="button" disabled={busy} onClick={() => void importLocal()}><Plus aria-hidden="true" />导入插件</button></div>
        <div className="plugin-list">{plugins.map(plugin => {
          const update = catalog?.plugins.find(value => value.id === plugin.manifest.id && compareVersions(value.version, plugin.manifest.version) === 1);
          return <article className="plugin-item" key={plugin.manifest.id}><span className="plugin-mark"><Puzzle aria-hidden="true" /></span><div className="plugin-info"><h3>{plugin.manifest.name}<small>{plugin.manifest.version}</small></h3>{plugin.manifest.description && <p>{plugin.manifest.description}</p>}<div className="plugin-item-actions"><button type="button" disabled={busy} onClick={() => review({ kind: 'permissions', id: plugin.manifest.id, enable: false })}>权限</button>{update && <button className="plugin-update-action" type="button" disabled={busy} onClick={() => review({ kind: 'market', entry: update })}>更新至 {update.version}</button>}<button type="button" disabled={busy} onClick={() => void change(previous => previous.filter(value => value.manifest.id !== plugin.manifest.id))}>移除</button></div></div>
            <button className={`plugin-toggle ${plugin.enabled ? 'plugin-on' : ''}`} type="button" role="switch" aria-checked={plugin.enabled} aria-label={`${plugin.enabled ? '停用' : '启用'} ${plugin.manifest.name}`} disabled={busy} onClick={() => plugin.enabled ? void change(previous => previous.map(value => value.manifest.id === plugin.manifest.id ? { ...value, enabled: false } : value)) : review({ kind: 'permissions', id: plugin.manifest.id, enable: true })} />
          </article>;
        })}</div>
        {!plugins.length && <p className="plugin-empty">暂无插件</p>}
      </div>}
    </>}
    {error && <p className="plugin-error" role="alert">{error}</p>}
    {status && <p className="plugin-status" role="status">{status}</p>}
  </section>;
}

export default PluginManager;
