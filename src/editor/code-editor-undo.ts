import type Vditor from 'vditor';
import { stripImageResizeDecorations } from './image-dimensions.ts';

type VditorState = Vditor['vditor'];

/** Keep runtime widgets out of Vditor's native history without moving live DOM. */
export function canonicalUndoField(field: HTMLPreElement) {
  const clone = field.cloneNode(true) as HTMLPreElement;
  const selection = field.ownerDocument.defaultView?.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && field.contains(range.startContainer) && !clone.querySelector('wbr')) {
    let node: Node | null = range.startContainer;
    const path: number[] = [];
    while (node && node !== field) {
      path.unshift([...node.parentNode!.childNodes].indexOf(node as ChildNode));
      node = node.parentNode;
    }
    let target: Node = clone;
    for (const index of path) target = target.childNodes[index];
    const element = target instanceof Element ? target : target.parentElement;
    const preview = element?.closest('.note-code-preview');
    const marker = field.ownerDocument.createElement('wbr');
    if (preview) preview.closest('[data-type="code-block"]')?.after(marker);
    else {
      const caret = field.ownerDocument.createRange();
      caret.setStart(target, range.startOffset); caret.collapse(true); caret.insertNode(marker);
    }
  }
  clone.querySelectorAll('[data-type="code-block"] > .vditor-ir__preview').forEach(preview => preview.remove());
  stripImageResizeDecorations(clone);
  clone.querySelectorAll('img[data-note-asset]').forEach(node => {
    const image = node as HTMLImageElement;
    image.setAttribute('src', image.dataset.noteAsset!); image.removeAttribute('data-note-asset');
  });
  clone.querySelectorAll('[data-typepro-block-controls],[data-typepro-image-resize]').forEach(preview => preview.remove());
  return clone;
}

/** Finish pending typing, then record one canonical document operation. */
export function runIRTransaction(state: VditorState, mutate: () => boolean) {
  clearTimeout(state.ir?.processTimeoutId);
  state.undo!.addToUndoStack(state);
  if (!mutate()) return false;
  state.undo!.addToUndoStack(state);
  return true;
}

/** Native restore briefly removes widget height; preserve the actual scroll port. */
function captureUndoViewport(field: HTMLPreElement) {
  const port = field;
  const top = port.scrollTop, left = port.scrollLeft;
  return (reveal: boolean) => {
    if (!field.isConnected) return;
    port.scrollTop = top; port.scrollLeft = left;
    if (!reveal) return;
    const selection = field.ownerDocument.defaultView?.getSelection();
    if (!selection?.rangeCount || !field.contains(selection.focusNode)) return;
    const caret = selection.getRangeAt(0).cloneRange(); caret.collapse(false);
    let rect: Pick<DOMRect, 'top' | 'bottom'> | undefined = [...caret.getClientRects()].find(item => item.height > 0);
    if (!rect && caret.startContainer.nodeType === 1) {
      // Component transactions place the caret between canonical blocks.
      const container = caret.startContainer;
      const next = container.childNodes[caret.startOffset];
      const neighbor = next || container.childNodes[caret.startOffset - 1];
      const element = neighbor?.nodeType === 1 ? neighbor as HTMLElement : neighbor?.parentElement;
      const bounds = element && element !== field ? element.getBoundingClientRect() : null;
      if (bounds?.height) { const edge = next ? bounds.top : bounds.bottom; rect = { top: edge, bottom: edge }; }
    }
    if (!rect) return;
    const bounds = port.getBoundingClientRect();
    const start = bounds.top + port.clientTop + 8, end = bounds.top + port.clientTop + port.clientHeight - 8;
    if (rect.top < start) port.scrollTop += rect.top - start;
    else if (rect.bottom > end) port.scrollTop += rect.bottom - end;
  };
}

/** Images and CodeMirror can finish layout after the native restore returns. */
function restoreUndoAfterLayout(field: HTMLPreElement, restore: (reveal: boolean) => void, rendered: void | Promise<void>) {
  const document = field.ownerDocument, window = document.defaultView;
  if (!window?.requestAnimationFrame) return () => {};
  const selection = window.getSelection();
  const anchor = selection?.anchorNode, anchorOffset = selection?.anchorOffset;
  const focus = selection?.focusNode, focusOffset = selection?.focusOffset;
  const activeElement = document.activeElement, firstChild = field.firstChild;
  const events = ['keydown', 'beforeinput', 'input', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove'];
  let active = true, frame = 0;
  const cancel = () => {
    active = false; window.cancelAnimationFrame(frame);
    events.forEach(name => document.removeEventListener(name, cancel, true));
    window.removeEventListener('blur', cancel);
  };
  events.forEach(name => document.addEventListener(name, cancel, { capture: true, passive: true }));
  window.addEventListener('blur', cancel);
  void Promise.resolve(rendered).catch(() => {}).then(async () => {
    if (!active) return;
    await Promise.all([...field.querySelectorAll('img')].map(image => image.decode?.().catch(() => {})));
    if (!active) return;
    frame = window.requestAnimationFrame(() => {
      const current = window.getSelection();
      const unchanged = active && field.isConnected && field.firstChild === firstChild && document.activeElement === activeElement
        && current?.anchorNode === anchor && current?.anchorOffset === anchorOffset
        && current?.focusNode === focus && current?.focusOffset === focusOffset;
      cancel();
      if (unchanged) restore(true);
    });
  });
  return cancel;
}

/** Reuse Vditor's history engine; only its snapshot and restoration boundary change. */
export function installCodeUndoBridge(state: VditorState, onRestore: () => void | Promise<void>) {
  const history = state.undo!;
  const add = history.addToUndoStack;
  const first = history.recordFirstPosition;
  const undo = history.undo;
  const redo = history.redo;
  const canonicalState = (current: VditorState): VditorState => current.currentMode === 'ir'
    ? { ...current, ir: { ...current.ir!, element: canonicalUndoField(current.ir!.element) } }
    : current;
  history.addToUndoStack = current => add.call(history, canonicalState(current));
  history.recordFirstPosition = (current, event) => first.call(history, canonicalState(current), event);
  let cancelViewportRestore = () => {};
  const restoreHistory = (current: VditorState, apply: typeof undo) => {
    cancelViewportRestore();
    const viewport = current.currentMode === 'ir' ? captureUndoViewport(current.ir!.element) : undefined;
    const field = current.currentMode === 'ir' ? current.ir!.element : undefined;
    const before = field?.firstChild;
    let changed = false, rendered: void | Promise<void> = undefined;
    try { apply.call(history, current); changed = field?.firstChild !== before; rendered = onRestore(); }
    finally { viewport?.(changed); }
    if (changed && field && viewport) cancelViewportRestore = restoreUndoAfterLayout(field, viewport, rendered);
  };
  history.undo = current => restoreHistory(current, undo);
  history.redo = current => restoreHistory(current, redo);
  return () => {
    cancelViewportRestore();
    history.addToUndoStack = add; history.recordFirstPosition = first; history.undo = undo; history.redo = redo;
  };
}
