interface MermaidEngine {
  initialize(options: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
  parse(source: string): Promise<unknown>;
}

let runtime: Promise<MermaidEngine> | undefined;
let renderQueue: Promise<boolean> = Promise.resolve(false);
let serial = 0;
const requests = new WeakMap<HTMLElement, object>();

function mermaidRuntime(): Promise<MermaidEngine> {
  if (!runtime) {
    runtime = new Promise((resolve, reject) => {
      const existing = (window as unknown as { mermaid?: MermaidEngine }).mermaid;
      if (existing?.render) { resolve(existing); return; }
      const script = document.createElement('script');
      script.src = '/vendor/vditor/dist/js/mermaid/mermaid.min.js';
      script.async = true;
      script.onload = () => {
        const engine = (window as unknown as { mermaid?: MermaidEngine }).mermaid;
        if (engine?.render) resolve(engine);
        else { script.remove(); runtime = undefined; reject(new Error('流程图组件加载失败')); }
      };
      script.onerror = () => {
        script.remove(); runtime = undefined;
        reject(new Error('流程图组件加载失败，请重试'));
      };
      document.head.append(script);
    });
  }
  return runtime;
}

export async function validateFlowSource(source: string): Promise<void> {
  const engine = await mermaidRuntime();
  await engine.parse(source);
}

/** Mermaid's strict renderer is followed by a local SVG-only boundary. */
export function sanitizeFlowSVG(markup: string): SVGElement {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg' || parsed.querySelector('parsererror')) throw new Error('图形生成失败');
  svg.querySelectorAll('script,foreignObject,iframe,object,embed,image,animate,animateMotion,animateTransform,set').forEach((element) => element.remove());
  svg.querySelectorAll('*').forEach((element) => {
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg') element.remove();
  });
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !value.startsWith('#'))) element.removeAttribute(attribute.name);
      else if (/url\(|\\|@import/i.test(value)) element.setAttribute(attribute.name, safeCSS(value));
    }
  }
  svg.querySelectorAll('a').forEach((link) => link.replaceWith(...link.childNodes));
  svg.querySelectorAll('style').forEach((style) => {
    style.textContent = safeCSS(style.textContent || '');
  });
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '流程图');
  return document.importNode(svg, true) as unknown as SVGElement;
}

function safeCSS(value: string): string {
  // Mermaid's generated rules do not require escaped CSS. Reject escapes so an
  // encoded url()/@import cannot cross the resource boundary.
  if (value.includes('\\')) return '';
  return value.replace(/@import[^;]*;?/gi, '').replace(/url\(([^)]*)\)/gi, (_, reference: string) => {
    const target = reference.trim().replace(/^(["'])(.*)\1$/, '$2');
    return /^#[\w:-]+$/.test(target) ? `url(${target})` : 'none';
  });
}

export function cancelFlowPreview(container: HTMLElement) {
  requests.delete(container);
}

/** Serialize global Mermaid renders and discard stale results for each container. */
export function renderFlowPreview(container: HTMLElement, source: string): Promise<boolean> {
  const request = {};
  requests.set(container, request);
  container.dataset.diagramSource = source;
  if (!source.trim()) {
    container.textContent = '输入 Mermaid 语法';
    container.removeAttribute('aria-busy');
    container.classList.remove('flow-preview-error');
    return Promise.resolve(false);
  }
  container.setAttribute('aria-busy', 'true');
  const task = async (): Promise<boolean> => {
    let id: string | undefined;
    const current = () => requests.get(container) === request && container.isConnected;
    try {
      if (!current()) return false;
      const engine = await mermaidRuntime();
      if (!current()) return false;
      id = `typeproflow${++serial}`;
      const styles = getComputedStyle(document.documentElement);
      const color = (name: string) => styles.getPropertyValue(name).trim();
      engine.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base',
        themeVariables: {
          primaryColor: color('--accent-wash'), primaryBorderColor: color('--accent-ring'),
          primaryTextColor: color('--text'), lineColor: color('--muted'),
          edgeLabelBackground: color('--bg'), background: color('--bg'),
        },
        fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif',
        htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true },
        secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels', 'themeCSS', 'themeVariables', 'theme', 'fontFamily', 'flowchart'],
        maxTextSize: 60000, maxEdges: 1000,
      });
      const result = await engine.render(id, source);
      if (!current()) return false;
      container.replaceChildren(sanitizeFlowSVG(result.svg));
      container.classList.remove('flow-preview-error');
      return true;
    } catch (error) {
      if (!current()) return false;
      container.classList.add('flow-preview-error');
      const message = error instanceof Error ? error.message : String(error);
      container.textContent = `暂时无法预览：${message.split('\n').slice(0, 3).join('\n')}`;
      return false;
    } finally {
      if (current()) container.removeAttribute('aria-busy');
      if (id) document.getElementById(`d${id}`)?.remove();
    }
  };
  renderQueue = renderQueue.then(task, task);
  return renderQueue;
}
