import { EditorState, Transaction, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { keymap } from '@codemirror/view';

export function createCodeEditorState(value: string, extensions: Extension = []) {
  return EditorState.create({
    doc: value,
    extensions: [
      history(), EditorState.tabSize.of(2), indentUnit.of('  '),
      indentOnInput(), bracketMatching(), closeBrackets(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      extensions,
    ],
  });
}

/** Formatting is one undo step, separate from typing on either side. */
export function formattedCodeTransaction(state: EditorState, value: string) {
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: value },
    annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')],
  });
}

/** Retain an existing fence unless the edited code would terminate it. */
export function safeCodeFence(code: string, original = '```') {
  const fence = /^(?:`{3,}|~{3,})/.exec(original)?.[0] || '```';
  const character = fence[0];
  const runs = code.match(character === '`' ? /`+/g : /~+/g) || [];
  return character.repeat(Math.max(fence.length, ...runs.map(run => run.length + 1)));
}
