/** Native-DOM/Lute roundtrip checks. The caller supplies the real JS modules. */
export function runListMarkdownTests({ document: doc, lute, listKind, listIndent, setListIndent, stripListMetadata, clearListMarkers, decorateLists, hydrateListHtml, serializeListHtml }) {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const marker = () => {
    const node = doc.createElement('span'); node.dataset.type = 'html-inline'; node.className = 'vditor-ir__node';
    const code = doc.createElement('code'); code.className = 'vditor-ir__marker'; code.textContent = '<span data-typepro-list="a"/>';
    node.append(code); return node;
  };
  const field = markdown => {
    const root = doc.createElement('div'); root.innerHTML = lute.Md2VditorIRDOM(markdown); return root;
  };
  const spin = root => { root.innerHTML = lute.SpinVditorIRDOM(root.innerHTML); decorateLists(root); };
  const save = root => {
    const clone = root.cloneNode(true); serializeListHtml(clone, lute);
    const markdown = lute.VditorIRDOM2Md(clone.innerHTML);
    assert(!markdown.includes('data-typepro-list'), 'internal metadata leaked into Markdown');
    return markdown;
  };
  const reopen = markdown => { const root = field(markdown); hydrateListHtml(root, lute); return root; };
  const check = (name, run) => {
    try { run(); checks.push({ name, pass: true }); }
    catch (error) { checks.push({ name, pass: false, error: error.message }); }
  };

  check('alphabetic list survives normalization, save and reopen without exposing metadata', () => {
    const root = reopen('<ol type="a"><li>first</li><li>second</li></ol>');
    assert(listKind(root.firstElementChild) === 'alpha', 'HTML list was not hydrated');
    spin(root);
    const markdown = save(root), reopened = reopen(markdown);
    assert(/<ol type="a">/.test(markdown), 'alphabetic HTML was not saved');
    assert(reopened.querySelectorAll('ol[type="a"] > li').length === 2, 'list items lost');
    assert(reopened.querySelectorAll('.note-list-marker').length === 2, 'metadata missing after reopen');
  });
  check('empty alphabetic items normalize back to hidden inline metadata', () => {
    const root = reopen('<ol type="a"><li></li></ol>'); spin(root);
    assert(root.querySelector('li > .note-list-marker')?.dataset.type === 'html-inline', 'marker stayed an HTML component');
    assert(!root.querySelector('[data-type="html-block"][data-block]'), 'empty marker exposed as component');
    assert(reopen(save(root)).querySelector('ol[type="a"] > li'), 'empty alpha item lost');
  });
  check('nested alphabetic metadata does not change its numeric parent', () => {
    const root = reopen('<ol><li>parent<ol type="a"><li>child</li></ol></li><li>next</li></ol>'); spin(root);
    const parent = root.firstElementChild, child = parent.querySelector('ol');
    assert(listKind(parent) === 'decimal' && listKind(child) === 'alpha', 'child metadata styled the parent');
    const reopened = reopen(save(root));
    assert(listKind(reopened.firstElementChild) === 'decimal', 'numeric parent changed during export');
    assert(listKind(reopened.querySelector('li ol')) === 'alpha', 'alpha child changed during export');
  });
  check('mixed bullet, decimal and alphabetic sublists keep their hierarchy', () => {
    const root = reopen('<ul><li>parent<ol type="a"><li>letter<ul><li>bullet</li></ul></li></ol><ol><li>number</li></ol></li><li>last</li></ul>'); spin(root);
    const reopened = reopen(save(root));
    assert(reopened.firstElementChild.tagName === 'UL', 'outer bullet list changed');
    assert(reopened.querySelector('ol[type="a"] li ul li')?.textContent === 'bullet', 'nested bullet hierarchy changed');
    assert(reopened.querySelectorAll('ol').length === 2, 'ordered sublists merged');
  });
  check('normalization-squashed alpha and numeric siblings split without rebuilding item nodes', () => {
    const root = field('1. first\n2. second\n3. third\n');
    const list = root.firstElementChild, first = list.children[0], second = list.children[1], third = list.children[2];
    second.prepend(marker()); decorateLists(root);
    assert(root.children.length === 3, 'mixed sibling types were not separated');
    assert(root.children[1].type === 'a', 'middle alphabetic group missing');
    assert(root.children[0].firstElementChild === first && root.children[1].firstElementChild === second && root.children[2].firstElementChild === third, 'list item identities changed');
    assert(!root.children[0].hasAttribute('type') && !root.children[2].hasAttribute('type'), 'numeric groups became alpha');
  });
  check('new items in an alpha list inherit its type and repeated decoration is stable', () => {
    const root = reopen('<ol type="a"><li>first</li></ol>'), list = root.firstElementChild;
    const item = doc.createElement('li'); item.dataset.marker = '2.'; item.textContent = 'second'; list.append(item);
    decorateLists(root); const first = root.innerHTML; decorateLists(root);
    assert(root.innerHTML === first && item.querySelector('.note-list-marker'), 'decoration duplicated metadata or missed a new item');
  });
  check('moving mixed list groups preserves the caret anchored in their existing text', () => {
    const root = field('1. first\n2. second\n3. third\n'), second = root.querySelectorAll('li')[1];
    const text = second.firstChild; second.prepend(marker()); doc.body.append(root);
    const selection = doc.defaultView.getSelection(); selection.setBaseAndExtent(text, 3, text, 3);
    try {
      decorateLists(root);
      assert(selection.anchorNode === text && selection.anchorOffset === 3, 'list decoration moved the caret');
    } finally { root.remove(); selection.removeAllRanges(); }
  });
  check('metadata lives directly in LI so moving an image paragraph cannot carry list type', () => {
    const root = field('1. ![image](../../assets/a.png)\n');
    const list = root.firstElementChild, item = list.firstElementChild; list.type = 'a';
    const image = item.querySelector('[data-type="img"]'), paragraph = doc.createElement('p'); paragraph.dataset.block = '0';
    paragraph.append(marker(), image); item.replaceChildren(paragraph); decorateLists(root);
    assert(item.firstElementChild.classList.contains('note-list-marker'), 'metadata not placed at item start');
    assert(!paragraph.querySelector('.note-list-marker') && paragraph.contains(image), 'image paragraph kept list metadata or was rebuilt');
  });
  check('clearListMarkers works on selection DocumentFragments and preserves real HTML', () => {
    const content = doc.createDocumentFragment(); content.append(marker());
    const html = doc.createElement('span'); html.dataset.type = 'html-inline';
    const code = doc.createElement('code'); code.textContent = '<span style="color:red">'; html.append(code); content.append(html);
    clearListMarkers(content);
    assert(content.children.length === 1 && content.firstElementChild === html, 'selection cleanup removed user HTML');
  });
  check('formatting, dimensions, custom HTML, code, table and math survive repeated roundtrips', () => {
    let root = reopen('<ol type="a" start="3"><li>before <span style="color:#ff0000;font-family:serif">colored</span><img src="../../assets/a.png" width="240" height="120"></li><li><div class="custom" data-test="keep">HTML</div></li><li><pre><code class="language-js">const a = 1;</code></pre><table><tr><th>head</th></tr><tr><td>cell</td></tr></table><span class="language-math">x^2</span></li></ol>');
    let markdown;
    for (let i = 0; i < 3; i++) { spin(root); markdown = save(root); root = reopen(markdown); }
    assert(/start="3"/.test(markdown), 'alpha start offset lost');
    assert(/font-family:serif/.test(markdown) && /color:#ff0000/.test(markdown), 'selected text styles lost');
    assert(/width="240"/.test(markdown) && /height="120"/.test(markdown), 'image dimensions lost');
    assert(/class="custom" data-test="keep"/.test(markdown), 'custom HTML attributes lost');
    assert(/language-js/.test(markdown) && /const a = 1;/.test(markdown), 'code content lost');
    assert(/<table>/.test(markdown) && /cell/.test(markdown) && /language-math/.test(markdown), 'table or math lost');
    assert(root.querySelectorAll('ol[type="a"] > li').length === 3, 'HTML component split list type');
  });
  check('serialize mutates only the supplied clone', () => {
    const root = reopen('<ol type="a"><li>value</li></ol>'), original = root.innerHTML;
    save(root); assert(root.innerHTML === original, 'serialization changed the live field');
  });
  check('custom attributes on native HTML nodes are kept as HTML rather than discarded', () => {
    let root = reopen('<ol type="a"><li><p class="custom" data-kind="paragraph">text</p><a href="https://example.com" data-link="keep">link</a><img src="../../assets/a.png" data-asset="keep"></li></ol>');
    spin(root); const markdown = save(root); root = reopen(markdown);
    assert(/class="custom" data-kind="paragraph"/.test(markdown), 'paragraph attributes lost');
    assert(/data-link="keep"/.test(markdown) && /data-asset="keep"/.test(markdown), 'link or image attributes lost');
    assert(root.querySelector('ol[type="a"] > li'), 'custom HTML stopped alpha list hydration');
  });
  check('plain Markdown lists retain their original serialization', () => {
    const root = field('- bullet\n  1. one\n  2. two\n- last\n'), before = lute.VditorIRDOM2Md(root.innerHTML);
    decorateLists(root); assert(save(root) === before, 'normal lists changed');
  });
  for (const [name, markdown, alpha] of [['bullet', '- first\n- following\n', false], ['decimal', '1. first\n2. following\n', false], ['alpha', '1. first\n2. following\n', true], ['task', '- [x] first\n- [ ] following\n', false]]) {
    check(`independent ${name} indentation survives Spin, export and three reopens`, () => {
      let root = field(markdown); if (alpha) root.firstElementChild.type = 'a';
      setListIndent(root.querySelector('li'), 2); decorateLists(root);
      let saved;
      for (let i = 0; i < 3; i++) { spin(root); saved = save(root); root = reopen(saved); }
      const list = root.firstElementChild, first = list.firstElementChild, following = list.lastElementChild;
      assert(listIndent(first) === 2 && listIndent(following) === 0, 'independent levels lost or spread to siblings');
      assert(root.querySelectorAll('li').length === 2 && !first.querySelector('li'), 'storage inserted a fake parent');
      assert(/data-typepro-indent="2"/.test(saved) && /margin-left: (?:56|62)px/.test(saved), 'portable HTML indentation not saved');
      if (alpha) assert(listKind(list) === 'alpha', 'alphabetic style lost');
      if (name === 'task') assert(first.classList.contains('vditor-task') && first.querySelector('input')?.checked && !following.querySelector('input')?.checked, 'task state lost');
    });
  }
  check('independent indentation and alpha style coexist with code and native HTML attributes', () => {
    let root = reopen('<ol type="a"><li>text<img src="../../assets/a.png" width="240"><div data-keep="yes">HTML</div><pre><code class="language-js">const x = 1;</code></pre></li></ol>');
    setListIndent(root.querySelector('li'), 1); spin(root); const saved = save(root); root = reopen(saved);
    assert(listIndent(root.querySelector('li')) === 1 && listKind(root.firstElementChild) === 'alpha', 'combined metadata lost');
    assert(/width="240"/.test(saved) && /data-keep="yes"/.test(saved) && /const x = 1/.test(saved), 'component source or attributes lost');
  });
  check('an empty unlisted paragraph retains and reopens its remaining indentation', () => {
    const root = field('paragraph'), current = root.querySelector('p'); current.replaceChildren(doc.createElement('br')); setListIndent(current, 2);
    spin(root); const saved = save(root), reopened = reopen(saved);
    assert(listIndent(reopened.querySelector('p[data-block]')) === 2, 'cancelled marker paragraph lost indentation');
    assert(!reopened.querySelector('li'), 'paragraph restore inserted a fake list item');
  });
  check('only bounded integer indentation metadata is accepted on import', () => {
    for (const level of ['-1', '1.5', '33', '999999999999999999999', 'NaN', '1e2', '']) {
      const root = field(`<ul><li data-typepro-indent="${level}">text</li></ul>`), before = root.innerHTML;
      hydrateListHtml(root, lute); assert(root.innerHTML === before, `invalid level ${level} imported`);
    }
    const root = field('<ul><li style="margin-left:99999px">text</li></ul>'), before = root.innerHTML;
    hydrateListHtml(root, lute); assert(root.innerHTML === before, 'arbitrary CSS became indentation');
    const valid = reopen('<ul><li data-typepro-indent="0">text</li></ul>');
    assert(valid.querySelector('li[data-marker]') && listIndent(valid.querySelector('li')) === 0, 'valid zero level rejected');
  });
  check('clipboard cleanup removes only internal marker spans and keeps persisted HTML attrs', () => {
    const value = '<span data-typepro-list="a" data-typepro-indent="2"/><span data-typepro-indent="1" data-typepro-target="p"/><li data-typepro-indent="2" style="margin-left:56px">text</li><span style="color:red"/>';
    const result = stripListMetadata(value);
    assert(!result.includes('data-typepro-target') && !result.includes('data-typepro-list="a"'), 'internal copy metadata leaked');
    assert(result.includes('<li data-typepro-indent="2"') && result.includes('<span style="color:red"/>'), 'persisted HTML or custom span was removed');
  });
  check('pseudo lists in raw text, code and custom HTML wrappers are not hydrated', () => {
    for (const markdown of ['```html\n<ol type="a"><li>code</li></ol>\n```', '<pre><ol type="a"><li>pre</li></ol></pre>', '<script>const text = \'<ol type="a"><li>x</li></ol>\';</script>', '<div class="custom"><ol type="a"><li>wrapped</li></ol></div>', '<ol type="a" class="custom"><li>attributes</li></ol>', '<ol type="a"><li value="7">custom numbering</li></ol>']) {
      const root = field(markdown), before = root.innerHTML; hydrateListHtml(root, lute);
      assert(root.innerHTML === before, 'non-interchange HTML was rewritten');
    }
  });
  return { pass: checks.every(item => item.pass), checks };
}
