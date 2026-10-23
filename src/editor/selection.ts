export interface RichSelection { range: Range; start: number; end: number }

function textNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement?.closest('[data-render],.vditor-ir__preview') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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
  clone.querySelectorAll('[data-render],.vditor-ir__preview').forEach(el => el.remove());
  return clone.textContent?.length || 0;
}
export function captureRichSelection(root: HTMLElement): RichSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0).cloneRange();
  return { range, start: position(root, range.startContainer, range.startOffset), end: position(root, range.endContainer, range.endOffset) };
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
      const locate = (offset: number): [Node, number] => {
        for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
        const last = nodes[nodes.length - 1];
        return last ? [last, last.length] : [root, 0];
      };
      range.setStart(...locate(saved.start));
      range.setEnd(...locate(saved.end));
    }
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

/** Textarea selection offsets omit CR bytes from CRLF, while stored Markdown retains them. */
export function sourceOffset(text: string, textareaPosition: number) {
  let visible = 0;
  let offset = 0;
  while (offset < text.length && visible < textareaPosition) {
    if (!(text[offset] === '\r' && text[offset + 1] === '\n')) visible++;
    offset++;
  }
  return offset;
}
export function textareaOffset(text: string, sourcePosition: number) {
  return text.slice(0, sourcePosition).replace(/\r\n/g, '\n').length;
}
