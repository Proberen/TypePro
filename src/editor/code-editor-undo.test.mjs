import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { redo, undo } from '@codemirror/commands';
import { createCodeEditorState } from './code-editor-state.ts';
import { installCodeUndoBridge, runIRTransaction } from './code-editor-undo.ts';

const require = createRequire(import.meta.url);
// Exercise the installed Vditor history engine itself. Only browser layout,
// toolbar drawing and selection are stubbed; its patch/undo/redo logic is real.
const nativeSource = readFileSync(new URL('../../node_modules/vditor/src/ts/undo/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export {Undo};', '');
const NativeUndo = runInNewContext(stripTypeScriptTypes(nativeSource) + '\nUndo;', {
  DiffMatchPatch: require('diff-match-patch'),
  getSelection: () => ({ rangeCount: 0, getRangeAt: () => ({ setEndBefore() {}, collapse() {} }) }),
  disableToolbar() {}, enableToolbar() {}, hidePanel() {}, isFirefox: () => false, isSafari: () => false,
  scrollCenter() {}, execAfterRender() {}, highlightToolbar() {}, processCodeRender() {}, setRangeByWbr() {}, setSelectionFocus() {}, renderToc() {},
});

// A string-backed IR field is sufficient for history snapshots. Runtime widget
// removal is modelled separately, so leaked widget HTML fails the assertions.
class Field {
  constructor(html, widget = true) { this.html = html; this.widget = widget; }
  dom = {};
  isConnected = true;
  ownerDocument = { defaultView: { getSelection: () => null } };
  get innerHTML() { return this.html + (this.widget ? '<div class="cm-editor">runtime widget</div>' : ''); }
  set innerHTML(value) { this.html = value; this.widget = false; this.dom = {}; }
  get firstChild() { return this.dom; }
  cloneNode() { return new Field(this.html, this.widget); }
  closest() { return null; }
  contains(node) { return node === this; }
  getAttribute() { return 'true'; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    return selector === '[data-type="code-block"] > .vditor-ir__preview' && this.widget ? [{ remove: () => { this.widget = false; } }] : [];
  }
}

test('native document undo/redo and independent code undo/redo can alternate without losing either edit', () => {
  let codeState = createCodeEditorState('const value = 1;');
  const code = { get state() { return codeState; }, dispatch(transaction) { codeState = transaction.state; syncCode(); } };
  const field = new Field('<pre><code>const value = 1;</code></pre><p>正文</p>');
  const history = new NativeUndo();
  const state = { currentMode: 'ir', ir: { element: field }, undo: history, toolbar: { elements: {} } };
  const syncCode = () => { field.html = field.html.replace(/<code>[\s\S]*?<\/code>/, `<code>${codeState.doc}</code>`); };
  const restore = installCodeUndoBridge(state, syncCode);
  history.addToUndoStack(state);

  // Code change B, followed by the baseline committed before new body input.
  code.dispatch(codeState.update({ changes: { from: 14, to: 15, insert: '42' } }));
  history.addToUndoStack(state);
  field.html = field.html.replace('正文</p>', '正文X</p>');
  history.addToUndoStack(state);
  assert.doesNotMatch(history.ir.lastText, /cm-editor|runtime widget/);

  history.undo(state);
  assert.match(field.html, /value = 42/);
  assert.match(field.html, /<p>正文<\/p>/);
  assert.equal(undo(code), true);
  assert.match(field.html, /value = 1/);
  history.redo(state);
  assert.match(field.html, /<p>正文X<\/p>/);
  assert.match(field.html, /value = 1/);
  assert.equal(redo(code), true);
  assert.match(field.html, /value = 42/);
  history.undo(state);
  assert.match(field.html, /<p>正文<\/p>/);
  assert.match(field.html, /value = 42/);
  history.redo(state);
  assert.match(field.html, /<p>正文X<\/p>/);
  assert.match(field.html, /value = 42/);
  restore();
});

test('moving and deleting canonical blocks use one native undo step and retain pending body input', () => {
  const heading = '<h1 data-block="0">标题</h1>';
  const code = '<div data-type="code-block" data-fold-id="stable"><pre><code>const x = 1;</code></pre></div>';
  const field = new Field(heading + '<p>正文</p>' + code);
  const history = new NativeUndo();
  const state = { currentMode: 'ir', ir: { element: field }, undo: history, toolbar: { elements: {} } };
  const restore = installCodeUndoBridge(state, () => {});
  history.addToUndoStack(state);
  field.html = field.html.replace('正文', '正文新输入');
  const before = field.html;
  const moved = '<p>正文新输入</p>' + code + heading;
  assert.equal(runIRTransaction(state, () => { field.html = moved; return true; }), true);
  assert.equal(history.ir.undoStack.length, 3);
  history.undo(state); assert.equal(field.html, before);
  history.redo(state); assert.equal(field.html, moved);
  runIRTransaction(state, () => { field.html = field.html.replace(code, ''); return true; });
  history.undo(state); assert.equal(field.html, moved);
  history.redo(state); assert.equal(field.html, '<p>正文新输入</p>' + heading);
  assert.doesNotMatch(history.ir.lastText, /cm-editor|runtime widget/);
  restore();
});

test('image resize is one native transaction, preserving canonical attachment references through undo/redo', () => {
  const original = '<p data-block="0">left<img src="../../assets/a.png" alt="图">right</p>';
  const resized = '<p data-block="0">left<img src="../../assets/a.png" alt="图" width="240">right</p>';
  const field = new Field(original, false);
  const history = new NativeUndo();
  const state = { currentMode: 'ir', ir: { element: field }, undo: history, toolbar: { elements: {} } };
  const restore = installCodeUndoBridge(state, () => {});
  history.addToUndoStack(state);
  runIRTransaction(state, () => { field.html = resized; return true; });
  history.undo(state); assert.equal(field.html, original);
  history.redo(state); assert.equal(field.html, resized);
  restore();
});

// Only layout and native caret geometry are supplied here; NativeUndo still
// applies its real patches and the production bridge restores the viewport.
function viewportHistory(caretY, afterRebuild = () => {}) {
  const layout = {
    scrollTop: 1200, scrollLeft: 37, clientHeight: 400, clientTop: 0, isConnected: true,
    getBoundingClientRect: () => ({ top: 100 }),
  };
  class ViewportField extends Field {
    get innerHTML() { return super.innerHTML; }
    set innerHTML(value) {
      super.innerHTML = value;
      // Replacing previews with canonical source temporarily shrinks layout.
      port.scrollTop = 0; port.scrollLeft = 0;
    }
    closest() { throw new Error('the IR wrapper is not the scrolling field'); }
  }
  const field = new ViewportField('<p>正文</p>', false);
  const port = Object.assign(field, layout);
  const history = new NativeUndo();
  const state = { currentMode: 'ir', ir: { element: field }, undo: history, toolbar: { elements: {} } };
  let rebuilds = 0;
  let previous = field.firstChild;
  const dispose = installCodeUndoBridge(state, () => {
    rebuilds++;
    if (field.firstChild !== previous) assert.equal(port.scrollTop, 0, 'native replacement must precede preview restoration');
    previous = field.firstChild;
    if (caretY !== null) field.ownerDocument.defaultView.getSelection = () => ({
      rangeCount: 1, focusNode: field,
      getRangeAt: () => ({ cloneRange: () => ({
        collapse() {},
        getClientRects: () => [{ top: 100 + caretY - port.scrollTop, bottom: 120 + caretY - port.scrollTop, height: 20 }],
      }) }),
    });
    return afterRebuild(field, port);
  });
  history.addToUndoStack(state);
  field.html = '<p>正文新输入</p>'; history.addToUndoStack(state);
  return { field, history, state, port, dispose, get rebuilds() { return rebuilds; } };
}

test('document undo and redo restore the scroll port after widget rebuilding when the caret stays visible', () => {
  const api = viewportHistory(1300);
  api.history.undo(api.state);
  assert.equal(api.field.html, '<p>正文</p>');
  assert.equal(api.port.scrollTop, 1200); assert.equal(api.port.scrollLeft, 37);
  api.history.redo(api.state);
  assert.equal(api.field.html, '<p>正文新输入</p>');
  assert.equal(api.port.scrollTop, 1200); assert.equal(api.port.scrollLeft, 37);
  assert.equal(api.rebuilds, 2); api.dispose();
});

test('restored offscreen carets scroll only the distance needed to enter the viewport', () => {
  for (const [caretY, expected] of [[1700, 1328], [1000, 992]]) {
    const api = viewportHistory(caretY); api.history.undo(api.state);
    assert.equal(api.port.scrollTop, expected);
    assert.equal(api.port.scrollLeft, 37); api.dispose();
  }
});

test('undo without a valid restored selection preserves position and later user scrolling remains untouched', () => {
  const api = viewportHistory(null); api.history.undo(api.state);
  assert.equal(api.port.scrollTop, 1200);
  api.port.scrollTop = 1460;
  assert.equal(api.port.scrollTop, 1460); api.dispose();
});

test('exhausted history does not scroll to an existing offscreen caret', () => {
  const api = viewportHistory(1300); api.history.undo(api.state);
  api.port.scrollTop = 1800;
  api.history.undo(api.state);
  assert.equal(api.port.scrollTop, 1800); api.dispose();
});

test('a restored caret between component blocks reveals the adjacent edge without centering the whole component', () => {
  const api = viewportHistory(null);
  api.field.nodeType = 1;
  api.field.childNodes = [{
    nodeType: 1,
    getBoundingClientRect: () => ({ top: 1800 - api.port.scrollTop, bottom: 2200 - api.port.scrollTop, height: 400 }),
  }];
  api.field.ownerDocument.defaultView.getSelection = () => ({
    rangeCount: 1, focusNode: api.field,
    getRangeAt: () => ({ cloneRange: () => ({
      collapse() {}, getClientRects: () => [], startContainer: api.field, startOffset: 0,
    }) }),
  });
  api.history.undo(api.state);
  assert.equal(api.port.scrollTop, 1308); api.dispose();
});

// Drive real Promise and single-frame boundaries without browser timers.
function delayedViewport() {
  let resolveAssets, resolveImage, imageReads = 0, maximum = 3000, scroll = 1200;
  const assets = new Promise(resolve => { resolveAssets = resolve; });
  const decoded = new Promise(resolve => { resolveImage = resolve; });
  const api = viewportHistory(1300, () => { maximum = 600; return assets; });
  const document = Object.assign(new EventTarget(), api.field.ownerDocument);
  const listeners = new Set();
  document.addEventListener = (name, ...args) => { listeners.add(name); EventTarget.prototype.addEventListener.call(document, name, ...args); };
  document.removeEventListener = (name, ...args) => { listeners.delete(name); EventTarget.prototype.removeEventListener.call(document, name, ...args); };
  const window = Object.assign(new EventTarget(), document.defaultView);
  document.defaultView = window; api.field.ownerDocument = document;
  const frames = new Map(); let nextFrame = 0;
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const originalQuery = api.field.querySelectorAll.bind(api.field);
  api.field.querySelectorAll = selector => selector === 'img'
    ? [{ decode: () => { imageReads++; return decoded; } }] : originalQuery(selector);
  Object.defineProperty(api.port, 'scrollTop', { configurable: true, get: () => scroll, set: value => { scroll = Math.min(value, maximum); } });
  return {
    ...api, document, window, frames,
    async assetsReady() { resolveAssets(); await Promise.resolve(); await Promise.resolve(); },
    async imagesReady() { maximum = 3000; resolveImage(); for (let i = 0; i < 5; i++) await Promise.resolve(); },
    flushFrame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    get imageReads() { return imageReads; }, get listenerCount() { return listeners.size; },
  };
}

test('one final frame restores a viewport clamped before asset resolution and image decoding finish', async () => {
  const api = delayedViewport(); api.history.undo(api.state);
  assert.equal(api.port.scrollTop, 600, 'synchronous restore is constrained by unfinished layout');
  assert.equal(api.imageReads, 0, 'do not decode stale source before asset resolution');
  assert.equal(api.frames.size, 0);
  await api.assetsReady(); assert.equal(api.imageReads, 1); assert.equal(api.frames.size, 0);
  await api.imagesReady(); assert.equal(api.frames.size, 1);
  api.flushFrame(); assert.equal(api.port.scrollTop, 1200); assert.equal(api.port.scrollLeft, 37); assert.equal(api.listenerCount, 0);
  api.port.scrollTop = 1400; api.document.dispatchEvent(new Event('keydown'));
  assert.equal(api.port.scrollTop, 1400); assert.equal(api.frames.size, 0); api.dispose();
});

test('new input cancels a pending viewport restore throughout asset, decode and frame phases', async () => {
  for (const phase of ['assets', 'decode', 'frame']) {
    for (const event of ['keydown', 'beforeinput', 'input', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove']) {
      const api = delayedViewport(); api.history.undo(api.state);
      if (phase !== 'assets') await api.assetsReady();
      if (phase === 'frame') await api.imagesReady();
      api.document.dispatchEvent(new Event(event)); assert.equal(api.listenerCount, 0);
      api.port.scrollTop = 220;
      await api.assetsReady(); await api.imagesReady(); api.flushFrame();
      assert.equal(api.port.scrollTop, 220, `${phase}: ${event} must preserve the user's newer position`);
      assert.equal(api.frames.size, 0); api.dispose();
    }
  }
});

test('a later undo, disposal or window blur cancels the pending frame and its input listeners', async () => {
  for (const action of ['undo', 'dispose', 'blur']) {
    const api = delayedViewport(); api.history.undo(api.state); await api.assetsReady(); await api.imagesReady();
    assert.equal(api.frames.size, 1);
    if (action === 'undo') api.history.undo(api.state); // Exhausted history still invalidates older restoration.
    if (action === 'dispose') api.dispose();
    if (action === 'blur') api.window.dispatchEvent(new Event('blur'));
    api.port.scrollTop = 220; api.flushFrame();
    assert.equal(api.port.scrollTop, 220); assert.equal(api.frames.size, 0); assert.equal(api.listenerCount, 0); api.dispose();
  }
});

test('an asynchronously changed selection or replaced document cannot receive the old viewport', async () => {
  for (const change of ['selection', 'document', 'disconnected', 'focus']) {
    const api = delayedViewport(); api.history.undo(api.state); await api.assetsReady(); await api.imagesReady();
    if (change === 'selection') api.window.getSelection = () => ({ rangeCount: 0, focusNode: null });
    if (change === 'document') api.field.dom = {};
    if (change === 'disconnected') api.field.isConnected = false;
    if (change === 'focus') api.document.activeElement = {};
    api.port.scrollTop = 220; api.flushFrame(); assert.equal(api.port.scrollTop, 220, change); assert.equal(api.listenerCount, 0); api.dispose();
  }
});
