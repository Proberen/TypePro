import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentBlock, blockLabel, canMoveBlock, findBlockDropTarget, getBlockAnchor, getBlockTarget, getBodyBlocks } from './block-targets.ts';

// Structural DOM fixture; targeting, ownership and placement use the production functions.
class Element {
  nodeType = 1; parentElement = null; children = [];
  constructor(tagName, attributes = {}, top = 0, height = 20, text = '') {
    this.tagName = tagName.toUpperCase(); this.attributes = { ...attributes }; this.text = text;
    this.rect = { top, bottom: top + height, height, left: 40, right: 640, width: 600 };
  }
  get dataset() { return { type: this.attributes['data-type'] }; }
  get childNodes() { return this.children; }
  get classList() { return { contains: name => (this.attributes.class || '').split(' ').includes(name) }; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; child.ownerDocument = this.ownerDocument; } return this; }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  cloneNode(deep) { const copy = new Element(this.tagName, this.attributes, this.rect.top, this.rect.height, this.text); if (deep) copy.append(...this.children.map(child => child.cloneNode(true))); return copy; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  contains(other) { return other === this || this.children.some(child => child.contains(other)); }
  matches(selector) {
    return selector.split(',').some(part => {
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attribute) return attribute[2] === undefined ? this.hasAttribute(attribute[1]) : this.attributes[attribute[1]] === attribute[2];
      return part.startsWith('.') ? this.classList.contains(part.slice(1)) : this.tagName === part.toUpperCase();
    });
  }
  get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  getBoundingClientRect() { return this.rect; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const node = (tag, type) => new Element(tag, { 'data-block': '0', ...(type ? { 'data-type': type } : {}) });
function field() { const root = new Element('pre'); root.ownerDocument = { elementFromPoint: () => null }; return root; }

test('a sized standalone HTML image keeps its image label while mixed HTML remains an HTML block', () => {
  const image = { dataset: { type: 'html-block' }, classList: { contains: name => name === 'note-image-block' } };
  const html = { dataset: { type: 'html-block' }, classList: { contains: () => false } };
  assert.equal(blockLabel(image), '图片');
  assert.equal(blockLabel(html), 'HTML 块');
});

test('only approved components are operable; prose and unsupported metadata remain insertion anchors', () => {
  const root = field();
  const prose = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote'].map(tag => node(tag));
  const metadata = ['yaml-front-matter', 'link-ref-defs', 'footnotes-block'].map(type => node('div', type));
  const components = ['code-block', 'math-block', 'html-block', 'table'].map(type => node(type === 'table' ? 'table' : 'div', type));
  root.append(...prose, ...metadata, ...components);
  for (const block of [...prose, ...metadata]) {
    assert.equal(getBlockTarget(root, block), null);
    assert.equal(getBlockAnchor(root, block), block);
  }
  for (const block of components) {
    const runtime = new Element('div').append(new Element('span'));
    block.append(runtime);
    assert.equal(getBlockTarget(root, runtime.children[0]), block);
  }
  const html = components[2], renderedHeading = node('h2');
  const renderedTable = node('table', 'table').append(node('p'));
  html.append(renderedHeading, renderedTable);
  assert.equal(getBlockTarget(root, renderedHeading), html);
  assert.equal(getBlockAnchor(root, renderedTable.children[0]), html);
  assert.deepEqual(getBodyBlocks(root), [...prose, ...metadata, ...components]);
});

test('list and quote prose is not operable, while a nested component stays independent', () => {
  const root = field(), paragraph = node('p');
  const nestedItem = new Element('li').append(paragraph);
  const item = new Element('li').append(node('p'), node('ul').append(nestedItem));
  const list = node('ul').append(item, new Element('li'));
  const quote = node('blockquote').append(node('p'));
  root.append(list, quote);
  for (const target of [list, item, nestedItem, paragraph, quote, quote.children[0]]) assert.equal(getBlockTarget(root, target), null);
  assert.equal(getBlockAnchor(root, paragraph), paragraph);
  const code = node('div', 'code-block'); nestedItem.append(code);
  assert.equal(getBlockTarget(root, code), code);
  assert.equal(adjacentBlock(root, code, -1), paragraph);
  assert.equal(getBlockTarget(root, root), null);
  assert.equal(getBlockTarget(root, new Element('p')), null);
});

test('only standalone image paragraphs are operable; mixed text and inline images stay prose', () => {
  const root = field();
  const standalone = node('p').append(new Element('span', { 'data-type': 'img' }).append(new Element('span', { class: 'vditor-ir__marker' }, 0, 20, '![说明]('), new Element('img')));
  const image = standalone.children[0].children[1];
  const mixed = node('p').append(new Element('img'), new Element('strong', {}, 0, 20, '说明文字'));
  const sized = node('p').append(new Element('span', { class: 'note-image-inline' }).append(new Element('code', { class: 'vditor-ir__marker' }, 0, 20, '<img src="local.png" width="200">'), new Element('span', { 'data-render': '1' }).append(new Element('img'))));
  const cellParagraph = node('p'), table = node('table', 'table').append(new Element('tbody').append(new Element('tr').append(new Element('td').append(cellParagraph))));
  root.append(standalone, mixed, sized, table);
  assert.equal(getBlockTarget(root, image), standalone);
  assert.equal(getBlockTarget(root, { nodeType: 3, parentElement: standalone.children[0] }), standalone);
  assert.equal(getBlockTarget(root, mixed.children[0]), null);
  assert.equal(getBlockTarget(root, sized.children[0]), sized);
  assert.equal(getBlockTarget(root, cellParagraph), table);
  assert.deepEqual(getBodyBlocks(root), [standalone, mixed, sized, table]);
});

test('tight list images are independent targets while their list item and nested prose stay protected', () => {
  const root = field();
  const marker = new Element('span', { class: 'note-list-marker', 'data-type': 'html-inline', 'data-block': '0' });
  const image = new Element('span', { 'data-type': 'img' }).append(new Element('img'));
  const nested = node('ul').append(new Element('li', {}, 0, 20, '子列表文字'));
  const item = new Element('li').append(marker, image, nested), list = node('ol').append(item);
  root.append(list);
  assert.equal(getBlockTarget(root, image.children[0]), image);
  assert.equal(getBlockTarget(root, item), null);
  assert.equal(getBlockTarget(root, marker), null);
  assert.equal(getBlockAnchor(root, image), image);
  assert.equal(getBlockAnchor(root, marker), item);
  assert.equal(adjacentBlock(root, image, 1), nested);
  assert.deepEqual(getBodyBlocks(root), [list, item, image, nested, nested.children[0]]);

  item.append(new Element('strong', {}, 0, 20, '同一行文字'));
  assert.equal(getBlockTarget(root, image), null);
  assert.equal(getBlockAnchor(root, image), item);
});

test('tight list HTML images need a single standalone image preview', () => {
  const root = field();
  const image = new Element('span', { 'data-type': 'html-inline', class: 'note-image-inline' }).append(
    new Element('code', { class: 'vditor-ir__marker' }, 0, 20, '<img src="a.png" width="200">'),
    new Element('span', { 'data-render': '1' }).append(new Element('img')),
  );
  const item = new Element('li').append(image), list = node('ul').append(item); root.append(list);
  assert.equal(getBlockTarget(root, image.children[1].children[0]), image);
  assert.equal(getBlockAnchor(root, image), image);
  image.children[1].append(new Element('img'));
  assert.equal(getBlockTarget(root, image), null);
});

test('move validation rejects containment and adjacent steps still include non-operable prose', () => {
  const root = field(), first = node('p'), source = node('div', 'code-block');
  const item = new Element('li'), list = node('ul').append(item), last = node('h2');
  root.append(first, source, list, last);
  assert.equal(canMoveBlock(list, item), false);
  assert.equal(canMoveBlock(item, list), false);
  assert.equal(canMoveBlock(source, source), false);
  assert.equal(canMoveBlock(source, first), true);
  assert.equal(adjacentBlock(root, source, -1), first);
  assert.equal(adjacentBlock(root, source, 1), list);
  assert.equal(getBlockTarget(root, list), null);
});

test('drop hit testing accepts prose before/after, resolves margin gaps and never targets itself', () => {
  const root = field();
  const first = new Element('p', { 'data-block': '0' }, 0, 20);
  const source = new Element('div', { 'data-block': '0', 'data-type': 'code-block' }, 40, 80);
  const last = new Element('h2', { 'data-block': '0' }, 140, 20);
  root.append(first, source, last);
  root.ownerDocument.elementFromPoint = () => last;
  assert.deepEqual(findBlockDropTarget(root, source, 100, 141), { block: last, position: 'before' });
  assert.deepEqual(findBlockDropTarget(root, source, 100, 159), { block: last, position: 'after' });
  root.ownerDocument.elementFromPoint = () => null;
  assert.deepEqual(findBlockDropTarget(root, source, 20, 26), { block: first, position: 'after' });
  assert.equal(findBlockDropTarget(root, source, 20, 60), null);
  root.ownerDocument.elementFromPoint = () => source;
  assert.equal(findBlockDropTarget(root, source, 100, 60), null);
});
