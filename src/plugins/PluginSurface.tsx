import { useEffect, useRef } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, MessageCircle, Puzzle, Sparkles } from 'lucide-react';
import type { PluginHost } from './PluginHost';
import type { PluginCommand, PluginView } from './contracts';
import './surfaces.css';

export function PluginIcon({ name }: { name?: string }) {
  const Icon = name === 'sparkles' ? Sparkles : name === 'calendar' ? CalendarDays : name === 'chart' ? BarChart3 : name === 'message' ? MessageCircle : Puzzle;
  return <Icon size={18}/>;
}
export function PluginActions({ host, commands, location, onError }: { host: PluginHost | null; commands: PluginCommand[]; location: string; onError: (error: unknown) => void }) {
  const items = commands.filter(command => command.locations.includes(location));
  if (!items.length) return null;
  return <div className="plugin-toolbar-actions">{items.map(command => <button type="button" className="icon-button" key={command.id} aria-label={command.label} title={command.label} onClick={() => void host?.runCommand(command.id).catch(onError)}><PluginIcon name={command.icon}/></button>)}</div>;
}
export function PluginSurface({ host, view, page = false, sidebar = false, visible = true, onBack }: { host: PluginHost | null; view: PluginView; page?: boolean; sidebar?: boolean; visible?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && host) return host.mountView(view.id, ref.current); }, [host, view]);
  useEffect(() => { host?.setViewVisibility(view.id, visible); return () => host?.setViewVisibility(view.id, false); }, [host, view, visible]);
  return <section className={page ? 'plugin-page' : sidebar ? 'plugin-sidebar-surface' : 'plugin-widget'} aria-label={view.title}>
    {page && <header className="plugin-page-heading"><button className="icon-button" title="返回笔记" aria-label="返回笔记" onClick={onBack}><ArrowLeft size={18}/></button><h1>{view.title}</h1></header>}
    <div ref={ref} className="plugin-surface" style={page || sidebar ? undefined : { height: view.height }}/>
  </section>;
}
