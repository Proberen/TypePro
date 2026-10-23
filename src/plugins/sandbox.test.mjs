// Executes only the shipped plain-JavaScript SDK. No TypeScript, bundler or app startup.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../../public/plugins/sandbox.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../public/plugins/sandbox.html', import.meta.url), 'utf8');
const sdkSource = source.slice(source.indexOf('  function createSDK('), source.indexOf('  function theme('));
function runtime() {
  const sent = [], errors = [], timers = new Map();
  let timerId = 0;
  const createSDK = runInNewContext(`(${sdkSource.trim()})`, {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const context = { pluginId: 'example.generic', activeDocumentId: null };
  const sdk = createSDK(message => sent.push(message), context, error => errors.push(error));
  return { ...sdk, sent, errors, timers,
    respond(result, message = sent.at(-1)) { return sdk.receive({ kind: 'response', requestId: message.requestId, result }); },
  };
}

function viewRuntime(slot = 'editor.sidebar') {
  const listeners = new Map(), documentListeners = new Map(), scripts = [], styles = [], sent = [];
  let dialogOpen = false;
  const parent = { postMessage: message => sent.push(message) };
  const document = {
    currentScript: { nonce: 'script-nonce' },
    querySelector: selector => selector === 'style[nonce]' ? { nonce: 'style-nonce' } : selector === 'dialog[open]' && dialogOpen ? {} : null,
    documentElement: { style: { setProperty() {} }, dataset: {} },
    createElement: tag => ({ tagName: tag }),
    head: { append: element => styles.push({ ...element }) },
    body: { append: element => scripts.push({ ...element }) },
    addEventListener: (name, handler) => documentListeners.set(name, handler),
  };
  const window = {};
  runInNewContext(source, {
    document, window, parent, Blob, navigator: { platform: 'MacIntel' },
    URL: { createObjectURL: () => 'blob:plugin-script', revokeObjectURL() {} },
    addEventListener: (name, handler) => listeners.set(name, handler),
    setTimeout, clearTimeout,
  });
  document.currentScript = null; // Init arrives after the bootstrap script has completed.
  const deliver = data => listeners.get('message')({ source: parent, data: { channel: 'notebook-plugin-v1', token: 'view-token', ...data } });
  deliver({ kind: 'init', role: 'view', code: 'document.body.textContent = "ready";', styles: ['body{color:red}', 'button{border:0}'],
    context: { pluginId: 'example.generic', slot, theme: { mode: 'light', accent: '#74ade5' } },
  });
  return { listeners, documentListeners, scripts, styles, sent, api: window.notebook, deliver,
    setDialogOpen: value => { dialogOpen = value; },
    dispose: () => deliver({ kind: 'dispose' }),
  };
}

test('view bootstrap and dynamic scripts/styles preserve their CSP nonces', () => {
  assert.match(html, /<script\b[^>]*src="sandbox\.js"[^>]*nonce="__TAURI_SCRIPT_NONCE__"/);
  const { scripts, styles, sent, dispose } = viewRuntime();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'blob:plugin-script');
  assert.equal(scripts[0].nonce, 'script-nonce');
  assert.deepEqual(styles.map(style => [style.nonce, style.textContent]), [
    ['style-nonce', 'body{color:red}'], ['style-nonce', 'button{border:0}'],
  ]);
  scripts[0].onload();
  assert.equal(sent.at(-1).kind, 'ready');
  dispose();
});

test('visibility comes from the host snapshot, including hidden sidebars', async () => {
  const view = viewRuntime(), received = [];
  const subscribed = view.api.events.on('view.visibility', value => received.push(value.visible));
  const requestId = view.sent.at(-1).requestId;
  // The host may send the current state before acknowledging the subscription.
  view.deliver({ kind: 'event', name: 'view.visibility', payload: { visible: false } });
  view.deliver({ kind: 'response', requestId, result: null });
  await subscribed;
  view.deliver({ kind: 'event', name: 'view.visibility', payload: { visible: true } });
  view.deliver({ kind: 'event', name: 'view.visibility', payload: { visible: false } });
  await Promise.resolve();
  assert.deepEqual(received, [false, true, false]);
  assert.equal(view.documentListeners.has('visibilitychange'), false);
  view.dispose();
});

test('Escape closes only an unhandled sidebar without an inner dialog', () => {
  const view = viewRuntime();
  const escape = overrides => ({ key: 'Escape', code: 'Escape', preventDefault() {}, ...overrides });
  for (const event of [escape({ defaultPrevented: true }), escape({ isComposing: true })]) view.listeners.get('keydown')(event);
  view.setDialogOpen(true); view.listeners.get('keydown')(escape());
  assert.equal(view.sent.length, 0);
  view.setDialogOpen(false);
  let prevented = false;
  view.listeners.get('keydown')(escape({ preventDefault() { prevented = true; } }));
  assert.equal(prevented, true);
  assert.equal(view.sent.at(-1).method, 'ui.close');
  view.deliver({ kind: 'response', requestId: view.sent.at(-1).requestId, result: null });
  view.dispose();
  for (const slot of ['app.page', 'home.widget', 'plugin.settings']) {
    const other = viewRuntime(slot);
    other.listeners.get('keydown')(escape());
    assert.equal(other.sent.length, 0);
    other.dispose();
  }
});

test('RPC preserves structured failure and never returns credentials from configuration', async () => {
  const sdk = runtime();
  const configured = sdk.api.secrets.configure('provider', { origin: 'https://api.example.com' });
  assert.equal(sdk.sent[0].method, 'secrets.configure');
  assert.equal('key' in sdk.sent[0].args, false);
  await sdk.respond({ configured: true });
  assert.equal((await configured).configured, true);
  const read = sdk.api.notes.get('missing');
  await sdk.receive({ kind: 'response', requestId: sdk.sent.at(-1).requestId, error: { code: 'PERMISSION_DENIED', message: '需要权限' } });
  await assert.rejects(read, error => error.code === 'PERMISSION_DENIED' && error.message === '需要权限');
  assert.equal(sdk.timers.size, 0);
});

test('aborting a pending trusted review cancels its exact request', async () => {
  const sdk = runtime(), controller = new AbortController();
  const result = sdk.api.dialogs.reviewChanges({ documentId: 'doc', title: '修改', markdown: 'after', expectedMarkdown: 'before' }, { signal: controller.signal });
  const requestId = sdk.sent[0].requestId;
  controller.abort();
  await assert.rejects(result, error => error.code === 'CANCELLED');
  assert.equal(sdk.sent.at(-1).kind, 'request.cancel');
  assert.equal(sdk.sent.at(-1).requestId, requestId);
  assert.equal(sdk.timers.size, 0);
  await sdk.respond({ applied: true }, sdk.sent[0]); // Late approval cannot revive the rejected call.
  const before = sdk.sent.length;
  await assert.rejects(sdk.api.network.request({ url: 'https://api.example.com' }, { signal: controller.signal }), error => error.code === 'CANCELLED');
  assert.equal(sdk.sent.length, before);
});

test('streams deliver raw chunks and parser failure cancels transport', async () => {
  const sdk = runtime(), chunks = [];
  const response = sdk.api.network.stream({ url: 'https://api.example.com/events' }, chunk => {
    if (chunk === 'broken') throw new Error('invalid provider payload');
    chunks.push(chunk);
  });
  const requestId = sdk.sent[0].requestId;
  await sdk.receive({ kind: 'chunk', requestId, chunk: 'data: 中文\n\n' });
  assert.deepEqual(chunks, ['data: 中文\n\n']);
  await sdk.receive({ kind: 'chunk', requestId, chunk: 'broken' });
  await assert.rejects(response, /invalid provider payload/);
  assert.equal(sdk.sent.at(-1).kind, 'request.cancel');
  assert.equal(sdk.timers.size, 0);
});

test('event subscribers share host subscription and last unsubscribe releases it', async () => {
  const sdk = runtime(), received = [];
  const first = sdk.api.events.on('storage.changed', event => received.push(`a:${event.keys[0]}`));
  await sdk.respond(null);
  const offFirst = await first;
  const offSecond = await sdk.api.events.on('storage.changed', event => received.push(`b:${event.keys[0]}`));
  assert.equal(sdk.sent.length, 1);
  await sdk.receive({ kind: 'event', name: 'storage.changed', payload: { keys: ['settings'] } });
  await Promise.resolve();
  assert.deepEqual(received, ['a:settings', 'b:settings']);
  await offFirst();
  assert.equal(sdk.sent.length, 1);
  const released = offSecond();
  assert.equal(sdk.sent.at(-1).method, 'events.unsubscribe');
  await sdk.respond(null);
  await released;
  await offSecond();
  assert.equal(sdk.sent.length, 2);
});

test('command registration failure rolls back callback and context updates stay live', async () => {
  const sdk = runtime();
  let called = 0;
  const registered = sdk.api.commands.register('open', '打开', () => { called++; });
  await sdk.respond(null); await registered;
  const conflicting = sdk.api.commands.register('open', '打开', () => { called += 10; }, { shortcut: 'Mod+KeyS' });
  await sdk.receive({ kind: 'response', requestId: sdk.sent.at(-1).requestId, error: { code: 'CONFLICT', message: '已占用' } });
  await assert.rejects(conflicting, error => error.code === 'CONFLICT');
  await sdk.receive({ kind: 'command', id: 'open', requestId: 'invoke' });
  assert.equal(called, 1);
  assert.equal(sdk.sent.at(-1).kind, 'command-result');
  await sdk.receive({ kind: 'context', context: { activeDocumentId: 'doc-2' } });
  assert.equal(sdk.api.context.activeDocumentId, 'doc-2');
});

test('concurrent subscribers all receive denied permission and can retry', async () => {
  const sdk = runtime();
  const first = sdk.api.events.on('document.changed', () => {});
  const second = sdk.api.events.on('document.changed', () => {});
  assert.equal(sdk.sent.length, 1);
  await sdk.receive({ kind: 'response', requestId: sdk.sent[0].requestId, error: { code: 'PERMISSION_DENIED', message: '需要权限' } });
  await assert.rejects(first, error => error.code === 'PERMISSION_DENIED');
  await assert.rejects(second, error => error.code === 'PERMISSION_DENIED');
  const retried = sdk.api.events.on('document.changed', () => {});
  assert.equal(sdk.sent.length, 2);
  await sdk.respond(null); await retried;
  sdk.dispose();
});

test('timeout and dispose reject outstanding calls without leaving timers', async () => {
  const sdk = runtime();
  const timed = sdk.api.storage.get('settings');
  sdk.timers.values().next().value();
  await assert.rejects(timed, error => error.code === 'LIMIT_EXCEEDED');
  assert.equal(sdk.sent.at(-1).kind, 'request.cancel');
  const pending = sdk.api.notes.list();
  sdk.dispose();
  await assert.rejects(pending, error => error.code === 'CANCELLED');
  assert.equal(sdk.timers.size, 0);
});
