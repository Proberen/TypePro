export function tableMarkdown(rows: number, columns: number) {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 100 || columns < 1 || columns > 30) throw new Error('行数为 1–100，列数为 1–30');
  const row = '| ' + Array(columns).fill(' ').join(' | ') + ' |\n';
  return row + '| ' + Array(columns).fill('---').join(' | ') + ' |\n' + row.repeat(rows - 1) + '\n';
}
export function safeTextStyle(raw: string) {
  const result: Record<string, string> = {};
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
    if (key === 'color' && /^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\)|[a-z]{1,25})$/i.test(value)) result.color = value;
    if (key === 'font-family' && value.length <= 150 && /^[\w\s,\-"'\u4e00-\u9fff]+$/.test(value)) result['font-family'] = value;
  }
  return Object.entries(result).map(([key, value]) => `${key}:${value}`).join(';');
}
export function styledMarkdown(text: string, style: string) {
  const safe = safeTextStyle(style).replace(/"/g, '&quot;');
  return safe ? `<span style="${safe}">${text}</span>` : text;
}
/** IR retains literal HTML markers. This visual-only wrapper is ignored by serialization. */
export function decorateInlineStyles(root: HTMLElement) {
  const starts = [...root.querySelectorAll<HTMLElement>('[data-type="html-inline"]')].reverse();
  for (const start of starts) {
    const raw = start.textContent || '';
    const match = raw.match(/^<span\s+style=(?:"([^"]*)"|'([^']*)')\s*>$/i);
    const style = match && safeTextStyle(match[1] || match[2]);
    if (!style) continue;
    let sibling = start.nextSibling, depth = 0, end: Node | null = null;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.dataset.type === 'html-inline') {
        const marker = sibling.textContent || '';
        if (/^<span(?:\s|>)/i.test(marker)) depth++;
        if (/^<\/span\s*>$/i.test(marker)) { if (!depth) { end = sibling; break; } depth--; }
      }
      sibling = sibling.nextSibling;
    }
    if (!end) continue;
    start.classList.add('note-style-marker');
    if (end instanceof HTMLElement) end.classList.add('note-style-marker');
    const existing = start.nextSibling;
    if (existing instanceof HTMLElement && existing.classList.contains('note-inline-style') && existing.nextSibling === end) {
      if (existing.getAttribute('style') !== style) existing.setAttribute('style', style);
      continue;
    }
    const range = document.createRange(); range.setStartAfter(start); range.setEndBefore(end);
    const span = document.createElement('span'); span.className = 'note-inline-style'; span.setAttribute('style', style);
    span.append(range.extractContents()); range.insertNode(span);
  }
}

/** Wrap text segments independently so formatting never joins adjacent document blocks. */
export function applySelectedTextStyle(root: HTMLElement, range: Range, style: string) {
  const safe = safeTextStyle(style);
  if (!safe || range.collapsed || !root.contains(range.commonAncestorContainer)) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement?.closest('[data-render],.vditor-ir__preview,.vditor-ir__marker:not(pre),[data-type="code-block"],pre:not(.vditor-reset),code') || !range.intersectsNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  const segments: { node: Text; start: number; end: number }[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end > start) segments.push({ node, start, end });
  }
  function marker(text: string) {
    const span = document.createElement('span'); span.dataset.type = 'html-inline'; span.className = 'vditor-ir__node';
    const code = document.createElement('code'); code.className = 'vditor-ir__marker'; code.textContent = text; span.append(code); return span;
  }
  for (const { node, start, end } of segments.reverse()) {
    const segment = document.createRange(); segment.setStart(node, start); segment.setEnd(node, end);
    const content = segment.extractContents();
    const fragment = document.createDocumentFragment(); fragment.append(marker(`<span style="${safe.replace(/"/g, '&quot;')}">`), content, marker('</span>'));
    segment.insertNode(fragment);
  }
  return segments.length > 0;
}

interface MarkdownEngine { HTML2Md: (html: string) => string; VditorIRDOM2Md: (html: string) => string }
/** Clear uses visible HTML so stale IR data-type wrappers cannot reapply formatting. */
export function visibleBlockMarkdown(block: HTMLElement, lute: MarkdownEngine, selection?: Range) {
  const clone = block.cloneNode(true) as HTMLElement;
  const selected: { node: Text; start: number; end: number }[] = [];
  if (selection) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      return node.parentElement?.closest('[data-render],.vditor-ir__preview,.vditor-ir__marker:not(pre),[data-type="code-block"],pre:not(.vditor-reset)') || !selection.intersectsNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const start = node === selection.startContainer ? selection.startOffset : 0;
      const end = node === selection.endContainer ? selection.endOffset : node.length;
      if (end <= start) continue;
      const path: number[] = [];
      let original: Node = node;
      while (original !== block) {
        const parent = original.parentNode!;
        path.unshift([...parent.childNodes].indexOf(original as ChildNode)); original = parent;
      }
      let copy: Node = clone;
      for (const index of path) copy = copy.childNodes[index];
      selected.push({ node: copy as Text, start, end });
    }
  }
  const replacements: [string, string][] = [];
  function preserve(element: Element, markdown: string) {
    const token = `TYPEPROINLINE${crypto.randomUUID().replace(/-/g, '')}END`;
    element.replaceWith(document.createTextNode(token)); replacements.push([token, markdown]);
  }
  clone.querySelectorAll('[data-type="inline-node"],[data-type="math-block"][data-block]').forEach(node => preserve(node, lute.VditorIRDOM2Md(node.outerHTML).trim()));
  clone.querySelectorAll<HTMLElement>('[data-type="code-block"]').forEach(node => {
    const pre = node.querySelector(':scope > pre'); if (pre) node.replaceWith(pre);
  });
  clone.querySelectorAll<HTMLElement>('[data-type="a"]').forEach(node => {
    const label = node.querySelector('.vditor-ir__link'), url = node.querySelector('.vditor-ir__marker--link');
    if (!label || !url) return;
    const link = document.createElement('a'); link.setAttribute('href', url.textContent || ''); link.append(...label.childNodes); node.replaceWith(link);
  });
  clone.querySelectorAll<HTMLImageElement>('img[data-note-asset]').forEach(image => image.setAttribute('src', image.dataset.noteAsset!));
  clone.querySelectorAll('[data-render],.vditor-ir__preview,.vditor-ir__marker:not(pre),[data-type="html-inline"],wbr').forEach(node => node.remove());
  clone.querySelectorAll<HTMLElement>('span').forEach(span => { if (!safeTextStyle(span.getAttribute('style') || '')) span.replaceWith(...span.childNodes); });
  for (const { node, start, end } of selected.reverse()) {
    if (!clone.contains(node)) continue;
    node.splitText(end);
    let unit: Node = node.splitText(start);
    let parent = unit.parentElement;
    while (parent && parent !== clone && /^(SPAN|STRONG|B|EM|I|S|DEL|MARK|SUB|SUP|CODE|FONT|A|U)$/.test(parent.tagName)) {
      const before = parent.cloneNode(false) as HTMLElement, after = parent.cloneNode(false) as HTMLElement;
      while (parent.firstChild && parent.firstChild !== unit) before.append(parent.firstChild);
      while (unit.nextSibling) after.append(unit.nextSibling);
      let cleared = unit;
      if (parent.tagName === 'A') {
        const link = parent.cloneNode(false) as HTMLElement;
        link.removeAttribute('style'); link.removeAttribute('class'); link.append(unit); cleared = link;
      }
      const meaningful = (element: HTMLElement) => !!element.textContent || !!element.querySelector('img,br,input');
      parent.replaceWith(...(meaningful(before) ? [before] : []), cleared, ...(meaningful(after) ? [after] : []));
      unit = cleared; parent = unit.parentElement;
    }
  }
  [...clone.querySelectorAll<HTMLElement>('span[style],font')].reverse().forEach(span => {
    const style = safeTextStyle(span.getAttribute('style') || '') || safeTextStyle(`font-family:${span.getAttribute('face') || ''};color:${span.getAttribute('color') || ''}`);
    if (style) preserve(span, `<span style="${style.replace(/"/g, '&quot;')}">${span.innerHTML}</span>`);
  });
  let markdown = lute.HTML2Md(clone.outerHTML);
  for (const [token, value] of replacements.reverse()) markdown = markdown.split(token).join(value);
  return markdown;
}
