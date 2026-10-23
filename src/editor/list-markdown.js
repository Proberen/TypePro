const IR_MARKERS = '[data-type="html-inline"],[data-type="html-block"]';
const RAW_TEXT = 'pre,code,script,style,textarea,title,xmp,iframe,noembed,noframes,template';
const INDENT = 'data-typepro-indent';
const MAX_INDENT = 32;
let tokenSequence = 0;

function indentValue(value) { return /^(0|[1-9]\d*)$/.test(String(value)) && Number(value) <= MAX_INDENT ? Number(value) : null; }
function metadata(source, prefix = false) {
  const match = /^\s*<span\s+([^<>]*?)\s*\/>\s*/.exec(source);
  if (!match || !prefix && match[0].length !== source.length) return null;
  const attributes = new Map();
  const rest = match[1].replace(/(data-typepro-(?:list|indent|target))=(["'])(.*?)\2/g, (_, name, quote, value) => {
    if (attributes.has(name)) return 'duplicate'; attributes.set(name, value); return '';
  });
  if (rest.trim() || !attributes.size) return null;
  const alpha = attributes.get('data-typepro-list'), indent = attributes.has(INDENT) ? indentValue(attributes.get(INDENT)) : 0;
  const paragraph = attributes.get('data-typepro-target');
  if (alpha !== undefined && alpha !== 'a' || indent === null || paragraph !== undefined && paragraph !== 'p'
    || paragraph && (alpha || !indent) || !alpha && !indent) return null;
  return { alpha: alpha === 'a', indent, paragraph: paragraph === 'p', length: match[0].length };
}
function markerSource(value) {
  return `<span${value.alpha ? ' data-typepro-list="a"' : ''}${value.indent ? ` ${INDENT}="${value.indent}"` : ''}${value.paragraph ? ' data-typepro-target="p"' : ''}/>`;
}

function rawMarker(node) {
  return node.dataset.type === 'html-inline'
    ? node.querySelector(':scope > code')
    : node.querySelector(':scope > pre.vditor-ir__marker--pre > code[data-type="html-block"]');
}
function markers(root) {
  return [...root.querySelectorAll(IR_MARKERS)].filter(node =>
    !node.closest('[data-render]') && metadata((rawMarker(node)?.textContent || '').trim()));
}
function items(list) { return [...list.children].filter(node => node.tagName === 'LI'); }
function ownMarkers(item) {
  return markers(item).filter(marker => {
    const value = metadata(rawMarker(marker).textContent.trim());
    return value.paragraph ? item.tagName === 'P' && marker.closest('p') === item : item.tagName === 'LI' && marker.closest('li') === item;
  });
}
function createMarker(doc, value = { alpha: true, indent: 0 }) {
  const node = doc.createElement('span'); node.dataset.type = 'html-inline';
  node.className = 'vditor-ir__node note-list-marker';
  const code = doc.createElement('code'); code.className = 'vditor-ir__marker'; code.textContent = markerSource(value);
  node.append(code); return node;
}
export function listKind(list) {
  if (list.tagName === 'UL') return 'bullet';
  return list.getAttribute('type') === 'a' || items(list).some(item => ownMarkers(item).some(marker => metadata(rawMarker(marker).textContent.trim()).alpha)) ? 'alpha' : 'decimal';
}
export function clearListMarkers(root) { markers(root).forEach(node => node.remove()); }
export function stripListMetadata(text) { return text.replace(/<span\s+[^<>]*?\/>/g, source => metadata(source) ? '' : source); }
export function listIndent(node) {
  const attribute = indentValue(node.getAttribute(INDENT));
  return attribute ?? ownMarkers(node).reduce((level, marker) => Math.max(level, metadata(rawMarker(marker).textContent.trim()).indent), 0);
}
export function setListIndent(node, level) {
  const value = indentValue(level);
  if (value === null) return false;
  if (value) { node.setAttribute(INDENT, String(value)); node.style.setProperty('--note-list-indent-level', String(value)); }
  else { node.removeAttribute(INDENT); node.style.removeProperty('--note-list-indent-level'); }
  const alpha = node.tagName === 'LI' && node.parentElement?.tagName === 'OL' && listKind(node.parentElement) === 'alpha';
  decorateMetadata(node, { alpha, indent: value, paragraph: node.tagName === 'P' });
  return true;
}
function decorateMetadata(item, value) {
  const existing = ownMarkers(item); let marker = existing.shift(); existing.forEach(node => node.remove());
  if (!value.alpha && !value.indent) { marker?.remove(); return false; }
  if (!marker || marker.dataset.type !== 'html-inline') {
    const replacement = createMarker(item.ownerDocument, value); marker?.replaceWith(replacement); marker = replacement;
  }
  marker.classList.add('note-list-marker');
  if (rawMarker(marker).textContent !== markerSource(value)) rawMarker(marker).textContent = markerSource(value);
  const checkbox = item.tagName === 'LI' ? [...item.querySelectorAll('input[type="checkbox"]')].find(input => input.closest('li') === item) : null;
  if (checkbox) {
    // Lute requires real text after the checkbox before any inline HTML marker.
    let text = checkbox.nextSibling;
    if (text?.nodeType !== 3) { text = item.ownerDocument.createTextNode(' '); checkbox.after(text); }
    if (text.nextSibling === marker) return false;
    text.after(marker); return true;
  }
  if (item.firstChild === marker) return false;
  item.prepend(marker); return true;
}

/** Restore presentation from markers that survive Lute's native normalization and undo. */
export function decorateLists(root) {
  // Lute can combine a leading inline marker and a following raw HTML component.
  // Split only our reserved prefix, leaving the component and its existing nodes intact.
  for (const block of root.querySelectorAll('[data-type="html-block"][data-block]')) {
    if (block.closest('[data-render]')) continue;
    const raw = rawMarker(block), source = raw?.textContent || '', prefix = metadata(source, true);
    if (prefix?.paragraph && !source.slice(prefix.length).trim() && !block.closest('p')) {
      const paragraph = root.ownerDocument.createElement('p'); paragraph.dataset.block = '0';
      paragraph.append(createMarker(root.ownerDocument, prefix), root.ownerDocument.createElement('br'));
      block.replaceWith(paragraph); continue;
    }
    if (!prefix || !source.slice(prefix.length).trim() || !block.closest(prefix.paragraph ? 'p' : 'li')) continue;
    if (raw.childNodes.length === 1 && raw.firstChild.nodeType === 3) raw.firstChild.deleteData(0, prefix.length);
    else raw.textContent = source.slice(prefix.length);
    block.before(createMarker(root.ownerDocument, prefix));
    block.querySelectorAll('[data-render] span[data-typepro-list],[data-render] span[data-typepro-indent]').forEach(marker => marker.replaceWith(...marker.childNodes));
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
      const alpha = forced || ownMarkers(item).some(marker => metadata(rawMarker(marker).textContent.trim()).alpha);
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
    });
  }
  for (const item of root.querySelectorAll('li,p[data-block]')) {
    if (item.closest('[data-render]') || item.tagName === 'LI' && !/^(UL|OL)$/.test(item.parentElement?.tagName)) continue;
    const indent = listIndent(item), alpha = item.tagName === 'LI' && item.parentElement.tagName === 'OL' && listKind(item.parentElement) === 'alpha';
    if (indent) { item.setAttribute(INDENT, String(indent)); item.style.setProperty('--note-list-indent-level', String(indent)); }
    if (decorateMetadata(item, { alpha, indent, paragraph: item.tagName === 'P' })) moved = true;
  }
  markers(root).filter(marker => {
    const value = metadata(rawMarker(marker).textContent.trim());
    return value.paragraph ? !marker.closest('p[data-block]') : !/^(UL|OL)$/.test(marker.closest('li')?.parentElement?.tagName);
  }).forEach(marker => marker.remove());
  if (moved && caret?.anchor.isConnected && caret.focus?.isConnected) {
    selection.setBaseAndExtent(caret.anchor, caret.anchorOffset, caret.focus, caret.focusOffset);
  }
}

function fragment(doc, html) {
  const template = doc.createElement('template'); template.innerHTML = html; return template.content;
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

/** Decode only the list/indent interchange HTML emitted by this module. */
export function hydrateListHtml(root, lute) {
  for (const block of [...root.querySelectorAll('[data-type="html-block"][data-block]')]) {
    if (!root.contains(block) || block.closest('[data-render]')) continue;
    const source = rawMarker(block)?.textContent || '';
    if (!/\b(?:ol|data-typepro-indent)\b/i.test(source)) continue;
    const html = fragment(root.ownerDocument, source);
    const top = [...html.childNodes].filter(node => node.nodeType !== 3 || node.textContent.trim());
    if (!top.length || top.some(node => node.nodeType !== 1 || !/^(OL|UL|P)$/.test(node.tagName) || node.tagName === 'P' && !node.hasAttribute(INDENT))) continue;
    const requested = [...html.querySelectorAll('ol[type="a"],li[data-typepro-indent],p[data-typepro-indent]')].filter(node => !node.closest(RAW_TEXT));
    if (!requested.length) continue;
    // Arbitrary HTML list attributes and arbitrary CSS are not indentation metadata.
    let valid = true;
    for (const node of html.querySelectorAll('ol,ul,li,p[data-typepro-indent]')) {
      if (node.closest(RAW_TEXT)) continue;
      const indent = node.hasAttribute(INDENT) ? indentValue(node.getAttribute(INDENT)) : 0;
      if (indent === null) { valid = false; break; }
      for (const attribute of node.attributes) {
        const accepted = node.tagName === 'OL' && (attribute.name === 'type' && ['a', '1'].includes(attribute.value) || attribute.name === 'start' && /^[1-9]\d*$/.test(attribute.value))
          || /^(LI|P)$/.test(node.tagName) && attribute.name === INDENT
          || node.tagName === 'LI' && attribute.name === 'class' && /^vditor-task(?: vditor-task--done)?$/.test(attribute.value)
          || /^(LI|P)$/.test(node.tagName) && node.hasAttribute(INDENT) && attribute.name === 'style' && [...node.style].every(name => name === 'margin-left' || name === '--note-list-indent-level' && node.style.getPropertyValue(name).trim() === String(indent));
        if (!accepted) { valid = false; break; }
      }
      if (!valid) break;
    }
    if (!valid) continue;
    const itemMetadata = [];
    for (const node of html.querySelectorAll('li,p[data-typepro-indent]')) {
      if (node.closest(RAW_TEXT)) continue;
      const value = { alpha: node.tagName === 'LI' && node.parentElement.matches('ol[type="a"]'), indent: indentValue(node.getAttribute(INDENT)) || 0, paragraph: node.tagName === 'P' };
      if (value.alpha || value.indent || node.hasAttribute(INDENT)) itemMetadata.push({ node, value });
      if (node.hasAttribute(INDENT)) { node.removeAttribute(INDENT); node.style.removeProperty('margin-left'); node.style.removeProperty('--note-list-indent-level'); if (!node.getAttribute('style')) node.removeAttribute('style'); }
    }
    const replacements = [], protectedNodes = [];
    for (const node of [...html.querySelectorAll('*')]) {
      if (node.closest(RAW_TEXT) && !/^(PRE|CODE)$/.test(node.tagName)) continue;
      const taskInput = node.tagName === 'INPUT' && node.type === 'checkbox' && node.closest('li')?.classList.contains('vditor-task') && [...node.attributes].every(attribute => ['type', 'checked', 'disabled'].includes(attribute.name));
      if (taskInput || protectedNodes.some(parent => parent.contains(node)) || !protectedHtml(node)) continue;
      protectedNodes.push(node);
      const value = token(source, 'TYPEPROLISTHTML');
      const isBlock = /^(P|H[1-6]|DIV|SECTION|ARTICLE|ASIDE|DETAILS|FIGURE|VIDEO|AUDIO|IFRAME|SCRIPT|STYLE|PRE|BLOCKQUOTE|TABLE|HR)$/.test(node.tagName);
      replacements.push({ value, html: node.outerHTML, block: isBlock });
      const placeholder = root.ownerDocument.createTextNode(value);
      if (isBlock) { const paragraph = root.ownerDocument.createElement('p'); paragraph.append(placeholder); node.replaceWith(paragraph); }
      else node.replaceWith(placeholder);
    }
    const metadataTokens = [];
    for (const record of itemMetadata) {
      if (!html.contains(record.node)) { valid = false; break; }
      const value = token(source, 'TYPEPROLISTMETA'); metadataTokens.push({ token: value, value: record.value });
      const placeholder = root.ownerDocument.createTextNode(value);
      const checkbox = record.node.querySelector(':scope > input[type="checkbox"]');
      if (checkbox) {
        let text = checkbox.nextSibling;
        if (text?.nodeType !== 3) { text = root.ownerDocument.createTextNode(' '); checkbox.after(text); }
        text.after(placeholder);
      }
      else record.node.prepend(placeholder);
    }
    if (!valid) continue;
    const container = root.ownerDocument.createElement('div'); container.append(html);
    const ir = root.ownerDocument.createElement('div'); ir.innerHTML = lute.HTML2VditorIRDOM(container.innerHTML);
    for (const record of metadataTokens) {
      const text = visibleTextNode(ir, record.token), owner = text?.parentElement?.closest(record.value.paragraph ? 'p[data-block]' : 'li');
      if (!owner) { valid = false; break; }
      replaceToken(ir, record.token, root.ownerDocument.createTextNode(''));
      if (record.value.alpha || record.value.indent) owner.prepend(createMarker(root.ownerDocument, record.value));
    }
    if (!valid) continue;
    for (const replacement of replacements) {
      if (!replaceToken(ir, replacement.value, protectedIR(root.ownerDocument, replacement.html, replacement.block, lute), replacement.block)) { valid = false; break; }
    }
    if (!valid) continue;
    decorateLists(ir); block.replaceWith(...ir.childNodes);
  }
}

/** Called on the serialization clone, after runtime code/image/style decorations are removed. */
export function serializeListHtml(root, lute) {
  decorateLists(root);
  const outer = [...root.querySelectorAll('ol[data-block],ul[data-block]')].filter(list =>
    !list.parentElement?.closest('ol,ul') && !list.closest('[data-render]'));
  for (const list of outer) {
    if (![list, ...list.querySelectorAll('ol[data-block]')].some(node => node.tagName === 'OL' && listKind(node) === 'alpha') && !list.querySelector('[data-typepro-indent]')) continue;
    // Render nested lists first so Lute cannot merge adjacent alpha/decimal groups.
    for (const nested of [...list.querySelectorAll('ol[data-block],ul[data-block]')].reverse()) replaceWithListHtml(nested, lute);
    replaceWithListHtml(list, lute);
  }
  for (const paragraph of [...root.querySelectorAll('p[data-block][data-typepro-indent]')]) {
    if (!paragraph.closest('[data-render]')) replaceWithListHtml(paragraph, lute);
  }
  clearListMarkers(root);
}

function replaceWithListHtml(list, lute) {
  // A real closing tag keeps the temporary HTML marker empty in the browser parser.
  for (const marker of markers(list)) rawMarker(marker).textContent = markerSource(metadata(rawMarker(marker).textContent.trim())).replace('/>', '></span>');
  const html = fragment(list.ownerDocument, lute.VditorIRDOM2HTML(list.outerHTML));
  for (const marker of html.querySelectorAll('span[data-typepro-list],span[data-typepro-indent]')) {
    const owner = marker.closest(marker.getAttribute('data-typepro-target') === 'p' ? 'p' : 'li');
    if (marker.getAttribute('data-typepro-list') === 'a' && owner?.parentElement?.tagName === 'OL') owner.parentElement.setAttribute('type', 'a');
    const indent = indentValue(marker.getAttribute(INDENT));
    if (owner && indent) {
      owner.setAttribute(INDENT, String(indent));
      owner.style.marginLeft = `${indent * (owner.classList.contains('vditor-task') ? 31 : 28)}px`;
      owner.style.setProperty('--note-list-indent-level', String(indent));
    }
    marker.remove();
  }
  const container = list.ownerDocument.createElement('div'); container.append(html);
  list.replaceWith(fragment(list.ownerDocument, lute.Md2VditorIRDOM(container.innerHTML.trim())));
}
