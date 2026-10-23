import { adjacentBlock, blockLabel, canMoveBlock, findBlockDropTarget, getBlockTarget, type BlockDropTarget } from './block-targets';
import './block-controls.css';

export type BlockOperation = { type: 'delete'; block: HTMLElement } | { type: 'move'; block: HTMLElement; target: HTMLElement; position: 'before' | 'after' };

interface BlockControlOptions {
  host: HTMLElement;
  field: HTMLElement;
  isEnabled: () => boolean;
  onOperation: (operation: BlockOperation) => void;
}

interface Gesture {
  id: number;
  block: HTMLElement;
  x: number;
  y: number;
  startX: number;
  startY: number;
  touch: boolean;
  dragging: boolean;
  cancelled: boolean;
  menuWasOpen: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export function installBlockControls({ host, field, isEnabled, onOperation }: BlockControlOptions) {
  const doc = field.ownerDocument;
  const view = doc.defaultView!;
  const overlay = doc.createElement('div');
  overlay.className = 'note-block-controls'; overlay.dataset.typeproBlockControls = '';
  const handle = doc.createElement('button');
  handle.type = 'button'; handle.className = 'note-block-handle'; handle.hidden = true;
  handle.setAttribute('aria-label', '块操作'); handle.setAttribute('aria-haspopup', 'menu'); handle.setAttribute('aria-expanded', 'false');
  handle.title = '拖动排序 · 点击操作';
  handle.innerHTML = '<svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="4" cy="9" r="1.2"/><circle cx="10" cy="9" r="1.2"/><circle cx="4" cy="14" r="1.2"/><circle cx="10" cy="14" r="1.2"/></svg>';
  const menu = doc.createElement('div');
  menu.className = 'note-block-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '块操作');
  const up = menuItem('上移', '↑', () => move(-1));
  const down = menuItem('下移', '↓', () => move(1));
  const remove = menuItem('删除', '⌫', () => { if (active) perform({ type: 'delete', block: active }); });
  remove.className = 'note-block-delete';
  menu.append(up, down, remove);
  const line = doc.createElement('div'); line.className = 'note-block-insert-line'; line.hidden = true;
  const ghost = doc.createElement('div'); ghost.className = 'note-block-drag-label'; ghost.hidden = true; ghost.setAttribute('aria-hidden', 'true');
  const live = doc.createElement('span'); live.className = 'note-block-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  overlay.append(handle, menu, line, ghost, live); host.append(overlay);

  let active: HTMLElement | null = null;
  let selected: HTMLElement | null = null;
  let gesture: Gesture | null = null;
  let drop: BlockDropTarget | null = null;
  let frame = 0;
  let dragFrame = 0;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  function menuItem(label: string, key: string, action: () => void) {
    const button = doc.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    const text = doc.createElement('span'); text.textContent = label;
    const hint = doc.createElement('kbd'); hint.textContent = key;
    button.append(text, hint); button.addEventListener('click', event => { event.stopPropagation(); action(); });
    return button;
  }
  function enabled() { return !destroyed && isEnabled() && field.isConnected && field.getClientRects().length > 0; }
  function valid(block: HTMLElement | null): block is HTMLElement { return !!block && field.contains(block) && getBlockTarget(field, block) === block; }
  function ignored(target: EventTarget | null) {
    return target instanceof view.Element && !!target.closest('[data-typepro-block-controls],[data-typepro-image-resize]');
  }
  function choose(block: HTMLElement | null) {
    if (gesture || !menu.hidden || !enabled()) return;
    clearTimeout(leaveTimer);
    const next = valid(block) ? block : null;
    if (active === next) return;
    active = next;
    position();
  }
  function scrollPort() {
    let element = field.parentElement;
    while (element && element !== host.parentElement) {
      if (/(auto|scroll)/.test(view.getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight) return element;
      element = element.parentElement;
    }
    return field.parentElement || host;
  }
  function visibleRect() {
    const rect = scrollPort().getBoundingClientRect();
    const bounds = host.getBoundingClientRect();
    return { top: Math.max(rect.top, bounds.top, 0), bottom: Math.min(rect.bottom, bounds.bottom, view.innerHeight), left: Math.max(rect.left, bounds.left, 0), right: Math.min(rect.right, bounds.right, view.innerWidth) };
  }
  function position() {
    frame = 0;
    if (!enabled()) { cancelGesture(); closeMenu(false); active = selected = null; handle.hidden = true; return; }
    if (!valid(active)) { active = null; handle.hidden = true; closeMenu(false); return; }
    const rect = active.getBoundingClientRect();
    const port = visibleRect();
    const size = view.matchMedia('(pointer: coarse)').matches ? 36 : 28;
    handle.hidden = rect.bottom < port.top || rect.top > port.bottom;
    if (handle.hidden) { closeMenu(false); return; }
    handle.style.left = `${Math.max(port.left + 2, rect.left - size - 3)}px`;
    handle.style.top = `${Math.max(port.top + 2, Math.min(rect.top, port.bottom - size))}px`;
    handle.setAttribute('aria-label', `${blockLabel(active)}操作`);
    up.disabled = !adjacentBlock(field, active, -1); down.disabled = !adjacentBlock(field, active, 1);
    if (!menu.hidden) {
      const handleRect = handle.getBoundingClientRect();
      menu.style.left = `${Math.min(view.innerWidth - 166, Math.max(8, handleRect.left))}px`;
      menu.style.top = `${Math.max(8, Math.min(handleRect.bottom + 4, view.innerHeight - menu.offsetHeight - 8))}px`;
    }
  }
  function schedulePosition() { if (!frame && !destroyed) frame = view.requestAnimationFrame(position); }
  function closeMenu(restoreFocus: boolean) {
    const wasOpen = !menu.hidden; menu.hidden = true; handle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && wasOpen && !handle.hidden) handle.focus({ preventScroll: true });
  }
  function openMenu() {
    if (!enabled() || !valid(active)) return;
    selected = active; menu.hidden = false; handle.setAttribute('aria-expanded', 'true'); position();
    [...menu.querySelectorAll<HTMLButtonElement>('button')].find(button => !button.disabled)?.focus({ preventScroll: true });
  }
  function perform(operation: BlockOperation) {
    if (!enabled() || !valid(operation.block) || (operation.type === 'move' && (!valid(operation.target) || !canMoveBlock(operation.block, operation.target)))) return;
    closeMenu(false);
    const focusControl = overlay.contains(doc.activeElement);
    onOperation(operation);
    live.textContent = operation.type === 'delete' ? '已删除，可撤销' : '已移动，可撤销';
    active = selected = valid(operation.block) ? operation.block : null;
    position();
    if (focusControl) (active ? handle : field).focus({ preventScroll: true });
  }
  function move(direction: -1 | 1) {
    if (!active) return;
    const target = adjacentBlock(field, active, direction);
    if (target) perform({ type: 'move', block: active, target, position: direction < 0 ? 'before' : 'after' });
  }
  function startDrag() {
    if (!gesture || gesture.cancelled || !enabled() || !valid(gesture.block)) return;
    gesture.dragging = true; closeMenu(false); selected = active = gesture.block;
    overlay.classList.add('is-dragging'); handle.setAttribute('aria-expanded', 'false');
    ghost.textContent = `移动${blockLabel(gesture.block)}`; ghost.hidden = false;
    live.textContent = '拖动以排序，按 Escape 取消'; updateDrop(); tickDrag();
  }
  function updateDrop() {
    if (!gesture?.dragging) return;
    const port = visibleRect();
    const inside = gesture.x >= port.left - 36 && gesture.x <= port.right + 8 && gesture.y >= port.top - 8 && gesture.y <= port.bottom + 8;
    drop = inside ? findBlockDropTarget(field, gesture.block, gesture.x, gesture.y) : null;
    ghost.style.left = `${Math.max(8, Math.min(gesture.x + 14, view.innerWidth - 130))}px`;
    ghost.style.top = `${Math.max(8, Math.min(gesture.y + 14, view.innerHeight - 38))}px`;
    line.hidden = !drop;
    if (drop) {
      const rect = drop.block.getBoundingClientRect();
      const y = drop.position === 'before' ? rect.top : rect.bottom;
      line.hidden = y < port.top || y > port.bottom;
      line.style.left = `${Math.max(rect.left, port.left + 8)}px`;
      line.style.width = `${Math.max(20, Math.min(rect.right, port.right - 8) - Math.max(rect.left, port.left + 8))}px`;
      line.style.top = `${y}px`;
    }
  }
  function tickDrag() {
    if (!gesture?.dragging) return;
    if (!enabled() || !valid(gesture.block)) { cancelGesture(); return; }
    const port = visibleRect();
    if (gesture.x >= port.left - 36 && gesture.x <= port.right + 8 && gesture.y >= port.top - 8 && gesture.y <= port.bottom + 8) {
      const edge = 48;
      const speed = gesture.y < port.top + edge ? -Math.min(18, Math.ceil((port.top + edge - gesture.y) / 3))
        : gesture.y > port.bottom - edge ? Math.min(18, Math.ceil((gesture.y - port.bottom + edge) / 3)) : 0;
      if (speed) { scrollPort().scrollTop += speed; updateDrop(); position(); }
    }
    dragFrame = view.requestAnimationFrame(tickDrag);
  }
  function cancelGesture() {
    if (gesture?.timer) clearTimeout(gesture.timer);
    if (gesture && handle.hasPointerCapture(gesture.id)) handle.releasePointerCapture(gesture.id);
    gesture = null; drop = null; view.cancelAnimationFrame(dragFrame); dragFrame = 0;
    line.hidden = ghost.hidden = true; overlay.classList.remove('is-dragging');
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || !enabled() || !valid(active)) return;
    event.preventDefault(); event.stopPropagation(); handle.focus({ preventScroll: true });
    const menuWasOpen = !menu.hidden;
    cancelGesture(); closeMenu(false);
    gesture = { id: event.pointerId, block: active, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, touch: event.pointerType !== 'mouse', dragging: false, cancelled: false, menuWasOpen };
    handle.setPointerCapture(event.pointerId);
    if (gesture.touch) gesture.timer = setTimeout(startDrag, 280);
  }
  function pointerMove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.x = event.clientX; gesture.y = event.clientY;
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.dragging && distance > (gesture.touch ? 10 : 5)) {
      if (gesture.touch) { gesture.cancelled = true; clearTimeout(gesture.timer); }
      else startDrag();
    }
    if (gesture.dragging) { event.preventDefault(); event.stopPropagation(); updateDrop(); }
  }
  function pointerUp(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const block = gesture.block; const wasDrag = gesture.dragging; const wasCancelled = gesture.cancelled; const menuWasOpen = gesture.menuWasOpen;
    const target = drop; cancelGesture();
    if (wasDrag && target) perform({ type: 'move', block, target: target.block, position: target.position });
    else if (!wasDrag && !wasCancelled && !menuWasOpen) openMenu();
    schedulePosition();
  }
  function hover(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.buttons || ignored(event.target)) return;
    choose(getBlockTarget(field, event.target as Node));
  }
  function select(event: PointerEvent) {
    if (ignored(event.target) || !enabled()) return;
    if (field.contains(event.target as Node)) { selected = getBlockTarget(field, event.target as Node); closeMenu(false); choose(selected); }
    else { closeMenu(false); selected = null; choose(null); }
  }
  function selectionChange() {
    if (gesture || overlay.contains(doc.activeElement)) return;
    const block = getBlockTarget(field, doc.getSelection()?.anchorNode || null);
    if (block) { selected = block; choose(block); }
  }
  function leave() { leaveTimer = setTimeout(() => choose(selected), 120); }
  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); if (active) perform({ type: 'delete', block: active });
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowUp' ? -1 : 1);
    }
  }
  function menuKey(event: KeyboardEvent) {
    if (event.key === 'Tab') { closeMenu(false); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.disabled);
    const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || (!gesture && menu.hidden)) return;
    event.preventDefault(); event.stopPropagation(); cancelGesture(); closeMenu(true); handle.focus({ preventScroll: true });
  }
  function nativeImageDrag(event: DragEvent) {
    if (enabled() && event.target instanceof view.Element && event.target.closest('img')) event.preventDefault();
  }
  function cancelled() { cancelGesture(); closeMenu(false); schedulePosition(); }

  handle.addEventListener('pointerdown', pointerDown);
  handle.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    // Pointer taps are handled on pointerup, including touch browsers that omit click after capture.
    if (event.detail === 0) { if (menu.hidden) openMenu(); else closeMenu(true); }
  });
  handle.addEventListener('keydown', handleKey); menu.addEventListener('keydown', menuKey);
  overlay.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
  overlay.addEventListener('pointerleave', leave);
  field.addEventListener('pointermove', hover); field.addEventListener('pointerleave', leave);
  field.addEventListener('dragstart', nativeImageDrag, true);
  doc.addEventListener('pointerdown', select, true);
  doc.addEventListener('pointermove', pointerMove, { capture: true, passive: false });
  doc.addEventListener('pointerup', pointerUp, true); doc.addEventListener('pointercancel', cancelled, true);
  doc.addEventListener('selectionchange', selectionChange); doc.addEventListener('keydown', escape, true);
  doc.addEventListener('scroll', schedulePosition, true); view.addEventListener('resize', schedulePosition);
  view.addEventListener('blur', cancelled); view.addEventListener('pagehide', cancelled);
  const resize = new ResizeObserver(schedulePosition); resize.observe(field); resize.observe(host);
  const observer = new MutationObserver(records => {
    if (records.every(record => record.target.parentElement?.closest('.cm-editor,[data-render],.note-code-preview'))) return;
    schedulePosition();
  });
  observer.observe(field, { childList: true, subtree: true, characterData: true });

  return {
    refresh() { if (gesture && !enabled()) cancelGesture(); position(); },
    destroy() {
      cancelGesture(); destroyed = true; clearTimeout(leaveTimer); view.cancelAnimationFrame(frame);
      resize.disconnect(); observer.disconnect(); overlay.remove();
      field.removeEventListener('pointermove', hover); field.removeEventListener('pointerleave', leave); field.removeEventListener('dragstart', nativeImageDrag, true);
      doc.removeEventListener('pointerdown', select, true); doc.removeEventListener('pointermove', pointerMove, true);
      doc.removeEventListener('pointerup', pointerUp, true); doc.removeEventListener('pointercancel', cancelled, true);
      doc.removeEventListener('selectionchange', selectionChange); doc.removeEventListener('keydown', escape, true); doc.removeEventListener('scroll', schedulePosition, true);
      view.removeEventListener('resize', schedulePosition); view.removeEventListener('blur', cancelled); view.removeEventListener('pagehide', cancelled);
    },
  };
}
