import type { InstalledPlugin, NoteDocument, Workspace } from '../lib/types';
import { validatePlugin } from './packages';

export interface PluginCommand { id: string; label: string; pluginId: string }
export interface PluginPanel { id: string; title: string; text: string; pluginId: string }
export interface ActivityWidget { id: string; title: string; pluginId: string }
export interface AssistantPageDescriptor { id: string; title: string; systemPrompt?: string; pluginId: string }
export interface PluginHostOptions {
  getWorkspace: () => Workspace;
  getActiveDocumentId: () => string | null;
  replaceDocument: (id: string, markdown: string) => void | Promise<void>;
  createDocument: (notebookId: string, title: string, markdown: string) => Promise<NoteDocument>;
  insertText: (text: string) => void;
  onStateChange: () => void;
  onError: (message: string) => void;
  onPluginStopped?: (id: string) => void;
  getPluginData: (pluginId: string, key: string) => unknown;
  listPluginData: (pluginId: string, prefix: string) => { key: string; value: unknown }[];
  setPluginData: (pluginId: string, key: string, value: unknown, remove?: boolean) => Promise<void>;
  onOpenAssistant: (page: AssistantPageDescriptor) => void;
}

interface RunningPlugin {
  plugin: InstalledPlugin;
  frame: HTMLIFrameElement;
  token: string;
  commands: Map<string, PluginCommand>;
  panels: Map<string, PluginPanel>;
  activity: Map<string, ActivityWidget>;
  assistants: Map<string, AssistantPageDescriptor>;
  subscribed: boolean;
  timeout: ReturnType<typeof setTimeout>;
  requests: number;
  lastRequestAt: number;
  pending: Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>;
}

const CHANNEL = 'notebook-plugin-v1';
const LOCAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const text = (value: unknown, name: string, limit: number): string => {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${name} 格式不正确或超出长度限制`);
  return value;
};
const localId = (value: unknown): string => {
  if (typeof value !== 'string' || !LOCAL_ID.test(value)) throw new Error('命令或面板 id 不正确');
  return value;
};

export class PluginHost {
  private running = new Map<string, RunningPlugin>();
  private failed = new Map<string, string>();
  private disposed = false;
  constructor(private options: PluginHostOptions) { window.addEventListener('message', this.onMessage); }

  setPlugins(plugins: InstalledPlugin[]) {
    if (this.disposed) return;
    const wanted = new Map(plugins.slice(0, 24).map(plugin => [plugin.manifest.id, plugin]));
    for (const [id, running] of this.running) {
      const next = wanted.get(id);
      if (!next?.enabled || next.code !== running.plugin.code || JSON.stringify(next.manifest) !== JSON.stringify(running.plugin.manifest)) this.stop(id);
    }
    for (const [id] of this.failed) if (!wanted.get(id)?.enabled) this.failed.delete(id);
    for (const [id, plugin] of wanted) {
      if (!plugin.enabled || this.running.has(id)) continue;
      const signature = JSON.stringify([plugin.manifest, plugin.code]);
      if (this.failed.get(id) === signature) continue;
      try { validatePlugin(plugin); this.start(plugin); }
      catch (error) {
        this.failed.set(id, signature);
        this.options.onPluginStopped?.(id);
        this.options.onError(`${plugin.manifest.name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  getCommands(): PluginCommand[] { return [...this.running.values()].flatMap(p => [...p.commands.values()]); }
  getPanels(): PluginPanel[] { return [...this.running.values()].flatMap(p => [...p.panels.values()]); }
  getActivityWidgets(): ActivityWidget[] { return [...this.running.values()].flatMap(p => [...p.activity.values()]); }
  getAssistantPages(): AssistantPageDescriptor[] { return [...this.running.values()].flatMap(p => [...p.assistants.values()]); }
  hasPermission(pluginId: string, permission: string): boolean { return !!this.running.get(pluginId)?.plugin.manifest.permissions.includes(permission); }
  async runCommand(id: string): Promise<void> {
    const plugin = [...this.running.values()].find(p => p.commands.has(id));
    if (!plugin) throw new Error('插件命令已不可用');
    const local = id.slice(plugin.plugin.manifest.id.length + 1);
    const requestId = randomToken();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => this.fail(plugin, '命令执行超时，插件已停用'), 10000);
      plugin.pending.set(requestId, { resolve, reject, timeout });
      this.post(plugin, { kind: 'command', id: local, requestId });
    });
  }

  notifyDocumentChange() {
    for (const plugin of this.running.values()) if (plugin.subscribed) this.post(plugin, { kind: 'document-change', documentId: this.options.getActiveDocumentId() });
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    for (const id of this.running.keys()) this.stop(id);
  }

  private start(plugin: InstalledPlugin) {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.hidden = true;
    frame.src = new URL('/plugins/sandbox.html', location.href).href;
    const instance: RunningPlugin = {
      plugin, frame, token: randomToken(), commands: new Map(), panels: new Map(), activity: new Map(), assistants: new Map(), subscribed: false,
      timeout: setTimeout(() => this.fail(instance, '启动超时，插件已停用'), 8000),
      requests: 0, lastRequestAt: Date.now(), pending: new Map(),
    };
    frame.onload = () => this.post(instance, { kind: 'init', code: plugin.code });
    this.running.set(plugin.manifest.id, instance);
    document.body.append(frame);
  }

  private stop(id: string) {
    const instance = this.running.get(id);
    if (!instance) return;
    this.running.delete(id);
    clearTimeout(instance.timeout);
    this.post(instance, { kind: 'dispose' });
    instance.frame.remove();
    for (const pending of instance.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error('插件已停用')); }
    instance.pending.clear();
    this.options.onStateChange();
  }

  private fail(instance: RunningPlugin, message: string) {
    if (this.running.get(instance.plugin.manifest.id) !== instance) return;
    this.failed.set(instance.plugin.manifest.id, JSON.stringify([instance.plugin.manifest, instance.plugin.code]));
    this.stop(instance.plugin.manifest.id);
    this.options.onPluginStopped?.(instance.plugin.manifest.id);
    this.options.onError(`${instance.plugin.manifest.name}：${message}`);
  }

  private post(instance: RunningPlugin, payload: Record<string, unknown>) {
    instance.frame.contentWindow?.postMessage({ channel: CHANNEL, token: instance.token, ...payload }, '*');
  }

  private onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) return;
    const instance = [...this.running.values()].find(p => p.frame.contentWindow === event.source && p.token === data.token);
    if (!instance) return;
    if (data.kind === 'ready') { clearTimeout(instance.timeout); this.options.onStateChange(); return; }
    if (data.kind === 'error') { this.fail(instance, typeof data.message === 'string' ? data.message.slice(0, 300) : '插件执行失败'); return; }
    if (data.kind === 'command-result') {
      const pending = instance.pending.get(data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout); instance.pending.delete(data.requestId);
      if (data.error) pending.reject(new Error(String(data.error).slice(0, 300))); else pending.resolve();
      return;
    }
    if (data.kind !== 'request' || typeof data.requestId !== 'string' || data.requestId.length > 80 || typeof data.method !== 'string') return;
    if (Date.now() - instance.lastRequestAt > 1000) { instance.lastRequestAt = Date.now(); instance.requests = 0; }
    if (++instance.requests > 120) { this.fail(instance, '调用过于频繁，插件已停用'); return; }
    void this.handle(instance, data.method, data.args).then(result => {
      if (this.running.get(instance.plugin.manifest.id) === instance) this.post(instance, { kind: 'response', requestId: data.requestId, result });
    }).catch(error => this.post(instance, { kind: 'response', requestId: data.requestId, error: error instanceof Error ? error.message : String(error) }));
  };

  private require(instance: RunningPlugin, permission: string) {
    if (!instance.plugin.manifest.permissions.includes(permission)) throw new Error(`插件未获授权：${permission}`);
  }

  private async handle(instance: RunningPlugin, method: string, input: unknown): Promise<unknown> {
    const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const workspace = this.options.getWorkspace();
    const findDocument = (id: string) => workspace.notebooks.flatMap(n => n.documents).find(d => d.id === id);
    switch (method) {
      case 'storage.get':
        this.require(instance, 'storage'); return this.options.getPluginData(instance.plugin.manifest.id, text(args.key, '存储键', 180)) ?? null;
      case 'storage.list':
        this.require(instance, 'storage'); return this.options.listPluginData(instance.plugin.manifest.id, text(args.prefix ?? '', '存储前缀', 180));
      case 'storage.set':
      case 'storage.remove':
        this.require(instance, 'storage'); await this.options.setPluginData(instance.plugin.manifest.id, text(args.key, '存储键', 180), args.value, method === 'storage.remove'); return null;
      case 'home.activity.register': {
        this.require(instance, 'home.activity'); this.require(instance, 'storage');
        const id = `${instance.plugin.manifest.id}:${localId(args.id)}`;
        if (instance.activity.size >= 1 && !instance.activity.has(id)) throw new Error('每个插件最多注册一个打卡组件');
        instance.activity.set(id, { id, pluginId: instance.plugin.manifest.id, title: text(args.title, '标题', 60) });
        this.options.onStateChange(); return null;
      }
      case 'pages.assistant.register': {
        this.require(instance, 'assistant'); this.require(instance, 'storage'); this.require(instance, 'notes.read');
        const id = `${instance.plugin.manifest.id}:${localId(args.id)}`;
        if (instance.assistants.size >= 2 && !instance.assistants.has(id)) throw new Error('每个插件最多注册两个 AI 页面');
        instance.assistants.set(id, { id, pluginId: instance.plugin.manifest.id, title: text(args.title, '标题', 60), systemPrompt: args.systemPrompt ? text(args.systemPrompt, '系统提示词', 20000) : undefined });
        this.options.onStateChange(); return null;
      }
      case 'pages.open': {
        this.require(instance, 'assistant');
        const page = instance.assistants.get(`${instance.plugin.manifest.id}:${localId(args.id)}`);
        if (!page) throw new Error('页面尚未注册');
        this.options.onOpenAssistant(page); return null;
      }
      case 'notes.list':
        this.require(instance, 'notes.read');
        return workspace.notebooks.map(notebook => ({ id: notebook.id, name: notebook.name, documents: notebook.documents.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) }));
      case 'notes.active': {
        this.require(instance, 'notes.read');
        return findDocument(this.options.getActiveDocumentId() ?? '') ?? null;
      }
      case 'notes.get': {
        this.require(instance, 'notes.read');
        return findDocument(text(args.id, '文档 id', 64)) ?? null;
      }
      case 'notes.update': {
        this.require(instance, 'notes.write');
        const id = text(args.id, '文档 id', 64);
        if (!findDocument(id)) throw new Error('文档不存在');
        await this.options.replaceDocument(id, text(args.markdown, 'Markdown', 5 * 1024 * 1024));
        return null;
      }
      case 'notes.create': {
        this.require(instance, 'notes.write');
        const notebookId = text(args.notebookId, '笔记本 id', 64);
        if (!workspace.notebooks.some(n => n.id === notebookId)) throw new Error('笔记本不存在');
        const title = text(args.title, '文档标题', 160).trim();
        if (!title) throw new Error('文档标题不能为空');
        const created = await this.options.createDocument(notebookId, title, text(args.markdown ?? '', 'Markdown', 5 * 1024 * 1024));
        return { id: created.id, title: created.title, updatedAt: created.updatedAt };
      }
      case 'editor.insert':
        this.require(instance, 'editor.insert');
        if (!this.options.getActiveDocumentId()) throw new Error('请先打开一篇文档');
        this.options.insertText(text(args.text, '插入文字', 1024 * 1024));
        return null;
      case 'commands.register': {
        this.require(instance, 'commands');
        const id = `${instance.plugin.manifest.id}:${localId(args.id)}`;
        if (instance.commands.size >= 20 && !instance.commands.has(id)) throw new Error('每个插件最多注册 20 个命令');
        const label = text(args.label, '命令名称', 60).trim();
        if (!label) throw new Error('命令名称不能为空');
        instance.commands.set(id, { id, label, pluginId: instance.plugin.manifest.id });
        this.options.onStateChange(); return null;
      }
      case 'panels.set': {
        this.require(instance, 'panels');
        const id = `${instance.plugin.manifest.id}:${localId(args.id)}`;
        if (instance.panels.size >= 6 && !instance.panels.has(id)) throw new Error('每个插件最多显示 6 个面板');
        instance.panels.set(id, { id, title: text(args.title, '面板名称', 60), text: text(args.text, '面板内容', 20000), pluginId: instance.plugin.manifest.id });
        this.options.onStateChange(); return null;
      }
      case 'panels.close':
        this.require(instance, 'panels'); instance.panels.delete(`${instance.plugin.manifest.id}:${localId(args.id)}`);
        this.options.onStateChange(); return null;
      case 'events.subscribe':
        this.require(instance, 'notes.read'); instance.subscribed = true; return null;
      case 'events.unsubscribe':
        this.require(instance, 'notes.read'); instance.subscribed = false; return null;
      default: throw new Error('不支持的插件 API');
    }
  }
}
