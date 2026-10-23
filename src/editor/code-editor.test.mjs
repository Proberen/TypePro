import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { EditorSelection, Transaction } from '@codemirror/state';
import { deleteBracketPair, insertBracket } from '@codemirror/autocomplete';
import { indentLess, indentWithTab, redo, undo } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxTree } from '@codemirror/language';
import { createCodeEditorState, formattedCodeTransaction, safeCodeFence } from './code-editor-state.ts';

const require = createRequire(import.meta.url);
require('vditor/dist/js/lute/lute.min.js');

function editor(value, extensions = []) {
  let state = createCodeEditorState(value, extensions);
  return {
    get state() { return state; },
    dispatch(transaction) { state = transaction.state; },
    update(spec) { state = state.update(spec).state; },
  };
}

test('CodeMirror edits are plain text with live parser state and isolated undo history', () => {
  const first = editor('const value = 1;', javascript());
  const second = editor('let other = 2;', javascript());
  first.update({ changes: { from: 14, to: 15, insert: '42' }, annotations: Transaction.userEvent.of('input.type') });
  assert.equal(first.state.doc.toString(), 'const value = 42;');
  assert.match(syntaxTree(first.state).toString(), /VariableDeclaration.*Number/);
  assert.equal(undo(first), true);
  assert.equal(first.state.doc.toString(), 'const value = 1;');
  assert.equal(second.state.doc.toString(), 'let other = 2;');
  assert.equal(redo(first), true);
  assert.equal(first.state.doc.toString(), 'const value = 42;');
});

test('Tab indents the selected code and Shift-Tab reverses it without dropping text', () => {
  const view = editor('const a = 1;\nconst b = 2;');
  view.update({ selection: EditorSelection.single(0, view.state.doc.length) });
  assert.equal(indentWithTab.run(view), true);
  assert.equal(view.state.doc.toString(), '  const a = 1;\n  const b = 2;');
  assert.equal(indentLess(view), true);
  assert.equal(view.state.doc.toString(), 'const a = 1;\nconst b = 2;');
});

test('formatting is a single undo step separate from typing before and after', () => {
  const view = editor('const a=1;');
  view.update({ changes: { from: 10, insert: '\nconst b=2;' }, annotations: Transaction.userEvent.of('input.type') });
  const before = view.state.doc.toString();
  view.dispatch(formattedCodeTransaction(view.state, 'const a = 1;\nconst b = 2;\n'));
  view.update({ changes: { from: view.state.doc.length, insert: '// 继续' }, annotations: Transaction.userEvent.of('input.type') });
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), 'const a = 1;\nconst b = 2;\n');
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), before);
  assert.equal(redo(view), true);
  assert.equal(view.state.doc.toString(), 'const a = 1;\nconst b = 2;\n');
});

test('bracket completion and paired deletion retain the code selection', () => {
  const pair = editor('');
  pair.dispatch(insertBracket(pair.state, '('));
  assert.equal(pair.state.doc.toString(), '()');
  assert.equal(pair.state.selection.main.head, 1);
  assert.equal(deleteBracketPair(pair), true);
  assert.equal(pair.state.doc.toString(), '');
  const view = editor('中文与 emoji 👋');
  view.update({ changes: { from: view.state.doc.length, insert: '\n继续输入' } });
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), '中文与 emoji 👋');
});

test('code containing Markdown fences roundtrips without terminating its block', () => {
  const lute = globalThis.Lute.New(); lute.SetVditorIR(true); lute.SetSanitize(true);
  const code = 'const fence = "```";\nconst raw = "<script>不会执行</script>";\n';
  const fence = safeCodeFence(code, '```');
  assert.equal(fence, '````');
  assert.equal(safeCodeFence('plain', '~~~~~'), '~~~~~');
  assert.equal(safeCodeFence('~~~', '~~~'), '~~~~');
  const source = `${fence}javascript\n${code}${fence}\n`;
  const ir = lute.Md2VditorIRDOM(source);
  const decorated = ir.replace('data-type="code-block"', 'data-type="code-block" class="note-code-editable" contenteditable="false"')
    .replace('</pre>', '</pre><div class="vditor-ir__preview note-code-preview" data-render="1" contenteditable="false"><div class="cm-editor"><div class="cm-line">WIDGET MUST NOT LEAK</div></div></div>');
  const result = lute.VditorIRDOM2Md(decorated);
  assert.equal(result, lute.VditorIRDOM2Md(ir));
  assert.doesNotMatch(result, /WIDGET MUST NOT LEAK|cm-editor|contenteditable/);
  assert.match(result, /const fence = "```"/);
  assert.equal((lute.Md2HTML(result).match(/<pre>/g) || []).length, 1);
});
