/** Preview/CodeMirror descendants belong to their outer canonical component. */
const COMPONENT_TYPES = new Set(['code-block', 'math-block', 'html-block', 'table']);

function isCanonical(element: HTMLElement) {
  return !element.classList.contains('note-list-marker') && (element.hasAttribute('data-block') || element.tagName === 'LI' || standaloneListImage(element));
}

/** Tight lists have no paragraph wrapper around a standalone image. */
function standaloneListImage(image: HTMLElement) {
  const item = image.parentElement;
  if (item?.tagName !== 'LI' || !(image.dataset.type === 'img' || image.dataset.type === 'html-inline' && image.classList.contains('note-image-inline')) || image.querySelectorAll('img').length !== 1) return false;
  return [...item.childNodes].every(node => {
    if (node === image || node.nodeType === 8) return true;
    if (node.nodeType === 3) return !node.textContent?.replace(/[\u200b\ufeff]/g, '').trim();
    return node.nodeType === 1 && (node as HTMLElement).matches('[data-block],ol,ul,blockquote,table,.note-list-marker,.vditor-ir__marker,wbr,br,input[type="checkbox"]');
  });
}

function blockPath(field: HTMLElement, node: Node | null) {
  let element = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement ?? null;
  if (!element || element === field || !field.contains(element)) return [];
  const path: HTMLElement[] = [];
  while (element && element !== field) { path.push(element); element = element.parentElement; }
  return path;
}

function componentOwner(path: HTMLElement[]) {
  // An HTML preview may itself contain a table or list. The outer canonical widget owns it.
  return [...path].reverse().find(item => isCanonical(item) && (COMPONENT_TYPES.has(item.dataset.type || '') || item.tagName === 'TABLE'));
}

function standaloneImage(block: HTMLElement) {
  if (block.tagName !== 'P' || block.querySelectorAll('img').length !== 1) return false;
  const clone = block.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.note-list-marker,.vditor-ir__marker,[data-render],.vditor-ir__preview,wbr').forEach(node => node.remove());
  return !clone.textContent?.replace(/[\u200b\ufeff]/g, '').trim()
    && !clone.querySelector('input,pre,code,table,hr,audio,video,iframe,object,svg,[data-type="inline-node"]');
}

/** Only independent components receive move/delete controls. */
export function getBlockTarget(field: HTMLElement, node: Node | null): HTMLElement | null {
  const path = blockPath(field, node);
  return componentOwner(path) || path.find(item => standaloneListImage(item) || isCanonical(item) && standaloneImage(item)) || null;
}

/** Prose and list structure remain valid insertion anchors without becoming operable. */
export function getBlockAnchor(field: HTMLElement, node: Node | null): HTMLElement | null {
  const path = blockPath(field, node);
  return componentOwner(path) || path.find(isCanonical) || null;
}

export function getBodyBlocks(field: HTMLElement): HTMLElement[] {
  return [...field.querySelectorAll<HTMLElement>('[data-block],li,[data-type="img"],.note-image-inline')]
    .filter(block => getBlockAnchor(field, block) === block);
}

export function canMoveBlock(block: HTMLElement, target: HTMLElement) {
  return block !== target && !block.contains(target) && !target.contains(block);
}

export function adjacentBlock(field: HTMLElement, block: HTMLElement, direction: -1 | 1): HTMLElement | null {
  let sibling = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
  while (sibling) {
    if (getBlockAnchor(field, sibling) === sibling) return sibling as HTMLElement;
    sibling = direction < 0 ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return null;
}

export interface BlockDropTarget { block: HTMLElement; position: 'before' | 'after' }

export function findBlockDropTarget(field: HTMLElement, source: HTMLElement, clientX: number, clientY: number): BlockDropTarget | null {
  const hit = getBlockAnchor(field, field.ownerDocument.elementFromPoint(clientX, clientY));
  if (hit && (hit === source || source.contains(hit))) return null;
  if (hit && canMoveBlock(source, hit)) {
    const rect = hit.getBoundingClientRect();
    return { block: hit, position: clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
  }
  // The pointer can be in paragraph margins or the handle gutter. Use the nearest block edge.
  const sourceRect = source.getBoundingClientRect();
  if (!hit && clientY >= sourceRect.top && clientY <= sourceRect.bottom) return null;
  let nearest: BlockDropTarget | null = null;
  let distance = Infinity;
  for (const block of getBodyBlocks(field)) {
    if (!canMoveBlock(source, block)) continue;
    const rect = block.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const before = Math.abs(clientY - rect.top);
    const after = Math.abs(clientY - rect.bottom);
    if (Math.min(before, after) < distance) {
      distance = Math.min(before, after);
      nearest = { block, position: before <= after ? 'before' : 'after' };
    }
  }
  return nearest;
}

export function blockLabel(block: HTMLElement) {
  if (block.classList.contains('note-image-block')) return '图片';
  const type = block.dataset.type;
  if (type === 'code-block') return block.querySelector('code.language-mermaid') ? '流程图' : '代码块';
  if (type === 'math-block') return '公式';
  if (type === 'html-block') return 'HTML 块';
  if (type === 'table' || block.tagName === 'TABLE') return '表格';
  return '图片';
}
