import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bold, Italic, Strikethrough, Undo2, Redo2, Code2, Table2, Network, List, ListOrdered, SquareCheck, Quote, Link, Image, Minus, Code, Highlighter, Sigma, Subscript, Superscript, RemoveFormatting, Ellipsis, Baseline, X } from 'lucide-react';
import { tableMarkdown } from './formatting';

interface ToolbarProps { onCommand: (id: string) => void; onStyle: (style: string) => void; rememberSelection: () => void }
const moreTools: [string, string, ReactNode][] = [
  ['ordered', '有序列表', <ListOrdered size={16} />], ['image', '图片', <Image size={16} />], ['rule', '分隔线', <Minus size={16} />], ['inlinecode', '行内代码', <Code size={16} />],
  ['mark', '高亮', <Highlighter size={16} />], ['math', '数学公式', <Sigma size={16} />], ['sub', '下标', <Subscript size={16} />], ['sup', '上标', <Superscript size={16} />], ['clear', '清除格式', <RemoveFormatting size={16} />], ['slash', '所有语法', <span>/</span>],
];
const colors = ['#334155', '#5287ad', '#4a927e', '#b48a42', '#a95662', '#8c6eb1'];
export default function EditorToolbar({ onCommand, onStyle, rememberSelection }: ToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<'color' | 'more' | null>(null);
  const [position, setPosition] = useState(12);
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  const [heading, setHeading] = useState('paragraph');
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setPopover(null); };
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null); };
    const selection = () => {
      const selected = window.getSelection()?.anchorNode?.parentElement;
      if (!selected?.closest('.markdown-visual')) return;
      setPressed({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), strike: document.queryCommandState('strikeThrough') });
      setHeading(selected.closest('h1,h2,h3,h4,h5,h6')?.tagName.toLowerCase() || 'paragraph');
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', keys); document.addEventListener('selectionchange', selection);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', keys); document.removeEventListener('selectionchange', selection); };
  }, []);
  function button(id: string, label: string, icon: ReactNode) {
    return <button type="button" title={label} aria-label={label} aria-pressed={id in pressed ? pressed[id] : undefined} onClick={() => { setPopover(null); onCommand(id); }}>{icon}</button>;
  }
  function toggle(kind: 'color' | 'more', target: HTMLButtonElement) {
    const area = root.current!.getBoundingClientRect();
    setPosition(Math.max(8, Math.min(target.getBoundingClientRect().left - area.left, area.width - 278)));
    setPopover(popover === kind ? null : kind);
  }
  return <div ref={root} className="editor-tools" aria-label="正文工具区" onPointerDownCapture={rememberSelection} onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
    <div className="toolbar-strip" role="toolbar" aria-label="Markdown 工具">
      {button('undo', '撤销 · ⌘ Z', <Undo2 size={17} />)}{button('redo', '重做 · ⌘ ⇧ Z', <Redo2 size={17} />)}<span className="tool-separator" />
      <select aria-label="字体" title="字体" defaultValue="" onChange={event => { onStyle(`font-family:${event.target.value || 'inherit'}`); }}>
        <option value="">默认字体</option><option value="PingFang SC">苹方</option><option value="Songti SC">宋体</option><option value="Georgia">Georgia</option><option value="Helvetica Neue">Helvetica</option><option value="SFMono-Regular">等宽字体</option>
      </select>
      <select aria-label="正文或标题" title="正文或标题" value={heading} onChange={event => { setHeading(event.target.value); onCommand(event.target.value); }}><option value="paragraph">正文</option>{[1, 2, 3, 4, 5, 6].map(level => <option value={`h${level}`} key={level}>标题 {level}</option>)}</select>
      <button type="button" aria-label="文字颜色" title="文字颜色" aria-expanded={popover === 'color'} onClick={event => toggle('color', event.currentTarget)}><Baseline size={17} /></button><span className="tool-separator" />
      {button('bold', '加粗 · ⌘ B', <Bold size={17} />)}{button('italic', '斜体 · ⌘ I', <Italic size={17} />)}{button('strike', '删除线', <Strikethrough size={17} />)}<span className="tool-separator" />
      {button('code', '代码块', <Code2 size={17} />)}{button('table', '插入表格', <Table2 size={17} />)}{button('mermaid', '流程图', <Network size={17} />)}<span className="tool-separator" />
      {button('bullet', '无序列表', <List size={17} />)}{button('task', '任务列表', <SquareCheck size={17} />)}{button('quote', '引用', <Quote size={17} />)}{button('link', '链接 · ⌘ K', <Link size={17} />)}
      <button type="button" aria-label="更多工具" title="更多工具" aria-expanded={popover === 'more'} onClick={event => toggle('more', event.currentTarget)}><Ellipsis size={18} /></button>
    </div>
    {popover ? <div className="toolbar-popover" style={{ left: position }} role="group" aria-label={popover === 'color' ? '文字颜色' : '更多工具'}>
      {popover === 'color' ? <><h3>文字颜色</h3><div className="text-colors">{colors.map(color => <button type="button" key={color} aria-label={`文字颜色 ${color}`} style={{ '--text-color': color } as CSSProperties} onClick={() => { onStyle(`color:${color}`); setPopover(null); }} />)}</div><label className="toolbar-custom-color">自定义<input type="color" aria-label="自定义文字颜色" defaultValue="#5287ad" onChange={event => onStyle(`color:${event.target.value}`)} /></label><button type="button" className="plain-tool" onClick={() => { onCommand('clear-color'); setPopover(null); }}>恢复默认颜色</button></> : <div className="more-tools">{moreTools.map(([id, label, icon]) => <button type="button" key={id} onClick={() => { setPopover(null); onCommand(id); }}>{icon}<span>{label}</span></button>)}</div>}
    </div> : null}
  </div>;
}

export function TableDialog({ onInsert, onClose }: { onInsert: (markdown: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState(3), [columns, setColumns] = useState(3), [error, setError] = useState('');
  const gridRows = Math.min(7, Math.max(1, rows || 1)), gridColumns = Math.min(8, Math.max(1, columns || 1));
  return <div className="editor-dialog-backdrop"><form className="editor-link-dialog table-dialog" role="dialog" aria-modal="true" aria-label="插入表格" onSubmit={event => { event.preventDefault(); try { onInsert(tableMarkdown(rows, columns)); } catch (error) { setError(String((error as Error).message)); } }} onKeyDown={event => trapDialogKeys(event, onClose)}>
    <header><h2>插入表格</h2><button type="button" aria-label="关闭表格设置" onClick={onClose}><X size={18} /></button></header>
    <div className="table-size"><label>行<input autoFocus aria-label="表格行数" type="number" min="1" max="100" value={Number.isNaN(rows) ? '' : rows} onChange={event => { setRows(event.target.valueAsNumber); setError(''); }} /></label><span>×</span><label>列<input aria-label="表格列数" type="number" min="1" max="30" value={Number.isNaN(columns) ? '' : columns} onChange={event => { setColumns(event.target.valueAsNumber); setError(''); }} /></label></div>
    <p className="table-header-option">含 1 行表头</p><div className="table-grid" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${gridColumns},1fr)` }}>{Array.from({ length: gridRows * gridColumns }, (_, i) => <i key={i} className={i < gridColumns ? 'th' : ''} />)}</div><p className="table-size-label">{rows || 0} 行 × {columns || 0} 列</p>
    {error ? <p role="alert">{error}</p> : null}<footer><button type="button" onClick={onClose}>取消</button><button type="submit">插入表格</button></footer>
  </form></div>;
}
export function trapDialogKeys(event: React.KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.nativeEvent.isComposing) return;
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  if (event.key === 'Tab') {
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]')].filter(element => !element.hasAttribute('disabled'));
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
