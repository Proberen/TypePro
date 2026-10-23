import assert from 'node:assert/strict';
import test from 'node:test';
import { FORMAT_LANGUAGES, formatCodeCore, formatLanguage } from './core.ts';
import { formatMermaidPreservingText } from './mermaid.ts';

// The production worker uses /vite entries; these are the same compiled WASM
// engines' documented Node entries, without rebuilding any toolchain.
const wasm = {
  async go(source) { return (await import('@wasm-fmt/gofmt/node')).format(source); },
  async python(source) { return (await import('@wasm-fmt/ruff_fmt/node')).format(source, 'note.py', { indent_style: 'space', indent_width: 4, line_width: 88, quote_style: 'double' }); },
  async bash(source) { return (await import('@wasm-fmt/shfmt/node')).format(source, 'note.bash', { indent: 2, simplify: false }); },
  async rust(source) { return (await import('@scalar/rust-fmt')).format(source, { maxWidth: 88, tabSpaces: 4, edition: '2021' }); },
};

const fixtures = {
  typescript: 'const f=(x:number)=>{return {x}}',
  javascript: 'const value={hello:"world",n:1};',
  python: 'def add( a,b ):\n return [a,b]\n',
  java: 'class Hello{public static void main(String[] args){System.out.println("Hi");}}',
  json: '{"a":1,"b":[2,3]}',
  css: '.note{color:red;background:#fff}',
  xml: '<div>\n <span>Hi</span>\n</div>',
  bash: 'if true;then echo "hello";fi',
  sql: 'select name,count(*) from notes where active=true group by name;',
  rust: 'fn main(){let x=1;println!("{}",x);}',
  go: 'package main\nfunc main(){println("hi")}',
  markdown: '#  标题\n\n* one\n* two',
  mermaid: 'flowchart TD\nA[开始] --> B{判断}\nB -->|是| C[完成]',
  plaintext: 'a  \r\n  b\t\nlast\t',
};

test('every code language exposed by the editor has a real successful formatter', async (t) => {
  assert.deepEqual(Object.keys(fixtures).sort(), [...FORMAT_LANGUAGES].sort());
  for (const [language, source] of Object.entries(fixtures)) await t.test(language, async () => {
    const result = await formatCodeCore(language, source, wasm);
    assert.equal(typeof result, 'string');
    assert.notEqual(result, source);
    assert.ok(result.trim());
    assert.equal(await formatCodeCore(language, result, wasm), result, 'formatting must be idempotent');
  });
});

test('syntax/load errors reject rather than returning or changing the original', async (t) => {
  const failures = {
    typescript: 'const : =', javascript: 'function () {', python: 'def broken(:',
    java: 'class Missing { public void (', json: '{"a": }', css: '.a { color: ',
    xml: '<div><span></div>', bash: 'if then', sql: "select 'unterminated",
    rust: 'fn main( {', go: 'package main\nfunc (', mermaid: 'not a diagram',
  };
  for (const [language, source] of Object.entries(failures)) await t.test(language, async () => {
    let editorCode = source;
    await assert.rejects(async () => { editorCode = await formatCodeCore(language, editorCode, wasm); });
    assert.equal(editorCode, source);
  });
  const noWasm = { ...wasm, go: async () => { throw new Error('offline asset missing'); } };
  await assert.rejects(formatCodeCore('go', fixtures.go, noWasm), /offline asset missing/);
  // Markdown and plain text accept arbitrary text by definition; they have no
  // parser-error fiction. Invalid input types still obey the rejection contract.
  await assert.rejects(formatCodeCore('markdown', null, wasm), /必须是文本/);
  await assert.rejects(formatCodeCore('plaintext', null, wasm), /必须是文本/);
});

test('Java supports full classes, method/statement/expression snippets', async () => {
  for (const source of [
    'public int add(int a,int b){return a+b;}',
    'if(true){System.out.println("hello");}',
    'a+b*2',
  ]) {
    const result = await formatCodeCore('java', source, wasm);
    assert.equal(await formatCodeCore('java', result, wasm), result);
    assert.ok(result.includes(source.includes('println') ? 'println' : '+'));
  }
});

test('plaintext changes only trailing horizontal whitespace, retaining CRLF and final-newline presence', async () => {
  assert.equal(await formatCodeCore('plaintext', ' a  \r\n\tb\t\nlast', wasm), ' a\r\n\tb\nlast');
  assert.equal(await formatCodeCore('plaintext', ' a  \n', wasm), ' a\n');
  assert.equal(await formatCodeCore('plaintext', '', wasm), '');
});

test('aliases match code-language menus and unsupported languages reject', () => {
  for (const [name, expected] of [[' TS ', 'typescript'], ['js', 'javascript'], ['py', 'python'], ['html', 'xml'], ['shell', 'bash'], ['sh', 'bash'], ['md', 'markdown'], ['text', 'plaintext']]) assert.equal(formatLanguage(name), expected);
  assert.throws(() => formatLanguage('unknown'), /暂不支持/);
});

test('Mermaid layout preserves labels, branch text, styles, comments and nested blocks', () => {
  const source = `flowchart TD
subgraph "Group  A"
A["  Hello  world  "] -->| spaced  branch | B[结束]
subgraph Child
B --> C[子节点]
end
end
classDef chosen fill:#fff,stroke:#74ade5;
class A chosen
%% comment  keeps   spacing`;
  const result = formatMermaidPreservingText(source);
  assert.ok(result.includes('    A["  Hello  world  "] -->| spaced  branch | B[结束]'));
  assert.ok(result.includes('      B --> C[子节点]'));
  assert.ok(result.includes('classDef chosen fill:#fff,stroke:#74ade5;'));
  assert.ok(result.includes('%% comment  keeps   spacing'));
  assert.equal(formatMermaidPreservingText(result), result);
  assert.deepEqual(result.split('\n').map((line) => line.trim()).filter(Boolean), source.split('\n').map((line) => line.trim()).filter(Boolean));
});

test('Mermaid multiline labels, directives and front matter stay byte-for-byte content data', () => {
  const directive = '%%{init: {\n "themeVariables": { "fontSize": "16px" }\n}}%%';
  const frontMatter = '---\ntitle: "  Keep   Title "\nconfig:\n  theme: base\n---\n';
  const quote = '"first\n  second  line\n last"';
  const rawLabel = '[raw\n  data  line]';
  const source = `${frontMatter}${directive}\nflowchart TD\nA[${quote}] --> B${rawLabel}`;
  const result = formatMermaidPreservingText(source);
  assert.ok(result.startsWith(frontMatter));
  assert.ok(result.includes(directive));
  assert.ok(result.includes(quote));
  assert.ok(result.includes(rawLabel));
  assert.equal(formatMermaidPreservingText(result), result);
});

test('Mermaid sequence messages and mindmap hierarchy retain meaningful whitespace', () => {
  const sequence = 'sequenceDiagram\nAlice->>Bob:  Keep   message\nalt condition\nBob-->>Alice:  yes  indeed\nelse other\nBob-->>Alice: no\nend';
  const formatted = formatMermaidPreservingText(sequence);
  assert.ok(formatted.includes('Alice->>Bob:  Keep   message'));
  assert.ok(formatted.includes('    Bob-->>Alice:  yes  indeed'));
  assert.equal(formatMermaidPreservingText(formatted), formatted);
  const mindmap = 'mindmap\n  root((Root))\n    one\n      child\n    two';
  assert.equal(formatMermaidPreservingText(mindmap), mindmap + '\n');
});
