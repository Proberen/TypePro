import { strFromU8, unzipSync } from 'fflate';
import type { InstalledPlugin } from '../lib/types';

export const PERMISSIONS = {
  'notes.read': '读取笔记本和文档',
  'notes.write': '创建和修改文档',
  'editor.insert': '向当前文档插入文字',
  commands: '添加工具菜单命令',
  panels: '显示文字面板',
  storage: '保存并同步插件数据',
  'home.activity': '在首页展示人工编辑打卡',
  assistant: '使用 AI 会话、模型连接和笔记工具',
} as const;

export type PluginPermission = keyof typeof PERMISSIONS;
const MAX_PACKAGE = 2 * 1024 * 1024;
const MAX_CODE = 512 * 1024;
const ID = /^[a-z][a-z0-9._-]{2,63}$/;

export function validatePlugin(input: unknown): InstalledPlugin {
  if (!input || typeof input !== 'object') throw new Error('插件包格式不正确');
  const { manifest, code } = input as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('缺少 manifest.json');
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== 'string' || !ID.test(m.id)) throw new Error('插件 id 应为 3–64 位小写字母、数字、点、短横线或下划线');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) throw new Error('插件名称应为 1–60 个字符');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version) || m.version.length > 40) throw new Error('插件版本格式应为 1.0.0');
  if (m.apiVersion !== 1 && m.apiVersion !== 2) throw new Error('此插件需要更新的 TypePro 版本');
  if (m.apiVersion === 1 && Array.isArray(m.permissions) && m.permissions.some(p => ['storage', 'home.activity', 'assistant'].includes(String(p)))) throw new Error('扩展能力需要 apiVersion: 2');
  if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > 300)) throw new Error('插件说明最多 300 个字符');
  if (!Array.isArray(m.permissions) || m.permissions.some(p => typeof p !== 'string' || !Object.prototype.hasOwnProperty.call(PERMISSIONS, p))) throw new Error('插件声明了不受支持的权限');
  if (typeof code !== 'string' || !code.trim() || new TextEncoder().encode(code).length > MAX_CODE) throw new Error('main.js 不能为空且不能超过 512 KB');
  return {
    manifest: {
      id: m.id,
      name: m.name.trim(),
      version: m.version,
      apiVersion: m.apiVersion,
      ...(m.description ? { description: m.description as string } : {}),
      permissions: [...new Set(m.permissions as string[])],
    },
    code,
    enabled: false,
  };
}

export function parsePluginPackage(name: string, bytes: Uint8Array): InstalledPlugin {
  if (bytes.length > MAX_PACKAGE) throw new Error('插件包不能超过 2 MB');
  if (/\.json$/i.test(name)) {
    try { return validatePlugin(JSON.parse(strFromU8(bytes))); }
    catch (error) { if (error instanceof SyntaxError) throw new Error('插件 JSON 无法解析'); throw error; }
  }
  if (!/\.zip$/i.test(name)) throw new Error('请选择 ZIP 或 JSON 插件包');
  let total = 0;
  let count = 0;
  let invalid = false;
  const names = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        count++;
        total += file.originalSize;
        if (count > 32 || total > MAX_PACKAGE || names.has(file.name) || file.originalSize < 0 || !Number.isSafeInteger(file.originalSize)) invalid = true;
        names.add(file.name);
        const limit = file.name === 'manifest.json' ? 16 * 1024 : MAX_CODE;
        if (file.originalSize > limit && (file.name === 'manifest.json' || file.name === 'main.js')) invalid = true;
        return !invalid && (file.name === 'manifest.json' || file.name === 'main.js');
      },
    });
  } catch { throw new Error('插件 ZIP 损坏或格式不受支持'); }
  if (invalid) throw new Error('插件 ZIP 超出大小限制或包含重复文件');
  if (!files['manifest.json'] || !files['main.js']) throw new Error('ZIP 根目录需要 manifest.json 和 main.js');
  try { return validatePlugin({ manifest: JSON.parse(strFromU8(files['manifest.json'])), code: strFromU8(files['main.js']) }); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('manifest.json 无法解析'); throw error; }
}
