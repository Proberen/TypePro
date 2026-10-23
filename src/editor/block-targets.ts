/** Only canonical IR nodes are operated on; preview/CodeMirror children never become blocks. */
const ATOMIC_TYPES = new Set(['code-block', 'math-block', 'html-block', 'table', 'yaml-front-matter', 'link-ref-defs', 'footnotes-block']);
const STRUCTURAL_TAGS = new Set(['LI', 'BLOCKQUOTE']);

function isCanonical(element: HTMLElement) {
  return element.hasAttribute('data-block') || element.tagName === 'LI';
}

export function getBlockTarget(field: HTMLElement, node: Node | null): HTMLElement | null {
  let element = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement ?? null;
  if (!element || element === field || !field.contains(element)) return null;
  const path: HTMLElement[] = [];
  while (element && element !== field) { path.push(element); element = element.parentElement; }
  // An HTML preview may itself contain a table or list. The outer canonical widget owns it.
  const atomic = [...path].reverse().find(item => isCanonical(item) && ATOMIC_TYPES.has(item.dataset.type || ''));
  if (atomic) return atomic;
  const structural = path.find(item => STRUCTURAL_TAGS.has(item.tagName) && isCanonical(item));
  return structural || path.find(isCanonical) || null;
}

export function getBodyBlocks(field: HTMLElement): HTMLElement[] {
  return [...field.querySelectorAll<HTMLElement>('[data-block],li')]
    .filter(block => getBlockTarget(field, block) === block);
}

export function canMoveBlock(block: HTMLElement, target: HTMLElement) {
  return block !== target && !block.contains(target) && !target.contains(block);
}

export function adjacentBlock(field: HTMLElement, block: HTMLElement, direction: -1 | 1): HTMLElement | null {
  let sibling = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
  while (sibling) {
    if (isCanonical(sibling as HTMLElement) && getBlockTarget(field, sibling) === sibling) return sibling as HTMLElement;
    sibling = direction < 0 ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return null;
}

export interface BlockDropTarget { block: HTMLElement; position: 'before' | 'after' }

export function findBlockDropTarget(field: HTMLElement, source: HTMLElement, clientX: number, clientY: number): BlockDropTarget | null {
  const hit = getBlockTarget(field, field.ownerDocument.elementFromPoint(clientX, clientY));
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
  if (block.tagName === 'TABLE') return '表格';
  if (block.tagName === 'BLOCKQUOTE') return '引用';
  if (block.tagName === 'LI') return '列表项';
  if (block.tagName === 'UL' || block.tagName === 'OL') return '列表';
  if (/^H[1-6]$/.test(block.tagName)) return '标题';
  if (block.tagName === 'HR') return '分隔线';
  return block.querySelector('img') ? '图片' : '段落';
}
