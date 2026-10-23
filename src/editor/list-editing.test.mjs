/**
 * Native-DOM regression cases. Run in an isolated browser document with the
 * installed Lute JS engine and the actual list modules; no TS transform/server.
 * The caller supplies {document, lute, installListEditing, decorateLists}.
 */
export function runListEditingTests({ document: doc, lute, installListEditing, decorateLists, listIndent, serializeListHtml, hydrateListHtml }) {
  const view = doc.defaultView;
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  function fixture(markdown, run) {
    const field = doc.createElement('pre'); field.className = 'vditor-reset'; field.contentEditable = 'true';
    field.innerHTML = lute.Md2VditorIRDOM(markdown); doc.body.append(field);
    let operations = 0; const history = [];
    const destroy = installListEditing({ field, transact(mutate) {
      const before = field.innerHTML;
      const changed = mutate();
      if (changed) { decorateLists?.(field); operations++; history.push({ before, after: field.innerHTML }); }
      return changed;
    } });
    const api = {
      field,
      get operations() { return operations; },
      history,
      text(value, offset = value.length, end = offset) {
        const walker = doc.createTreeWalker(field, 4);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent === value && !node.parentElement.closest('[data-render],.vditor-ir__marker')) break;
        }
        assert(node, `text not found: ${value}`);
        const range = doc.createRange(); range.setStart(node, offset); range.setEnd(node, end);
        const selection = view.getSelection(); selection.removeAllRanges(); selection.addRange(range); field.focus();
      },
      start(node) {
        const range = doc.createRange(); range.selectNodeContents(node); range.collapse(true);
        const selection = view.getSelection(); selection.removeAllRanges(); selection.addRange(range); field.focus();
      },
      key(key, options = {}) {
        const event = new view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
        field.dispatchEvent(event); return event;
      },
      input(inputType, data = null, options = {}) {
        const event = new view.InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true, ...options });
        field.dispatchEvent(event); return event;
      },
    };
    try { run(api); } finally { destroy(); field.remove(); view.getSelection().removeAllRanges(); }
  }
  function check(name, run) {
    try { run(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
  }
  // These prefixes are the live text immediately before the space keystroke.
  // Parsing a standalone "-" or "1." as stored Markdown already creates a list.
  function typing(value, run) {
    fixture('typing', api => {
      const current = api.field.querySelector('p');
      assert(current, 'typing paragraph missing');
      current.replaceChildren(doc.createTextNode(value));
      api.text(value); run(api);
    });
  }

  for (const [prefix, tag, type] of [['-', 'UL', null], ['1.', 'OL', null], ['a.', 'OL', 'a']]) {
    check(`prefix ${prefix} space creates its list`, () => typing(prefix, api => {
      const event = api.input('insertText', ' ');
      const list = api.field.firstElementChild;
      assert(event.defaultPrevented && api.operations === 1, 'prefix should be one structure change');
      assert(list.tagName === tag && list.getAttribute('type') === type, 'wrong list type');
      assert(list.children.length === 1 && list.firstElementChild.tagName === 'LI', 'missing first item');
      const current = list.firstElementChild;
      assert(current.querySelector('br'), 'empty list needs a real caret line before typing resumes');
      assert(current.contains(view.getSelection().anchorNode), 'caret left the new list item');
    }));
  }
  check('decimal prefix preserves explicit start number', () => typing('8.', api => {
    api.input('insertText', ' ');
    assert(api.field.querySelector('ol').getAttribute('start') === '8', 'number start lost');
    assert(api.field.querySelector('li').dataset.marker === '8.', 'IR marker not initialized');
  }));
  check('non-prefix spaces and invalid number prefixes stay native', () => {
    for (const value of ['text -', '0.', '1234567890.', 'path/a.']) typing(value, api => {
      assert(!api.input('insertText', ' ').defaultPrevented && api.operations === 0, `${value} converted`);
    });
  });
  check('prefix changes only the current tight item and preserves siblings', () => fixture('- first\n- a.\n- last\n', api => {
    const first = api.field.querySelector('li'), last = api.field.querySelector('li:last-child');
    api.text('a.'); api.input('insertText', ' ');
    assert(api.field.children.length === 3, 'current item should split its old list');
    assert(api.field.children[1].tagName === 'OL' && api.field.children[1].type === 'a', 'alpha segment missing');
    assert(api.field.contains(first) && api.field.contains(last), 'sibling identities changed');
  }));
  check('Enter splits tight item at caret and keeps inline formatting', () => fixture('1. abc**DEF**\n2. next\n', api => {
    api.text('abc', 3); api.key('Enter');
    const items = api.field.querySelectorAll(':scope > ol > li');
    assert(items.length === 3 && items[0].textContent === 'abc', 'prefix item changed');
    assert(items[1].querySelector('strong')?.textContent.includes('DEF'), 'inline formatting lost');
    assert(items[2].textContent === 'next', 'next item lost');
    assert(items[1].dataset.marker === '2.' && items[2].dataset.marker === '3.', 'number continuation wrong');
  }));
  check('Enter keeps alphabetic continuation after native normalization drops the type attribute', () => fixture('1. first\n2. second\n', api => {
    api.field.firstElementChild.setAttribute('type', 'a'); decorateLists(api.field);
    api.field.innerHTML = lute.SpinVditorIRDOM(api.field.innerHTML);
    assert(!api.field.firstElementChild.hasAttribute('type') && api.field.querySelector('[data-type="html-inline"]'), 'native normalization fixture did not drop presentation');
    api.text('first'); api.key('Enter');
    const lists = api.field.querySelectorAll(':scope > ol');
    assert(lists.length === 1 && lists[0].type === 'a' && lists[0].children.length === 3, 'new item lost inherited alphabetic style');
  }));
  check('Enter restores merged alphabetic and decimal groups before capturing the split caret', () => fixture('1. alpha\n2. numeric\n', api => {
    const list = api.field.firstElementChild;
    list.setAttribute('type', 'a'); decorateLists(api.field);
    list.lastElementChild.querySelector('.note-list-marker').remove(); list.removeAttribute('type');
    api.field.innerHTML = lute.SpinVditorIRDOM(api.field.innerHTML);
    api.text('numeric', 3); api.key('Enter');
    const lists = api.field.querySelectorAll(':scope > ol');
    assert(lists.length === 2 && lists[0].type === 'a' && !lists[1].hasAttribute('type'), 'mixed groups were changed to the same style');
    assert(lists[1].children.length === 2 && lists[1].children[0].textContent === 'num' && lists[1].children[1].textContent === 'eric', 'normalization moved the split caret or lost text');
  }));
  check('Enter in loose item moves following paragraphs and component nodes intact', () => fixture('- first\n\n  second\n\n  ```js\n  const value = 1;\n  ```\n', api => {
    const second = [...api.field.querySelectorAll('p')].find(node => node.textContent === 'second');
    const component = api.field.querySelector('[data-type="code-block"]');
    api.text('first'); api.key('Enter');
    const items = api.field.querySelectorAll(':scope > ul > li');
    assert(items.length === 2, 'new item missing');
    assert(items[1].contains(second) && items[1].contains(component), 'following nodes were rebuilt or lost');
    assert(items[0].textContent === 'first', 'original item text changed');
  }));
  check('empty nested Backspace removes marker, then reduces one indent', () => fixture('- parent\n  - child\n', api => {
    api.text('child'); api.key('Enter');
    const parent = api.field.querySelector(':scope > ul > li');
    api.key('Backspace');
    const continuation = parent.querySelector(':scope > p[data-typepro-list-exit="pending"]');
    assert(continuation && parent.textContent.includes('parent') && parent.textContent.includes('child'), 'first Backspace lost parent/child');
    api.key('Backspace');
    assert(continuation.isConnected && !continuation.hasAttribute('data-typepro-list-exit') && continuation.parentElement === parent, 'second Backspace should only reduce pending indentation');
    api.key('Backspace');
    assert(continuation.parentElement === api.field && api.field.contains(parent), 'further Backspace should lift paragraph, not parent content');
  }));
  check('empty nested Enter outdents the existing item and preserves its marker', () => fixture('- parent\n  - child\n', api => {
    api.text('child'); api.key('Enter'); api.key('Enter');
    const list = api.field.firstElementChild, parent = list.firstElementChild;
    assert(list.children.length === 2 && list.lastElementChild.tagName === 'LI', 'empty Enter should retain a list item one level up');
    assert(list.lastElementChild.querySelector('br') && !parent.querySelector(':scope > p') && !api.field.querySelector('[data-typepro-list-exit]'), 'empty Enter inserted a paragraph or lost its caret line');
    assert(parent.textContent.includes('parent') && parent.textContent.includes('child'), 'existing content lost');
  }));
  check('repeated empty Enter reduces one level per press and then unlists on the same item', () => fixture('1. parent\n   1. child\n', api => {
    api.text('child'); api.key('Enter');
    const current = api.field.querySelector('ol ol').lastElementChild;
    api.key('Enter');
    assert(api.field.firstElementChild.lastElementChild === current && api.field.querySelectorAll('li').length === 3, 'outdent rebuilt the empty item or created a new row');
    api.key('Enter');
    assert(api.field.children.length === 2 && api.field.lastElementChild.tagName === 'P', 'outer empty item should become an ordinary paragraph');
    assert(api.field.lastElementChild.querySelector('br') && api.field.querySelectorAll('li').length === 2, 'top-level exit created an extra blank row');
  }));
  check('top-level empty marker becomes normal paragraph', () => fixture('1. first\n', api => {
    api.text('first'); api.key('Enter'); api.key('Backspace');
    const current = api.field.lastElementChild;
    assert(current.tagName === 'P' && !current.hasAttribute('data-typepro-list-exit'), 'top-level empty marker not cancelled');
    assert(!api.key('Backspace').defaultPrevented, 'ordinary paragraph should keep native behavior');
  }));
  check('Tab nests the complete item under its previous sibling', () => fixture('- parent\n- child\n\n  ```js\n  const value = 1;\n  ```\n', api => {
    const item = api.field.querySelector(':scope > ul > li:last-child');
    const component = item.querySelector('[data-type="code-block"]');
    api.text('child'); api.key('Tab');
    assert(item.parentElement.parentElement === api.field.querySelector(':scope > ul > li'), 'item not nested');
    assert(item.contains(component), 'component identity changed');
  }));
  check('alphabetic Tab and Shift+Tab retain the outer style after native normalization', () => fixture('1. first\n2. second\n', api => {
    api.field.firstElementChild.setAttribute('type', 'a'); decorateLists(api.field);
    api.field.innerHTML = lute.SpinVditorIRDOM(api.field.innerHTML);
    api.text('second'); api.key('Tab');
    assert(api.field.querySelectorAll('ol[type="a"]').length === 2, 'Tab lost alphabetic nesting');
    api.field.innerHTML = lute.SpinVditorIRDOM(api.field.innerHTML);
    api.text('second'); api.key('Tab', { shiftKey: true });
    const lists = api.field.querySelectorAll(':scope > ol');
    assert(lists.length === 1 && lists[0].type === 'a' && lists[0].children.length === 2, 'Shift+Tab lost outer alphabetic style');
  }));
  check('Shift+Tab preserves a decimal parent beside an alphabetic sibling group', () => fixture('1. alpha\n2. parent\n   1. child\n', api => {
    const outer = api.field.firstElementChild, parent = outer.lastElementChild;
    outer.setAttribute('type', 'a'); decorateLists(api.field);
    parent.querySelector(':scope > .note-list-marker').remove(); outer.removeAttribute('type');
    parent.querySelector('ol').setAttribute('type', 'a'); decorateLists(api.field);
    api.field.innerHTML = lute.SpinVditorIRDOM(api.field.innerHTML);
    api.text('child'); api.key('Tab', { shiftKey: true });
    const lists = api.field.querySelectorAll(':scope > ol');
    assert(lists.length === 2 && lists[0].type === 'a' && !lists[1].hasAttribute('type'), 'outdent changed the neighboring list style');
    assert(lists[1].children.length === 2 && lists[1].lastElementChild.textContent === 'child', 'outdented child lost text or numbering');
  }));
  check('Shift+Tab lifts item and preserves its following nested siblings', () => fixture('- parent\n  - child\n  - following\n- last\n', api => {
    const child = [...api.field.querySelectorAll('li')].find(node => node.textContent === 'child');
    const following = [...api.field.querySelectorAll('li')].find(node => node.textContent === 'following');
    api.text('child'); api.key('Tab', { shiftKey: true });
    assert(child.parentElement === api.field.firstElementChild, 'item not lifted');
    assert(child.contains(following), 'trailing siblings should retain nested level');
    assert(api.field.textContent.includes('parent') && api.field.textContent.includes('last'), 'outer content lost');
  }));
  check('Shift+Tab at top level unlists only current item', () => fixture('- first\n- current\n- last\n', api => {
    const first = api.field.querySelector('li'), last = api.field.querySelector('li:last-child');
    api.text('current'); api.key('Tab', { shiftKey: true });
    assert(api.field.contains(first) && api.field.contains(last), 'other items lost');
    assert(api.field.textContent.includes('current') && api.field.children.length >= 3, 'current text not preserved outside list');
  }));
  for (const [name, markdown, alpha] of [['bullet', '- first\n', false], ['decimal', '1. first\n', false], ['alpha', '1. first\n', true], ['task', '- [x] first\n', false]]) {
    check(`first ${name} item Tab indents in place and Shift+Tab reverses each level`, () => fixture(markdown, api => {
      const list = api.field.firstElementChild, item = list.firstElementChild;
      if (alpha) { list.type = 'a'; decorateLists(api.field); }
      const checkbox = item.querySelector('input'); api.text(name === 'task' ? ' first' : 'first', 3);
      const anchor = view.getSelection().anchorNode, offset = view.getSelection().anchorOffset;
      assert(api.key('Tab').defaultPrevented && api.operations === 1 && listIndent(item) === 1, 'first Tab did not change one level');
      assert(item.parentElement === list && api.field.querySelectorAll('li').length === 1, 'indent created a fake parent or rebuilt the item');
      assert(view.getSelection().anchorNode === anchor && view.getSelection().anchorOffset === offset, 'Tab moved the text caret');
      api.key('Tab'); assert(listIndent(item) === 2, 'second Tab did not add a level');
      api.key('Tab', { shiftKey: true }); assert(listIndent(item) === 1, 'Shift+Tab did not reduce one level');
      api.key('Tab', { shiftKey: true }); assert(listIndent(item) === 0 && item.parentElement === list, 'second Shift+Tab should restore the original list');
      if (checkbox) assert(item.contains(checkbox) && checkbox.checked, 'checkbox state or identity changed');
      assert(api.operations === 4, 'each structure change must be one transaction');
    }));
    check(`empty first ${name} item Tab and Enter reduce indentation without adding rows`, () => fixture(markdown, api => {
      const list = api.field.firstElementChild, item = list.firstElementChild;
      if (alpha) { list.type = 'a'; decorateLists(api.field); }
      for (const node of [...item.childNodes]) if (node.nodeType !== 1 || !node.matches('input,.note-list-marker')) node.remove();
      item.append(doc.createElement('br')); api.start(item); api.key('Tab'); api.key('Tab');
      assert(listIndent(item) === 2 && api.field.querySelectorAll('li').length === 1, 'empty first item did not indent');
      api.key('Enter'); assert(listIndent(item) === 1 && item.parentElement === list, 'empty Enter should keep its marker one level left');
      api.key('Enter'); assert(listIndent(item) === 0 && item.parentElement === list, 'second empty Enter should restore original level');
      api.key('Enter'); assert(!api.field.querySelector('li') && api.field.querySelector('p br'), 'outer empty Enter should unlist after all independent levels');
    }));
  }
  check('indenting a first item leaves later sibling items and embedded components intact', () => fixture('- first\n\n  ```js\n  const value = 1;\n  ```\n- following\n', api => {
    const list = api.field.firstElementChild, first = list.firstElementChild, following = list.lastElementChild;
    const code = first.querySelector('[data-type="code-block"]'); api.text('first'); api.key('Tab');
    assert(listIndent(first) === 1 && listIndent(following) === 0, 'independent indent changed sibling level');
    assert(first.contains(code) && following.parentElement === list && api.field.querySelectorAll('li').length === 2, 'component or sibling was moved');
  }));
  check('nested first item can indent independently before structural outdent resumes', () => fixture('- parent\n  - child\n  - following\n', api => {
    const list = api.field.querySelector('ul ul'), item = list.firstElementChild, following = list.lastElementChild;
    api.text('child'); api.key('Tab'); assert(listIndent(item) === 1 && item.parentElement === list, 'nested first item was not independently indented');
    api.key('Tab', { shiftKey: true }); assert(listIndent(item) === 0 && item.parentElement === list, 'first Shift+Tab should undo only independent indent');
    api.key('Tab', { shiftKey: true }); assert(item.parentElement === api.field.firstElementChild && item.contains(following), 'further outdent lost nested siblings');
  }));
  check('Enter continues at the independently indented level and keeps inline text nodes', () => fixture('1. abc**DEF**\n2. following\n', api => {
    const first = api.field.querySelector('li'), bold = first.querySelector('strong'); api.text('abc'); api.key('Tab'); api.key('Enter');
    const next = first.nextElementSibling;
    assert(listIndent(first) === 1 && listIndent(next) === 1 && next.contains(bold), 'Enter lost inherited indent or formatting');
    assert(next.dataset.marker === '2.' && next.nextElementSibling.dataset.marker === '3.', 'continuation numbering wrong');
  }));
  check('newly continued indented item can become a real child of its previous item', () => fixture('- first\n', api => {
    api.text('first'); api.key('Tab'); api.key('Enter'); const list = api.field.firstElementChild, first = list.firstElementChild, next = list.lastElementChild;
    api.key('Tab'); assert(next.parentElement.parentElement === first && listIndent(next) === 0, 'real nesting retained redundant independent indent');
    assert(listIndent(first) === 1 && api.field.querySelectorAll('li').length === 2, 'real nesting changed parent indent or inserted a fake item');
  }));
  check('Tab never shifts an independently deeper item left when its preceding item was outdented', () => fixture('- first\n', api => {
    api.text('first'); api.key('Tab'); api.key('Tab'); api.key('Enter');
    const first = api.field.querySelector('li'), next = first.nextElementSibling;
    next.querySelector('br').replaceWith(doc.createTextNode('next'));
    api.text('first'); api.key('Tab', { shiftKey: true }); api.text('next'); api.key('Tab');
    assert(listIndent(first) === 1 && next.parentElement.parentElement === first && listIndent(next) === 1, 'nesting discarded residual indentation');
    api.key('Tab', { shiftKey: true });
    assert(listIndent(next) === 0 && next.parentElement.parentElement === first, 'first Shift+Tab should remove the residual level only');
  }));
  check('structural outdent inherits parent indentation and preserves trailing sublists through save/reopen', () => fixture('- parent\n  - child\n  - following\n', api => {
    const outer = api.field.firstElementChild, parent = outer.firstElementChild, nested = parent.querySelector('ul'), child = nested.firstElementChild, following = nested.lastElementChild;
    api.text('parent'); api.key('Tab'); api.key('Tab'); api.text('child'); api.key('Tab', { shiftKey: true });
    assert(child.parentElement === outer && listIndent(child) === 2 && listIndent(parent) === 2 && child.contains(following), 'outdent lost inherited indent or trailing nodes');
    const clone = api.field.cloneNode(true); serializeListHtml(clone, lute);
    api.field.innerHTML = lute.Md2VditorIRDOM(lute.VditorIRDOM2Md(clone.innerHTML)); hydrateListHtml(api.field, lute);
    const items = api.field.querySelectorAll(':scope > ul > li');
    assert(items.length === 2 && listIndent(items[0]) === 2 && listIndent(items[1]) === 2 && items[1].querySelector('ul > li')?.textContent === 'following', 'outdent hierarchy changed on reopen');
  }));
  check('empty Backspace removes marker before reducing independent indentation', () => fixture('- first\n', api => {
    api.text('first'); api.key('Tab'); api.key('Tab'); api.key('Enter'); const first = api.field.querySelector('li');
    api.key('Backspace'); const current = api.field.lastElementChild;
    assert(current.tagName === 'P' && listIndent(current) === 2 && api.field.querySelector('li') === first, 'first Backspace lost indentation or another item');
    api.key('Backspace'); assert(listIndent(current) === 1, 'next Backspace should reduce only one level');
    api.key('Backspace'); assert(listIndent(current) === 0 && current.isConnected, 'last independent level did not clear');
    assert(!api.key('Backspace').defaultPrevented, 'unindented paragraph should resume native Backspace');
  }));
  check('undo snapshot boundary contains indentation metadata before transaction completion', () => fixture('- first\n', api => {
    api.text('first'); api.key('Tab');
    assert(api.history.length === 1 && /data-typepro-indent/.test(api.history[0].after), 'undo snapshot was captured before metadata');
    api.field.innerHTML = lute.SpinVditorIRDOM(api.history[0].before); decorateLists(api.field);
    assert(listIndent(api.field.querySelector('li')) === 0, 'undo snapshot did not restore original level');
    api.field.innerHTML = lute.SpinVditorIRDOM(api.history[0].after); decorateLists(api.field);
    assert(listIndent(api.field.querySelector('li')) === 1, 'redo snapshot did not recover independent level');
  }));
  check('mobile beforeinput Enter and Backspace follow the same rules', () => fixture('- first\n', api => {
    api.text('first'); api.input('insertParagraph');
    assert(api.field.querySelectorAll('li').length === 2, 'mobile Enter did not continue');
    assert(api.field.querySelector('li:last-child br'), 'empty next item needs an editable line');
    api.input('deleteContentBackward');
    assert(api.field.lastElementChild.tagName === 'P' && api.operations === 2, 'mobile Backspace did not cancel marker');
  }));
  check('Shift+Enter, composition, modifiers and cross-item selection stay native', () => fixture('- first\n- last\n', api => {
    api.text('first');
    assert(!api.key('Enter', { shiftKey: true }).defaultPrevented, 'Shift+Enter intercepted');
    assert(!api.key('Enter', { isComposing: true }).defaultPrevented, 'composition intercepted');
    assert(!api.key('Enter', { metaKey: true }).defaultPrevented, 'modified Enter intercepted');
    const nodes = api.field.querySelectorAll('li'); const range = doc.createRange();
    range.setStart(nodes[0].firstChild, 0); range.setEnd(nodes[1].firstChild, 2);
    const selection = view.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    assert(!api.key('Enter').defaultPrevented && api.operations === 0, 'cross-item selection intercepted');
  }));
  check('code, table and math input never become lists', () => {
    for (const source of ['```text\n1.\n```\n', '| a |\n| - |\n| 1. |\n', '$$\n1.\n$$\n']) fixture(source, api => {
      const target = api.field.querySelector('code,td'); assert(target, 'excluded fixture missing');
      api.start(target);
      assert(!api.key('Enter').defaultPrevented && !api.input('insertText', ' ').defaultPrevented && api.operations === 0, 'component input intercepted');
    });
  });
  check('pending empty paragraph clears its transient indent when typing resumes', () => fixture('- parent\n  - child\n', api => {
    api.text('child'); api.key('Enter'); api.key('Backspace');
    const pending = api.field.querySelector('[data-typepro-list-exit]');
    assert(pending, 'pending paragraph missing');
    api.input('insertText', 'x');
    assert(!pending.hasAttribute('data-typepro-list-exit'), 'transient indent leaked into normal typing');
  }));
  return { pass: results.every(result => result.pass), checks: results };
}
