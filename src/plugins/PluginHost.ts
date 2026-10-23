import type { InstalledPlugin } from '../lib/types';
import { pickPluginFile, savePluginFile } from './transfer';
import { validatePlugin } from './packages';
import { extensionDeviceId } from './state';
import { openLink } from '../lib/bridge';
import { PluginServices, httpsOrigin } from './services';
import { PluginError, pluginError, type DocumentChange, type PluginCommand, type PluginHostOptions, type PluginPanel, type PluginView } from './contracts';
export type { PluginHostOptions, PluginCommand, PluginPanel, PluginView } from './contracts';

interface Connection {
  frame: HTMLIFrameElement; token: string; viewId?: string;
  subscriptions: Set<string>; requests: Map<string, AbortController>;
}
interface RunningPlugin {
  plugin: InstalledPlugin; main: Connection; connections: Set<Connection>; services: PluginServices;
  commands: Map<string, PluginCommand>; panels: Map<string, PluginPanel>; views: Map<string, PluginView>;
  timeout: ReturnType<typeof setTimeout>; requests: number; lastRequestAt: number;
  pending: Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>;
}
const CHANNEL = 'notebook-plugin-v1';
const LOCAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const EVENTS = new Set(['document.changed', 'document.active', 'storage.changed', 'sync.completed', 'theme.changed', 'view.visibility']);
const LOCATIONS = new Set(['app.menu', 'home.toolbar', 'editor.toolbar']);
const RESERVED_KEYS = new Set(['Mod+KeyZ', 'Mod+Shift+KeyZ', 'Mod+KeyX', 'Mod+KeyC', 'Mod+KeyV', 'Mod+KeyA', 'Mod+KeyQ', 'Mod+KeyW', 'Mod+KeyH', 'Mod+KeyM', 'Mod+KeyR', 'Mod+KeyT', 'Mod+KeyL', 'Mod+Tab', 'Alt+Tab', 'Alt+F4']);
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const text = (value: unknown, name: string, limit: number): string => {
  if (typeof value !== 'string' || value.length > limit) throw new PluginError('INVALID_ARGUMENT', `${name} 格式不正确或超出长度限制`);
  return value;
};
const localId = (value: unknown): string => {
  if (typeof value !== 'string' || !LOCAL_ID.test(value)) throw new PluginError('INVALID_ARGUMENT', '局部 id 不正确');
  return value;
};
const boundedHeight = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(100, Math.min(600, Math.round(value))) : 220;
const shortcut = (event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code'>) => {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return [(mac ? event.metaKey : event.ctrlKey) ? 'Mod' : '', mac && event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.code].filter(Boolean).join('+');
};

export class PluginHost {
  private running = new Map<string, RunningPlugin>();
  private failed = new Map<string, string>();
  private disposed = false;
  private activeDocumentId: string | null | undefined;
  constructor(private options: PluginHostOptions) {
    window.addEventListener('message', this.onMessage);
    window.addEventListener('keydown', this.onKeyDown);
  }
  setPlugins(plugins: InstalledPlugin[]) {
    if (this.disposed) return;
    const wanted = new Map(plugins.slice(0, 24).map(plugin => [plugin.manifest.id, plugin]));
    for (const [id, running] of this.running) {
      const next = wanted.get(id);
      if (!next?.enabled || JSON.stringify([next.code, next.files, next.manifest]) !== JSON.stringify([running.plugin.code, running.plugin.files, running.plugin.manifest])) this.stop(id);
    }
    for (const id of this.failed.keys()) if (!wanted.get(id)?.enabled) this.failed.delete(id);
    for (const [id, plugin] of wanted) {
      if (!plugin.enabled || this.running.has(id)) continue;
      const signature = JSON.stringify([plugin.manifest, plugin.code, plugin.files]);
      if (this.failed.get(id) === signature) continue;
      try { validatePlugin(plugin); this.start(plugin); }
      catch (error) { this.failed.set(id, signature); this.options.onPluginStopped?.(id); this.options.onError(`${plugin.manifest.name}：${pluginError(error).message}`); }
    }
  }
  getCommands(): PluginCommand[] { return [...this.running.values()].flatMap(p => [...p.commands.values()]); }
  getPanels(): PluginPanel[] { return [...this.running.values()].flatMap(p => [...p.panels.values()]); }
  getViews(slot?: PluginView['slot']): PluginView[] { return [...this.running.values()].flatMap(p => [...p.views.values()]).filter(view => !slot || view.slot === slot); }
  hasPermission(pluginId: string, permission: string) { return !!this.running.get(pluginId)?.plugin.manifest.permissions.includes(permission); }
  hasDocumentSubscribers() { return [...this.running.values()].some(p => [...p.connections].some(c => c.subscriptions.has('document.changed'))); }
  async runCommand(id: string) {
    const instance = [...this.running.values()].find(p => p.commands.has(id));
    if (!instance) throw new PluginError('NOT_FOUND', '插件命令已不可用');
    const requestId = randomToken();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => this.fail(instance, '命令执行超时，插件已停用'), 10000);
      instance.pending.set(requestId, { resolve, reject, timeout });
      this.post(instance.main, { kind: 'command', id: id.slice(instance.plugin.manifest.id.length + 1), requestId });
    });
  }
  openView(id: string) {
    const view = this.getViews().find(view => view.id === id);
    if (!view || view.slot === 'home.widget') throw new PluginError('NOT_FOUND', '插件页面不可用');
    this.options.onOpenView(view);
  }
  mountView(id: string, container: HTMLElement): () => void {
    const instance = [...this.running.values()].find(p => p.views.has(id));
    if (!instance) return () => {};
    const view = instance.views.get(id)!;
    const connection = this.connection(id);
    connection.frame.title = view.title;
    connection.frame.className = 'plugin-surface-frame';
    instance.connections.add(connection);
    connection.frame.onload = () => this.initialize(instance, connection);
    container.append(connection.frame);
    return () => this.detach(instance, connection);
  }
  notifyDocumentChange(change?: DocumentChange) {
    if (change) this.emit('document.changed', change);
    const documentId = this.options.getActiveDocumentId();
    if (documentId !== this.activeDocumentId) {
      this.activeDocumentId = documentId;
      for (const instance of this.running.values()) for (const connection of instance.connections) this.post(connection, { kind: 'context', context: { activeDocumentId: documentId } });
      this.emit('document.active', { documentId });
    }
  }
  notifyStorage(pluginId?: string, keys: string[] | null = null) { this.emit('storage.changed', { keys }, pluginId); }
  notifySync() { this.emit('sync.completed', { timestamp: new Date().toISOString() }); }
  notifyTheme() {
    const theme = this.options.getTheme();
    for (const instance of this.running.values()) for (const connection of instance.connections) this.post(connection, { kind: 'context', context: { theme, activeDocumentId: this.options.getActiveDocumentId() } });
    this.emit('theme.changed', theme);
  }
  dispose() {
    this.disposed = true; window.removeEventListener('message', this.onMessage); window.removeEventListener('keydown', this.onKeyDown);
    for (const id of this.running.keys()) this.stop(id);
  }
  private emit(name: string, payload: unknown, pluginId?: string) {
    for (const instance of this.running.values()) {
      if (pluginId && instance.plugin.manifest.id !== pluginId) continue;
      for (const connection of instance.connections) if (connection.subscriptions.has(name)) this.post(connection, { kind: 'event', name, payload });
    }
  }
  private connection(viewId?: string): Connection {
    const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts');
    if (!viewId) { frame.hidden = true; frame.setAttribute('aria-hidden', 'true'); }
    frame.src = new URL('/plugins/sandbox.html', location.href).href;
    return { frame, viewId, token: randomToken(), subscriptions: new Set(), requests: new Map() };
  }
  private initialize(instance: RunningPlugin, connection: Connection) {
    if (this.running.get(instance.plugin.manifest.id) !== instance) return;
    const view = connection.viewId ? instance.views.get(connection.viewId) : undefined;
    this.post(connection, {
      kind: 'init', code: view ? instance.plugin.files?.[view.script] : instance.plugin.code,
      role: view ? 'view' : 'worker', styles: view?.styles.map(path => instance.plugin.files?.[path] ?? '') ?? [],
      context: { pluginId: instance.plugin.manifest.id, surfaceId: view?.id ?? null, slot: view?.slot ?? null, deviceId: extensionDeviceId(), theme: this.options.getTheme(), activeDocumentId: this.options.getActiveDocumentId() },
    });
  }
  private start(plugin: InstalledPlugin) {
    if (plugin.manifest.apiVersion === 2 && plugin.manifest.permissions.some(p => p === 'home.activity' || p === 'assistant'))
      throw new PluginError('UNSUPPORTED_API', '此插件使用已停用的业务接口，请在插件市场更新到 API 3 版本；已有数据保留');
    const main = this.connection();
    const instance: RunningPlugin = {
      plugin, main, connections: new Set([main]), services: new PluginServices(randomToken(), plugin.manifest.id, plugin.manifest.networkOrigins ?? []),
      commands: new Map(), panels: new Map(), views: new Map(), requests: 0, lastRequestAt: Date.now(), pending: new Map(),
      timeout: setTimeout(() => this.fail(instance, '启动超时，插件已停用'), 8000),
    };
    main.frame.onload = () => this.initialize(instance, main);
    this.running.set(plugin.manifest.id, instance); document.body.append(main.frame);
  }
  private detach(instance: RunningPlugin, connection: Connection) {
    if (!instance.connections.delete(connection)) return;
    for (const controller of connection.requests.values()) controller.abort();
    connection.requests.clear(); this.post(connection, { kind: 'dispose' }); connection.frame.remove();
  }
  private stop(id: string) {
    const instance = this.running.get(id); if (!instance) return;
    this.running.delete(id); clearTimeout(instance.timeout);
    this.options.cancelDialogs(id);
    for (const connection of [...instance.connections]) this.detach(instance, connection);
    void instance.services.stop();
    for (const pending of instance.pending.values()) { clearTimeout(pending.timeout); pending.reject(new PluginError('CANCELLED', '插件已停用')); }
    instance.pending.clear(); this.options.onStateChange();
  }
  private fail(instance: RunningPlugin, message: string) {
    if (this.running.get(instance.plugin.manifest.id) !== instance) return;
    this.failed.set(instance.plugin.manifest.id, JSON.stringify([instance.plugin.manifest, instance.plugin.code, instance.plugin.files]));
    this.stop(instance.plugin.manifest.id); this.options.onPluginStopped?.(instance.plugin.manifest.id); this.options.onError(`${instance.plugin.manifest.name}：${message}`);
  }
  private post(connection: Connection, payload: Record<string, unknown>) {
    connection.frame.contentWindow?.postMessage({ channel: CHANNEL, token: connection.token, ...payload }, '*');
  }
  private sendShortcuts(instance: RunningPlugin, connection?: Connection) {
    const bindings = [...instance.commands.values()].filter(command => command.shortcut).map(command => ({ id: command.id.slice(instance.plugin.manifest.id.length + 1), binding: command.shortcut }));
    for (const target of connection ? [connection] : instance.connections) this.post(target, { kind: 'shortcuts', bindings });
  }
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
    const command = this.getCommands().find(command => command.shortcut === shortcut(event));
    if (command) { event.preventDefault(); void this.runCommand(command.id).catch(error => this.options.onError(pluginError(error).message)); }
  };
  private onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) return;
    let instance: RunningPlugin | undefined, connection: Connection | undefined;
    for (const candidate of this.running.values()) {
      const found = [...candidate.connections].find(c => c.frame.contentWindow === event.source && c.token === data.token);
      if (found) { instance = candidate; connection = found; break; }
    }
    if (!instance || !connection) return;
    const current = instance, target = connection;
    if (data.kind === 'ready') {
      if (target === current.main) clearTimeout(current.timeout);
      this.post(target, { kind: 'context', context: { theme: this.options.getTheme(), activeDocumentId: this.options.getActiveDocumentId() } });
      this.sendShortcuts(current, target);
      return;
    }
    if (data.kind === 'error') { this.fail(current, String(data.message ?? '插件执行失败').slice(0, 500)); return; }
    if (data.kind === 'command-result') {
      if (target !== current.main) return;
      const pending = current.pending.get(data.requestId); if (!pending) return;
      clearTimeout(pending.timeout); current.pending.delete(data.requestId);
      if (data.error) pending.reject(new PluginError('INTERNAL_ERROR', String(data.error).slice(0, 300))); else pending.resolve();
      return;
    }
    if (data.kind === 'request.cancel') { target.requests.get(String(data.requestId))?.abort(); return; }
    if (data.kind === 'shortcut' && target.viewId) {
      const command = current.commands.get(`${current.plugin.manifest.id}:${data.id}`);
      if (command?.shortcut && !document.querySelector('dialog[open]')) void this.runCommand(command.id).catch(error => this.options.onError(pluginError(error).message));
      return;
    }
    if (data.kind !== 'request' || typeof data.requestId !== 'string' || data.requestId.length > 80 || typeof data.method !== 'string') return;
    if (Date.now() - current.lastRequestAt > 1000) { current.lastRequestAt = Date.now(); current.requests = 0; }
    if (++current.requests > 120 || target.requests.size >= 100 || target.requests.has(data.requestId)) { this.fail(current, '调用过于频繁，插件已停用'); return; }
    const controller = new AbortController(); target.requests.set(data.requestId, controller);
    void this.handle(current, target, data.requestId, data.method, data.args, controller.signal).then(result => {
      if (this.running.get(current.plugin.manifest.id) === current && current.connections.has(target)) this.post(target, { kind: 'response', requestId: data.requestId, result });
    }).catch(error => this.post(target, { kind: 'response', requestId: data.requestId, error: pluginError(error) })).finally(() => target.requests.delete(data.requestId));
  };
  private require(instance: RunningPlugin, permission: string) {
    if (!instance.plugin.manifest.permissions.includes(permission)) throw new PluginError('PERMISSION_DENIED', `插件未获授权：${permission}`);
  }
  private live(instance: RunningPlugin, signal: AbortSignal) {
    if (signal.aborted || this.running.get(instance.plugin.manifest.id) !== instance) throw new PluginError('CANCELLED', '操作已取消');
  }
  private async handle(instance: RunningPlugin, connection: Connection, requestId: string, method: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const workspace = () => this.options.getWorkspace();
    const findDocument = (id: string) => workspace().notebooks.flatMap(n => n.documents).find(d => d.id === id);
    const id = instance.plugin.manifest.id;
    const dialog = async (value: Parameters<PluginHostOptions['showDialog']>[2]) => {
      const result = await this.options.showDialog(id, instance.plugin.manifest.name, value, signal);
      this.live(instance, signal); return result;
    };
    switch (method) {
      case 'storage.get': this.require(instance, 'storage'); return this.options.getPluginData(id, text(args.key, '存储键', 128)) ?? null;
      case 'storage.list': this.require(instance, 'storage'); return this.options.listPluginData(id, text(args.prefix ?? '', '存储前缀', 128));
      case 'storage.set': case 'storage.remove':
        this.require(instance, 'storage'); await this.options.setPluginData(id, text(args.key, '存储键', 128), args.value, method === 'storage.remove');
        this.notifyStorage(id, [String(args.key)]); return null;
      case 'events.subscribe': {
        const name = text(args.name ?? 'document.active', '事件', 60);
        if (!EVENTS.has(name)) throw new PluginError('UNSUPPORTED_API', '未知事件');
        if (name.startsWith('document.')) this.require(instance, 'notes.read');
        if (name === 'storage.changed') this.require(instance, 'storage');
        connection.subscriptions.add(name); this.options.onStateChange(); return null;
      }
      case 'events.unsubscribe': connection.subscriptions.delete(String(args.name ?? 'document.active')); this.options.onStateChange(); return null;
      case 'notes.list': this.require(instance, 'notes.read'); return workspace().notebooks.map(n => ({ id: n.id, name: n.name, documents: n.documents.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) }));
      case 'notes.get': this.require(instance, 'notes.read'); return findDocument(text(args.id, '文档 id', 64)) ?? null;
      case 'notes.active': this.require(instance, 'notes.read'); return findDocument(this.options.getActiveDocumentId() ?? '') ?? null;
      case 'notes.search': {
        this.require(instance, 'notes.read'); const query = text(args.query, '搜索', 300).trim().toLocaleLowerCase();
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20)), offset = Math.max(0, Math.trunc(Number(args.offset) || 0));
        if (!query) return { results: [], hasMore: false };
        const matches = workspace().notebooks.flatMap(book => book.documents.map(doc => ({ ...doc, notebookId: book.id, notebook: book.name }))).filter(doc => (doc.title + '\n' + doc.markdown).toLocaleLowerCase().includes(query));
        return { results: matches.slice(offset, offset + limit).map(doc => { const start = Math.max(0, doc.markdown.toLocaleLowerCase().indexOf(query) - 80); return { id: doc.id, title: doc.title, notebookId: doc.notebookId, notebook: doc.notebook, updatedAt: doc.updatedAt, snippet: doc.markdown.slice(start, start + 300) }; }), hasMore: offset + limit < matches.length };
      }
      case 'notes.open': this.require(instance, 'notes.read'); if (!findDocument(text(args.id, '文档 id', 64))) throw new PluginError('NOT_FOUND', '文档不存在'); this.options.openDocument(String(args.id)); return null;
      case 'notes.update': {
        this.require(instance, 'notes.write'); const documentId = text(args.id, '文档 id', 64), markdown = text(args.markdown, 'Markdown', 5 * 1024 * 1024);
        if (!findDocument(documentId)) throw new PluginError('NOT_FOUND', '文档不存在');
        const expected = args.expectedMarkdown === undefined ? undefined : text(args.expectedMarkdown, '原正文', 5 * 1024 * 1024);
        await this.options.replaceDocument(documentId, markdown, expected); return null;
      }
      case 'notes.create': {
        this.require(instance, 'notes.write'); const notebookId = text(args.notebookId, '笔记 id', 64), title = text(args.title, '文档标题', 160).trim();
        if (!title || !workspace().notebooks.some(n => n.id === notebookId)) throw new PluginError('INVALID_ARGUMENT', '标题或目标笔记无效');
        return this.options.createDocument(notebookId, title, text(args.markdown ?? '', 'Markdown', 5 * 1024 * 1024));
      }
      case 'editor.context': this.require(instance, 'editor.read'); { const doc = findDocument(this.options.getActiveDocumentId() ?? ''); return doc ? { id: doc.id, title: doc.title, updatedAt: doc.updatedAt } : null; }
      case 'editor.selection': this.require(instance, 'editor.read'); return this.options.getSelection();
      case 'editor.insert': case 'editor.replaceSelection': this.require(instance, 'editor.insert'); this.options.insertText(text(args.text, '插入文字', 1024 * 1024)); return null;
      case 'commands.register': {
        this.require(instance, 'commands'); const local = localId(args.id), commandId = `${id}:${local}`, label = text(args.label, '命令名称', 60).trim();
        if (!label || (instance.commands.size >= 20 && !instance.commands.has(commandId))) throw new PluginError('LIMIT_EXCEEDED', '命令无效或超过 20 个');
        const locations = args.locations ?? ['app.menu'];
        if (!Array.isArray(locations) || locations.some(location => !LOCATIONS.has(String(location)))) throw new PluginError('INVALID_ARGUMENT', '未知命令位置');
        const binding = args.shortcut === undefined ? undefined : text(args.shortcut, '快捷键', 80);
        if (binding && (!/^(?:Mod\+)?(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|Comma|Period|Slash|BracketLeft|BracketRight)$/.test(binding) || !binding.includes('+') || RESERVED_KEYS.has(binding) || this.options.reservedShortcuts.includes(binding) || this.getCommands().some(command => command.id !== commandId && command.shortcut === binding))) throw new PluginError('CONFLICT', '快捷键无效或已被占用，请按 Mod、Ctrl、Alt、Shift 顺序声明，或不带快捷键注册');
        instance.commands.set(commandId, { id: commandId, pluginId: id, label, locations, shortcut: binding, ...(typeof args.icon === 'string' ? { icon: text(args.icon, '图标', 40) } : {}) });
        this.sendShortcuts(instance);
        this.options.onStateChange(); return null;
      }
      case 'ui.register': {
        this.require(instance, 'ui'); const local = localId(args.id), viewId = `${id}:${local}`;
        if (instance.views.size >= 8 && !instance.views.has(viewId)) throw new PluginError('LIMIT_EXCEEDED', '每个插件最多 8 个视图');
        if (!['home.widget', 'app.page', 'plugin.settings'].includes(String(args.slot))) throw new PluginError('INVALID_ARGUMENT', '未知视图位置');
        const script = text(args.script, '界面脚本', 200), styles = args.styles ?? [];
        if (!script.endsWith('.js') || !Array.isArray(styles) || styles.length > 8 || styles.some(path => typeof path !== 'string' || !path.endsWith('.css') || typeof instance.plugin.files?.[path] !== 'string') || typeof instance.plugin.files?.[script] !== 'string') throw new PluginError('NOT_FOUND', '插件包缺少 JS 或 CSS 界面资源');
        instance.views.set(viewId, { id: viewId, pluginId: id, localId: local, slot: args.slot as PluginView['slot'], title: text(args.title, '标题', 60), script, styles: styles as string[], height: boundedHeight(args.height), ...(typeof args.icon === 'string' ? { icon: text(args.icon, '图标', 40) } : {}) });
        this.options.onStateChange(); return null;
      }
      case 'ui.open': this.require(instance, 'ui'); this.openView(`${id}:${localId(args.id)}`); return null;
      case 'ui.close': this.require(instance, 'ui'); if (connection.viewId) this.options.onCloseView(connection.viewId); return null;
      case 'ui.openExternal': {
        this.require(instance, 'ui'); const url = text(args.url, '链接', 4000);
        let parsed: URL; try { parsed = new URL(url); } catch { throw new PluginError('INVALID_ARGUMENT', '链接无效'); }
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new PluginError('INVALID_ARGUMENT', '仅支持 HTTP(S) 链接');
        await openLink(url); return null;
      }
      case 'ui.resize': {
        this.require(instance, 'ui'); const view = instance.views.get(connection.viewId ?? '');
        if (!view || view.slot !== 'home.widget') throw new PluginError('INVALID_ARGUMENT', '仅首页组件可调整高度');
        if (view.height !== boundedHeight(args.height)) { view.height = boundedHeight(args.height); this.options.onStateChange(); } return null;
      }
      case 'dialogs.confirm': this.require(instance, 'ui'); return dialog({ kind: 'confirm', title: text(args.title, '标题', 100), message: text(args.message, '内容', 10000) });
      case 'dialogs.reviewChanges': {
        this.require(instance, 'ui'); this.require(instance, 'notes.write'); this.require(instance, 'notes.read');
        const documentId = args.documentId === undefined ? undefined : text(args.documentId, '文档 id', 64), markdown = text(args.markdown, 'Markdown', 5 * 1024 * 1024), title = text(args.title ?? '修改文档', '标题', 160);
        const doc = documentId ? findDocument(documentId) : undefined;
        if (documentId && !doc) throw new PluginError('NOT_FOUND', '文档不存在');
        const expected = documentId ? text(args.expectedMarkdown, '原正文', 5 * 1024 * 1024) : '';
        if (doc && doc.markdown !== expected) throw new PluginError('CONFLICT', '文档已发生变化，请重新读取');
        if (!await dialog({ kind: 'review', title, before: expected, after: markdown })) return { applied: false };
        this.live(instance, signal);
        if (documentId) { await this.options.replaceDocument(documentId, markdown, expected); return { applied: true, documentId }; }
        const notebookId = text(args.notebookId, '笔记 id', 64);
        if (!workspace().notebooks.some(book => book.id === notebookId)) throw new PluginError('NOT_FOUND', '目标笔记不存在');
        const created = await this.options.createDocument(notebookId, title, markdown); return { applied: true, documentId: created.id };
      }
      case 'notifications.show': this.require(instance, 'ui'); this.options.notify(text(args.message, '消息', 300)); return null;
      case 'files.pick': this.require(instance, 'files.pick'); return pickPluginFile(args.extensions);
      case 'files.save': this.require(instance, 'files.export'); return savePluginFile(args.name, args.bytes);
      case 'network.authorize': {
        this.require(instance, 'network'); const origin = httpsOrigin(args.origin);
        if (instance.services.hasOrigin(origin)) return true;
        if (!await dialog({ kind: 'confirm', title: '允许连接', message: `允许此插件连接 ${origin}？此授权仅保存在当前设备。` })) return false;
        await instance.services.authorize(origin); return true;
      }
      case 'network.request': case 'network.stream': {
        this.require(instance, 'network'); if (args.credential !== undefined) this.require(instance, 'secrets');
        const nativeId = `${connection.token}.${requestId}`;
        const cancel = () => { void instance.services.call('plugin_network_cancel', { requestId: nativeId }).catch(() => {}); };
        signal.addEventListener('abort', cancel, { once: true });
        try { this.live(instance, signal); return await instance.services.request(nativeId, args, method === 'network.stream' ? chunk => this.post(connection, { kind: 'chunk', requestId, chunk }) : undefined); }
        finally { signal.removeEventListener('abort', cancel); }
      }
      case 'secrets.status': this.require(instance, 'secrets'); return instance.services.call('plugin_secret_status', { id: localId(args.id), origin: httpsOrigin(args.origin) });
      case 'secrets.remove': this.require(instance, 'secrets'); await instance.services.call('plugin_secret_remove', { id: localId(args.id) }); return null;
      case 'secrets.configure': {
        this.require(instance, 'secrets'); const origin = httpsOrigin(args.origin);
        if (!instance.services.hasOrigin(origin)) throw new PluginError('PERMISSION_DENIED', '请先授权目标域名');
        const key = await dialog({ kind: 'secret', title: text(args.label ?? '配置访问密钥', '标题', 100), origin });
        if (typeof key !== 'string' || !key) return { configured: false };
        await instance.services.call('plugin_secret_configure', { id: localId(args.id), origin, key }); return { configured: true };
      }
      case 'panels.set': {
        this.require(instance, 'panels'); const panelId = `${id}:${localId(args.id)}`;
        if (instance.panels.size >= 6 && !instance.panels.has(panelId)) throw new PluginError('LIMIT_EXCEEDED', '最多 6 个面板');
        instance.panels.set(panelId, { id: panelId, pluginId: id, title: text(args.title, '标题', 60), text: text(args.text, '内容', 20000) }); this.options.onStateChange(); return null;
      }
      case 'panels.close': this.require(instance, 'panels'); instance.panels.delete(`${id}:${localId(args.id)}`); this.options.onStateChange(); return null;
      default: throw new PluginError('UNSUPPORTED_API', '不支持此插件接口，请更新插件或 TypePro');
    }
  }
}
