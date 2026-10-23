import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Italic, Link, ListChecks, MoreHorizontal, Quote } from 'lucide-react';
import Vditor from 'vditor';
import type { EditorMode } from '../lib/types';
import { SourceBuffer } from './SourceBuffer';
import { createAssetRenderer, EDITOR_ASSETS, enhanceEditor, MARKDOWN_OPTIONS, renderReading, snapshotMarkdown } from './rendering';
import 'vditor/dist/index.css';
import './editor.css';

export interface EditorHandle {
  insertText(text: string): void;
  focus(): void;
  getValue(): string;
}

export interface MarkdownEditorProps {
  documentId: string;
  markdown: string;
  mode: EditorMode;
  onChange: (markdown: string) => void;
  onReady?: (api: EditorHandle) => void;
  onError?: (error: string) => void;
  saveAsset: (file: File) => Promise<{ path: string; url: string }>;
  resolveAsset: (path: string) => Promise<string>;
}

type Format = 'bold' | 'headings' | 'check' | 'link' | 'italic' | 'quote' | 'code' | 'table';
const formats: Record<Format, [string, string, string]> = {
  bold: ['**', '**', '粗体'], headings: ['## ', '', '标题'], check: ['- [ ] ', '', '待办'],
  link: ['[', '](https://)', '链接'], italic: ['*', '*', '斜体'], quote: ['> ', '', '引用'],
  code: ['\n```\n', '\n```\n', '代码'], table: ['\n| 列 1 | 列 2 |\n| --- | --- |\n| ', ' |  |\n', '表格'],
};

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
  const savedRange = useRef<Range | null>(null);
  const [value, setValue] = useState(props.markdown);
  const [ready, setReady] = useState(false);
  const [more, setMore] = useState(false);
  const [floating, setFloating] = useState<{ x: number; y: number } | null>(null);

  function publish() {
    setValue(buffer.current.value);
    propsRef.current.onChange(buffer.current.value);
  }

  function collect() {
    const editor = editorRef.current;
    if (editor && buffer.current.accept(snapshotMarkdown(editor))) publish();
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
    const selection = window.getSelection();
    if (selection?.rangeCount && mountRef.current?.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRange.current;
    if (!range || !mountRef.current?.contains(range.startContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function insertSource(prefix: string, suffix = '', placeholder = '', replaceSelection = false) {
    const source = sourceRef.current;
    const text = buffer.current.value;
    const start = source?.selectionStart ?? text.length;
    const end = source?.selectionEnd ?? start;
    const selected = replaceSelection ? '' : text.slice(start, end) || placeholder;
    replaceSource(text.slice(0, start) + prefix + selected + suffix + text.slice(end));
    requestAnimationFrame(() => {
      source?.focus();
      source?.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }

  function insertText(text: string) {
    if (propsRef.current.mode === 'source') {
      insertSource(text, '', '', true);
    } else if (editorRef.current && propsRef.current.mode === 'edit') {
      restoreSelection();
      editorRef.current.insertMD(text);
      collect();
    } else {
      replaceSource(buffer.current.value + text);
    }
  }

  const apiRef = useRef<EditorHandle>({
    insertText,
    focus: () => {
      if (propsRef.current.mode === 'source') sourceRef.current?.focus();
      else if (propsRef.current.mode === 'edit') editorRef.current?.focus();
    },
    getValue: () => propsRef.current.mode === 'edit' ? collect() : buffer.current.value,
  });

  async function addImages(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    for (const file of images) {
      try {
        const asset = await propsRef.current.saveAsset(file);
        if (!alive.current) return;
        const alt = file.name.replace(/[\[\]\\\r\n]/g, ' ').replace(/\.[^.]+$/, '');
        insertText(`![${alt}](${asset.path})`);
        rememberSelection();
      } catch (error) {
        if (alive.current) propsRef.current.onError?.(`图片保存失败：${String(error)}`);
      }
    }
  }

  function format(action: Format) {
    if (propsRef.current.mode === 'read') return;
    if (propsRef.current.mode === 'source') {
      const [prefix, suffix, placeholder] = formats[action];
      insertSource(prefix, suffix, placeholder);
    } else {
      restoreSelection();
      const controls = editorRef.current?.vditor.toolbar?.elements;
      const button = action === 'headings'
        ? controls?.headings?.querySelector<HTMLButtonElement>('[data-tag="h2"]')
        : controls?.[action]?.querySelector<HTMLButtonElement>('button');
      button?.click();
      collect();
      rememberSelection();
    }
    setMore(false);
  }

  useEffect(() => {
    alive.current = true;
    propsRef.current.onReady?.(apiRef.current);
    const root = rootRef.current!;
    const mount = mountRef.current!;
    // Explicit undefined disables Vditor's synchronous inline-script icon loader.
    if (!document.getElementById('note-editor-icons')) {
      const icons = document.createElement('script');
      icons.id = 'note-editor-icons';
      icons.src = `${EDITOR_ASSETS}/dist/js/icons/ant.js`;
      document.head.appendChild(icons);
    }
    let disposed = false;
    let frame = 0;
    const assets = createAssetRenderer((path) => propsRef.current.resolveAsset(path));
    const enhance = () => {
      if (disposed || composing.current) return;
      assets(root);
      enhanceEditor(mount);
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(enhance);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    const timeout = window.setTimeout(() => {
      if (!editorRef.current && !disposed) propsRef.current.onError?.('编辑组件加载失败，可切换到源码继续编辑');
    }, 15_000);
    const instance = new Vditor(mount, {
      cdn: EDITOR_ASSETS,
      lang: 'zh_CN',
      mode: 'ir',
      icon: undefined,
      value: buffer.current.value,
      height: '100%',
      minHeight: 240,
      placeholder: '开始书写…',
      cache: { enable: false },
      undoDelay: 150,
      toolbar: ['bold', 'headings', 'check', 'link', 'italic', 'quote', 'code', 'table', 'undo', 'redo'],
      toolbarConfig: { hide: true },
      resize: { enable: false },
      counter: { enable: false },
      outline: { enable: false, position: 'right' },
      hint: { emoji: {}, emojiPath: `${EDITOR_ASSETS}/dist/images/emoji` },
      link: { isOpen: false },
      image: { isPreview: false },
      preview: {
        delay: 150,
        maxWidth: 740,
        markdown: MARKDOWN_OPTIONS,
        math: { engine: 'KaTeX', inlineDigit: true },
        hljs: { enable: true, style: 'github' },
        theme: { current: 'light', path: `${EDITOR_ASSETS}/dist/css/content-theme` },
        render: { media: { enable: false } },
        actions: [],
      },
      input: () => { if (!disposed && !composing.current) collect(); },
      blur: () => { if (!disposed) collect(); },
      after: () => {
        clearTimeout(timeout);
        if (disposed) { instance.destroy(); return; }
        editorRef.current = instance;
        instance.setValue(buffer.current.value);
        buffer.current.baseline(snapshotMarkdown(instance));
        const field = instance.vditor.ir!.element;
        field.setAttribute('role', 'textbox');
        field.setAttribute('aria-label', 'Markdown 正文');
        field.setAttribute('aria-multiline', 'true');
        field.setAttribute('spellcheck', 'false');
        setReady(true);
        enhance();
      },
    });
    const selectionChange = () => {
      const selection = window.getSelection();
      if (propsRef.current.mode !== 'edit' || !selection?.rangeCount || !mount.contains(selection.anchorNode)) {
        setFloating(null);
        return;
      }
      rememberSelection();
      if (selection.isCollapsed) { setFloating(null); return; }
      const selected = selection.getRangeAt(0).getBoundingClientRect();
      const area = root.getBoundingClientRect();
      setFloating({ x: Math.max(90, Math.min(area.width - 90, selected.left - area.left + selected.width / 2)), y: Math.max(4, selected.top - area.top - 46) });
    };
    document.addEventListener('selectionchange', selectionChange);
    return () => {
      disposed = true;
      alive.current = false;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('selectionchange', selectionChange);
      // A loading instance is disposed in its after callback, once Vditor's internals exist.
      if (editorRef.current === instance) {
        clearTimeout(instance.vditor.ir?.processTimeoutId);
        clearTimeout(instance.vditor.ir?.hlToolbarTimeoutId);
        instance.destroy();
        editorRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (props.markdown === buffer.current.value) return;
    buffer.current.replace(props.markdown);
    setValue(props.markdown);
    if (editorRef.current) {
      editorRef.current.setValue(props.markdown);
      buffer.current.baseline(snapshotMarkdown(editorRef.current));
    }
  }, [props.markdown]);

  useEffect(() => {
    setMore(false);
    setFloating(null);
    if (props.mode !== 'read' || !readingRef.current) return;
    const page = document.createElement('div');
    page.className = 'vditor-reset note-reading-content';
    readingRef.current.replaceChildren(page);
    void renderReading(page, value).catch((error) => {
      if (page.isConnected) propsRef.current.onError?.(`预览失败：${String(error)}`);
    });
  }, [props.mode, value, ready]);

  function toolbarButton(action: Format, label: ReactNode) {
    return <button type="button" title={formats[action][2]} aria-label={formats[action][2]} onClick={() => format(action)}>{label}</button>;
  }

  return <div ref={rootRef} className={`markdown-editor mode-${props.mode}`} data-document-id={props.documentId}
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; requestAnimationFrame(() => { if (alive.current && propsRef.current.mode === 'edit') collect(); }); }}
    onPasteCapture={(event) => {
      const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
      if (props.mode !== 'read' && files.length) { event.preventDefault(); event.stopPropagation(); rememberSelection(); void addImages(files); }
    }}
    onDragOver={(event) => { if (props.mode !== 'read' && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDropCapture={(event) => {
      if (props.mode === 'read') return;
      const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); event.stopPropagation(); rememberSelection(); void addImages(files); }
    }}>
    <div ref={mountRef} className="markdown-visual" hidden={props.mode !== 'edit'} aria-busy={!ready} />
    <textarea ref={sourceRef} className="markdown-source" hidden={props.mode !== 'source'} aria-label="Markdown 源码" spellCheck={false} value={value}
      onChange={(event) => replaceSource(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'k'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          format(event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : 'link');
        } else if (event.key === 'Tab') { event.preventDefault(); insertSource('  '); }
      }} />
    <div ref={readingRef} className="markdown-reading" hidden={props.mode !== 'read'} onClick={(event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-target-id]');
      const id = target?.dataset.targetId;
      if (id) readingRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }} />
    {floating && props.mode === 'edit' ? <div className="editor-floating-toolbar" role="toolbar" aria-label="文字格式" style={{ left: floating.x, top: floating.y }} onMouseDown={(event) => event.preventDefault()}>
      {toolbarButton('bold', 'B')}{toolbarButton('italic', <Italic size={16}/>)}{toolbarButton('link', <Link size={16}/>)}{toolbarButton('quote', <Quote size={16}/>)}
      <button type="button" title="插入图片" aria-label="插入图片" onClick={() => { rememberSelection(); fileRef.current?.click(); }}><Image size={17}/></button>
    </div> : null}
    {props.mode !== 'read' ? <div className="editor-mobile-toolbar" role="toolbar" aria-label="格式" onMouseDown={(event) => event.preventDefault()}>
      {toolbarButton('bold', 'B')}{toolbarButton('headings', 'H')}{toolbarButton('check', <ListChecks size={21}/>)}{toolbarButton('link', <Link size={20}/>)}
      <button type="button" title="更多格式" aria-label="更多格式" aria-expanded={more} onClick={() => { rememberSelection(); setMore(!more); }}><MoreHorizontal size={22}/></button>
      {more ? <div className="editor-more-menu">
        {toolbarButton('italic', '斜体')}{toolbarButton('quote', '引用')}{toolbarButton('code', '代码')}{toolbarButton('table', '表格')}
        <button type="button" onClick={() => { rememberSelection(); fileRef.current?.click(); setMore(false); }}>图片</button>
        <button type="button" onClick={() => { insertText('\n$$\nx^2\n$$\n'); setMore(false); }}>公式</button>
      </div> : null}
    </div> : null}
    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void addImages([...event.target.files || []]); event.target.value = ''; }} />
  </div>;
}
