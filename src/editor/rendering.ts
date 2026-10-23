import Vditor from 'vditor';
import { renderFlowPreview } from '../flow/preview';
import { decorateInlineStyles } from './formatting';
import { loadFolds, reconcileFolds, saveFolds, type FoldEntry } from './folding';
import { mountCodeEditor, type CodeEditorHandle } from './CodeMirrorEditor';
import { safeCodeFence } from './code-editor-state';

export const EDITOR_ASSETS = '/vendor/vditor';
export const MARKDOWN_OPTIONS = {
  sanitize: true,
  toc: true,
  footnotes: true,
  autoSpace: false,
  fixTermTypo: false,
  codeBlockPreview: false,
  mathBlockPreview: true,
  gfmAutoLink: true,
  mark: true,
  sub: true,
  sup: true,
};
const HIGHLIGHT_OPTIONS = { enable: true, style: 'github', defaultLang: '', lineNumber: false };
const CODE_LANGUAGES = [
  ['typescript', 'TypeScript'], ['javascript', 'JavaScript'], ['python', 'Python'], ['java', 'Java'],
  ['json', 'JSON'], ['css', 'CSS'], ['xml', 'HTML'], ['bash', 'Shell'], ['sql', 'SQL'],
  ['rust', 'Rust'], ['go', 'Go'], ['markdown', 'Markdown'], ['mermaid', 'Mermaid'], ['plaintext', '纯文本'],
];

function createCodeBox(text: string, language: string, editable: boolean) {
  const box = document.createElement('div');
  box.className = 'note-codebox';
  const header = document.createElement('div');
  header.className = 'note-codehead';
  const select = document.createElement('select');
  select.dataset.codeLanguage = 'true';
  select.setAttribute('aria-label', '代码语言');
  select.disabled = !editable;
  const name = language || 'plaintext';
  const languages = CODE_LANGUAGES.some(([id]) => id === name) ? CODE_LANGUAGES : [...CODE_LANGUAGES, [name, name]];
  for (const [id, label] of languages) {
    const option = document.createElement('option');
    option.value = id; option.textContent = label; select.append(option);
  }
  select.value = name;
  const copy = document.createElement('button');
  copy.type = 'button'; copy.dataset.copyCode = 'true'; copy.title = '复制代码'; copy.setAttribute('aria-label', '复制代码');
  copy.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="8" width="12" height="13" rx="2"/><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2"/></svg>';
  if (editable) {
    const format = document.createElement('button');
    format.type = 'button'; format.dataset.formatCode = 'true'; format.title = '格式化代码 · ⌥ ⇧ F'; format.setAttribute('aria-label', '格式化代码');
    format.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H6a2 2 0 0 0-2 2v4a3 3 0 0 1-2 3 3 3 0 0 1 2 3v4a2 2 0 0 0 2 2h2m8-18h2a2 2 0 0 1 2 2v4a3 3 0 0 0 2 3 3 3 0 0 0-2 3v4a2 2 0 0 1-2 2h-2M10 8h4m-4 4h4m-4 4h4"/></svg>';
    header.append(select, format, copy);
  } else header.append(select, copy);
  const content = document.createElement('div');
  content.className = 'note-code-content';
  const gutter = document.createElement('div');
  gutter.className = 'note-line-gutter'; gutter.setAttribute('aria-hidden', 'true');
  gutter.textContent = text.replace(/\n$/, '').split('\n').map((_, index) => index + 1).join('\n');
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = `language-${name}`; code.textContent = text;
  pre.append(code); content.append(gutter, pre); box.append(header, content);
  return box;
}

const foldCache = new Map<string, FoldEntry[]>();
const foldTimers = new Map<string, ReturnType<typeof setTimeout>>();
function deferFoldSave(documentId: string) {
  clearTimeout(foldTimers.get(documentId));
  foldTimers.set(documentId, setTimeout(() => {
    foldTimers.delete(documentId);
    try { saveFolds(documentId, foldEntries(documentId)); } catch { /* Explicit toggles report persistence failures. */ }
  }, 300));
}
function foldEntries(documentId: string) {
  if (!foldCache.has(documentId)) foldCache.set(documentId, loadFolds(documentId));
  return foldCache.get(documentId)!;
}
function applyFold(block: HTMLElement, collapsed: boolean) {
  block.classList.toggle('note-code-collapsed', collapsed);
  const button = block.querySelector<HTMLButtonElement>('[data-fold-code]');
  if (button) {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? '展开代码块' : '折叠代码块');
    button.title = collapsed ? '展开代码块' : '折叠代码块';
  }
}
export function toggleCodeFold(button: HTMLButtonElement, documentId: string, onError?: (message: string) => void) {
  const block = button.closest<HTMLElement>('[data-fold-id]');
  const entry = foldEntries(documentId).find(entry => entry.id === block?.dataset.foldId);
  if (!block || !entry) return;
  entry.collapsed = !entry.collapsed; applyFold(block, entry.collapsed);
  try { saveFolds(documentId, foldEntries(documentId)); }
  catch { onError?.('折叠状态无法保存，请检查设备剩余空间'); }
}
function decorateFolds(root: HTMLElement, documentId: string) {
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-type="code-block"],.note-codebox')].filter(block =>
    !block.parentElement?.closest('[data-type="code-block"]') && !block.querySelector('code.language-mermaid'));
  const previous = foldEntries(documentId);
  const entries = reconcileFolds(previous, blocks.map(block => ({ id: block.dataset.foldId, code: block.querySelector('code')?.textContent || '' })), () => crypto.randomUUID());
  foldCache.set(documentId, entries);
  blocks.forEach((block, index) => {
    const entry = entries[index]; block.dataset.foldId = entry.id;
    const header = block.querySelector('.note-codehead');
    if (header && !header.querySelector('[data-fold-code]')) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.foldCode = 'true'; button.className = 'note-code-fold';
      button.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const lines = document.createElement('span'); lines.className = 'note-code-lines';
      header.prepend(button); header.querySelector('select')?.after(lines);
    }
    const lines = header?.querySelector('.note-code-lines');
    if (lines) lines.textContent = `${entry.code.replace(/\n$/, '').split('\n').length} 行`;
    applyFold(block, entry.collapsed);
  });
  if (JSON.stringify(entries) !== JSON.stringify(previous)) {
    deferFoldSave(documentId);
  }
}
function createDiagramPreview(source: string, editable: boolean) {
  const box = document.createElement('div'); box.className = 'note-flow-block'; box.dataset.diagramSource = source;
  const header = document.createElement('div'); header.className = 'note-codehead';
  const label = document.createElement('span'); label.textContent = '流程图'; header.append(label);
  if (editable) { const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.editFlow = 'true'; edit.textContent = '编辑'; edit.setAttribute('aria-label', '编辑流程图'); header.append(edit); }
  const preview = document.createElement('div'); preview.className = 'note-diagram'; box.append(header, preview);
  void renderFlowPreview(preview, source); return box;
}

export function refreshEditorDiagrams(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.note-flow-block').forEach(block => {
    const preview = block.querySelector<HTMLElement>('.note-diagram');
    if (preview && block.dataset.diagramSource !== undefined) void renderFlowPreview(preview, block.dataset.diagramSource);
  });
}

/** Serialize a clone so resolved image URLs can never escape into stored Markdown. */
export function snapshotMarkdown(editor: Vditor) {
  if (!editor.vditor.ir!.element.querySelector('img[data-note-asset],.note-inline-style,.note-code-preview')) return editor.getValue();
  const clone = editor.vditor.ir!.element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.note-code-preview').forEach(preview => preview.remove());
  clone.querySelectorAll<HTMLImageElement>('img[data-note-asset]').forEach((image) => {
    image.setAttribute('src', image.dataset.noteAsset!);
    image.removeAttribute('data-note-asset');
  });
  clone.querySelectorAll('.note-inline-style').forEach(span => span.replaceWith(...span.childNodes));
  return editor.vditor.lute.VditorIRDOM2Md(clone.innerHTML).replace(/\u00a0/g, ' ');
}

export function createAssetRenderer(resolveAsset: (path: string) => Promise<string>) {
  const cache = new Map<string, Promise<string>>();
  const failed = new WeakSet<HTMLImageElement>();
  return (root: HTMLElement) => {
    root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      const path = image.dataset.noteAsset || image.getAttribute('src') || '';
      if (!path.startsWith('../../assets/') || failed.has(image)) return;
      image.dataset.noteAsset = path;
      if (!cache.has(path)) cache.set(path, resolveAsset(path));
      void cache.get(path)!.then((url) => {
        if (!url.startsWith('data:image/')) throw new Error('Invalid local image');
        if (image.isConnected && image.dataset.noteAsset === path && image.getAttribute('src') !== url) {
          image.src = url;
        }
      }).catch(() => {
        failed.add(image);
        image.title = '图片不存在或无法读取';
      });
    });
  };
}

interface CodeWidget {
  block: HTMLElement;
  preview: HTMLElement;
  code: HTMLElement;
  editor: CodeEditorHandle;
}
interface CodeSession {
  documentId: string;
  widgets: Map<HTMLElement, CodeWidget>;
  onChange?: () => void;
  onError?: (message: string) => void;
}
const codeSessions = new WeakMap<HTMLElement, CodeSession>();

export function disposeEditorCodeBlocks(root: HTMLElement) {
  const session = codeSessions.get(root);
  if (!session) return;
  session.widgets.forEach(widget => widget.editor.destroy());
  session.widgets.clear(); codeSessions.delete(root);
  clearTimeout(foldTimers.get(session.documentId)); foldTimers.delete(session.documentId);
  try { saveFolds(session.documentId, foldEntries(session.documentId)); } catch { /* Explicit toggles report errors. */ }
}

export function selectedCodeEditor(root: HTMLElement) {
  const session = codeSessions.get(root);
  const selection = window.getSelection();
  return [...session?.widgets.values() || []].find(widget => widget.preview.contains(document.activeElement) || (selection?.anchorNode && widget.preview.contains(selection.anchorNode)))?.editor;
}

export function formatEditorCodeBlock(button: HTMLElement, root: HTMLElement) {
  const block = button.closest<HTMLElement>('[data-type="code-block"]');
  const editor = block && codeSessions.get(root)?.widgets.get(block)?.editor;
  if (editor) { editor.focus(); void editor.format(); }
}

export function codeBlockText(control: HTMLElement) {
  const block = control.closest('[data-type="code-block"]');
  return block?.querySelector(':scope > pre.vditor-ir__marker--pre > code')?.textContent
    ?? control.closest('.note-codebox')?.querySelector('code')?.textContent ?? '';
}

function syncCodeSource(block: HTMLElement, code: HTMLElement, value: string) {
  if (code.textContent !== value) code.textContent = value;
  const open = block.querySelector('[data-type="code-block-open-marker"]');
  const close = block.querySelector('[data-type="code-block-close-marker"]');
  const fence = safeCodeFence(value, open?.textContent || '```');
  if (open && open.textContent !== fence) open.textContent = fence;
  if (close && close.textContent !== fence) close.textContent = fence;
}

function createCodeWidget(root: HTMLElement, session: CodeSession, block: HTMLElement, preview: HTMLElement, code: HTMLElement, language: string) {
  let widget: CodeWidget;
  const box = createCodeBox(code.textContent || '', language, true);
  const content = box.querySelector<HTMLElement>('.note-code-content')!;
  content.replaceChildren(); content.classList.add('note-code-editor-host');
  const status = document.createElement('span'); status.className = 'note-code-status'; status.setAttribute('role', 'status');
  box.querySelector('.note-codehead')!.append(status);
  preview.replaceChildren(box);
  // CodeMirror owns these input events; Vditor must never normalize its DOM.
  for (const name of ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'copy', 'cut', 'drop', 'dragstart', 'click', 'dblclick', 'selectstart']) {
    preview.addEventListener(name, event => event.stopPropagation());
  }
  const editor = mountCodeEditor(content, {
    value: code.textContent || '', language, ariaLabel: '代码块内容',
    onChange(value) {
      if (!root.contains(widget.block) || session.widgets.get(widget.block) !== widget) return;
      syncCodeSource(widget.block, widget.code, value); preview.dataset.source = value;
      const lines = box.querySelector('.note-code-lines');
      if (lines) lines.textContent = `${value.replace(/\n$/, '').split('\n').length} 行`;
      const entry = foldEntries(session.documentId).find(entry => entry.id === widget.block.dataset.foldId);
      if (entry) { entry.code = value; deferFoldSave(session.documentId); }
      status.textContent = ''; status.removeAttribute('title');
      session.onChange?.();
    },
    onFormatStateChange(pending) {
      const format = box.querySelector<HTMLButtonElement>('[data-format-code]')!;
      format.disabled = pending; format.setAttribute('aria-busy', String(pending));
      if (pending) { status.textContent = '格式化中…'; status.removeAttribute('title'); status.setAttribute('role', 'status'); }
      else if (status.textContent === '格式化中…') status.textContent = '';
    },
    onFormatError(message) {
      status.textContent = '无法格式化'; status.title = message; status.setAttribute('role', 'alert');
      session.onError?.(message);
    },
  });
  widget = { block, preview, code, editor }; return widget;
}

/** Stable local code editors and Mermaid previews; no remote renderers. */
export function enhanceEditor(root: HTMLElement, documentId: string, callbacks?: { onChange?: () => void; onError?: (message: string) => void }, preserveCodeEdits = false) {
  let session = codeSessions.get(root);
  if (session && session.documentId !== documentId) { disposeEditorCodeBlocks(root); session = undefined; }
  if (!session) { session = { documentId, widgets: new Map() }; codeSessions.set(root, session); }
  if (callbacks) { session.onChange = callbacks.onChange; session.onError = callbacks.onError; }
  if (preserveCodeEdits) decorateFolds(root, documentId);
  session.widgets.forEach((widget, block) => {
    if (!root.contains(block) || !block.contains(widget.preview) || !widget.preview.querySelector('.cm-editor')) {
      const replacement = preserveCodeEdits && [...root.querySelectorAll<HTMLElement>('[data-type="code-block"]')].find(candidate => candidate.dataset.foldId === block.dataset.foldId);
      const code = replacement && replacement.querySelector<HTMLElement>(':scope > pre.vditor-ir__marker--pre > code');
      if (replacement && code && !code.classList.contains('language-mermaid')) {
        replacement.querySelectorAll(':scope > .note-code-preview').forEach(preview => preview.remove());
        code.parentElement!.after(widget.preview);
        session!.widgets.delete(block);
        widget.block = replacement; widget.code = code;
        session!.widgets.set(replacement, widget);
        syncCodeSource(replacement, code, widget.editor.getValue());
        return;
      }
      widget.editor.destroy(); session!.widgets.delete(block);
    }
  });
  decorateInlineStyles(root);
  root.querySelectorAll<HTMLElement>('[data-type="code-block"]').forEach((block) => {
    const source = block.querySelector<HTMLElement>(':scope > pre.vditor-ir__marker--pre');
    const code = source?.querySelector('code');
    if (!source || !code) return;
    const text = code.textContent || '';
    const language = [...code.classList].find((name) => name.startsWith('language-'))?.replace(/^language-/, '') || 'plaintext';
    source.dataset.lineNumbers = text.replace(/\n$/, '').split('\n').map((_, index) => index + 1).join('\n');
    let preview = block.querySelector<HTMLElement>(':scope > .note-code-preview');
    const languageSelect = preview?.querySelector<HTMLSelectElement>('[data-code-language]');
    if (languageSelect) languageSelect.value = language;
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'vditor-ir__preview note-code-preview';
      preview.dataset.render = '1';
      preview.contentEditable = 'false';
      source.after(preview);
    }
    source.classList.add('vditor-ir__marker');
    block.querySelectorAll(':scope > pre.vditor-ir__preview').forEach(element => element.remove());
    if (language === 'mermaid') {
      const widget = session!.widgets.get(block);
      if (widget) { widget.editor.destroy(); session!.widgets.delete(block); }
      block.classList.remove('note-code-editable'); block.removeAttribute('contenteditable');
      if (preview.dataset.source !== text || preview.dataset.language !== language) preview.replaceChildren(createDiagramPreview(text, true));
    } else {
      block.classList.add('note-code-editable'); block.contentEditable = 'false';
      let widget = session!.widgets.get(block);
      if (!widget || widget.code !== code) {
        widget?.editor.destroy();
        widget = createCodeWidget(root, session!, block, preview, code, language);
        session!.widgets.set(block, widget);
      } else {
        widget.editor.setLanguage(language);
        widget.editor.setValue(text);
      }
    }
    preview.dataset.source = text; preview.dataset.language = language;
  });
  decorateFolds(root, documentId);
}

export async function renderReading(root: HTMLElement, markdown: string, documentId: string) {
  const html = await Vditor.md2html(markdown, {
    mode: 'light',
    cdn: EDITOR_ASSETS,
    markdown: MARKDOWN_OPTIONS,
    math: { engine: 'KaTeX', inlineDigit: true },
    emojiPath: `${EDITOR_ASSETS}/dist/images/emoji`,
  });
  root.innerHTML = html;
  root.querySelectorAll<HTMLElement>('pre > code').forEach(code => {
    const language = [...code.classList].find(name => name.startsWith('language-'))?.replace(/^language-/, '') || '';
    if (language !== 'mermaid') code.parentElement?.replaceWith(createCodeBox(code.textContent || '', language, false));
  });
  Vditor.highlightRender(HIGHLIGHT_OPTIONS, root, EDITOR_ASSETS);
  Vditor.mathRender(root, { cdn: EDITOR_ASSETS, math: { engine: 'KaTeX', inlineDigit: true } });
  root.querySelectorAll<HTMLElement>('.language-mermaid').forEach((element) => {
    element.replaceWith(createDiagramPreview(element.textContent || '', false));
  });
  decorateFolds(root, documentId);
  root.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.disabled = true; });
}
