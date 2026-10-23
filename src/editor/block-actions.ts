import type { BlockOperation } from './block-controls';
import { getBlockAnchor, getBlockTarget } from './block-targets';

const LIST = /^(UL|OL)$/;
const BLOCK = '[data-block],li';

function canonicalBlock(field: HTMLElement, block: HTMLElement) {
  return block !== field && field.contains(block) && (block.matches(BLOCK) || getBlockTarget(field, block) === block)
    && !block.closest('[data-render],.note-code-preview,.note-image-preview');
}

function normalizeList(list: HTMLElement) {
  if (!LIST.test(list.tagName)) return;
  const ordered = list.tagName === 'OL';
  const marker = list.getAttribute('data-marker') || (ordered ? '1.' : '-');
  const first = Number(list.getAttribute('start')) || 1;
  list.setAttribute('data-marker', ordered ? `${first}.` : marker);
  [...list.children].filter(child => child.tagName === 'LI').forEach((child, index) => {
    child.setAttribute('data-marker', ordered ? `${first + index}.` : marker);
  });
}

function removeEmptyContainers(field: HTMLElement, parent: HTMLElement | null) {
  while (parent && parent !== field && /^(UL|OL|BLOCKQUOTE)$/.test(parent.tagName)) {
    if (parent.children.length || parent.textContent?.replace(/\u200b/g, '').trim()) {
      normalizeList(parent); return;
    }
    const next = parent.parentElement;
    parent.remove(); parent = next;
  }
}

/** Move real canonical nodes so code editors, attachments and block identities survive. */
export function applyBlockOperation(field: HTMLElement, operation: BlockOperation): HTMLElement | null {
  const { block } = operation;
  if (!canonicalBlock(field, block) || getBlockTarget(field, block) !== block) return null;
  const originalParent = block.parentElement;
  let focus: HTMLElement | null;
  if (operation.type === 'delete') {
    focus = block.nextElementSibling as HTMLElement | null || block.previousElementSibling as HTMLElement | null;
    block.remove();
  } else {
    const { target, position } = operation;
    if (!canonicalBlock(field, target) || getBlockAnchor(field, target) !== target || block === target || block.contains(target) || target.contains(block)) return null;
    if (block.parentElement === target.parentElement && (position === 'before' ? block.nextElementSibling === target : block.previousElementSibling === target)) return null;
    let moved = block;
    if (target.tagName === 'LI') {
      moved = field.ownerDocument.createElement('li');
      moved.append(block);
    } else if (!block.matches(BLOCK) && target.parentElement?.tagName !== 'LI') {
      moved = field.ownerDocument.createElement('p');
      moved.setAttribute('data-block', '0'); moved.append(block);
    }
    target.parentElement!.insertBefore(moved, position === 'before' ? target : target.nextSibling);
    normalizeList(target.parentElement!);
    focus = moved.tagName === 'P' ? moved : block;
  }
  removeEmptyContainers(field, originalParent);
  if (!field.children.length) {
    const paragraph = field.ownerDocument.createElement('p');
    paragraph.setAttribute('data-block', '0'); paragraph.append(field.ownerDocument.createElement('br'));
    field.append(paragraph); focus = paragraph;
  }
  return focus && field.contains(focus) ? focus : field.firstElementChild as HTMLElement;
}
