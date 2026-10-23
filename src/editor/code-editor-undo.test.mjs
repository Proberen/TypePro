import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { redo, undo } from '@codemirror/commands';
import { createCodeEditorState } from './code-editor-state.ts';
import { installCodeUndoBridge } from './code-editor-undo.ts';

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
