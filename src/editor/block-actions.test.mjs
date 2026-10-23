import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { applyBlockOperation } from './block-actions.ts';

const require = createRequire(import.meta.url);
require('vditor/dist/js/lute/lute.min.js');

// Minimal mutable DOM tree. Assertions cover node identity and Lute's real IR serializer.
class Element {
  nodeType = 1; parentElement = null; childNodes = [];
  constructor(tag, attributes = {}, text = '') { this.tagName = tag.toUpperCase(); this.attributes = { ...attributes }; this.text = text; }
  ownerDocument = document;
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
  get nextSibling() { return this.parentElement?.childNodes[this.parentElement.childNodes.indexOf(this) + 1] || null; }
  get textContent() { return this.text + this.childNodes.map(child => child.textContent).join(''); }
  get innerHTML() { return this.text + this.childNodes.map(child => child.outerHTML).join(''); }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    return `<${tag}${Object.entries(this.attributes).map(([key, value]) => ` ${key}="${value}"`).join('')}>${this.innerHTML}${/^(BR|INPUT|IMG|HR)$/.test(this.tagName) ? '' : `</${tag}>`}`;
  }
  get dataset() { return { type: this.attributes['data-type'] }; }
  get classList() { return { contains: name => (this.attributes.class || '').split(' ').includes(name) }; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
  matches(selector) {
    return selector.split(',').some(part => {
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attribute) return attribute[2] === undefined ? this.hasAttribute(attribute[1]) : this.attributes[attribute[1]] === attribute[2];
      return part.startsWith('.') ? (this.attributes.class || '').split(' ').includes(part.slice(1)) : this.tagName === part.toUpperCase();
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); return this; }
  insertBefore(node, target) { node.remove(); const index = target ? this.childNodes.indexOf(target) : this.childNodes.length; assert.notEqual(index, -1); this.childNodes.splice(index, 0, node); node.parentElement = this; return node; }
  remove() { if (this.parentElement) this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1); this.parentElement = null; }
  cloneNode(deep) { const clone = new Element(this.tagName, this.attributes, this.text); if (deep) clone.append(...this.childNodes.map(child => child.cloneNode(true))); return clone; }
}
class Text extends Element {
  nodeType = 3;
  constructor(text) { super('#text', {}, text); }
  get outerHTML() { return this.text; }
}
const document = { createElement: tag => new Element(tag) };
const block = (tag, text = '', attributes = {}) => new Element(tag, { 'data-block': '0', ...attributes }, text);
const heading = (level, text) => block(`h${level}`, '', { 'data-marker': '#' }).append(new Element('span', { class: 'vditor-ir__marker vditor-ir__marker--heading', 'data-type': 'heading-marker' }, '#'.repeat(level) + ' '), new Element('span', {}, text));
const field = (...blocks) => new Element('pre').append(...blocks);
const markdown = root => { const lute = globalThis.Lute.New(); lute.SetVditorIR(true); return lute.VditorIRDOM2Md(root.innerHTML); };

test('moving a component across prose preserves heading, code and attachment node identities', () => {
  const title = heading(1, '标题'), paragraph = block('p', '正文');
  const attachment = new Element('img', { src: '../../assets/a.png' }); paragraph.append(attachment);
  const code = block('div', '', { 'data-type': 'code-block', 'data-fold-id': 'stable' });
  const raw = new Element('pre').append(new Element('code', {}, 'const x = 1;')); code.append(raw);
  const root = field(title, paragraph, code);
  assert.equal(applyBlockOperation(root, { type: 'move', block: code, target: title, position: 'before' }), code);
  assert.deepEqual(root.children, [code, title, paragraph]);
  assert.equal(code.children[0], raw); assert.equal(paragraph.children[0], attachment);
  assert.match(markdown(root), /const x = 1;[\s\S]*# 标题[\s\S]*正文/);
});

test('headings, paragraphs, quotes, lists, list items and separators reject direct move/delete operations', () => {
  const task = new Element('li', { 'data-marker': '-' }, '任务');
  const list = block('ul', '', { 'data-marker': '-' }).append(task);
  const title = heading(2, '下一节'), paragraph = block('p', '正文'), quote = block('blockquote', '引用'), separator = block('hr');
  const target = block('div', '', { 'data-type': 'code-block' });
  const root = field(title, paragraph, quote, list, separator, target), original = root.innerHTML;
  for (const source of [title, paragraph, quote, list, task, separator]) {
    assert.equal(applyBlockOperation(root, { type: 'delete', block: source }), null);
    assert.equal(applyBlockOperation(root, { type: 'move', block: source, target, position: 'after' }), null);
    assert.equal(root.innerHTML, original);
  }
});

test('a component can move into an ordered list without moving its source list item or text', () => {
  const code = block('div', '', { 'data-type': 'code-block' }).append(new Element('pre').append(new Element('code', {}, 'const value = 1;')));
  const first = new Element('li', { 'data-marker': '-' }, '第一项').append(code);
  const source = block('ul', '', { 'data-tight': 'true', 'data-marker': '-' }).append(first);
  const target = new Element('li', { 'data-marker': '1.' }, '第二项');
  const ordered = block('ol', '', { 'data-tight': 'true', 'data-marker': '1.' }).append(target);
  const root = field(source, ordered);
  assert.equal(applyBlockOperation(root, { type: 'move', block: code, target, position: 'before' }), code);
  assert.equal(source.children[0], first); assert.equal(first.textContent, '第一项');
  assert.equal(ordered.children[0].tagName, 'LI'); assert.equal(ordered.children[0].children[0], code);
  assert.equal(target.getAttribute('data-marker'), '2.');
  assert.match(markdown(root), /第一项[\s\S]*const value = 1;[\s\S]*2\. 第二项/);
});

test('components move around prose inside a list item and delete independently of that list item', () => {
  const paragraph = block('p', '列表文字');
  const code = block('div', '', { 'data-type': 'code-block' });
  const item = new Element('li', { 'data-marker': '-' }).append(paragraph, code);
  const list = block('ul', '', { 'data-marker': '-' }).append(item), root = field(list);
  applyBlockOperation(root, { type: 'move', block: code, target: paragraph, position: 'before' });
  assert.deepEqual(item.children, [code, paragraph]);
  applyBlockOperation(root, { type: 'delete', block: code });
  assert.deepEqual(item.children, [paragraph]); assert.equal(item.parentElement, list);
});

test('a standalone image is operable but an inline image cannot make its text paragraph deletable', () => {
  const standalone = block('p').append(new Element('img', { src: '../../assets/a.png' }));
  const mixed = block('p', '说明文字').append(new Element('img', { src: '../../assets/b.png' }));
  const root = field(standalone, mixed);
  assert.equal(applyBlockOperation(root, { type: 'delete', block: mixed }), null);
  applyBlockOperation(root, { type: 'delete', block: standalone });
  assert.deepEqual(root.children, [mixed]);
});

test('deleting a tight list image preserves its item and nested list text', () => {
  const image = new Element('span', { 'data-type': 'img' }).append(new Element('img', { src: '../../assets/a.png' }));
  const nested = block('ul', '', { 'data-marker': '-' }).append(new Element('li', { 'data-marker': '-' }, '子列表文字'));
  const item = new Element('li', { 'data-marker': '-' }).append(image, nested);
  const list = block('ul', '', { 'data-marker': '-' }).append(item), root = field(list);
  assert.equal(applyBlockOperation(root, { type: 'delete', block: item }), null);
  assert.equal(applyBlockOperation(root, { type: 'delete', block: image }), nested);
  assert.deepEqual(item.children, [nested]); assert.equal(item.parentElement, list);
  assert.equal(nested.textContent, '子列表文字');
});

test('moving a tight list image out preserves its node in a paragraph and leaves the original item intact', () => {
  const image = new Element('span', { 'data-type': 'img' }).append(new Element('img', { src: '../../assets/a.png' }));
  const attachment = image.children[0];
  const nested = block('ul', '', { 'data-marker': '-' }).append(new Element('li', { 'data-marker': '-' }, '保留子列表'));
  const item = new Element('li', { 'data-marker': '-' }).append(image, nested), list = block('ul', '', { 'data-marker': '-' }).append(item);
  const target = block('p', '正文'), root = field(list, target);
  const moved = applyBlockOperation(root, { type: 'move', block: image, target, position: 'after' });
  assert.equal(moved.tagName, 'P'); assert.equal(moved.getAttribute('data-block'), '0');
  assert.deepEqual(root.children, [list, target, moved]); assert.equal(moved.children[0], image);
  assert.equal(image.children[0], attachment); assert.deepEqual(item.children, [nested]);
  assert.equal(item.parentElement, list); assert.equal(nested.textContent, '保留子列表');
  assert.equal(applyBlockOperation(root, { type: 'delete', block: moved }), target);
  assert.deepEqual(root.children, [list, target]);
});

test('moving a tight list image into another item keeps it independent and rejects mixed inline text', () => {
  const image = new Element('span', { 'data-type': 'img' }).append(new Element('img', { src: '../../assets/a.png' }));
  const source = new Element('li', { 'data-marker': '-' }).append(image);
  const target = new Element('li', { 'data-marker': '-' }).append(new Text('另一项'));
  const list = block('ul', '', { 'data-marker': '-' }).append(source, target), root = field(list);
  assert.equal(applyBlockOperation(root, { type: 'move', block: image, target, position: 'before' }), image);
  assert.equal(list.children[0], source); assert.equal(source.children.length, 0);
  assert.equal(list.children[1].children[0], image); assert.equal(list.children[2], target);
  assert.equal(applyBlockOperation(root, { type: 'delete', block: image }), list);

  const mixedImage = new Element('span', { 'data-type': 'img' }).append(new Element('img'));
  target.append(mixedImage);
  assert.equal(applyBlockOperation(root, { type: 'delete', block: mixedImage }), null);
  assert.equal(mixedImage.parentElement, target);
});

test('deleting the final component leaves an editable paragraph and invalid targets do nothing', () => {
  const code = block('div', '', { 'data-type': 'code-block' });
  const quote = block('blockquote').append(code), root = field(quote);
  assert.equal(applyBlockOperation(root, { type: 'move', block: code, target: quote, position: 'after' }), null);
  assert.equal(applyBlockOperation(root, { type: 'move', block: code, target: block('p'), position: 'after' }), null);
  const next = applyBlockOperation(root, { type: 'delete', block: code });
  assert.equal(next.tagName, 'P'); assert.equal(next.children[0].tagName, 'BR'); assert.equal(next.getAttribute('data-block'), '0');
  assert.deepEqual(root.children, [next]); assert.equal(markdown(root).trim(), '');
});
