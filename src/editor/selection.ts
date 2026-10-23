export interface RichSelection { range: Range; start: number; end: number }

function textNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement?.closest('[data-render],.vditor-ir__preview,.vditor-ir__marker:not(pre)') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
function position(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  const clone = range.cloneContents();
  clone.querySelectorAll('[data-render],.vditor-ir__preview,.vditor-ir__marker:not(pre)').forEach(el => el.remove());
  return clone.textContent?.length || 0;
}
export function captureRichSelection(root: HTMLElement): RichSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0).cloneRange();
  return { range, start: position(root, range.startContainer, range.startOffset), end: position(root, range.endContainer, range.endOffset) };
}
/** A range start at a block boundary belongs to the following text, not the previous heading. */
export function locateTextOffset(lengths: number[], offset: number, end: boolean): [number, number] {
  for (let index = 0; index < lengths.length; index++) {
    if (offset < lengths[index] || (end && offset === lengths[index])) return [index, offset];
    offset -= lengths[index];
  }
  return [lengths.length - 1, lengths[lengths.length - 1] || 0];
}
export function restoreRichSelection(root: HTMLElement, saved: RichSelection | null) {
  let range = saved?.range;
  root.focus({ preventScroll: true });
  if (!range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    if (saved) {
      const nodes = textNodes(root);
      const locate = (offset: number, end: boolean): [Node, number] => {
        const [index, position] = locateTextOffset(nodes.map(node => node.length), offset, end);
        return nodes[index] ? [nodes[index], position] : [root, 0];
      };
      range.setStart(...locate(saved.start, false));
      range.setEnd(...locate(saved.end, saved.end !== saved.start));
    }
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

