import Vditor from 'vditor';
import { renderFlowPreview } from '../flow/preview';
import { decorateInlineStyles } from './formatting';
import { loadFolds, reconcileFolds, saveFolds, type FoldEntry } from './folding';

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
  header.append(select, copy);
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
      const lines = document.createElement('span'); lines.className = 'note-code-lines'; lines.textContent = `${entry.code.replace(/\n$/, '').split('\n').length} 行`;
      header.prepend(button); header.querySelector('select')?.after(lines);
    }
    applyFold(block, entry.collapsed);
  });
  if (JSON.stringify(entries) !== JSON.stringify(previous)) {
    try { saveFolds(documentId, entries); } catch { /* Explicit toggles report persistence failures. */ }
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
  if (!editor.vditor.ir!.element.querySelector('img[data-note-asset],.note-inline-style')) return editor.getValue();
  const clone = editor.vditor.ir!.element.cloneNode(true) as HTMLElement;
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

/** Opt into only local code highlighting and Mermaid; Vditor's network renderers stay off. */
export function enhanceEditor(root: HTMLElement, documentId: string) {
  decorateInlineStyles(root);
  root.querySelectorAll<HTMLElement>('[data-type="code-block"]').forEach((block) => {
    const source = block.querySelector<HTMLElement>(':scope > pre.vditor-ir__marker--pre');
    const code = source?.querySelector('code');
    if (!source || !code) return;
    const text = code.textContent || '';
    const language = [...code.classList].find((name) => name.startsWith('language-')) || '';
    source.dataset.lineNumbers = text.replace(/\n$/, '').split('\n').map((_, index) => index + 1).join('\n');
    let preview = block.querySelector<HTMLElement>(':scope > .note-code-preview');
    const languageSelect = preview?.querySelector<HTMLSelectElement>('[data-code-language]');
    if (languageSelect) languageSelect.value = language.replace(/^language-/, '') || 'plaintext';
    if (preview?.dataset.source === text && preview.dataset.language === language) return;
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'vditor-ir__preview note-code-preview';
      preview.dataset.render = '1';
      preview.contentEditable = 'false';
      source.after(preview);
    }
    source.classList.add('vditor-ir__marker');
    preview.dataset.source = text;
    preview.dataset.language = language;
    preview.replaceChildren();
    if (language === 'language-mermaid') {
      preview.append(createDiagramPreview(text, true));
    } else {
      preview.classList.remove('note-diagram');
      preview.append(createCodeBox(text, language.replace(/^language-/, ''), true));
      Vditor.highlightRender(HIGHLIGHT_OPTIONS, preview, EDITOR_ASSETS);
    }
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
