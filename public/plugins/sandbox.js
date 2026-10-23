'use strict';
(() => {
  const CHANNEL = 'notebook-plugin-v1';
  let token;
  let worker;
  let url;
  const send = payload => parent.postMessage({ ...payload, channel: CHANNEL, token }, '*');

  function bootstrap() {
    const pending = new Map();
    const commands = new Map();
    const listeners = new Set();
    let sequence = 0;
    const send = self.postMessage.bind(self);
    const rpc = (method, args = {}) => new Promise((resolve, reject) => {
      if (pending.size >= 100) { reject(new Error('插件待处理请求过多')); return; }
      const requestId = String(++sequence);
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('插件请求超时')); }, 10000);
      pending.set(requestId, { resolve, reject, timeout });
      send({ kind: 'request', requestId, method, args });
    });
    const report = error => send({ kind: 'error', message: String(error?.message ?? error).slice(0, 300) });
    self.addEventListener('message', async event => {
      const data = event.data;
      if (data.kind === 'response') {
        const request = pending.get(data.requestId);
        if (!request) return;
        pending.delete(data.requestId); clearTimeout(request.timeout);
        if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
      } else if (data.kind === 'command') {
        try {
          const callback = commands.get(data.id);
          if (!callback) throw new Error('命令不存在');
          await callback(); send({ kind: 'command-result', requestId: data.requestId });
        } catch (error) { send({ kind: 'command-result', requestId: data.requestId, error: String(error?.message ?? error) }); }
      } else if (data.kind === 'document-change') {
        for (const listener of listeners) Promise.resolve().then(() => listener({ documentId: data.documentId })).catch(report);
      }
    });
    self.addEventListener('unhandledrejection', event => report(event.reason));
    const api = Object.freeze({
      notes: Object.freeze({
        list: () => rpc('notes.list'),
        active: () => rpc('notes.active'),
        get: id => rpc('notes.get', { id }),
        update: (id, markdown) => rpc('notes.update', { id, markdown }),
        create: (notebookId, title, markdown = '') => rpc('notes.create', { notebookId, title, markdown }),
      }),
      editor: Object.freeze({ insert: text => rpc('editor.insert', { text }) }),
      commands: Object.freeze({ register: async (id, label, callback) => {
        if (typeof callback !== 'function') throw new Error('命令回调必须为函数');
        const previous = commands.get(id);
        commands.set(id, callback);
        try { await rpc('commands.register', { id, label }); }
        catch (error) { if (previous) commands.set(id, previous); else commands.delete(id); throw error; }
      } }),
      panels: Object.freeze({
        set: (id, title, text) => rpc('panels.set', { id, title, text }),
        close: id => rpc('panels.close', { id }),
      }),
      events: Object.freeze({ onDocumentChange: async callback => {
        if (typeof callback !== 'function') throw new Error('事件回调必须为函数');
        if (!listeners.size) await rpc('events.subscribe');
        listeners.add(callback);
        return async () => { listeners.delete(callback); if (!listeners.size) await rpc('events.unsubscribe'); };
      } }),
    });
    Object.defineProperty(self, 'notebook', { value: api, writable: false, configurable: false });
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker']) {
      try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch { /* CSP also blocks network. */ }
    }
  }

  addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.channel !== CHANNEL) return;
    const data = event.data;
    if (!token && data.kind === 'init' && typeof data.token === 'string' && typeof data.code === 'string') {
      token = data.token;
      const source = `(${bootstrap.toString()})();\n(async () => {\n${data.code}\n})().then(() => self.postMessage({kind:'ready'})).catch(error => self.postMessage({kind:'error',message:String(error?.message ?? error)}));`;
      try {
        url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = message => {
          if (message.data && typeof message.data === 'object') send(message.data);
        };
        worker.onerror = error => send({ kind: 'error', message: error.message || '插件脚本无法执行' });
      } catch (error) { send({ kind: 'error', message: String(error?.message ?? error) }); }
      return;
    }
    if (data.token !== token) return;
    if (data.kind === 'dispose') {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      worker = null;
    } else if (worker) worker.postMessage(data);
  });
  addEventListener('pagehide', () => { worker?.terminate(); if (url) URL.revokeObjectURL(url); });
})();
