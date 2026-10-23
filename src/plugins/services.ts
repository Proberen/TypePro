import { Channel } from '@tauri-apps/api/core';
import { command, native } from '../lib/bridge';
import { PluginError } from './contracts';
import { normalizeNetworkOrigins } from './packages';

export function httpsOrigin(value: unknown): string {
  try { return normalizeNetworkOrigins([value])[0]; }
  catch { throw new PluginError('INVALID_ARGUMENT', '请输入完整的 HTTPS 来源，例如 https://api.example.com'); }
}

/** Only the trusted host creates native sessions and holds their handles. */
export class PluginServices {
  private ready: Promise<void> = Promise.resolve();
  private stopped = false;
  private origins: Set<string>;
  private grants = new Set<string>();
  constructor(private sessionId: string, private pluginId: string, declared: string[]) {
    this.origins = new Set(declared);
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(this.grantKey()) || '[]');
      if (Array.isArray(saved)) for (const origin of saved.slice(0, 32)) {
        try { const validated = httpsOrigin(origin); this.grants.add(validated); this.origins.add(validated); } catch { /* Ignore malformed device-local grants. */ }
      }
    } catch { /* Device-local grants can be absent. */ }
    this.refresh();
  }
  private grantKey() { return `typepro.plugin.origins.${this.pluginId}`; }
  private refresh() {
    if (!native) return;
    this.ready = this.ready.catch(() => {}).then(async () => {
      if (this.stopped) return;
      await command('plugin_session_start', { sessionId: this.sessionId, pluginId: this.pluginId, origins: [...this.origins] });
      if (this.stopped) await command('plugin_session_stop', { sessionId: this.sessionId });
    });
    // Calls still receive the original rejection; avoid an unhandled startup rejection.
    void this.ready.catch(() => {});
  }
  hasOrigin(origin: string) { return this.origins.has(origin); }
  async authorize(origin: string) {
    origin = httpsOrigin(origin);
    const next = new Set([...this.grants, origin]);
    if (next.size > 32) throw new PluginError('LIMIT_EXCEEDED', '每个插件最多额外授权 32 个 HTTPS 来源');
    try { localStorage.setItem(this.grantKey(), JSON.stringify([...next])); }
    catch { throw new PluginError('INTERNAL_ERROR', '无法保存此设备的域名授权'); }
    this.grants = next; this.origins.add(origin);
    this.refresh(); await this.ready;
  }
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!native) throw new PluginError('UNSUPPORTED_API', '请在 TypePro 应用中使用网络和安全凭据');
    await this.ready;
    if (this.stopped) throw new PluginError('CANCELLED', '插件已停用');
    return command<T>(name, { ...args, sessionId: this.sessionId });
  }
  async request(requestId: string, request: unknown, stream?: (chunk: string) => void) {
    const args: Record<string, unknown> = { requestId, request };
    let channel: Channel<string> | undefined;
    if (stream) { channel = new Channel<string>(); channel.onmessage = stream; args.onChunk = channel; }
    try { return await this.call('plugin_network_request', args); }
    finally { if (channel) channel.onmessage = () => {}; }
  }
  async stop() {
    this.stopped = true;
    await this.ready.catch(() => {});
    if (native) await command('plugin_session_stop', { sessionId: this.sessionId }).catch(() => {});
  }
}
