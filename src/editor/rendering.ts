import Vditor from 'vditor';

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

interface MermaidEngine {
  initialize(options: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

let mermaidPromise: Promise<MermaidEngine> | undefined;
let diagramNumber = 0;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = new Promise<MermaidEngine>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${EDITOR_ASSETS}/dist/js/mermaid/mermaid.min.js`;
      script.onload = () => {
        const engine = (window as unknown as { mermaid: MermaidEngine }).mermaid;
        engine.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'neutral',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          maxTextSize: 100_000,
          maxEdges: 1_000,
        });
        resolve(engine);
      };
      script.onerror = () => {
        script.remove();
        mermaidPromise = undefined;
        reject(new Error('图表组件加载失败'));
      };
      document.head.appendChild(script);
    });
  }
  return mermaidPromise;
}

async function renderDiagram(element: HTMLElement, source: string) {
  element.dataset.diagramSource = source;
  try {
    const mermaid = await getMermaid();
    const result = await mermaid.render(`noteDiagram${++diagramNumber}`, source);
    if (!element.isConnected || element.dataset.diagramSource !== source) return;
    element.innerHTML = result.svg;
    element.classList.remove('note-diagram-error');
  } catch (error) {
    if (!element.isConnected || element.dataset.diagramSource !== source) return;
    element.textContent = '图表语法有误';
    element.title = error instanceof Error ? error.message : String(error);
    element.classList.add('note-diagram-error');
  }
}

/** Serialize a clone so resolved image URLs can never escape into stored Markdown. */
export function snapshotMarkdown(editor: Vditor) {
  if (!editor.vditor.ir!.element.querySelector('img[data-note-asset]')) return editor.getValue();
  const clone = editor.vditor.ir!.element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLImageElement>('img[data-note-asset]').forEach((image) => {
    image.setAttribute('src', image.dataset.noteAsset!);
    image.removeAttribute('data-note-asset');
  });
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
export function enhanceEditor(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-type="code-block"]').forEach((block) => {
    const source = block.querySelector<HTMLElement>(':scope > pre.vditor-ir__marker--pre');
    const code = source?.querySelector('code');
    if (!source || !code) return;
    const text = code.textContent || '';
    const language = [...code.classList].find((name) => name.startsWith('language-')) || '';
    let preview = block.querySelector<HTMLElement>(':scope > .note-code-preview');
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
      preview.classList.add('note-diagram');
      void renderDiagram(preview, text);
    } else {
      preview.classList.remove('note-diagram');
      const pre = document.createElement('pre');
      const displayCode = document.createElement('code');
      displayCode.className = language;
      displayCode.textContent = text;
      pre.append(displayCode);
      preview.append(pre);
      Vditor.highlightRender(HIGHLIGHT_OPTIONS, preview, EDITOR_ASSETS);
    }
  });
}

export async function renderReading(root: HTMLElement, markdown: string) {
  const html = await Vditor.md2html(markdown, {
    mode: 'light',
    cdn: EDITOR_ASSETS,
    markdown: MARKDOWN_OPTIONS,
    math: { engine: 'KaTeX', inlineDigit: true },
    emojiPath: `${EDITOR_ASSETS}/dist/images/emoji`,
  });
  root.innerHTML = html;
  Vditor.highlightRender(HIGHLIGHT_OPTIONS, root, EDITOR_ASSETS);
  Vditor.mathRender(root, { cdn: EDITOR_ASSETS, math: { engine: 'KaTeX', inlineDigit: true } });
  root.querySelectorAll<HTMLElement>('.language-mermaid').forEach((element) => {
    element.classList.add('note-diagram');
    void renderDiagram(element, element.textContent || '');
  });
  root.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.disabled = true; });
}
