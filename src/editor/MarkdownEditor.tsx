import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Italic, Link, ListChecks, Plus, Quote, X } from 'lucide-react';
import Vditor from 'vditor';
import type { EditorMode } from '../lib/types';
import { SourceBuffer } from './SourceBuffer';
import { createAssetRenderer, EDITOR_ASSETS, enhanceEditor, MARKDOWN_OPTIONS, renderReading, snapshotMarkdown } from './rendering';
import { changeSourceFormat, headingSourceOffsets, EDITOR_COMMANDS, EDITOR_SHORTCUTS, INLINE_MARKERS, isSourceCode, matchesEditorShortcut, type EditorCommand } from './commands';
import { captureRichSelection, restoreRichSelection, sourceOffset, textareaOffset, type RichSelection } from './selection';
import SlashMenu from './SlashMenu';
import 'vditor/dist/index.css';
import './editor.css';

export interface EditorHeading { id: string; text: string; level: number }
export interface EditorHandle {
  insertText(text: string): void;
  focus(): void;
  getValue(): string;
  executeCommand(id: string): void;
  getHeadings(): EditorHeading[];
  scrollToHeading(id: string): void;
}
export interface MarkdownEditorProps {
  documentId: string;
  markdown: string;
  mode: EditorMode;
  theme?: 'light' | 'dark';
  onChange: (markdown: string) => void;
  onReady?: (api: EditorHandle) => void;
  onHeadingsChange?: (headings: EditorHeading[]) => void;
  onError?: (error: string) => void;
  saveAsset: (file: File) => Promise<{ path: string; url: string }>;
  resolveAsset: (path: string) => Promise<string>;
}

const TOOLBAR_COMMANDS: Record<string, string> = { bold: 'bold', italic: 'italic', strike: 'strike', inlinecode: 'inline-code', bullet: 'list', ordered: 'ordered-list', task: 'check', quote: 'quote' };
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';

export default function MarkdownEditor(props: MarkdownEditorProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Vditor | null>(null);
  const buffer = useRef(new SourceBuffer(props.markdown));
  const alive = useRef(true);
  const composing = useRef(false);
  const savedSelection = useRef<RichSelection | null>(null);
  const sourceSelection = useRef({ start: 0, end: 0 });
  const pendingSourceSelection = useRef(false);
  const headingsRef = useRef<EditorHeading[]>([]);
  const [value, setValue] = useState(props.markdown);
  const [ready, setReady] = useState(false);
  const [slash, setSlash] = useState<{ x: number; y: number } | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ kind: 'link' | 'image'; label: string; url: string; error: string } | null>(null);
  const [floating, setFloating] = useState<{ x: number; y: number } | null>(null);

  function getHeadings() {
    const field = editorRef.current?.vditor.ir?.element;
    if (!field) return headingsRef.current;
    const headings = [...field.querySelectorAll<HTMLElement>(HEADING_SELECTOR)].filter(node => !node.closest('[data-render]')).map((node, index) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.vditor-ir__marker').forEach(marker => marker.remove());
      return { id: `heading-${index}`, text: (clone.textContent || '').replace(/\u200b/g, '').trim(), level: Number(node.tagName[1]) };
    });
    if (JSON.stringify(headings) !== JSON.stringify(headingsRef.current)) {
      headingsRef.current = headings;
      propsRef.current.onHeadingsChange?.(headings);
    }
    return headingsRef.current;
  }
  function publish() {
    setValue(buffer.current.value);
    propsRef.current.onChange(buffer.current.value);
    getHeadings();
  }
  function collect() {
    const editor = editorRef.current;
    if (!composing.current && editor && buffer.current.accept(snapshotMarkdown(editor))) publish();
    return buffer.current.value;
  }
  function replaceSource(next: string) {
    buffer.current.replace(next);
    const editor = editorRef.current;
    if (editor) {
      editor.setValue(next);
      buffer.current.baseline(snapshotMarkdown(editor));
    }
    publish();
  }
  function rememberSelection() {
    const source = sourceRef.current;
    if (propsRef.current.mode === 'source' && source && document.activeElement === source) {
      if (pendingSourceSelection.current) return;
      sourceSelection.current = { start: sourceOffset(buffer.current.value, source.selectionStart), end: sourceOffset(buffer.current.value, source.selectionEnd) };
      return;
    }
    const field = editorRef.current?.vditor.ir?.element;
    if (field) savedSelection.current = captureRichSelection(field) || savedSelection.current;
  }
  function restoreSelection() {
    if (propsRef.current.mode === 'source') {
      sourceRef.current?.focus({ preventScroll: true });
      sourceRef.current?.setSelectionRange(textareaOffset(buffer.current.value, sourceSelection.current.start), textareaOffset(buffer.current.value, sourceSelection.current.end));
      return;
    }
    const field = editorRef.current?.vditor.ir?.element;
    if (field) restoreRichSelection(field, savedSelection.current);
  }
  function updateSource(text: string, start: number, end = start) {
    sourceSelection.current = { start, end };
    pendingSourceSelection.current = true;
    replaceSource(text);
  }
  function insertText(text: string) {
    rememberSelection();
    if (propsRef.current.mode === 'source') {
      const { start, end } = sourceSelection.current;
      const source = buffer.current.value;
      updateSource(source.slice(0, start) + text + source.slice(end), start + text.length);
    } else if (editorRef.current && propsRef.current.mode === 'edit') {
      restoreSelection();
      const field = editorRef.current.vditor.ir!.element;
      const fragment = document.createElement('div');
      fragment.innerHTML = editorRef.current.vditor.lute.Md2VditorIRDOM(text);
      const inline = fragment.childNodes.length === 1 && fragment.firstElementChild?.tagName === 'P';
      if (!inline && fragment.firstElementChild?.getAttribute('data-block') === '0') {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
          range.deleteContents();
          const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
          const block = parent?.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6');
          if (block && field.contains(block)) {
            const tail = range.cloneRange();
            tail.setEnd(block, block.childNodes.length);
            const right = document.createElement('p');
            right.dataset.block = '0';
            right.append(tail.extractContents());
            if (right.textContent || right.querySelector('img')) block.after(right);
            range.selectNodeContents(block); range.collapse(false);
          } else if (range.startContainer === field) {
            const anchor = document.createElement('p'); anchor.dataset.block = '0';
            range.insertNode(anchor); range.selectNodeContents(anchor); range.collapse(false);
          }
          selection?.removeAllRanges(); selection?.addRange(range);
        }
      }
      editorRef.current.insertMD(text);
      collect();
      rememberSelection();
    } else {
      replaceSource(buffer.current.value + text);
    }
  }
  function scrollToHeading(id: string) {
    const index = Number(id.replace('heading-', ''));
    if (!Number.isInteger(index) || index < 0) return;
    if (propsRef.current.mode === 'source') {
      const source = sourceRef.current;
      const position = headingSourceOffsets(buffer.current.value)[index];
      if (!source || position === undefined) return;
      sourceSelection.current = { start: position, end: position };
      source.focus(); source.setSelectionRange(textareaOffset(buffer.current.value, position), textareaOffset(buffer.current.value, position));
      const lineHeight = parseFloat(getComputedStyle(source).lineHeight);
      source.scrollTop = Math.max(0, (buffer.current.value.slice(0, position).match(/\n/g)?.length || 0) * lineHeight - 30);
      return;
    }
    const root = propsRef.current.mode === 'read' ? readingRef.current : editorRef.current?.vditor.ir?.element;
    const headings = [...root?.querySelectorAll<HTMLElement>(HEADING_SELECTOR) || []].filter(node => !node.closest('[data-render]'));
    headings[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openSlash() {
    if (propsRef.current.mode === 'read' || composing.current) return;
    rememberSelection();
    const area = rootRef.current?.getBoundingClientRect();
    if (!area) return;
    const caret = savedSelection.current?.range.getBoundingClientRect();
    const source = sourceRef.current;
    const sourceY = source ? 34 + (buffer.current.value.slice(0, sourceSelection.current.start).match(/\n/g)?.length || 0) * parseFloat(getComputedStyle(source).lineHeight) - source.scrollTop : 60;
    const x = propsRef.current.mode === 'source' ? 40 : (caret?.left || area.left + 40) - area.left;
    const y = propsRef.current.mode === 'source' ? sourceY : (caret?.bottom || area.top + 60) - area.top + 10;
    setFloating(null);
    setSlash({ x: Math.max(10, Math.min(x, area.width - 354)), y: Math.max(8, Math.min(y, area.height - 450)) });
  }
  function closeSlash(restore: boolean) { setSlash(null); if (restore) restoreSelection(); }
  function selectedText() {
    return propsRef.current.mode === 'source' ? buffer.current.value.slice(sourceSelection.current.start, sourceSelection.current.end) : savedSelection.current?.range.toString() || '';
  }
  function openLink(kind: 'link' | 'image') {
    rememberSelection();
    setLinkDialog({ kind, label: selectedText() || (kind === 'image' ? '图片' : '链接文字'), url: '', error: '' });
  }
  function insertCommand(command: EditorCommand) {
    setSlash(null);
    if (command.id === 'link' || command.id === 'image') { openLink(command.id); return; }
    if (command.id === 'break' && propsRef.current.mode === 'edit') {
      restoreSelection(); document.execCommand('insertLineBreak'); collect(); rememberSelection(); return;
    }
    let snippet = command.snippet;
    if (!command.inline && propsRef.current.mode === 'source') {
      const { start, end } = sourceSelection.current;
      const before = buffer.current.value.slice(0, start);
      const after = buffer.current.value.slice(end);
      snippet = (before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '') + snippet + (after && !after.startsWith('\n') ? '\n' : '');
    }
    insertText(snippet);
  }
  function executeCommand(id: string) {
    if (id === 'slash') { openSlash(); return; }
    if (propsRef.current.mode === 'read' || composing.current) return;
    const command = EDITOR_COMMANDS.find(item => item.id === id);
    if (!command) return;
    rememberSelection();
    setSlash(null);
    if (id === 'link' || id === 'image') { openLink(id); return; }
    const selected = selectedText();
    const insertion = selected && (id === 'code' || id === 'math') ? { ...command, snippet: id === 'code' ? `\`\`\`\n${selected}\n\`\`\`\n` : `$$\n${selected}\n$$\n` } : command;
    if (propsRef.current.mode === 'source') {
      const { start, end } = sourceSelection.current;
      const changed = changeSourceFormat(buffer.current.value, start, end, id);
      if (changed) updateSource(changed.text, changed.start, changed.end);
      else insertCommand(insertion);
      return;
    }
    restoreSelection();
    const controls = editorRef.current?.vditor.toolbar?.elements;
    let button: HTMLButtonElement | null | undefined;
    if (/^h[1-6]$/.test(id)) button = controls?.headings?.querySelector<HTMLButtonElement>(`[data-tag="${id}"]`);
    else if (id === 'paragraph') {
      const marker = window.getSelection()?.anchorNode?.parentElement?.closest('h1,h2,h3,h4,h5,h6')?.querySelector('.vditor-ir__marker--heading');
      if (marker) { marker.textContent = ''; editorRef.current?.vditor.ir?.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatBlock' })); }
      collect(); rememberSelection(); return;
    } else if (TOOLBAR_COMMANDS[id]) button = controls?.[TOOLBAR_COMMANDS[id]]?.querySelector<HTMLButtonElement>('button');
    if (button) { button.click(); collect(); rememberSelection(); }
    else if (INLINE_MARKERS[id] && selectedText()) insertText(INLINE_MARKERS[id] + selectedText() + INLINE_MARKERS[id]);
    else insertCommand(insertion);
  }
  const apiRef = useRef<EditorHandle>({ insertText, focus: restoreSelection, getValue: () => propsRef.current.mode === 'edit' ? collect() : buffer.current.value, executeCommand, getHeadings, scrollToHeading });

  async function addImages(files: File[]) {
    setLinkDialog(null);
    for (const file of files.filter(file => file.type.startsWith('image/'))) {
      try {
        const asset = await propsRef.current.saveAsset(file);
        if (!alive.current) return;
        const alt = file.name.replace(/[\[\]\\\r\n]/g, ' ').replace(/\.[^.]+$/, '');
        insertText(`![${alt}](${asset.path})`);
      } catch (error) { if (alive.current) propsRef.current.onError?.(`图片保存失败：${String(error)}`); }
    }
  }
  function canOpenSlash() {
    if (propsRef.current.mode === 'read' || composing.current) return false;
    if (document.activeElement === sourceRef.current) {
      const position = sourceOffset(buffer.current.value, sourceRef.current!.selectionStart);
      return !isSourceCode(buffer.current.value, position) && (position === 0 || /\s/.test(buffer.current.value[position - 1]));
    }
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const field = editorRef.current?.vditor.ir?.element;
    if (!node || !field?.contains(node) || !field.contains(document.activeElement)) return false;
    const parent = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    if (parent?.closest('[data-type="code-block"],pre:not(.vditor-reset),code,[data-type="code"]')) return false;
    const prefix = node.textContent?.slice(0, selection?.anchorOffset || 0) || '';
    return !prefix || /\s$/.test(prefix);
  }

  useEffect(() => {
    alive.current = true;
    propsRef.current.onReady?.(apiRef.current);
    const root = rootRef.current!;
    const mount = mountRef.current!;
    if (!document.getElementById('note-editor-icons')) {
      const icons = document.createElement('script'); icons.id = 'note-editor-icons'; icons.src = `${EDITOR_ASSETS}/dist/js/icons/ant.js`; document.head.appendChild(icons);
    }
    let disposed = false;
    let frame = 0;
    const assets = createAssetRenderer(path => propsRef.current.resolveAsset(path));
    const enhance = () => { if (!disposed && !composing.current) { assets(root); enhanceEditor(mount); } };
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(enhance); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    const timeout = window.setTimeout(() => { if (!editorRef.current && !disposed) propsRef.current.onError?.('编辑组件加载失败，可切换到源码继续编辑'); }, 15_000);
    const instance = new Vditor(mount, {
      cdn: EDITOR_ASSETS, lang: 'zh_CN', mode: 'ir', icon: undefined, value: buffer.current.value,
      height: '100%', minHeight: 240, placeholder: '输入 / 插入内容', cache: { enable: false }, undoDelay: 150,
      toolbar: ['bold', 'headings', 'check', 'link', 'italic', 'strike', 'inline-code', 'list', 'ordered-list', 'quote', 'code', 'table', 'undo', 'redo'],
      toolbarConfig: { hide: true }, resize: { enable: false }, counter: { enable: false }, outline: { enable: false, position: 'right' },
      hint: { emoji: {}, emojiPath: `${EDITOR_ASSETS}/dist/images/emoji` }, link: { isOpen: false }, image: { isPreview: false },
      preview: { delay: 150, maxWidth: 720, markdown: MARKDOWN_OPTIONS, math: { engine: 'KaTeX', inlineDigit: true }, hljs: { enable: true, style: 'github' }, theme: { current: 'light', path: `${EDITOR_ASSETS}/dist/css/content-theme` }, render: { media: { enable: false } }, actions: [] },
      input: () => { if (!disposed && !composing.current) collect(); },
      blur: () => { if (!disposed) collect(); },
      after: () => {
        clearTimeout(timeout);
        if (disposed) { instance.destroy(); return; }
        editorRef.current = instance; instance.setValue(buffer.current.value); buffer.current.baseline(snapshotMarkdown(instance));
        const field = instance.vditor.ir!.element;
        field.setAttribute('role', 'textbox'); field.setAttribute('aria-label', 'Markdown 正文'); field.setAttribute('aria-multiline', 'true'); field.setAttribute('spellcheck', 'false');
        setReady(true); getHeadings(); enhance();
      },
    });
    const selectionChange = () => {
      rememberSelection();
      const selection = window.getSelection();
      if (propsRef.current.mode !== 'edit' || !selection?.rangeCount || !mount.contains(selection.anchorNode) || selection.isCollapsed) { setFloating(null); return; }
      const selected = selection.getRangeAt(0).getBoundingClientRect();
      const area = root.getBoundingClientRect();
      setFloating({ x: Math.max(90, Math.min(area.width - 90, selected.left - area.left + selected.width / 2)), y: Math.max(4, selected.top - area.top - 46) });
    };
    const beforeInput = (event: InputEvent) => {
      if (event.data === '/' && !event.isComposing && event.inputType === 'insertText' && canOpenSlash()) { event.preventDefault(); event.stopPropagation(); openSlash(); }
    };
    const languageChange = (event: Event) => { if (event.target instanceof HTMLSelectElement && event.target.matches('[data-code-language]')) { event.stopPropagation(); changeCodeLanguage(event.target); } };
    const codeControlInput = (event: Event) => { if (event.target instanceof HTMLSelectElement && event.target.matches('[data-code-language]')) event.stopPropagation(); };
    root.addEventListener('input', codeControlInput, true);
    root.addEventListener('change', languageChange, true);
    root.addEventListener('beforeinput', beforeInput);
    document.addEventListener('selectionchange', selectionChange);
    return () => {
      disposed = true; alive.current = false; clearTimeout(timeout); cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('selectionchange', selectionChange); root.removeEventListener('beforeinput', beforeInput); root.removeEventListener('change', languageChange, true); root.removeEventListener('input', codeControlInput, true);
      if (editorRef.current === instance) { clearTimeout(instance.vditor.ir?.processTimeoutId); clearTimeout(instance.vditor.ir?.hlToolbarTimeoutId); instance.destroy(); editorRef.current = null; }
    };
  }, []);

  useLayoutEffect(() => {
    if (!pendingSourceSelection.current || props.mode !== 'source') return;
    sourceRef.current?.focus({ preventScroll: true });
    sourceRef.current?.setSelectionRange(textareaOffset(value, sourceSelection.current.start), textareaOffset(value, sourceSelection.current.end));
    pendingSourceSelection.current = false;
  }, [value, props.mode]);

  useLayoutEffect(() => {
    if (props.markdown === buffer.current.value) return;
    buffer.current.replace(props.markdown); setValue(props.markdown);
    if (editorRef.current) { editorRef.current.setValue(props.markdown); buffer.current.baseline(snapshotMarkdown(editorRef.current)); getHeadings(); }
  }, [props.markdown]);
  useEffect(() => {
    setSlash(null); setLinkDialog(null); setFloating(null);
    if (props.mode !== 'read' || !readingRef.current) return;
    const page = document.createElement('div'); page.className = 'vditor-reset note-reading-content'; readingRef.current.replaceChildren(page);
    void renderReading(page, value).catch(error => { if (page.isConnected) propsRef.current.onError?.(`预览失败：${String(error)}`); });
  }, [props.mode, value, ready]);
  function toolbarButton(id: string, label: ReactNode) {
    const command = EDITOR_COMMANDS.find(item => item.id === id)!;
    return <button type="button" title={command.label} aria-label={command.label} onClick={() => executeCommand(id)}>{label}</button>;
  }
  function changeCodeLanguage(select: HTMLSelectElement) {
    const block = select.closest('[data-type="code-block"]');
    const code = block?.querySelector(':scope > pre > code');
    const info = block?.querySelector('[data-type="code-block-info"]');
    if (!code || !info) return;
    code.className = select.value === 'plaintext' ? '' : `language-${select.value}`;
    info.textContent = '\u200b' + (select.value === 'plaintext' ? '' : select.value);
    const editor = editorRef.current;
    if (editor) editor.setValue(snapshotMarkdown(editor));
    enhanceEditor(mountRef.current!); collect();
  }

  return <div ref={rootRef} className={`markdown-editor mode-${props.mode}`} data-theme={props.theme || 'light'} data-document-id={props.documentId}
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; requestAnimationFrame(() => { if (alive.current && propsRef.current.mode === 'edit') collect(); }); }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || composing.current || (event.target as HTMLElement).closest('.editor-slash-menu,.editor-link-dialog')) return;
      const isEditor = event.target === sourceRef.current || mountRef.current?.contains(event.target as Node);
      if (!isEditor || propsRef.current.mode === 'read') return;
      const shortcut = EDITOR_SHORTCUTS.find(item => matchesEditorShortcut(event.nativeEvent, item.binding));
      if (shortcut) { event.preventDefault(); event.stopPropagation(); executeCommand(shortcut.id); }
      else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && canOpenSlash()) { event.preventDefault(); event.stopPropagation(); openSlash(); }
      else if (event.key === 'Tab' && event.target === sourceRef.current) { event.preventDefault(); insertText('  '); }
    }}
    onClickCapture={event => {
      const target = event.target as HTMLElement;
      const copy = target.closest<HTMLButtonElement>('[data-copy-code]');
      if (copy) {
        event.preventDefault(); event.stopPropagation();
        const text = copy.closest('.note-codebox')?.querySelector('code')?.textContent || '';
        void navigator.clipboard.writeText(text).then(() => { if (copy.isConnected) { copy.dataset.copied = 'true'; copy.title = '已复制'; window.setTimeout(() => { if (copy.isConnected) { delete copy.dataset.copied; copy.title = '复制代码'; } }, 1400); } }).catch(() => propsRef.current.onError?.('复制失败'));
      } else if (target.closest('[data-code-language]')) event.stopPropagation();
    }}
    onPasteCapture={event => {
      const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
      if (props.mode !== 'read' && files.length) { event.preventDefault(); event.stopPropagation(); rememberSelection(); void addImages(files); }
    }}
    onDragOver={event => { if (props.mode !== 'read' && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDropCapture={event => {
      if (props.mode === 'read') return;
      const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); event.stopPropagation(); rememberSelection(); void addImages(files); }
    }}>
    <div ref={mountRef} className="markdown-visual" hidden={props.mode !== 'edit'} aria-busy={!ready} />
    <div className="markdown-source-wrap" hidden={props.mode !== 'source'}><div className="editor-source-label"><span>Markdown</span><span>UTF-8</span></div>
    <textarea ref={sourceRef} className="markdown-source" aria-label="Markdown 源码" spellCheck={false} value={value} onSelect={rememberSelection} onClick={rememberSelection} onKeyUp={rememberSelection} onChange={event => { sourceSelection.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; replaceSource(event.target.value); }} /></div>
    <div ref={readingRef} className="markdown-reading" hidden={props.mode !== 'read'} onClick={event => { const id = (event.target as HTMLElement).closest<HTMLElement>('[data-target-id]')?.dataset.targetId; if (id) readingRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
    {floating && !slash && !linkDialog && props.mode === 'edit' ? <div className="editor-floating-toolbar" role="toolbar" aria-label="文字格式" style={{ left: floating.x, top: floating.y }} onMouseDown={event => event.preventDefault()}>{toolbarButton('bold', 'B')}{toolbarButton('italic', <Italic size={16} />)}{toolbarButton('link', <Link size={16} />)}{toolbarButton('quote', <Quote size={16} />)}{toolbarButton('image', <Image size={17} />)}</div> : null}
    {props.mode !== 'read' ? <div className="editor-mobile-toolbar" role="toolbar" aria-label="格式" onMouseDown={event => event.preventDefault()}>{toolbarButton('bold', <b>B</b>)}{toolbarButton('h2', 'H')}{toolbarButton('task', <ListChecks size={20} />)}<button type="button" aria-label="打开语法菜单" onClick={openSlash}>/</button><button type="button" aria-label="更多语法" onClick={openSlash}><Plus size={20} /></button></div> : null}
    {slash ? <SlashMenu {...slash} onCommand={insertCommand} onClose={closeSlash} /> : null}
    {linkDialog ? <div className="editor-dialog-backdrop"><form className="editor-link-dialog" role="dialog" aria-modal="true" aria-label={linkDialog.kind === 'image' ? '插入图片' : '插入链接'} onSubmit={event => {
      event.preventDefault();
      const url = linkDialog.url.trim();
      if (!url || /^(?:javascript|data|vbscript|file):/i.test(url) || /[\r\n]/.test(url)) { setLinkDialog({ ...linkDialog, error: '请输入有效地址' }); return; }
      const label = linkDialog.label.replace(/[\[\]\\]/g, '\\$&');
      setLinkDialog(null); insertText(`${linkDialog.kind === 'image' ? '!' : ''}[${label}](<${url.replace(/[<>]/g, '')}>)`);
    }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Tab') {
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLinkDialog(null); restoreSelection(); } }}>
      <header><h2>{linkDialog.kind === 'image' ? '插入图片' : '插入链接'}</h2><button type="button" aria-label="关闭" onClick={() => { setLinkDialog(null); restoreSelection(); }}><X size={18} /></button></header>
      <label>{linkDialog.kind === 'image' ? '图片说明' : '显示文字'}<input autoFocus value={linkDialog.label} onChange={event => setLinkDialog({ ...linkDialog, label: event.target.value })} /></label>
      <label>{linkDialog.kind === 'image' ? '图片地址' : '链接地址'}<input placeholder="https://" value={linkDialog.url} onChange={event => setLinkDialog({ ...linkDialog, url: event.target.value, error: '' })} /></label>
      {linkDialog.error ? <p role="alert">{linkDialog.error}</p> : null}
      {linkDialog.kind === 'image' ? <button type="button" className="editor-local-image" onClick={() => fileRef.current?.click()}>选择本地图片</button> : null}
      <footer><button type="button" onClick={() => { setLinkDialog(null); restoreSelection(); }}>取消</button><button type="submit">插入</button></footer>
    </form></div> : null}
    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={event => { void addImages([...event.target.files || []]); event.target.value = ''; }} />
  </div>;
}
