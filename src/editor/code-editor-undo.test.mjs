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
  ownerDocument = { defaultView: { getSelection: () => null } };
  get innerHTML() { return this.html + (this.widget ? '<div class="cm-editor">runtime widget</div>' : ''); }
  set innerHTML(value) { this.html = value; this.widget = false; }
  cloneNode() { return new Field(this.html, this.widget); }
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
