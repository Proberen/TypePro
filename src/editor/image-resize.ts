import { constrainImageWidth } from './image-dimensions.ts';

interface ImageResizeOptions {
  host: HTMLElement;
  field: HTMLElement;
  isEnabled: () => boolean;
  onResize: (change: { image: HTMLImageElement; width: number }) => void;
}

export function imageDragWidth(width: number, height: number, deltaX: number, deltaY: number, corner: string, maximum: number) {
  const ratio = height / Math.max(1, width);
  const horizontal = corner.includes('w') ? -1 : 1, vertical = corner.includes('n') ? -1 : 1;
  return constrainImageWidth(width + (horizontal * deltaX + ratio * vertical * deltaY) / (1 + ratio * ratio), maximum);
}

/** The frame and drag preview live outside IR; a completed gesture commits exactly once. */
export function installImageResizeControls({ host, field, isEnabled, onResize }: ImageResizeOptions) {
  const doc = field.ownerDocument, view = doc.defaultView!;
  const overlay = doc.createElement('div'); overlay.className = 'note-image-resize'; overlay.dataset.typeproImageResize = 'true'; overlay.hidden = true;
  overlay.setAttribute('contenteditable', 'false');
  const mask = doc.createElement('div'); mask.className = 'note-image-resize-mask'; mask.hidden = true;
  const frame = doc.createElement('div'); frame.className = 'note-image-resize-frame';
  const ghost = doc.createElement('img'); ghost.className = 'note-image-resize-ghost'; ghost.draggable = false; ghost.alt = ''; ghost.hidden = true;
  const size = doc.createElement('span'); size.className = 'note-image-resize-size'; size.hidden = true; size.setAttribute('aria-live', 'off');
  frame.append(ghost, size); overlay.append(mask, frame); host.append(overlay);
  let selected: HTMLImageElement | null = null, observed: Element | null = null, scheduled = 0, destroyed = false;
  let drag: { pointer: number; corner: string; x: number; y: number; width: number; height: number; value: number; maximum: number; scale: number; target: HTMLElement } | null = null;
  const corners: [string, string][] = [['nw', '左上角'], ['ne', '右上角'], ['sw', '左下角'], ['se', '右下角']];
  for (const [corner, label] of corners) {
    const handle = doc.createElement('button'); handle.type = 'button'; handle.className = `note-image-resize-handle note-image-resize-${corner}`;
    handle.dataset.imageCorner = corner; handle.setAttribute('aria-label', `调整图片尺寸（${label}）`); handle.title = '等比缩放'; frame.append(handle);
  }
  function contentWidth(image: HTMLImageElement) {
    const parent = image.closest<HTMLElement>('td,th,li,blockquote') || field;
    const rect = parent.getBoundingClientRect(), style = view.getComputedStyle(parent);
    // DOM coordinates include browser zoom/transforms; HTML widths use CSS pixels.
    const scale = parent.offsetWidth > 0 ? rect.width / parent.offsetWidth : 1;
    return Math.max(1, (rect.width / scale) - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0));
  }
  function visibleRect(image: HTMLImageElement) {
    const imageRect = image.getBoundingClientRect(), fieldRect = field.getBoundingClientRect();
    const clip = field.closest<HTMLElement>('.vditor-ir')?.getBoundingClientRect() || fieldRect;
    return imageRect.width > 0 && imageRect.height > 0 && imageRect.right > Math.max(clip.left, 0) && imageRect.left < Math.min(clip.right, view.innerWidth) && imageRect.bottom > Math.max(clip.top, 0) && imageRect.top < Math.min(clip.bottom, view.innerHeight);
  }
  function observe(image: HTMLImageElement | null) {
    if (observed) resizeObserver?.unobserve(observed);
    observed = image;
    if (observed) resizeObserver?.observe(observed);
  }
  function paint() {
    scheduled = 0;
    if (destroyed) return;
    if (!selected || !field.contains(selected) || !isEnabled()) { cancel(); selected = null; observe(null); overlay.hidden = true; return; }
    if (!visibleRect(selected)) { overlay.hidden = true; return; }
    overlay.hidden = false;
    const clip = (field.closest<HTMLElement>('.vditor-ir') || host).getBoundingClientRect();
    overlay.style.clipPath = `inset(${Math.max(0, clip.top)}px ${Math.max(0, view.innerWidth - clip.right)}px ${Math.max(0, view.innerHeight - clip.bottom)}px ${Math.max(0, clip.left)}px)`;
    const rect = selected.getBoundingClientRect();
    const scale = selected.offsetWidth > 0 ? rect.width / selected.offsetWidth : 1;
    if (drag) { drag.maximum = contentWidth(selected); drag.value = constrainImageWidth(drag.value, drag.maximum); }
    const width = drag ? drag.value * scale : rect.width;
    const height = drag ? width * drag.height / drag.width : rect.height;
    frame.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${width}px;height:${height}px`;
    mask.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    if (drag) size.textContent = `${drag.value} × ${Math.max(1, Math.round(drag.value * drag.height / drag.width))}`;
  }
  function refresh() {
    if (!destroyed && !scheduled) scheduled = view.requestAnimationFrame(paint);
  }
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
  resizeObserver?.observe(field);
  function cancel() {
    const current = drag; drag = null;
    if (current) {
      try { current.target.releasePointerCapture(current.pointer); } catch { /* Capture may already be released by the browser. */ }
    }
    mask.hidden = true; ghost.hidden = true; ghost.removeAttribute('src'); size.hidden = true;
  }
  function pointerDown(event: PointerEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (overlay.contains(target)) {
      const handle = target.closest<HTMLElement>('[data-image-corner]');
      if (!handle || !selected || !isEnabled() || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const rect = selected.getBoundingClientRect();
      const scale = selected.offsetWidth > 0 ? rect.width / selected.offsetWidth : 1;
      drag = { pointer: event.pointerId, corner: handle.dataset.imageCorner!, x: event.clientX, y: event.clientY, width: rect.width / scale, height: rect.height / scale, value: rect.width / scale, maximum: contentWidth(selected), scale, target: handle };
      handle.setPointerCapture(event.pointerId); ghost.src = selected.currentSrc || selected.src; ghost.hidden = false; mask.hidden = false; size.hidden = false;
      paint(); return;
    }
    if (target.closest('[data-typepro-block-controls]')) return;
    const image = target.closest<HTMLImageElement>('img');
    if (image && field.contains(image) && !image.closest('.note-diagram,.cm-editor') && isEnabled()) {
      cancel(); selected = image; observe(image); refresh();
    } else { cancel(); selected = null; observe(null); overlay.hidden = true; }
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopPropagation();
    drag.value = imageDragWidth(drag.width, drag.height, (event.clientX - drag.x) / drag.scale, (event.clientY - drag.y) / drag.scale, drag.corner, drag.maximum);
    refresh();
  }
  function pointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopPropagation();
    const image = selected, original = drag.width, width = drag.value;
    cancel();
    if (image && field.contains(image) && isEnabled() && Math.abs(width - original) >= 1) onResize({ image, width });
    refresh();
  }
  function pointerCancel(event: PointerEvent) { if (drag?.pointer === event.pointerId) { cancel(); refresh(); } }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); cancel(); selected = null; observe(null); overlay.hidden = true; field.focus({ preventScroll: true }); return; }
    const target = event.target instanceof Element ? event.target : null;
    if (!selected || !target || !overlay.contains(target) || !isEnabled() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const width = constrainImageWidth(selected.offsetWidth + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) * (event.shiftKey ? 10 : 1), contentWidth(selected));
    onResize({ image: selected, width }); refresh();
  }
  const dragStart = (event: DragEvent) => { if (event.target instanceof Element && event.target.closest('img') && field.contains(event.target)) event.preventDefault(); };
  doc.addEventListener('pointerdown', pointerDown, true);
  doc.addEventListener('pointermove', pointerMove, { capture: true, passive: false });
  doc.addEventListener('pointerup', pointerUp, true);
  doc.addEventListener('pointercancel', pointerCancel, true);
  doc.addEventListener('keydown', keyDown, true);
  doc.addEventListener('scroll', refresh, true);
  field.addEventListener('dragstart', dragStart, true);
  overlay.addEventListener('lostpointercapture', pointerCancel);
  field.addEventListener('load', refresh, true);
  view.addEventListener('resize', refresh);
  view.visualViewport?.addEventListener('resize', refresh);
  view.visualViewport?.addEventListener('scroll', refresh);
  return { refresh, destroy() {
    destroyed = true; cancel(); view.cancelAnimationFrame(scheduled); resizeObserver?.disconnect(); overlay.remove();
    doc.removeEventListener('pointerdown', pointerDown, true); doc.removeEventListener('pointermove', pointerMove, true); doc.removeEventListener('pointerup', pointerUp, true); doc.removeEventListener('pointercancel', pointerCancel, true); doc.removeEventListener('keydown', keyDown, true); doc.removeEventListener('scroll', refresh, true);
    field.removeEventListener('dragstart', dragStart, true); field.removeEventListener('load', refresh, true); overlay.removeEventListener('lostpointercapture', pointerCancel); view.removeEventListener('resize', refresh); view.visualViewport?.removeEventListener('resize', refresh); view.visualViewport?.removeEventListener('scroll', refresh);
  } };
}
