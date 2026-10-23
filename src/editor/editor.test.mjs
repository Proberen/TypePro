import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { SourceBuffer } from './SourceBuffer.ts';

const require = createRequire(import.meta.url);
require('vditor/dist/js/lute/lute.min.js');

test('view transitions retain byte-for-byte original Markdown until an actual edit', () => {
  const original = '---\r\ntitle:  笔记\r\n---\r\n\r\nHeading\r\n=======\r\n\r\n-  item  \r\n';
  const normalized = '---\ntitle: 笔记\n---\n\n# Heading\n\n- item\n';
  const source = new SourceBuffer(original);
  source.baseline(normalized);
  for (let viewChange = 0; viewChange < 6; viewChange++) assert.equal(source.accept(normalized), false);
  assert.equal(source.value, original);
  assert.equal(source.accept(normalized + '\n新内容\n'), true);
  assert.equal(source.value, normalized + '\n新内容\n');
});

test('source input and external updates keep trailing whitespace and no final newline', () => {
  const source = new SourceBuffer('');
  source.replace('first  \n\nlast');
  source.baseline('first\n\nlast\n');
  assert.equal(source.accept('first\n\nlast\n'), false);
  assert.equal(source.value, 'first  \n\nlast');
  source.replace('external\r\n');
  source.baseline('external\n');
  assert.equal(source.accept('external\n'), false);
  assert.equal(source.value, 'external\r\n');
});

test('IR preserves canonical image references and excludes rendered diagram content', () => {
  const lute = globalThis.Lute.New();
  lute.SetSanitize(true);
  lute.SetVditorIR(true);
  lute.SetVditorCodeBlockPreview(false);
  const source = '![image](../../assets/photo.png)\n\n```mermaid\ngraph LR\n A --> B\n```\n';
  const original = lute.Md2VditorIRDOM(source);
  const resolved = original
    .replace('src="../../assets/photo.png"', 'src="data:image/png;base64,AAA" data-note-asset="../../assets/photo.png"')
    .replace('</pre>', '</pre><div class="vditor-ir__preview note-code-preview" data-render="1" contenteditable="false"><svg>rendered graph</svg></div>');
  assert.equal(lute.VditorIRDOM2Md(resolved), lute.VditorIRDOM2Md(original));
  assert.doesNotMatch(lute.VditorIRDOM2Md(resolved), /data:image|rendered graph/);
});

test('HTML rendering strips script tags and inline event handlers', () => {
  const lute = globalThis.Lute.New();
  lute.SetSanitize(true);
  const result = lute.Md2HTML('<img src="x" onerror="alert(1)">\n<script>alert(1)</script>\n<a href="javascript:alert(1)">link</a>');
  assert.doesNotMatch(result, /onerror|<script>|href="javascript:/i);
});

import { changeSourceFormat, EDITOR_SHORTCUTS, headingSourceOffsets, isSourceCode, matchesEditorShortcut } from './commands.ts';
import { sourceOffset, textareaOffset } from './selection.ts';

test('source selections map exactly across CRLF without changing stored bytes', () => {
  const raw = '# 文档\r\n\r\n前方 后方';
  assert.equal(sourceOffset(raw, 9), 11);
  assert.equal(textareaOffset(raw, 11), 9);
  for (let offset = 0; offset <= raw.replace(/\r\n/g, '\n').length; offset++) assert.equal(textareaOffset(raw, sourceOffset(raw, offset)), offset);
});

test('source formatting uses selected text and toggles without destroying neighboring content', () => {
  const bold = changeSourceFormat('before hello after', 7, 12, 'bold');
  assert.equal(bold.text, 'before **hello** after');
  assert.equal(changeSourceFormat(bold.text, bold.start, bold.end, 'bold').text, 'before hello after');
  assert.equal(changeSourceFormat('## heading\nbody', 5, 5, 'paragraph').text, 'heading\nbody');
});

test('slash code detection covers fenced, inline and indented code', () => {
  assert.equal(isSourceCode('```ts\nconst a = ', 17), true);
  assert.equal(isSourceCode('```ts\nx\n```\ntext ', 18), false);
  assert.equal(isSourceCode('`inline ', 8), true);
  assert.equal(isSourceCode('    path ', 9), true);
  assert.equal(isSourceCode('文字 ', 3), false);
});

test('outline source positions skip front matter and fenced code, and include Setext headings', () => {
  const markdown = '---\ntitle: 资料\n---\n\n# 文档\n\n```md\n# 假标题\n```\n\n子标题\n======\n\n### 子节\n';
  assert.deepEqual(headingSourceOffsets(markdown), [markdown.indexOf('# 文档'), markdown.indexOf('子标题'), markdown.indexOf('### 子节')]);
});

test('Mac key bindings distinguish Cmd-Shift and Control-Shift backquote, including Option key glyphs', () => {
  const event = { code: 'Backquote', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
  assert.equal(EDITOR_SHORTCUTS.find(shortcut => matchesEditorShortcut(event, shortcut.binding)).id, 'inlinecode');
  assert.equal(EDITOR_SHORTCUTS.find(shortcut => matchesEditorShortcut({ ...event, metaKey: false, ctrlKey: true }, shortcut.binding)).id, 'strike');
  assert.equal(EDITOR_SHORTCUTS.find(shortcut => matchesEditorShortcut({ code: 'KeyC', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true }, shortcut.binding)).id, 'code');
});
