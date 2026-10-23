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
