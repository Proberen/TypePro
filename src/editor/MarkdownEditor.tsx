import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import FlowDesigner from '../flow/FlowDesigner';
import EditorToolbar, { TableDialog, trapDialogKeys } from './EditorToolbar';
import { applySelectedTextStyle, visibleBlockMarkdown } from './formatting';
import Vditor from 'vditor';
import type { EditorMode } from '../lib/types';
import { SourceBuffer } from './SourceBuffer';
import { installCodeUndoBridge } from './code-editor-undo';
import { codeBlockText, createAssetRenderer, disposeEditorCodeBlocks, EDITOR_ASSETS, enhanceEditor, formatEditorCodeBlock, MARKDOWN_OPTIONS, renderReading, selectedCodeEditor, snapshotMarkdown, toggleCodeFold, refreshEditorDiagrams } from './rendering';
import { EDITOR_COMMANDS, EDITOR_SHORTCUTS, INLINE_MARKERS, matchesEditorShortcut, type EditorCommand } from './commands';
import { captureRichSelection, restoreRichSelection, type RichSelection } from './selection';
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
  documentTools?: ReactNode;
  documentOutline?: ReactNode;
}

const TOOLBAR_COMMANDS: Record<string, string> = { bold: 'bold', italic: 'italic', strike: 'strike', inlinecode: 'inline-code', bullet: 'list', ordered: 'ordered-list', task: 'check', quote: 'quote' };
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';

export default function MarkdownEditor(props: MarkdownEditorProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Vditor | null>(null);
  const buffer = useRef(new SourceBuffer(props.markdown));
  const alive = useRef(true);
  const composing = useRef(false);
  const codeCollectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const codeHistoryDirty = useRef(false);
  const savedSelection = useRef<RichSelection | null>(null);
  const headingsRef = useRef<EditorHeading[]>([]);
  const [value, setValue] = useState(props.markdown);
  const [ready, setReady] = useState(false);
  const [slash, setSlash] = useState<{ x: number; y: number } | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ kind: 'link' | 'image'; label: string; url: string; error: string } | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [flow, setFlow] = useState<{ source?: string; block: HTMLElement | null } | null>(null);

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
    clearTimeout(codeCollectTimer.current);
    const editor = editorRef.current;
    if (!composing.current && editor && buffer.current.accept(snapshotMarkdown(editor))) publish();
    return buffer.current.value;
  }
  function commitCodeHistory() {
    const editor = editorRef.current;
    if (!codeHistoryDirty.current || !editor) return;
    codeHistoryDirty.current = false;
    editor.vditor.undo?.addToUndoStack(editor.vditor);
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
    const field = editorRef.current?.vditor.ir?.element;
    const activeControl = document.activeElement?.closest('.editor-tools,[role=dialog],.editor-slash-menu,.cm-editor');
    if (field && !activeControl) savedSelection.current = captureRichSelection(field) || savedSelection.current;
  }
  function restoreSelection() {
    const field = editorRef.current?.vditor.ir?.element;
    if (field) restoreRichSelection(field, savedSelection.current);
  }
  function insertText(text: string) {
    commitCodeHistory();
    rememberSelection();
    if (editorRef.current && propsRef.current.mode === 'edit') {
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
            const leading = range.cloneRange(); leading.selectNodeContents(block); leading.setEnd(range.startContainer, range.startOffset);
            const prefix = leading.cloneContents(); prefix.querySelectorAll('.vditor-ir__marker,[data-render]').forEach(node => node.remove());
            if (!prefix.textContent?.replace(/\u200b/g, '').trim() && !prefix.querySelector('img,input')) {
              const inserted = document.createDocumentFragment(); inserted.append(...fragment.childNodes); block.before(inserted);
              range.selectNodeContents(block); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range);
              savedSelection.current = captureRichSelection(field);
              const offsets = savedSelection.current && { start: savedSelection.current.start, end: savedSelection.current.end };
              replaceSource(snapshotMarkdown(editorRef.current)); enhanceEditor(mountRef.current!, propsRef.current.documentId);
              if (offsets) savedSelection.current = { range: document.createRange(), ...offsets };
              restoreSelection(); rememberSelection(); return;
            }
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
    }
  }
  function scrollToHeading(id: string) {
    const index = Number(id.replace('heading-', ''));
    if (!Number.isInteger(index) || index < 0) return;
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
    const x = (caret?.left || area.left + 40) - area.left;
    const y = (caret?.bottom || area.top + 60) - area.top + 10;
    setSlash({ x: Math.max(10, Math.min(x, area.width - 354)), y: Math.max(8, Math.min(y, area.height - 450)) });
  }
  function closeSlash(restore: boolean) { setSlash(null); if (restore) restoreSelection(); }
  function selectedText() {
    const range = savedSelection.current?.range;
    if (!range) return '';
    const fragment = range.cloneContents(); fragment.querySelectorAll('.vditor-ir__marker,[data-render]').forEach(node => node.remove());
    return fragment.textContent || '';
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
    if (command.id === 'table') { setTableOpen(true); return; }
    if (command.id === 'mermaid') { openFlow(); return; }
    const snippet = command.snippet;
    insertText(snippet);
  }
  function executeCommand(id: string) {
    if (id === 'slash') { openSlash(); return; }
    if (propsRef.current.mode === 'read' || composing.current) return;
    if (id === 'undo' || id === 'redo') {
      const code = mountRef.current && selectedCodeEditor(mountRef.current);
      if (code) { code.focus(); code[id](); collect(); return; }
      rememberSelection(); restoreSelection(); editorRef.current?.vditor.toolbar?.elements?.[id]?.querySelector<HTMLButtonElement>('button')?.click(); collect(); return;
    }
    commitCodeHistory();
    if (id === 'clear-color') { styleSelection(`color:${getComputedStyle(rootRef.current!).getPropertyValue('--body-text').trim() || '#3c4758'}`); return; }
    if (id === 'clear') { clearFormatting(); return; }
    const command = EDITOR_COMMANDS.find(item => item.id === id);
    if (!command) return;
    rememberSelection();
    setSlash(null);
    if (id === 'link' || id === 'image') { openLink(id); return; }
    const selected = selectedText();
    const insertion = selected && (id === 'code' || id === 'math') ? { ...command, snippet: id === 'code' ? `\`\`\`\n${selected}\n\`\`\`\n` : `$$\n${selected}\n$$\n` } : command;
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
  function clearFormatting() {
    rememberSelection(); restoreSelection();
    const editor = editorRef.current, saved = savedSelection.current;
    if (!editor || !saved || saved.range.collapsed) return;
    const field = editor.vditor.ir!.element;
    const blocks = [...field.children].filter((node): node is HTMLElement => node instanceof HTMLElement && saved.range.intersectsNode(node));
    const offsets = { start: saved.start, end: saved.end };
    const changed = blocks.filter(block => !block.matches('[data-type="code-block"],[data-type="math-block"]')).map(block => ({ block, markdown: visibleBlockMarkdown(block, editor.vditor.lute, saved.range) }));
    for (const { block, markdown } of changed) {
      const fragment = document.createElement('template');
      fragment.innerHTML = editor.vditor.lute.Md2VditorIRDOM(markdown);
      block.replaceWith(fragment.content);
    }
    replaceSource(snapshotMarkdown(editor));
    enhanceEditor(mountRef.current!, propsRef.current.documentId);
    savedSelection.current = { range: document.createRange(), ...offsets };
    restoreSelection(); rememberSelection();
  }
  function styleSelection(style: string) {
    rememberSelection(); restoreSelection();
    const editor = editorRef.current, range = savedSelection.current?.range;
    if (!editor || !range || range.collapsed) { propsRef.current.onError?.('请先选中需要设置的文字'); return; }
    const offsets = { start: savedSelection.current!.start, end: savedSelection.current!.end };
    if (!applySelectedTextStyle(editor.vditor.ir!.element, range, style)) return;
    replaceSource(snapshotMarkdown(editor));
    enhanceEditor(mountRef.current!, propsRef.current.documentId);
    savedSelection.current = { range: document.createRange(), ...offsets };
    restoreSelection(); rememberSelection();
  }
  function openFlow(block: HTMLElement | null = null) {
    rememberSelection(); setSlash(null);
    const source = block ? block.querySelector(':scope > pre > code')?.textContent || '' : undefined;
    setFlow({ source, block });
  }
  function saveFlow(source: string) {
    const editor = editorRef.current;
    if (!editor) return;
    if (flow?.block?.isConnected) {
      const code = flow.block.querySelector(':scope > pre > code');
      if (code) {
        code.textContent = source;
        const next = snapshotMarkdown(editor);
        replaceSource(next); enhanceEditor(mountRef.current!, propsRef.current.documentId);
      }
    } else {
      const longest = Math.max(2, ...[...source.matchAll(/`+/g)].map(match => match[0].length));
      const fence = '`'.repeat(longest + 1); insertText(`${fence}mermaid\n${source}\n${fence}\n`);
    }
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
    let restoreUndo: (() => void) | undefined;
    const assets = createAssetRenderer(path => propsRef.current.resolveAsset(path));
    const enhance = () => { if (!disposed && !composing.current) {
      assets(root); enhanceEditor(mount, propsRef.current.documentId, {
        onChange: () => { codeHistoryDirty.current = true; clearTimeout(codeCollectTimer.current); codeCollectTimer.current = setTimeout(() => { if (!disposed) collect(); }, 180); },
        onError: message => propsRef.current.onError?.(message),
      });
    } };
    const observer = new MutationObserver(records => {
      // CodeMirror paints its own DOM and updates only its canonical raw code.
      // Neither mutation needs the document-wide decoration pass while typing.
      if (records.every(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return element?.closest('.note-code-editable .note-code-preview,.note-code-editable > pre.vditor-ir__marker--pre');
      })) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(enhance);
    });
    const themeObserver = new MutationObserver(() => refreshEditorDiagrams(root));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    const timeout = window.setTimeout(() => { if (!editorRef.current && !disposed) propsRef.current.onError?.('编辑组件加载失败，请重新打开文档'); }, 15_000);
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
        editorRef.current = instance;
        restoreUndo = installCodeUndoBridge(instance.vditor, () => {
          if (disposed) return;
          enhanceEditor(mount, propsRef.current.documentId, undefined, true); collect();
        });
        instance.setValue(buffer.current.value); buffer.current.baseline(snapshotMarkdown(instance));
        const field = instance.vditor.ir!.element;
        field.setAttribute('role', 'textbox'); field.setAttribute('aria-label', 'Markdown 正文'); field.setAttribute('aria-multiline', 'true'); field.setAttribute('spellcheck', 'false');
        setReady(true); getHeadings(); enhance();
      },
    });
    const selectionChange = () => {
      rememberSelection();
    };
    const beforeInput = (event: InputEvent) => {
      if (!(event.target as HTMLElement).closest('.cm-editor') && !/^history(?:Undo|Redo)$/.test(event.inputType)) commitCodeHistory();
      if (event.data === '/' && !event.isComposing && event.inputType === 'insertText' && canOpenSlash()) { event.preventDefault(); event.stopPropagation(); openSlash(); }
    };
    const languageChange = (event: Event) => { if (event.target instanceof HTMLSelectElement && event.target.matches('[data-code-language]')) { event.stopPropagation(); changeCodeLanguage(event.target); } };
    const codeControlInput = (event: Event) => { if (event.target instanceof HTMLSelectElement && event.target.matches('[data-code-language]')) event.stopPropagation(); };
    root.addEventListener('input', codeControlInput, true);
    root.addEventListener('change', languageChange, true);
    root.addEventListener('beforeinput', beforeInput);
    document.addEventListener('selectionchange', selectionChange);
    return () => {
      clearTimeout(codeCollectTimer.current);
      disposed = true; alive.current = false; clearTimeout(timeout); cancelAnimationFrame(frame); observer.disconnect(); themeObserver.disconnect();
      document.removeEventListener('selectionchange', selectionChange); root.removeEventListener('beforeinput', beforeInput); root.removeEventListener('change', languageChange, true); root.removeEventListener('input', codeControlInput, true);
      disposeEditorCodeBlocks(mount);
      restoreUndo?.();
      if (editorRef.current === instance) { clearTimeout(instance.vditor.ir?.processTimeoutId); clearTimeout(instance.vditor.ir?.hlToolbarTimeoutId); instance.destroy(); editorRef.current = null; }
    };
  }, []);

  useLayoutEffect(() => {
    if (props.markdown === buffer.current.value) return;
    buffer.current.replace(props.markdown); setValue(props.markdown);
    if (editorRef.current) { editorRef.current.setValue(props.markdown); buffer.current.baseline(snapshotMarkdown(editorRef.current)); getHeadings(); }
  }, [props.markdown]);
  useEffect(() => {
    setSlash(null); setLinkDialog(null); setTableOpen(false); setFlow(null);
  }, [props.mode]);
  useEffect(() => {
    if (props.mode !== 'read' || !readingRef.current) return;
    const page = document.createElement('div'); page.className = 'vditor-reset note-reading-content'; readingRef.current.replaceChildren(page);
    void renderReading(page, value, props.documentId).catch(error => { if (page.isConnected) propsRef.current.onError?.(`预览失败：${String(error)}`); });
  }, [props.mode, value, ready]);
  function changeCodeLanguage(select: HTMLSelectElement) {
    const block = select.closest('[data-type="code-block"]');
    const code = block?.querySelector(':scope > pre > code');
    const info = block?.querySelector('[data-type="code-block-info"]');
    if (!code || !info) return;
    code.className = select.value === 'plaintext' ? '' : `language-${select.value}`;
    info.textContent = '\u200b' + (select.value === 'plaintext' ? '' : select.value);
    enhanceEditor(mountRef.current!, propsRef.current.documentId); collect();
  }

  return <div ref={rootRef} className={`markdown-editor mode-${props.mode}`} data-theme={props.theme || 'light'} data-document-id={props.documentId}
    onCompositionStartCapture={event => { if (!(event.target as HTMLElement).closest('.cm-editor')) { commitCodeHistory(); composing.current = true; } }}
    onCompositionEndCapture={event => { if ((event.target as HTMLElement).closest('.cm-editor')) return; composing.current = false; requestAnimationFrame(() => { if (alive.current && propsRef.current.mode === 'edit') collect(); }); }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || composing.current || (event.target as HTMLElement).closest('.editor-slash-menu,.editor-link-dialog,.editor-tools,.cm-editor,[role=dialog]')) return;
      const isEditor = mountRef.current?.contains(event.target as Node);
      if (!isEditor || propsRef.current.mode === 'read') return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
        event.preventDefault(); event.stopPropagation(); executeCommand(event.code === 'KeyY' || event.shiftKey ? 'redo' : 'undo'); return;
      }
      if (['Backspace', 'Delete', 'Enter', 'Tab'].includes(event.key)) commitCodeHistory();
      const shortcut = EDITOR_SHORTCUTS.find(item => matchesEditorShortcut(event.nativeEvent, item.binding));
      if (shortcut) { event.preventDefault(); event.stopPropagation(); executeCommand(shortcut.id); }
      else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && canOpenSlash()) { event.preventDefault(); event.stopPropagation(); openSlash(); }
    }}
    onClickCapture={event => {
      const target = event.target as HTMLElement;
      const fold = target.closest<HTMLButtonElement>('[data-fold-code]');
      if (fold) { event.preventDefault(); event.stopPropagation(); toggleCodeFold(fold, propsRef.current.documentId, propsRef.current.onError); return; }
      const editFlow = target.closest<HTMLButtonElement>('[data-edit-flow]');
      if (editFlow) { event.preventDefault(); event.stopPropagation(); openFlow(editFlow.closest('[data-type="code-block"]')); return; }
      const format = target.closest<HTMLButtonElement>('[data-format-code]');
      if (format && mountRef.current) { event.preventDefault(); event.stopPropagation(); formatEditorCodeBlock(format, mountRef.current); return; }
      const copy = target.closest<HTMLButtonElement>('[data-copy-code]');
      if (copy) {
        event.preventDefault(); event.stopPropagation();
        const text = codeBlockText(copy);
        void navigator.clipboard.writeText(text).then(() => { if (copy.isConnected) { copy.dataset.copied = 'true'; copy.title = '已复制'; window.setTimeout(() => { if (copy.isConnected) { delete copy.dataset.copied; copy.title = '复制代码'; } }, 1400); } }).catch(() => propsRef.current.onError?.('复制失败'));
      } else if (target.closest('[data-code-language]')) event.stopPropagation();
    }}
    onPasteCapture={event => {
      if ((event.target as HTMLElement).closest('.cm-editor')) return;
      commitCodeHistory();
      const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
      if (props.mode !== 'read' && files.length) { event.preventDefault(); event.stopPropagation(); rememberSelection(); void addImages(files); }
    }}
    onDragOver={event => { if (!(event.target as HTMLElement).closest('.cm-editor') && props.mode !== 'read' && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDropCapture={event => {
      if (props.mode === 'read' || (event.target as HTMLElement).closest('.cm-editor')) return;
      commitCodeHistory();
      const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); event.stopPropagation(); rememberSelection(); void addImages(files); }
    }}>
    {props.mode === 'edit' ? <EditorToolbar onCommand={executeCommand} onStyle={styleSelection} rememberSelection={rememberSelection} /> : null}
    {props.documentTools}
    <div className="editor-body-flex">
      {props.documentOutline}
      <div className="editor-surface">
      <div ref={mountRef} className="markdown-visual" hidden={props.mode !== 'edit'} aria-busy={!ready} />
      <div ref={readingRef} className="markdown-reading" hidden={props.mode !== 'read'} onClick={event => { const id = (event.target as HTMLElement).closest<HTMLElement>('[data-target-id]')?.dataset.targetId; if (id) readingRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
      </div>
    </div>
    {tableOpen ? <TableDialog onInsert={markdown => { setTableOpen(false); insertText(markdown); }} onClose={() => { setTableOpen(false); restoreSelection(); }} /> : null}
    {flow ? <FlowDesigner source={flow.source} onSave={saveFlow} onClose={() => { setFlow(null); restoreSelection(); }} /> : null}
    {slash ? <SlashMenu {...slash} onCommand={insertCommand} onClose={closeSlash} /> : null}
    {linkDialog ? <div className="editor-dialog-backdrop"><form className="editor-link-dialog" role="dialog" aria-modal="true" aria-label={linkDialog.kind === 'image' ? '插入图片' : '插入链接'} onSubmit={event => {
      event.preventDefault();
      const url = linkDialog.url.trim();
      if (!url || /^(?:javascript|data|vbscript|file):/i.test(url) || /[\r\n]/.test(url)) { setLinkDialog({ ...linkDialog, error: '请输入有效地址' }); return; }
      const label = linkDialog.label.replace(/[\[\]\\]/g, '\\$&');
      setLinkDialog(null); insertText(`${linkDialog.kind === 'image' ? '!' : ''}[${label}](<${url.replace(/[<>]/g, '')}>)`);
    }} onKeyDown={event => trapDialogKeys(event, () => { setLinkDialog(null); restoreSelection(); })}>
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
