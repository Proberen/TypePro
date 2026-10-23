import { unzipSync } from 'fflate';
import type { InstalledPlugin } from '../lib/types';

export const PERMISSIONS = {
  'notes.read': '读取笔记本和文档',
  'notes.write': '创建和修改文档',
  'editor.read': '读取当前编辑器与选区',
  'editor.insert': '向当前文档插入和替换文字',
  commands: '添加菜单命令和工具按钮',
  panels: '显示文字面板',
  ui: '显示插件页面、组件和设置',
  storage: '保存并同步插件数据',
  network: '访问已授权的 HTTPS 服务',
  secrets: '使用本设备安全保存的凭据',
  'files.pick': '读取用户选择的文件',
  'files.export': '导出文件到用户选择的位置',
  'home.activity': '旧版打卡接口（请更新插件）',
  assistant: '旧版 AI 接口（请更新插件）',
} as const;

export type PluginPermission = keyof typeof PERMISSIONS;
export const PACKAGE_LIMITS = { bytes: 8 * 1024 * 1024, files: 128, code: 512 * 1024, resource: 4 * 1024 * 1024, manifest: 16 * 1024 } as const;
const ID = /^[a-z][a-z0-9._-]{2,63}$/;
const encoder = new TextEncoder();
const LEGACY = new Set(['notes.read', 'notes.write', 'editor.insert', 'commands', 'panels']);
const API2 = new Set([...LEGACY, 'storage', 'home.activity', 'assistant']);
const API3 = new Set(Object.keys(PERMISSIONS).filter(value => !['home.activity', 'assistant'].includes(value)));

export function normalizeNetworkOrigins(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 32) throw new Error('最多声明 32 个 HTTPS 来源');
  return [...new Set(input.map(value => {
    if (typeof value !== 'string' || value.length > 2048 || value.includes('\\') || value.includes('*') || value.trim() !== value) throw new Error('网络来源必须是完整 HTTPS 来源');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('网络来源无效'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/' || ![url.origin, `${url.origin}/`].includes(value)) throw new Error('网络来源只能包含 HTTPS 协议、主机和端口');
    return url.origin;
  }))].sort();
}

export function validResourcePath(path: string): boolean {
  return path.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:js|css|json|txt|md|svg)$/.test(path)
    && path.split('/').every(part => !!part && !['.', '..', '__proto__', 'prototype', 'constructor'].includes(part));
}

export function normalizePluginFiles(input: unknown): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('插件资源必须为对象');
  const entries = Object.entries(input);
  if (entries.length > PACKAGE_LIMITS.files - 2) throw new Error('插件资源文件过多');
  const files: Record<string, string> = {};
  for (const [name, value] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!validResourcePath(name) || typeof value !== 'string' || encoder.encode(value).length > PACKAGE_LIMITS.resource) throw new Error('插件资源路径、类型或大小无效');
    files[name] = value;
  }
  return Object.keys(files).length ? files : undefined;
}

export function validatePlugin(input: unknown): InstalledPlugin {
  if (!input || typeof input !== 'object') throw new Error('插件包格式不正确');
  const { manifest, code } = input as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('缺少 manifest.json');
  const m = manifest as Record<string, unknown>;
  if (encoder.encode(JSON.stringify(m)).length > PACKAGE_LIMITS.manifest) throw new Error('Manifest 不能超过 16 KB');
  if (typeof m.id !== 'string' || !ID.test(m.id)) throw new Error('插件 id 应为 3–64 位小写字母、数字、点、短横线或下划线');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) throw new Error('插件名称应为 1–60 个字符');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version) || m.version.length > 40) throw new Error('插件版本格式应为 1.0.0');
  if (m.apiVersion !== 1 && m.apiVersion !== 2 && m.apiVersion !== 3) throw new Error('此插件需要更新的 TypePro 版本');
  if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > 300)) throw new Error('插件说明最多 300 个字符');
  const allowed = m.apiVersion === 1 ? LEGACY : m.apiVersion === 2 ? API2 : API3;
  if (!Array.isArray(m.permissions) || m.permissions.some(p => typeof p !== 'string' || !allowed.has(p))) throw new Error('插件声明了当前 API 不支持的权限');
  const networkOrigins = normalizeNetworkOrigins(m.networkOrigins);
  if (m.networkOrigins !== undefined && (m.apiVersion !== 3 || !m.permissions.includes('network'))) throw new Error('网络来源需要 API 3 和 network 权限');
  if (typeof code !== 'string' || !code.trim() || encoder.encode(code).length > PACKAGE_LIMITS.code) throw new Error('main.js 不能为空且不能超过 512 KB');
  const files = normalizePluginFiles((input as Record<string, unknown>).files);
  if (files && m.apiVersion !== 3) throw new Error('插件资源需要 apiVersion: 3');
  const normalized: InstalledPlugin['manifest'] = {
    id: m.id, name: m.name.trim(), version: m.version, apiVersion: m.apiVersion,
    ...(m.description ? { description: m.description as string } : {}),
    permissions: [...new Set(m.permissions as string[])],
    ...(m.networkOrigins !== undefined ? { networkOrigins } : {}),
  };
  if (encoder.encode(JSON.stringify(normalized)).length > PACKAGE_LIMITS.manifest
    || encoder.encode(JSON.stringify(normalized) + code + Object.values(files ?? {}).join('')).length > PACKAGE_LIMITS.bytes) throw new Error('插件解压内容不能超过 8 MB');
  return { manifest: normalized, code, ...(files ? { files } : {}), enabled: false };
}

export function parsePluginPackage(name: string, bytes: Uint8Array): InstalledPlugin {
  if (bytes.length > PACKAGE_LIMITS.bytes) throw new Error('插件包不能超过 8 MB');
  if (/\.json$/i.test(name)) {
    try { return validatePlugin(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
    catch (error) { if (error instanceof SyntaxError) throw new Error('插件 JSON 无法解析'); throw error; }
  }
  if (!/\.zip$/i.test(name)) throw new Error('请选择 ZIP 或 JSON 插件包');
  let total = 0, count = 0, invalid = false;
  const names = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter(file) {
      const directory = file.name.endsWith('/');
      if (directory) return false;
      count++; total += file.originalSize;
      const resource = file.name.startsWith('files/') && validResourcePath(file.name.slice(6));
      const limit = file.name === 'manifest.json' ? PACKAGE_LIMITS.manifest : file.name === 'main.js' ? PACKAGE_LIMITS.code : PACKAGE_LIMITS.resource;
      if (count > PACKAGE_LIMITS.files || total > PACKAGE_LIMITS.bytes || names.has(file.name) || file.originalSize < 0 || !Number.isSafeInteger(file.originalSize)
        || file.originalSize > limit || (!resource && !['manifest.json', 'main.js'].includes(file.name))) invalid = true;
      names.add(file.name);
      return !invalid;
    } });
  } catch { throw new Error('插件 ZIP 损坏或格式不受支持'); }
  if (invalid) throw new Error('插件 ZIP 超出限制或包含无效、重复文件');
  if (!files['manifest.json'] || !files['main.js']) throw new Error('ZIP 根目录需要 manifest.json 和 main.js');
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const resources: Record<string, string> = {};
    for (const [path, data] of Object.entries(files)) if (path.startsWith('files/')) resources[path.slice(6)] = decoder.decode(data);
    return validatePlugin({ manifest: JSON.parse(decoder.decode(files['manifest.json'])), code: decoder.decode(files['main.js']), files: resources });
  } catch (error) { if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('插件 JSON 或 UTF-8 内容无效'); throw error; }
}
