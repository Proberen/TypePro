'use strict';
(() => {
  const CHANNEL = 'notebook-plugin-v1';
  const scriptNonce = document.currentScript?.nonce;
  const styleNonce = document.querySelector('style[nonce]')?.nonce;
  let token, worker, sdk, disposed = false, shortcuts = [];
  const urls = new Set();
  const send = payload => parent.postMessage({ ...payload, channel: CHANNEL, token }, '*');

  // Shared by isolated worker and view. This function has no closure dependencies.
  function createSDK(send, context, report) {
    const pending = new Map(), commands = new Map(), listeners = new Map(), subscriptions = new Map();
    let sequence = 0;
    const cancelled = () => Object.assign(new Error('操作已取消'), { code: 'CANCELLED' });
    const rpc = (method, args = {}, options = {}) => new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(cancelled());
      if (pending.size >= 100) return reject(Object.assign(new Error('插件待处理请求过多'), { code: 'LIMIT_EXCEEDED' }));
      const requestId = String(++sequence);
      const slow = /^(network\.|dialogs\.|secrets.configure|files\.)/.test(method);
      const finish = (error, result) => {
        const entry = pending.get(requestId); if (!entry) return;
        pending.delete(requestId); clearTimeout(entry.timer);
        options.signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result);
      };
      const abort = () => { send({ kind: 'request.cancel', requestId }); finish(cancelled()); };
      const timer = setTimeout(() => { send({ kind: 'request.cancel', requestId }); finish(Object.assign(new Error('插件请求超时'), { code: 'LIMIT_EXCEEDED' })); }, slow ? 360000 : 10000);
      pending.set(requestId, { finish, timer, onChunk: options.onChunk });
      options.signal?.addEventListener('abort', abort, { once: true });
      send({ kind: 'request', requestId, method, args });
    });
    const events = Object.freeze({
      on: async (name, callback) => {
        if (typeof callback !== 'function') throw new Error('事件回调必须为函数');
        let callbacks = listeners.get(name);
        if (!callbacks) { callbacks = new Set(); listeners.set(name, callbacks); }
        callbacks.add(callback);
        if (!subscriptions.has(name)) subscriptions.set(name, rpc('events.subscribe', { name }));
        try { await subscriptions.get(name); }
        catch (error) { callbacks.delete(callback); if (!callbacks.size) { listeners.delete(name); subscriptions.delete(name); } throw error; }
        let active = true;
        return async () => { if (!active) return; active = false; callbacks.delete(callback); if (!callbacks.size) { subscriptions.delete(name); await rpc('events.unsubscribe', { name }); } };
      },
      onDocumentChange: async callback => {
        const offActive = await events.on('document.active', callback);
        const offEdit = await events.on('document.changed', event => callback({ documentId: event.documentId }));
        return async () => { await offActive(); await offEdit(); };
      },
    });
    const api = Object.freeze({
      context,
      notes: Object.freeze({
        list: () => rpc('notes.list'), search: (query, options = {}) => rpc('notes.search', { query, ...options }),
        active: () => rpc('notes.active'), get: id => rpc('notes.get', { id }), open: id => rpc('notes.open', { id }),
        update: (id, markdown, options = {}) => rpc('notes.update', { id, markdown, ...options }),
        create: (notebookId, title, markdown = '') => rpc('notes.create', { notebookId, title, markdown }),
      }),
      editor: Object.freeze({ context: () => rpc('editor.context'), selection: () => rpc('editor.selection'), insert: text => rpc('editor.insert', { text }), replaceSelection: text => rpc('editor.replaceSelection', { text }) }),
      storage: Object.freeze({ get: key => rpc('storage.get', { key }), list: (prefix = '') => rpc('storage.list', { prefix }), set: (key, value) => rpc('storage.set', { key, value }), remove: key => rpc('storage.remove', { key }) }),
      commands: Object.freeze({ register: async (id, label, callback, options = {}) => {
        if (typeof callback !== 'function') throw new Error('命令回调必须为函数');
        const previous = commands.get(id); commands.set(id, callback);
        try { await rpc('commands.register', { id, label, ...options }); }
        catch (error) { if (previous) commands.set(id, previous); else commands.delete(id); throw error; }
      } }),
      ui: Object.freeze({ register: options => rpc('ui.register', options), open: id => rpc('ui.open', { id }), close: () => rpc('ui.close'), resize: height => rpc('ui.resize', { height }), openExternal: url => rpc('ui.openExternal', { url }) }),
      dialogs: Object.freeze({ confirm: (options, control) => rpc('dialogs.confirm', options, control), reviewChanges: (options, control) => rpc('dialogs.reviewChanges', options, control) }),
      notifications: Object.freeze({ show: message => rpc('notifications.show', { message }) }),
      network: Object.freeze({ authorize: origin => rpc('network.authorize', { origin }), request: (request, options) => rpc('network.request', request, options), stream: (request, onChunk, options = {}) => rpc('network.stream', request, { ...options, onChunk }) }),
      secrets: Object.freeze({ configure: (id, options) => rpc('secrets.configure', { id, ...options }), status: (id, options) => rpc('secrets.status', { id, ...options }), remove: id => rpc('secrets.remove', { id }) }),
      files: Object.freeze({ pick: options => rpc('files.pick', options), save: options => rpc('files.save', options) }),
      panels: Object.freeze({ set: (id, title, text) => rpc('panels.set', { id, title, text }), close: id => rpc('panels.close', { id }) }),
      events,
    });
    return {
      api,
      dispose() { for (const entry of [...pending.values()]) entry.finish(cancelled()); pending.clear(); listeners.clear(); subscriptions.clear(); commands.clear(); },
      async receive(data) {
        if (data.kind === 'response') {
          const entry = pending.get(data.requestId); if (!entry) return;
          const error = data.error ? Object.assign(new Error(typeof data.error === 'string' ? data.error : data.error.message), { code: data.error.code || 'INTERNAL_ERROR' }) : undefined;
          entry.finish(error, data.result);
        } else if (data.kind === 'chunk') {
          const entry = pending.get(data.requestId); if (!entry) return;
          try { entry.onChunk?.(data.chunk); } catch (error) { send({ kind: 'request.cancel', requestId: data.requestId }); entry.finish(error); }
        } else if (data.kind === 'command') {
          try { const callback = commands.get(data.id); if (!callback) throw new Error('命令不存在'); await callback(); send({ kind: 'command-result', requestId: data.requestId }); }
          catch (error) { send({ kind: 'command-result', requestId: data.requestId, error: String(error?.message ?? error).slice(0, 300) }); }
        } else if (data.kind === 'event') {
          for (const callback of listeners.get(data.name) ?? []) Promise.resolve().then(() => callback(data.payload)).catch(report);
        } else if (data.kind === 'context') Object.assign(context, data.context);
      },
    };
  }
  function theme(context) {
    const dark = context.theme?.mode === 'dark', root = document.documentElement;
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.dataset.theme = dark ? 'dark' : 'light';
    const accent = /^#[0-9a-f]{6}$/i.test(context.theme?.accent ?? '') ? context.theme.accent : '#74ade5';
    const values = { bg: dark ? '#141a23' : '#ffffff', surface: dark ? '#1c2430' : '#f7f9fc', text: dark ? '#edf2f8' : '#253247', muted: dark ? '#97a5b8' : '#8390a3', border: dark ? '#2c3747' : '#e5ebf3', accent, 'accent-soft': dark ? '#233b53' : '#eef6fd', radius: '10px', font: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' };
    for (const [key, value] of Object.entries(values)) root.style.setProperty(`--tp-${key}`, value);
  }
  const blob = (value, type) => { const url = URL.createObjectURL(new Blob([value], { type })); urls.add(url); return url; };
  const report = error => send({ kind: 'error', message: String(error?.message ?? error).slice(0, 500) });
  const dispose = () => { disposed = true; sdk?.dispose(); worker?.terminate(); worker = null; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.channel !== CHANNEL || disposed) return;
    const data = event.data;
    if (!token && data.kind === 'init' && typeof data.token === 'string' && typeof data.code === 'string') {
      token = data.token;
      if (data.role === 'view') {
        theme(data.context);
        sdk = createSDK(send, data.context, report);
        Object.defineProperty(window, 'notebook', { value: sdk.api });
        for (const css of data.styles ?? []) { const style = document.createElement('style'); if (styleNonce) style.nonce = styleNonce; style.textContent = css; document.head.append(style); }
        const script = document.createElement('script'); if (scriptNonce) script.nonce = scriptNonce; script.src = blob(data.code, 'text/javascript'); script.onload = () => send({ kind: 'ready' }); script.onerror = () => report(new Error('插件界面加载失败')); document.body.append(script);
        addEventListener('unhandledrejection', event => report(event.reason));
        addEventListener('error', event => report(event.error || event.message));
      } else {
        const source = `'use strict';\nconst report=error=>self.postMessage({kind:'error',message:String(error?.message??error).slice(0,500)});\nconst sdk=(${createSDK.toString()})(self.postMessage.bind(self),${JSON.stringify(data.context)},report);\nObject.defineProperty(self,'notebook',{value:sdk.api});\nfor(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker'])try{Object.defineProperty(self,name,{value:undefined,writable:false,configurable:false});}catch{}\nself.addEventListener('message',event=>sdk.receive(event.data));\nself.addEventListener('unhandledrejection',event=>report(event.reason));\n(async()=>{\n${data.code}\n})().then(()=>self.postMessage({kind:'ready'})).catch(report);`;
        try { worker = new Worker(blob(source, 'text/javascript')); worker.onmessage = event => send(event.data); worker.onerror = error => report(error.message || '插件脚本加载失败'); }
        catch (error) { report(error); }
      }
      return;
    }
    if (data.token !== token) return;
    if (data.kind === 'dispose') { dispose(); return; }
    if (data.kind === 'shortcuts') { shortcuts = data.bindings; return; }
    if (data.kind === 'context' && data.context.theme) theme(data.context);
    if (worker) worker.postMessage(data); else void sdk?.receive(data);
  });
  addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || disposed || !sdk) return;
    if (event.key === 'Escape' && sdk.api.context.slot === 'editor.sidebar' && !document.querySelector('dialog[open]')) {
      event.preventDefault(); void sdk.api.ui.close().catch(report); return;
    }
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const binding = [(mac ? event.metaKey : event.ctrlKey) ? 'Mod' : '', mac && event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.code].filter(Boolean).join('+');
    const command = shortcuts.find(command => command.binding === binding);
    if (command) { event.preventDefault(); send({ kind: 'shortcut', id: command.id }); }
  });
  addEventListener('pagehide', dispose);
})();
