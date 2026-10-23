const MARKER = '<span data-typepro-list="a"/>';
const MARKER_PATTERN = /^<span\s+data-typepro-list=(["'])a\1\s*\/>$/;
const MARKER_PREFIX = /^\s*<span\s+data-typepro-list=(["'])a\1\s*\/>\s*/;
const IR_MARKERS = '[data-type="html-inline"],[data-type="html-block"]';
const RAW_TEXT = 'pre,code,script,style,textarea,title,xmp,iframe,noembed,noframes,template';
let tokenSequence = 0;

function rawMarker(node) {
  return node.dataset.type === 'html-inline'
    ? node.querySelector(':scope > code')
    : node.querySelector(':scope > pre.vditor-ir__marker--pre > code[data-type="html-block"]');
}
function markers(root) {
  return [...root.querySelectorAll(IR_MARKERS)].filter(node =>
    !node.closest('[data-render]') && MARKER_PATTERN.test((rawMarker(node)?.textContent || '').trim()));
}
function items(list) { return [...list.children].filter(node => node.tagName === 'LI'); }
function ownMarkers(item) { return markers(item).filter(marker => marker.closest('li') === item); }
function createMarker(doc) {
  const node = doc.createElement('span'); node.dataset.type = 'html-inline';
  node.className = 'vditor-ir__node note-list-marker';
  const code = doc.createElement('code'); code.className = 'vditor-ir__marker'; code.textContent = MARKER;
  node.append(code); return node;
}
export function listKind(list) {
  if (list.tagName === 'UL') return 'bullet';
  return list.getAttribute('type') === 'a' || items(list).some(item => ownMarkers(item).length) ? 'alpha' : 'decimal';
}
export function clearListMarkers(root) { markers(root).forEach(node => node.remove()); }

/** Restore presentation from markers that survive Lute's native normalization and undo. */
export function decorateLists(root) {
  // Lute can combine a leading inline marker and a following raw HTML component.
  // Split only our reserved prefix, leaving the component and its existing nodes intact.
  for (const block of root.querySelectorAll('[data-type="html-block"][data-block]')) {
    if (block.closest('[data-render]') || block.closest('li')?.parentElement?.tagName !== 'OL') continue;
    const raw = rawMarker(block), source = raw?.textContent || '', prefix = MARKER_PREFIX.exec(source);
    if (!prefix || !source.slice(prefix[0].length).trim()) continue;
    if (raw.childNodes.length === 1 && raw.firstChild.nodeType === 3) raw.firstChild.deleteData(0, prefix[0].length);
    else raw.textContent = source.slice(prefix[0].length);
    block.before(createMarker(root.ownerDocument));
    block.querySelectorAll('[data-render] span[data-typepro-list="a"]').forEach(marker => marker.replaceWith(...marker.childNodes));
  }
  const selection = root.ownerDocument.defaultView?.getSelection();
  const caret = selection?.anchorNode && root.contains(selection.anchorNode) ? {
    anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focus: selection.focusNode, focusOffset: selection.focusOffset,
  } : null;
  let moved = false;
  for (const list of [...root.querySelectorAll('ol[data-block]')]) {
    if (list.closest('[data-render]')) continue;
    const children = items(list);
    const forced = list.getAttribute('type') === 'a';
    const groups = [];
    for (const item of children) {
      const alpha = forced || ownMarkers(item).length > 0;
      if (!groups.length || groups[groups.length - 1].alpha !== alpha) groups.push({ alpha, items: [] });
      groups[groups.length - 1].items.push(item);
    }
    if (!groups.length) continue;
    const lists = groups.length === 1 ? [list] : groups.map(group => {
      const part = list.cloneNode(false);
      const start = Number.parseInt(group.items[0].getAttribute('data-marker') || '', 10) || 1;
      part.setAttribute('start', String(start)); part.setAttribute('data-marker', `${start}.`);
      list.before(part); return part;
    });
    if (groups.length > 1) {
      let index = 0;
      for (const child of [...list.childNodes]) {
        if (child.nodeType === 1 && child.tagName === 'LI') index = groups.findIndex(group => group.items.includes(child));
        lists[index].append(child);
      }
      list.remove(); moved = true;
    }
    groups.forEach((group, index) => {
      const part = lists[index];
      if (group.alpha) part.setAttribute('type', 'a');
      else if (part.getAttribute('type') === 'a') part.removeAttribute('type');
      for (const item of group.items) {
        const existing = ownMarkers(item);
        if (!group.alpha) { existing.forEach(node => node.remove()); continue; }
        let marker = existing.shift(); existing.forEach(node => node.remove());
        if (!marker || marker.dataset.type !== 'html-inline') {
          const replacement = createMarker(root.ownerDocument);
          if (marker) marker.replaceWith(replacement);
          marker = replacement;
        }
        marker.classList.add('note-list-marker');
        if (item.firstChild !== marker) { item.prepend(marker); moved = true; }
      }
    });
  }
  // Metadata is meaningful only while it belongs to an ordered list item.
  markers(root).filter(marker => marker.closest('li')?.parentElement?.tagName !== 'OL').forEach(marker => marker.remove());
  if (moved && caret?.anchor.isConnected && caret.focus?.isConnected) {
    selection.setBaseAndExtent(caret.anchor, caret.anchorOffset, caret.focus, caret.focusOffset);
  }
}

function fragment(doc, html) {
  const template = doc.createElement('template'); template.innerHTML = html; return template.content;
}
function alphaLists(root) {
  return [...root.querySelectorAll('ol[type="a"]')].filter(list => !list.closest(RAW_TEXT));
}
function token(source, prefix) {
  let value;
  do { value = prefix + (++tokenSequence) + 'END'; } while (source.includes(value));
  return value;
}
function visibleTextNode(root, value) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.includes(value) && !node.parentElement?.closest('[data-render]')) return node;
  }
  return null;
}
function replaceToken(root, value, replacement, block = false) {
  const text = visibleTextNode(root, value);
  if (!text) return false;
  const paragraph = text.parentElement?.closest('p[data-block]');
  if (block && paragraph?.textContent.trim() === value) paragraph.replaceWith(replacement);
  else {
    const selected = text.splitText(text.textContent.indexOf(value)); selected.splitText(value.length);
    selected.replaceWith(replacement);
  }
  return true;
}
function protectedHtml(node) {
  if (/^(OL|UL|LI)$/.test(node.tagName)) return false;
  if (node.hasAttribute('style') || node.tagName === 'FONT') return true;
  if (node.tagName === 'IMG') return [...node.attributes].some(attribute => !['src', 'alt', 'title'].includes(attribute.name));
  if (/^(DIV|SPAN)$/.test(node.tagName)) return node.className !== 'language-math' || [...node.attributes].some(attribute => attribute.name !== 'class');
  if (node.tagName === 'CODE' && node.hasAttribute('class') && !/^language-[^\s]+$/.test(node.className)) return true;
  const nativeAttributes = node.tagName === 'A' ? ['href', 'title'] : node.tagName === 'CODE' ? ['class'] : /^(TD|TH)$/.test(node.tagName) ? ['align'] : [];
  if ([...node.attributes].some(attribute => !nativeAttributes.includes(attribute.name))) return true;
  return !/^(OL|UL|LI|P|BR|STRONG|B|EM|I|S|DEL|CODE|PRE|BLOCKQUOTE|HR|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|A)$/.test(node.tagName);
}
function protectedIR(doc, html, block, lute) {
  const ir = fragment(doc, lute.Md2VditorIRDOM(html));
  if (!block && ir.childNodes.length === 1) {
    const first = ir.firstElementChild;
    if (first?.tagName === 'P') first.replaceWith(...first.childNodes);
    else if (first?.dataset.type === 'html-block') {
      const inline = createMarker(doc); inline.classList.remove('note-list-marker');
      rawMarker(inline).textContent = html; first.replaceWith(inline);
    }
  }
  return ir;
}

/** Decode only list-shaped HTML; custom wrappers remain ordinary HTML components. */
export function hydrateListHtml(root, lute) {
  for (const block of [...root.querySelectorAll('[data-type="html-block"][data-block]')]) {
    if (!root.contains(block) || block.closest('[data-render]')) continue;
    const source = rawMarker(block)?.textContent || '';
    if (!/\bol\b/i.test(source)) continue;
    const html = fragment(root.ownerDocument, source);
    const top = [...html.childNodes].filter(node => node.nodeType !== 3 || node.textContent.trim());
    if (!top.length || top.some(node => node.nodeType !== 1 || !/^(OL|UL)$/.test(node.tagName))) continue;
    if (!alphaLists(html).length) continue;
    // List container attributes outside our interchange contract must not be silently lost.
    if ([...html.querySelectorAll('ol,ul,li')].some(node => [...node.attributes].some(attribute =>
      node.tagName !== 'OL' || !['type', 'start'].includes(attribute.name)
      || attribute.name === 'type' && !['a', '1'].includes(attribute.value)
      || attribute.name === 'start' && !/^[1-9]\d*$/.test(attribute.value)))) continue;
    const replacements = [];
    const protectedNodes = [];
    for (const node of [...html.querySelectorAll('*')]) {
      if (node.closest(RAW_TEXT) && !/^(PRE|CODE)$/.test(node.tagName)) continue;
      if (protectedNodes.some(parent => parent.contains(node)) || !protectedHtml(node)) continue;
      protectedNodes.push(node);
      const value = token(source, 'TYPEPROLISTHTML');
      const isBlock = /^(P|H[1-6]|DIV|SECTION|ARTICLE|ASIDE|DETAILS|FIGURE|VIDEO|AUDIO|IFRAME|SCRIPT|STYLE|PRE|BLOCKQUOTE|TABLE|HR)$/.test(node.tagName);
      replacements.push({ value, html: node.outerHTML, block: isBlock });
      const placeholder = root.ownerDocument.createTextNode(value);
      if (isBlock) { const paragraph = root.ownerDocument.createElement('p'); paragraph.append(placeholder); node.replaceWith(paragraph); }
      else node.replaceWith(placeholder);
    }
    const alpha = alphaLists(html);
    if (!alpha.length) continue;
    const alphaTokens = [];
    for (const list of alpha) for (const item of items(list)) {
      const value = token(source, 'TYPEPROLISTALPHA'); alphaTokens.push(value);
      item.prepend(root.ownerDocument.createTextNode(value));
    }
    const container = root.ownerDocument.createElement('div'); container.append(html);
    const ir = root.ownerDocument.createElement('div');
    ir.innerHTML = lute.HTML2VditorIRDOM(container.innerHTML);
    let valid = true;
    for (const value of alphaTokens) {
      const text = visibleTextNode(ir, value), item = text?.parentElement?.closest('li');
      if (!item) { valid = false; break; }
      replaceToken(ir, value, root.ownerDocument.createTextNode(''));
      item.prepend(createMarker(root.ownerDocument));
    }
    if (!valid) continue;
    for (const replacement of replacements) {
      if (!replaceToken(ir, replacement.value, protectedIR(root.ownerDocument, replacement.html, replacement.block, lute), replacement.block)) { valid = false; break; }
    }
    if (!valid) continue;
    decorateLists(ir);
    block.replaceWith(...ir.childNodes);
  }
}

/** Called on the serialization clone, after runtime code/image/style decorations are removed. */
export function serializeListHtml(root, lute) {
  decorateLists(root);
  const outer = [...root.querySelectorAll('ol[data-block],ul[data-block]')].filter(list =>
    !list.parentElement?.closest('ol,ul') && !list.closest('[data-render]'));
  for (const list of outer) {
    if (![list, ...list.querySelectorAll('ol[data-block]')].some(node => node.tagName === 'OL' && listKind(node) === 'alpha')) continue;
    // Render nested lists first so Lute cannot merge adjacent alpha/decimal groups.
    for (const nested of [...list.querySelectorAll('ol[data-block],ul[data-block]')].reverse()) replaceWithListHtml(nested, lute);
    replaceWithListHtml(list, lute);
  }
  clearListMarkers(root);
}

function replaceWithListHtml(list, lute) {
  // A real closing tag keeps the temporary HTML marker empty in the browser parser.
  for (const marker of markers(list)) rawMarker(marker).textContent = '<span data-typepro-list="a"></span>';
  const html = fragment(list.ownerDocument, lute.VditorIRDOM2HTML(list.outerHTML));
  for (const marker of html.querySelectorAll('span[data-typepro-list="a"]')) {
    const owner = marker.closest('li')?.parentElement;
    if (owner?.tagName === 'OL') owner.setAttribute('type', 'a');
    marker.remove();
  }
  const container = list.ownerDocument.createElement('div'); container.append(html);
  list.replaceWith(fragment(list.ownerDocument, lute.Md2VditorIRDOM(container.innerHTML.trim())));
}
