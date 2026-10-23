import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { constrainImageWidth, htmlImageTags, imageWidthMarkup, isStandaloneImageHtml, replaceHtmlImageWidth } from './image-dimensions.ts';
import { imageDragWidth } from './image-resize.ts';

const require = createRequire(import.meta.url);
require('vditor/dist/js/lute/lute.min.js');

test('all four image corners change width proportionally and respect body width', () => {
  for (const [corner, x, y] of [['se', 100, 50], ['sw', -100, 50], ['ne', 100, -50], ['nw', -100, -50]]) {
    assert.equal(imageDragWidth(200, 100, x, y, corner, 1000), 300);
    assert.equal(imageDragWidth(200, 100, x, y, corner, 240), 240);
    assert.equal(imageDragWidth(200, 100, -x * 3, -y * 3, corner, 1000), 24);
  }
  assert.equal(constrainImageWidth(300, 12), 12);
  assert.equal(constrainImageWidth(300, 0), 1);
});

test('HTML image width replacement changes only selected image and retains neighboring text', () => {
  const original = '<div>before<img src="../../assets/a.png" alt="first > alt" width="600" height="300" style="border:0;width:600px;height:300px">between<img src="../../assets/a.png" alt="second" width="120"><p>after</p></div>';
  const changed = replaceHtmlImageWidth(original, 0, 320);
  assert.equal(changed, '<div>before<img src="../../assets/a.png" alt="first > alt" style="border:0" width="320">between<img src="../../assets/a.png" alt="second" width="120"><p>after</p></div>');
  assert.equal(replaceHtmlImageWidth(original, 1, 240), original.replace('alt="second" width="120"', 'alt="second" width="240"'));
  assert.equal(replaceHtmlImageWidth(original, 2, 240), null);
  assert.equal(replaceHtmlImageWidth(original, 0, NaN), null);
});

test('HTML tag scanning ignores comments, raw text and template images', () => {
  const source = '<!-- <img src="comment"> --><script>"<img src=script>"</script><style>img::before{content:"<img src=style>"}</style><textarea><img src=textarea></textarea><template><template><img src=nested></template><img src=template></template><img src="../../assets/visible.png" title="quoted > value"><img src=second>';
  assert.deepEqual(htmlImageTags(source).map(tag => tag.value), ['<img src="../../assets/visible.png" title="quoted > value">', '<img src=second>']);
  assert.equal(replaceHtmlImageWidth(source, 1, 87), source.replace('<img src=second>', '<img src=second width="87">'));
});

test('canonical width HTML retains local asset, alt and title through real sanitized Lute IR', () => {
  const lute = globalThis.Lute.New(); lute.SetSanitize(true); lute.SetVditorIR(true);
  const html = imageWidthMarkup({ src: '../../assets/a.png', alt: 'a & "<b>', title: 'title & "quote"' }, 321);
  assert.equal(html, '<img src="../../assets/a.png" alt="a &amp; &quot;&lt;b&gt;" title="title &amp; &quot;quote&quot;" width="321">');
  const source = `before ${html} after\n`;
  const ir = lute.Md2VditorIRDOM(source);
  assert.match(ir, /data-type="html-inline"/);
  assert.equal(lute.VditorIRDOM2Md(ir), source);
  const rendered = lute.Md2HTML(source);
  assert.match(rendered, /src="\.\.\/\.\.\/assets\/a\.png"/);
  assert.match(rendered, /width="321"/);
  assert.match(rendered, /alt="a &amp; (?:&quot;|&#34;)&lt;b&gt;"/);
  assert.doesNotMatch(source, /data:image|note-image|typepro/);
});

test('an HTML block containing multiple images retains its other markup after resize and reload', () => {
  const lute = globalThis.Lute.New(); lute.SetSanitize(true); lute.SetVditorIR(true);
  const original = '<div><img src="../../assets/one.png" width="120"><p>文本<strong>加粗</strong></p><img src="../../assets/two.png" width="200"></div>\n';
  const resized = replaceHtmlImageWidth(original, 1, 286);
  const ir = lute.Md2VditorIRDOM(resized);
  assert.equal(lute.VditorIRDOM2Md(ir), resized);
  assert.match(resized, /one\.png" width="120"/);
  assert.match(resized, /<p>文本<strong>加粗<\/strong><\/p>/);
  assert.match(lute.Md2HTML(resized), /two\.png" width="286"/);
  assert.equal(isStandaloneImageHtml('  <img src="../../assets/one.png" width="120">\n'), true);
  assert.equal(isStandaloneImageHtml(original), false);
  assert.equal(isStandaloneImageHtml('before <img src="a.png" width="120">'), false);
  assert.equal(isStandaloneImageHtml('<img src="one.png"><img src="two.png">'), false);
  assert.equal(isStandaloneImageHtml('<div>普通 HTML</div>'), false);
});
