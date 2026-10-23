import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PluginHost } from './PluginHost';
import type { PluginView } from './contracts';
import { PluginIcon, PluginSurface } from './PluginSurface';

const STORAGE_KEY = 'typepro.plugin-sidebar.v1';
const MIN_WIDTH = 280, MAX_WIDTH = 640, DEFAULT_WIDTH = 400;
export interface PluginSidebarState { viewId: string | null; open: boolean; width: number }
export function readPluginSidebarState(): PluginSidebarState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (value && typeof value === 'object') return {
      viewId: typeof value.viewId === 'string' ? value.viewId : null,
      open: value.open === true,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value.width)) : DEFAULT_WIDTH,
    };
  } catch { /* Local preferences are optional. */ }
  return { viewId: null, open: false, width: DEFAULT_WIDTH };
}
export function savePluginSidebarState(state: PluginSidebarState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Local preferences are optional. */ }
}

export function PluginSidebarActions({ views, state, onToggle }: { views: PluginView[]; state: PluginSidebarState; onToggle: (view: PluginView) => void }) {
  if (!views.length) return null;
  return <div className="plugin-toolbar-actions">{views.map(view => {
    const open = state.open && state.viewId === view.id;
    return <button type="button" key={view.id} className={`icon-button ${open ? 'active' : ''}`} aria-label={`${open ? '收起' : '展开'}${view.title}`} title={view.title} aria-expanded={open} aria-controls="editor-plugin-sidebar" data-plugin-sidebar-toggle={view.id} onClick={() => onToggle(view)}><PluginIcon name={view.icon}/></button>;
  })}</div>;
}

export default function PluginSidebar({ host, views, state, mobile, onClose, onResize }: {
  host: PluginHost | null; views: PluginView[]; state: PluginSidebarState; mobile: boolean;
  onClose: () => void; onResize: (width: number) => void;
}) {
  const active = state.open ? views.find(view => view.id === state.viewId) : undefined;
  const [visited, setVisited] = useState<string[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    if (active) setVisited(previous => previous.includes(active.id) ? previous : [...previous, active.id]);
  }, [active?.id]);
  useEffect(() => {
    if (!mobile || !active) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected && !previous.closest('[inert]')) previous.focus(); };
  }, [mobile, active?.id]);
  const mounted = views.filter(view => visited.includes(view.id) || view.id === active?.id);
  return <>
    {mobile && active && <button className="plugin-sidebar-scrim" aria-label={`收起${active.title}`} tabIndex={-1} onClick={onClose}/>}
    <aside ref={panelRef} id="editor-plugin-sidebar" className="editor-plugin-sidebar" hidden={!active} role={mobile ? 'dialog' : 'complementary'} aria-modal={mobile && active ? true : undefined} aria-label={active?.title || '插件侧栏'}>
      {mobile && <span className="plugin-sidebar-focus-guard" tabIndex={active ? 0 : -1} onFocus={() => panelRef.current?.querySelector<HTMLIFrameElement>('section:not([hidden]) iframe')?.focus()}/>}
      <div className="plugin-sidebar-resize" role="separator" aria-label="调整插件侧栏宽度" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={state.width} tabIndex={mobile ? -1 : 0}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width: panelRef.current?.getBoundingClientRect().width || state.width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (drag.current) onResize(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.current.width + drag.current.x - event.clientX))); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const width = panelRef.current?.getBoundingClientRect().width || state.width; onResize(event.key === 'Home' ? DEFAULT_WIDTH : event.key === 'End' ? MAX_WIDTH : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width + (event.key === 'ArrowLeft' ? 16 : -16)))); }}/>
      <header className="plugin-sidebar-heading"><PluginIcon name={active?.icon}/><h2>{active?.title}</h2><button ref={closeRef} type="button" className="icon-button" aria-label="收起插件侧栏" title="收起侧栏 · Esc" onClick={onClose}><X size={18}/></button></header>
      <div className="plugin-sidebar-views">{mounted.map(view => <section key={view.id} hidden={view.id !== active?.id} className="plugin-sidebar-view"><PluginSurface host={host} view={view} sidebar visible={view.id === active?.id}/></section>)}</div>
      {mobile && <span className="plugin-sidebar-focus-guard" tabIndex={active ? 0 : -1} onFocus={() => closeRef.current?.focus()}/>}
    </aside>
  </>;
}
