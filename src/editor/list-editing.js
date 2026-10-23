import { clearListMarkers, decorateLists, listKind } from './list-markdown.js';

const LIST = /^(UL|OL)$/;
const EXCLUDED = '.cm-editor,[data-render],.vditor-ir__preview,[data-type="code-block"],[data-type="math-block"],[data-type="html-block"],table,pre:not(.vditor-reset),code';
const CONTENT = 'img,audio,canvas,embed,hr,iframe,object,ol,pre,svg,table,ul,video,[data-type="img"],[data-type="inline-node"],[data-type="html-inline"],[data-type="code-block"],[data-type="math-block"],[data-type="html-block"]';
const EXIT = 'data-typepro-list-exit';

function element(node) { return node.nodeType === 1 ? node : node.parentElement; }
function paragraph(doc) {
  const node = doc.createElement('p'); node.dataset.block = '0'; node.append(doc.createElement('br')); return node;
}
function visibleContent(node) {
  const copy = node.cloneNode(true);
  clearListMarkers(copy);
  copy.querySelectorAll('[data-render],.vditor-ir__marker,wbr,input[type="checkbox"]').forEach(item => item.remove());
  return copy;
}
function isEmpty(node) {
  const copy = visibleContent(node);
  return !(copy.textContent || '').replace(/[\u200b\ufeff\s]/gu, '') && !copy.querySelector(CONTENT);
}
function setSelection(field, range) {
  const selection = field.ownerDocument.defaultView.getSelection();
  selection.removeAllRanges(); selection.addRange(range); field.focus({ preventScroll: true });
}
function focusStart(field, node) {
  const range = field.ownerDocument.createRange();
  const walker = field.ownerDocument.createTreeWalker(node, 4, { acceptNode(text) {
    const parent = text.parentElement;
    return parent?.closest(`${EXCLUDED},[data-type="html-inline"],.vditor-ir__marker`) || (node.tagName === 'LI' && parent?.closest('li') !== node) || !text.textContent.replace(/[\u200b\ufeff\s]/gu, '') ? 2 : 1;
  } });
  const first = walker.nextNode();
  if (first) range.setStart(first, 0);
  else {
    let offset = 0;
    while (node.childNodes[offset]?.nodeType === 1 && node.childNodes[offset].matches('[data-type="html-inline"],input[type="checkbox"]')) offset++;
    range.setStart(node, offset);
  }
  range.collapse(true); setSelection(field, range);
}
function bookmark(field, range, mutate) {
  const marker = field.ownerDocument.createElement('wbr');
  range.insertNode(marker); mutate();
  range.setStartBefore(marker); range.collapse(true); marker.remove(); setSelection(field, range);
}
function startOf(list) { return Math.max(1, Number(list.getAttribute('start')) || 1); }
function renumber(list) {
  if (!list?.isConnected || !LIST.test(list.tagName)) return;
  const ordered = list.tagName === 'OL', start = startOf(list);
  list.dataset.marker = ordered ? `${start}.` : list.dataset.marker || '-';
  [...list.children].filter(child => child.tagName === 'LI').forEach((item, index) => { item.dataset.marker = ordered ? `${start + index}.` : list.dataset.marker; });
}
function newList(doc, kind, start = 1) {
  const list = doc.createElement(kind === 'bullet' ? 'ul' : 'ol');
  list.dataset.block = '0'; list.dataset.tight = 'true'; list.dataset.marker = kind === 'bullet' ? '-' : `${start}.`;
  if (kind !== 'bullet') list.setAttribute('start', String(start));
  if (kind === 'alpha') list.setAttribute('type', 'a');
  return list;
}
function ensureParagraph(item) {
  const first = [...item.children].find(child => child.tagName === 'P');
  const current = first || item;
  if (isEmpty(current) && !current.querySelector('br')) current.append(item.ownerDocument.createElement('br'));
  return current;
}

/** Split only the item's own list; sibling items and component nodes retain identity. */
function replaceItem(item, replacement) {
  const list = item.parentElement;
  const index = [...list.children].indexOf(item);
  let trailing = null;
  if (item.nextElementSibling) {
    trailing = list.cloneNode(false); trailing.removeAttribute('data-node-id');
    if (list.tagName === 'OL') trailing.setAttribute('start', String(startOf(list) + index + 1));
    while (item.nextSibling) trailing.append(item.nextSibling);
    list.after(trailing);
  }
  list.after(replacement); item.remove();
  if (!list.querySelector(':scope > li')) list.remove(); else renumber(list);
  if (trailing) renumber(trailing);
}
function exitEmptyItem(field, item, pending) {
  const list = item.parentElement;
  const next = paragraph(field.ownerDocument);
  if (pending && list.parentElement?.tagName === 'LI') next.setAttribute(EXIT, 'pending');
  replaceItem(item, next); focusStart(field, next);
}
function unlistItem(field, item, range) {
  bookmark(field, range, () => {
    const fragment = field.ownerDocument.createDocumentFragment();
    clearListMarkers(item);
    [...item.querySelectorAll('input[type="checkbox"]')].filter(input => input.closest('li') === item).forEach(input => input.remove());
    let inline = null;
    for (const node of [...item.childNodes]) {
      if (node.nodeType === 1 && node.matches('[data-block],ul,ol,blockquote,table,hr')) {
        inline = null; fragment.append(node);
      } else {
        if (!inline) { inline = field.ownerDocument.createElement('p'); inline.dataset.block = '0'; fragment.append(inline); }
        inline.append(node);
      }
    }
    replaceItem(item, fragment);
  });
}
function indentItem(field, item, range) {
  const previous = item.previousElementSibling;
  const source = item.parentElement, kind = listKind(source);
  bookmark(field, range, () => {
    let nested = previous.lastElementChild;
    if (!nested || !LIST.test(nested.tagName) || listKind(nested) !== kind) {
      nested = newList(field.ownerDocument, kind); previous.append(nested);
    }
    nested.append(item); renumber(nested);
    if (!source.querySelector(':scope > li')) source.remove(); else renumber(source);
  });
}
function outdentItem(field, item, range) {
  const source = item.parentElement, parentItem = source.parentElement;
  if (parentItem.tagName !== 'LI') { unlistItem(field, item, range); return; }
  bookmark(field, range, () => {
    if (item.nextElementSibling) {
      const trailing = source.cloneNode(false); trailing.removeAttribute('data-node-id');
      while (item.nextSibling) trailing.append(item.nextSibling);
      item.append(trailing); renumber(trailing);
    }
    // The outer list owns this item's style; its nested lists keep their own type.
    clearListMarkers(item);
    parentItem.after(item);
    if (!source.querySelector(':scope > li')) source.remove(); else renumber(source);
    renumber(item.parentElement);
  });
}

/** A cancelled nested marker leaves a paragraph; further backspace lifts only it. */
function liftParagraph(field, current) {
  const owner = current.parentElement;
  if (owner.tagName !== 'LI') return false;
  const list = owner.parentElement;
  const after = owner.cloneNode(false); after.removeAttribute('data-node-id');
  while (current.nextSibling) after.append(current.nextSibling);
  if (after.childNodes.length) owner.after(after);
  current.remove();
  if (owner.childNodes.length) owner.after(current); else owner.replaceWith(current);
  // Reuse list splitting with a temporary LI, keeping earlier and later items intact.
  const anchor = field.ownerDocument.createElement('li'); current.replaceWith(anchor);
  replaceItem(anchor, current);
  if (!list.querySelector(':scope > li')) list.remove();
  focusStart(field, current); return true;
}
function splitItem(field, item, range) {
  range.deleteContents();
  const suffix = range.cloneRange(); suffix.setEnd(item, item.childNodes.length);
  const next = item.cloneNode(false); next.removeAttribute('data-node-id'); next.removeAttribute(EXIT);
  next.append(suffix.extractContents());
  clearListMarkers(next);
  if (item.classList.contains('vditor-task')) {
    next.querySelector(':scope > input[type="checkbox"]')?.remove();
    const checkbox = field.ownerDocument.createElement('input'); checkbox.type = 'checkbox'; next.prepend(checkbox);
  }
  const focus = ensureParagraph(next); ensureParagraph(item);
  item.after(next); renumber(item.parentElement); focusStart(field, focus);
}
function prefixKind(text) {
  if (text === '-') return { kind: 'bullet', start: 1 };
  if (text === 'a.') return { kind: 'alpha', start: 1 };
  if (/^[1-9]\d{0,8}\.$/.test(text)) return { kind: 'decimal', start: Number(text.slice(0, -1)) };
  return null;
}
function context(field) {
  if (field.getAttribute('contenteditable') === 'false' || field.closest('[hidden]')) return null;
  const selection = field.ownerDocument.defaultView.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return null;
  const first = element(range.startContainer), last = element(range.endContainer);
  if (!first || !last || first.closest(EXCLUDED) || last.closest(EXCLUDED)) return null;
  const item = first.closest('li'), endItem = last.closest('li');
  if (item !== endItem) return null;
  // Tight IR lists store text directly in LI; loose lists use paragraphs.
  const current = first.closest('p') || item;
  return { range, item, current: current && field.contains(current) ? current : null };
}
function convertPrefix(field, state) {
  const { range, item, current } = state;
  if (!range.collapsed || !current) return null;
  const leading = range.cloneRange(); leading.selectNodeContents(current); leading.setEnd(range.startContainer, range.startOffset);
  const copy = visibleContent(leading.cloneContents());
  if (copy.querySelector(CONTENT)) return null;
  const prefix = prefixKind((copy.textContent || '').replace(/[\u200b\ufeff]/g, ''));
  if (!prefix) return null;
  return () => {
    leading.deleteContents(); current.removeAttribute(EXIT);
    const list = newList(field.ownerDocument, prefix.kind, prefix.start);
    if (item && (current === item || [...item.children].find(child => child.tagName === 'P') === current)) {
      clearListMarkers(item);
      item.classList.remove('vditor-task');
      [...item.querySelectorAll('input[type="checkbox"]')].filter(input => input.closest('li') === item).forEach(input => input.remove());
      replaceItem(item, list); list.append(item);
    } else {
      const next = field.ownerDocument.createElement('li');
      current.replaceWith(list); next.append(current); list.append(next);
    }
    renumber(list); focusStart(field, current); return true;
  };
}
function actionFor(field, state, key, shift) {
  const { range, item, current } = state;
  if (key === ' ' && !shift) return convertPrefix(field, state);
  if (key === 'Enter' && !shift) {
    if (current?.hasAttribute(EXIT) && isEmpty(current)) return () => { current.removeAttribute(EXIT); return true; };
    if (!item) return null;
    return () => {
      if (isEmpty(item)) exitEmptyItem(field, item, false); else splitItem(field, item, range);
      return true;
    };
  }
  if (key === 'Backspace' && range.collapsed) {
    if (current && isEmpty(current) && current.hasAttribute(EXIT)) return () => { current.removeAttribute(EXIT); return true; };
    if (item && isEmpty(item)) return () => { exitEmptyItem(field, item, true); return true; };
    if (current?.parentElement?.tagName === 'LI' && isEmpty(current)) return () => liftParagraph(field, current);
  }
  if (key === 'Tab' && item && range.collapsed) {
    if (!shift && item.previousElementSibling?.tagName !== 'LI') return false;
    return () => { if (shift) outdentItem(field, item, range); else indentItem(field, item, range); return true; };
  }
  return null;
}

/** Intercept only list structure changes before Vditor's default keyboard normalization. */
export function installListEditing({ field, transact }) {
  function handle(event, key, shift = false) {
    if (event.defaultPrevented || event.isComposing) return;
    // Restore native-normalized list groups before capturing their caret and item.
    decorateLists(field);
    const state = context(field);
    if (!state) return;
    const action = actionFor(field, state, key, shift);
    if (action === null) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (action) transact(action);
  }
  function keydown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (['Enter', 'Backspace', 'Tab'].includes(event.key)) handle(event, event.key, event.shiftKey);
  }
  function beforeinput(event) {
    if (event.inputType === 'insertText' && event.data === ' ') handle(event, ' ');
    else if (event.inputType === 'insertParagraph') handle(event, 'Enter');
    else if (event.inputType === 'deleteContentBackward') handle(event, 'Backspace');
    if (!event.defaultPrevented && /^insert/.test(event.inputType)) {
      const current = context(field)?.current;
      current?.removeAttribute(EXIT);
    }
  }
  field.addEventListener('keydown', keydown, true);
  field.addEventListener('beforeinput', beforeinput, true);
  return () => { field.removeEventListener('keydown', keydown, true); field.removeEventListener('beforeinput', beforeinput, true); };
}
