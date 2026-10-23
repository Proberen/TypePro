import type Vditor from 'vditor';

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
  return clone;
}

/** Reuse Vditor's history engine; only its snapshot and restoration boundary change. */
export function installCodeUndoBridge(state: VditorState, onRestore: () => void) {
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
  history.undo = current => { undo.call(history, current); onRestore(); };
  history.redo = current => { redo.call(history, current); onRestore(); };
  return () => {
    history.addToUndoStack = add; history.recordFirstPosition = first; history.undo = undo; history.redo = redo;
  };
}
