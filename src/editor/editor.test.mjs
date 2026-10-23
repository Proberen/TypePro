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

import { safeTextStyle, styledMarkdown, tableMarkdown } from './formatting.ts';
import { reconcileFolds } from './folding.ts';

test('selected font and color roundtrip through sanitized IR and Markdown', () => {
  const lute = globalThis.Lute.New(); lute.SetSanitize(true); lute.SetVditorIR(true);
  const styled = styledMarkdown('**selected**', 'font-family:Georgia;color:#a95662');
  const source = `before ${styled} after\n`;
  const roundtrip = lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(source));
  assert.equal(roundtrip.trim(), source.trim());
  const html = lute.Md2HTML(roundtrip);
  assert.match(html, /font-family:Georgia;color:#a95662/);
  assert.match(html, /<strong>selected<\/strong>/);
  assert.equal(safeTextStyle('color:url(https://bad);font-family:Arial;background-image:url(x);position:fixed'), 'font-family:Arial');
  assert.doesNotMatch(styledMarkdown('text', 'font-family:Georgia" onmouseover="alert(1)'), /onmouseover/);
});

test('M×N tables retain exact rows including the header and validate dimensions', () => {
  const lute = globalThis.Lute.New();
  const html = lute.Md2HTML(tableMarkdown(4, 7));
  assert.equal((html.match(/<tr>/g) || []).length, 4);
  assert.equal((html.match(/<th>/g) || []).length, 7);
  assert.equal((html.match(/<td>/g) || []).length, 21);
  assert.equal((lute.Md2HTML(tableMarkdown(1, 1)).match(/<tr>/g) || []).length, 1);
  for (const [rows, cols] of [[0, 3], [101, 3], [2, 31], [1.5, 2], [NaN, 2]]) assert.throws(() => tableMarkdown(rows, cols));
});

test('identical code blocks retain independent fold states after reload, edits and insertion', () => {
  const previous = [{ id: 'a', code: 'same', collapsed: true }, { id: 'b', code: 'same', collapsed: false }];
  let next = 0;
  const ids = () => `new-${++next}`;
  const reload = reconcileFolds(previous, [{ code: 'same' }, { code: 'same' }], ids);
  assert.deepEqual(reload.map(entry => entry.collapsed), [true, false]);
  const edited = reconcileFolds(previous, [{ id: 'a', code: 'changed' }, { id: 'b', code: 'same' }], ids);
  assert.equal(edited[0].collapsed, true);
  const inserted = reconcileFolds(previous, [{ code: 'same' }, { id: 'a', code: 'same' }, { id: 'b', code: 'same' }], ids);
  assert.deepEqual(inserted.map(entry => [entry.id, entry.collapsed]), [['new-1', false], ['a', true], ['b', false]]);
});

test('folded preview controls and resolved images cannot leak into canonical Markdown', () => {
  const lute = globalThis.Lute.New(); lute.SetVditorIR(true); lute.SetSanitize(true);
  const original = lute.Md2VditorIRDOM('```ts\nconst x = 1;\n```\n');
  const decorated = original.replace('data-type="code-block"', 'data-type="code-block" data-fold-id="abc" class="note-code-collapsed"').replace('</pre>', '</pre><div class="vditor-ir__preview note-code-preview" data-render="1" contenteditable="false"><button>展开代码块</button><span>1 行</span></div>');
  assert.equal(lute.VditorIRDOM2Md(decorated), lute.VditorIRDOM2Md(original));
});

import { locateTextOffset } from './selection.ts';
test('selection restoration keeps paragraph starts after a heading in their own block', () => {
  // Heading and following paragraph have no textContent separator in the IR DOM.
  const lengths = ['一个简单的开始'.length, '先写下来，再慢慢整理。'.length];
  assert.deepEqual(locateTextOffset(lengths, lengths[0], false), [1, 0]);
  assert.deepEqual(locateTextOffset(lengths, lengths[0], true), [0, lengths[0]]);
  assert.deepEqual(locateTextOffset(lengths, lengths[0] + 4, true), [1, 4]);
});

test('font and color markers preserve heading/paragraph boundaries and existing bold', () => {
  const lute = globalThis.Lute.New(); lute.SetSanitize(true); lute.SetVditorIR(true);
  const source = '### 一个简单的开始\n\n**先写下来**，再慢慢整理。\n';
  const ir = lute.Md2VditorIRDOM(source);
  const marker = raw => `<span data-type="html-inline" class="vditor-ir__node"><code class="vditor-ir__marker">${raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</code></span>`;
  const font = marker('<span style="font-family:Georgia">'), color = marker('<span style="color:#a95662">'), end = marker('</span>');
  const styled = ir.replace('>先写下来<', `>${font}${color}先写下来${end}${end}<`);
  const markdown = lute.VditorIRDOM2Md(styled);
  assert.match(markdown, /^### 一个简单的开始\n\n/);
  assert.match(markdown, /\*\*<span style="font-family:Georgia"><span style="color:#a95662">先写下来<\/span><\/span>\*\*，再慢慢整理。/);
  const html = lute.Md2HTML(markdown);
  assert.equal((html.match(/<h3/g) || []).length, 1);
  assert.equal((html.match(/<p>/g) || []).length, 1);
});
