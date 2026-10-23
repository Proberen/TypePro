function attribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
}

export function constrainImageWidth(width: number, maximum: number) {
  return Math.max(1, Math.round(Math.min(Math.max(24, width), Math.max(1, maximum))));
}

export function imageWidthMarkup(image: { src: string; alt: string; title?: string }, width: number) {
  return `<img src="${attribute(image.src)}" alt="${attribute(image.alt)}"${image.title === undefined ? '' : ` title="${attribute(image.title)}"`} width="${Math.max(1, Math.round(width))}">`;
}

interface ImageTag { start: number; end: number; value: string }
/** Locate actual image tags, without mistaking quoted '>', comments or raw text for markup. */
export function htmlImageTags(source: string): ImageTag[] {
  const tags: ImageTag[] = [];
  let cursor = 0, templateDepth = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const close = source.indexOf('-->', start + 4); cursor = close < 0 ? source.length : close + 3; continue;
    }
    const name = /^<\s*(\/?)([a-z][\w:-]*)\b/i.exec(source.slice(start));
    let quote = '', end = start + 1;
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') { end++; break; }
    }
    if (end > source.length || source[end - 1] !== '>') break;
    cursor = end;
    const tagName = name?.[2].toLowerCase(), closing = name?.[1] === '/';
    if (tagName === 'template') templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1));
    if (!closing && !templateDepth && tagName === 'img') tags.push({ start, end, value: source.slice(start, end) });
    if (!closing && tagName && /^(script|style|textarea|title|xmp|iframe|noembed|noframes)$/.test(tagName)) {
      const close = new RegExp(`</${tagName}\\s*>`, 'ig'); close.lastIndex = end;
      const match = close.exec(source); cursor = match ? close.lastIndex : source.length;
    }
  }
  return tags;
}

/** Change only the selected tag; all surrounding HTML remains byte-for-byte intact. */
export function replaceHtmlImageWidth(source: string, index: number, width: number) {
  const selected = htmlImageTags(source)[index];
  if (!selected || !Number.isFinite(width) || width <= 0) return null;
  const tag = selected.value;
  const attributes = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let resized = tag.replace(attributes, (whole, name: string, double: string | undefined, single: string | undefined, bare: string | undefined) => {
    if (/^(width|height)$/i.test(name)) return '';
    if (name.toLowerCase() !== 'style') return whole;
    const style = (double ?? single ?? bare ?? '').split(';').filter(part => !/^\s*(?:(?:min|max)-)?(?:width|height)\s*:/i.test(part)).join(';').trim();
    return style ? ` style="${style.replace(/"/g, '&quot;')}"` : '';
  });
  resized = resized.replace(/\s*\/?\s*>$/, ` width="${Math.max(1, Math.round(width))}">`);
  return source.slice(0, selected.start) + resized + source.slice(selected.end);
}

function sourceCode(container: HTMLElement) {
  return container.dataset.type === 'html-inline'
    ? container.querySelector<HTMLElement>(':scope > code.vditor-ir__marker')
    : container.querySelector<HTMLElement>(':scope > pre.vditor-ir__marker--pre > code[data-type="html-block"]');
}

function copyImage(tag: string) {
  const template = document.createElement('template'); template.innerHTML = tag;
  const source = template.content.querySelector('img');
  if (!source) return null;
  const image = document.createElement('img');
  // Copy only inert presentation attributes; never execute handlers from raw HTML markers.
  for (const name of ['src', 'alt', 'title', 'width', 'height']) {
    const value = source.getAttribute(name); if (value !== null) image.setAttribute(name, value);
  }
  image.draggable = false;
  return image;
}

export function isStandaloneImageHtml(source: string) {
  const tags = htmlImageTags(source);
  return tags.length === 1 && source.trim() === tags[0].value;
}

/** HTML inline image markers need an inert visible preview in Vditor IR. */
export function decorateResizableImages(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-type="html-inline"],[data-type="html-block"]').forEach(container => {
    const source = sourceCode(container)?.textContent || '';
    const standalone = isStandaloneImageHtml(source);
    if (container.dataset.type === 'html-block') { container.classList.toggle('note-image-block', standalone); return; }
    if (!standalone) return;
    container.classList.add('note-image-inline');
    const existing = container.querySelector<HTMLElement>(':scope > .note-image-preview');
    if (existing?.dataset.imageSource === source) return;
    const image = copyImage(source.trim()); if (!image) return;
    const preview = document.createElement('span'); preview.className = 'note-image-preview';
    preview.setAttribute('contenteditable', 'false'); preview.dataset.render = '1'; preview.dataset.imageSource = source;
    preview.append(image); existing?.remove(); container.append(preview);
  });
}

function canonicalSource(image: HTMLImageElement) {
  return image.dataset.noteAsset || image.getAttribute('src') || '';
}

function markdownTitle(container: HTMLElement, image: HTMLImageElement) {
  const title = container.querySelector('.vditor-ir__marker--title')?.textContent?.trim();
  if (!title) return image.getAttribute('title') ?? undefined;
  return title.slice(1, -1).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

/** Update canonical IR, inside the caller's single undoable document transaction. */
export function persistImageWidth(image: HTMLImageElement, width: number) {
  if (!Number.isFinite(width) || width <= 0) return false;
  const markdown = image.closest<HTMLElement>('[data-type="img"]');
  if (markdown && markdown.querySelector(':scope > img') === image) {
    const html = document.createElement('span'); html.dataset.type = 'html-inline'; html.className = 'vditor-ir__node';
    const code = document.createElement('code'); code.className = 'vditor-ir__marker';
    code.textContent = imageWidthMarkup({ src: canonicalSource(image), alt: image.alt, title: markdownTitle(markdown, image) }, width);
    html.append(code); markdown.replaceWith(html); return true;
  }
  const container = image.closest<HTMLElement>('[data-type="html-inline"],[data-type="html-block"]');
  const code = container && sourceCode(container);
  if (!container || !code) return false;
  const tags = htmlImageTags(code.textContent || '');
  const matchesImage = (candidate: HTMLImageElement) => canonicalSource(candidate) === canonicalSource(image) && candidate.alt === image.alt && candidate.getAttribute('title') === image.getAttribute('title');
  const preview = container.querySelector('.note-image-preview,.vditor-ir__preview');
  const images = [...preview?.querySelectorAll<HTMLImageElement>('img') || []].filter(matchesImage);
  const occurrence = images.indexOf(image);
  const candidates = tags.map((tag, index) => ({ index, image: copyImage(tag.value) })).filter(item => item.image && matchesImage(item.image));
  const index = candidates[occurrence]?.index;
  if (index === undefined) return false;
  const source = replaceHtmlImageWidth(code.textContent || '', index, width);
  if (source === null) return false;
  code.textContent = source;
  if (container.dataset.type === 'html-block') {
    image.setAttribute('width', String(Math.round(width))); image.removeAttribute('height');
    for (const key of ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']) image.style.removeProperty(key);
  }
  else container.querySelector('.note-image-preview')?.remove();
  return true;
}

/** Runtime preview images must not enter Markdown or native document history. */
export function stripImageResizeDecorations(root: HTMLElement) {
  root.querySelectorAll('.note-image-preview').forEach(preview => preview.remove());
  root.querySelectorAll('.note-image-inline').forEach(node => node.classList.remove('note-image-inline'));
  root.querySelectorAll('.note-image-block').forEach(node => node.classList.remove('note-image-block'));
}
