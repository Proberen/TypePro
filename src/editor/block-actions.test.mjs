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
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
  matches(selector) { return selector.split(',').some(part => part.startsWith('[') ? part.slice(1, -1) in this.attributes : part.startsWith('.') ? (this.attributes.class || '').split(' ').includes(part.slice(1)) : this.tagName === part.toUpperCase()); }
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

test('moving a heading moves only that node and preserves code/attachment node identities', () => {
  const title = heading(1, '标题'), paragraph = block('p', '正文');
  const attachment = new Element('img', { src: '../../assets/a.png' }); paragraph.append(attachment);
  const code = block('div', '', { 'data-type': 'code-block', 'data-fold-id': 'stable' });
  const raw = new Element('pre').append(new Element('code', {}, 'const x = 1;')); code.append(raw);
  const root = field(title, paragraph, code);
  assert.equal(applyBlockOperation(root, { type: 'move', block: title, target: code, position: 'after' }), title);
  assert.deepEqual(root.children, [paragraph, code, title]);
  assert.equal(code.children[0], raw); assert.equal(paragraph.children[0], attachment);
  assert.match(markdown(root), /正文[\s\S]*const x = 1;[\s\S]*# 标题/);
});

test('moving a task item out of its list retains its checkbox, nested list and list semantics', () => {
  const checkbox = new Element('input', { type: 'checkbox', checked: '' });
  const nested = block('ul', '', { 'data-tight': 'true', 'data-marker': '-' }).append(new Element('li', { 'data-marker': '-' }, '嵌套'));
  const task = new Element('li', { 'data-marker': '-', class: 'vditor-task' }).append(checkbox, new Text(' 任务'), nested);
  const source = block('ul', '', { 'data-tight': 'true', 'data-marker': '-' }).append(task);
  const title = heading(2, '下一节'); const root = field(source, title);
  applyBlockOperation(root, { type: 'move', block: task, target: title, position: 'after' });
  assert.equal(source.parentElement, null);
  assert.equal(root.children[1].tagName, 'UL'); assert.equal(root.children[1].children[0], task);
  assert.equal(task.children[0], checkbox); assert.equal(task.children[1], nested);
  assert.match(markdown(root), /## 下一节[\s\S]*\[X\][\s\S]*任务[\s\S]*嵌套/i);
});

test('cross-list and paragraph-to-list moves keep a valid canonical list structure', () => {
  const first = new Element('li', { 'data-marker': '-' }, '第一项');
  const source = block('ul', '', { 'data-tight': 'true', 'data-marker': '-' }).append(first);
  const target = new Element('li', { 'data-marker': '1.' }, '第二项');
  const ordered = block('ol', '', { 'data-tight': 'true', 'data-marker': '1.' }).append(target);
  const paragraph = block('p', '新的内容'); const root = field(source, ordered, paragraph);
  applyBlockOperation(root, { type: 'move', block: first, target, position: 'before' });
  assert.deepEqual(ordered.children, [first, target]);
  assert.equal(target.getAttribute('data-marker'), '2.'); assert.equal(source.parentElement, null);
  applyBlockOperation(root, { type: 'move', block: paragraph, target, position: 'after' });
  assert.equal(ordered.children[2].tagName, 'LI'); assert.equal(ordered.children[2].children[0], paragraph);
  assert.match(markdown(root), /1\. 第一项\n2\. 第二项\n3\. 新的内容/);
});

test('delete removes empty containers and leaves an editable final paragraph; invalid moves do nothing', () => {
  const item = new Element('li', { 'data-marker': '-' }, '唯一项');
  const list = block('ul').append(item); const quote = block('blockquote').append(list); const root = field(quote);
  assert.equal(applyBlockOperation(root, { type: 'move', block: quote, target: item, position: 'after' }), null);
  assert.equal(applyBlockOperation(root, { type: 'move', block: item, target: block('p'), position: 'after' }), null);
  const next = applyBlockOperation(root, { type: 'delete', block: item });
  assert.equal(next.tagName, 'P'); assert.equal(next.children[0].tagName, 'BR'); assert.equal(next.getAttribute('data-block'), '0');
  assert.deepEqual(root.children, [next]); assert.equal(markdown(root).trim(), '');
});
