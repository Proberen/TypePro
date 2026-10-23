import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Code2, CornerDownLeft, FileText, GitFork, Highlighter, Image, Italic, Link, List, ListChecks, ListOrdered, Minus, Pilcrow, Quote, Sigma, Strikethrough, Subscript, Superscript, Table2, X } from 'lucide-react';
import { EDITOR_CATEGORIES, EDITOR_COMMANDS, EDITOR_SHORTCUTS, type EditorCommand } from './commands';

export function CommandIcon({ symbol }: { symbol: string }) {
  const Icon = ({ list: List, ordered: ListOrdered, task: ListChecks, quote: Quote, rule: Minus, code: Code2, table: Table2, link: Link, image: Image, italic: Italic, strike: Strikethrough, mark: Highlighter, sub: Subscript, sup: Superscript, math: Sigma, graph: GitFork, outline: List, file: FileText, paragraph: Pilcrow, break: CornerDownLeft, escape: ArrowDownToLine } as const)[symbol as 'list'];
  return Icon ? <Icon size={16} aria-hidden="true" /> : <span>{symbol}</span>;
}

export default function SlashMenu({ x, y, onCommand, onClose }: { x: number; y: number; onCommand: (command: EditorCommand) => void; onClose: (restore: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const list = EDITOR_COMMANDS.filter(command => (category === '全部' || command.category === category) && `${command.label} ${command.id} ${command.syntax}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = Math.min(index, Math.max(0, list.length - 1));
  useEffect(() => {
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { menu.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return <div ref={menu} className="editor-slash-menu" role="dialog" aria-label="插入语法" style={{ left: x, top: y }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, list.length)) % Math.max(1, list.length)); }
    if (event.key === 'Enter' && list[selected]) { event.preventDefault(); onCommand(list[selected]); }
  }}>
    <div className="editor-slash-search"><b>/</b><input ref={input} role="combobox" aria-expanded="true" aria-controls="editor-slash-results" aria-activedescendant={list[selected] ? `editor-command-${list[selected].id}` : undefined} aria-label="搜索语法" placeholder="搜索语法…" autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} /><button type="button" aria-label="关闭语法菜单" onClick={() => onClose(true)}><X size={16} /></button></div>
    <div className="editor-slash-categories">{EDITOR_CATEGORIES.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => { setCategory(item); setIndex(0); }}>{item}</button>)}</div>
    <div className="editor-slash-results" id="editor-slash-results" role="listbox">{list.length ? list.map((item, i) => <div key={item.id}>{i === 0 || list[i - 1].category !== item.category ? <div className="editor-slash-group">{item.category}</div> : null}<button type="button" id={`editor-command-${item.id}`} className={`editor-slash-item ${selected === i ? 'is-selected' : ''}`} role="option" aria-selected={selected === i} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(i)} onClick={() => onCommand(item)}><span className="editor-slash-symbol"><CommandIcon symbol={item.symbol} /></span><span>{item.label}</span><kbd title={item.syntax}>{EDITOR_SHORTCUTS.find(shortcut => shortcut.id === item.id)?.keys || item.syntax}</kbd></button></div>) : <div className="editor-slash-empty">没有匹配的语法</div>}</div>
    <footer className="editor-slash-footer"><span><kbd>↑↓</kbd>选择</span><span><kbd>↵</kbd>插入</span><span><kbd>Esc</kbd>关闭</span></footer>
  </div>;
}
