import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentBlock, blockLabel, canMoveBlock, findBlockDropTarget, getBlockTarget, getBodyBlocks } from './block-targets.ts';

// Structural DOM fixture: no layout/editor implementation is mocked into the targeting functions.
class Element {
  nodeType = 1; parentElement = null; children = []; dataset = {};
  constructor(tagName, attributes = {}, top = 0, height = 20) {
    this.tagName = tagName.toUpperCase(); this.attributes = attributes;
    if (attributes['data-type']) this.dataset.type = attributes['data-type'];
    this.rect = { top, bottom: top + height, height, left: 40, right: 640, width: 600 };
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; child.ownerDocument = this.ownerDocument; } return this; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  contains(other) { return other === this || this.children.some(child => child.contains(other)); }
  get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  getBoundingClientRect() { return this.rect; }
  querySelectorAll() { return this.children.flatMap(child => [...(child.hasAttribute('data-block') || child.tagName === 'LI' ? [child] : []), ...child.querySelectorAll()]); }
}
const node = (tag, type) => new Element(tag, { 'data-block': '0', ...(type ? { 'data-type': type } : {}) });
function field() { const root = new Element('pre'); root.ownerDocument = { elementFromPoint: () => null }; return root; }

test('a sized standalone HTML image keeps its image label while mixed HTML remains an HTML block', () => {
  const image = { dataset: { type: 'html-block' }, classList: { contains: name => name === 'note-image-block' } };
  const html = { dataset: { type: 'html-block' }, classList: { contains: () => false } };
  assert.equal(blockLabel(image), '图片');
  assert.equal(blockLabel(html), 'HTML 块');
});

test('targets every canonical prose/widget block and maps runtime descendants to their owner', () => {
  const root = field();
  const plain = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr'].map(tag => node(tag));
  const widgets = ['code-block', 'math-block', 'html-block', 'table', 'yaml-front-matter'].map(type => node(type === 'table' ? 'table' : 'div', type));
  root.append(...plain, ...widgets);
  for (const block of [...plain, ...widgets]) {
    const runtime = new Element('div').append(new Element('span'));
    block.append(runtime);
    assert.equal(getBlockTarget(root, runtime.children[0]), block);
  }
  const html = widgets[2];
  const renderedHeading = node('h2');
  const renderedTable = node('table', 'table').append(node('p'));
  html.append(renderedHeading, renderedTable);
  assert.equal(getBlockTarget(root, renderedHeading), html);
  assert.equal(getBlockTarget(root, renderedTable.children[0]), html);
  assert.deepEqual(getBodyBlocks(root), [...plain, ...widgets]);
});

test('nested list items stay independent; paragraph fragments belong to their list item or quote', () => {
  const root = field();
  const nestedItem = new Element('li').append(node('p'));
  const item = new Element('li').append(node('p'), node('ul').append(nestedItem));
  const list = node('ul').append(item, new Element('li'));
  const innerQuote = node('blockquote').append(node('p'));
  const quote = node('blockquote').append(node('p'), innerQuote);
  root.append(list, quote);
  assert.equal(getBlockTarget(root, item.children[0]), item);
  assert.equal(getBlockTarget(root, nestedItem.children[0]), nestedItem);
  assert.equal(getBlockTarget(root, quote.children[0]), quote);
  assert.equal(getBlockTarget(root, innerQuote.children[0]), innerQuote);
  const code = node('div', 'code-block'); nestedItem.append(code);
  assert.equal(getBlockTarget(root, code), code);
  assert.equal(getBlockTarget(root, root), null);
  assert.equal(getBlockTarget(root, new Element('p')), null);
});

test('inline image/link/text and table cells move with their enclosing canonical block', () => {
  const root = field();
  const image = new Element('img'); const span = new Element('span').append(image);
  const paragraph = node('p').append(span, new Element('a'));
  const cellParagraph = node('p');
  const table = node('table', 'table').append(new Element('tbody').append(new Element('tr').append(new Element('td').append(cellParagraph))));
  root.append(paragraph, table);
  assert.equal(getBlockTarget(root, image), paragraph);
  assert.equal(getBlockTarget(root, { nodeType: 3, parentElement: span }), paragraph);
  assert.equal(getBlockTarget(root, cellParagraph), table);
  assert.deepEqual(getBodyBlocks(root), [paragraph, table]);
});

test('move validation forbids source/ancestor/descendant drops and menu steps stay at the same structural level', () => {
  const root = field();
  const first = node('p'); const item = new Element('li'); const secondItem = new Element('li');
  const list = node('ul').append(item, secondItem); const last = node('h2');
  root.append(first, list, last);
  assert.equal(canMoveBlock(list, item), false);
  assert.equal(canMoveBlock(item, list), false);
  assert.equal(canMoveBlock(item, item), false);
  assert.equal(canMoveBlock(item, first), true);
  assert.equal(adjacentBlock(root, first, 1), list);
  assert.equal(adjacentBlock(root, last, -1), list);
  assert.equal(adjacentBlock(root, item, 1), secondItem);
  assert.equal(adjacentBlock(root, item, -1), null);
});

test('drop hit testing chooses before/after, resolves margin gaps and never moves a block into itself', () => {
  const root = field();
  const first = new Element('p', { 'data-block': '0' }, 0, 20);
  const source = new Element('div', { 'data-block': '0', 'data-type': 'code-block' }, 40, 80);
  const last = new Element('p', { 'data-block': '0' }, 140, 20);
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
