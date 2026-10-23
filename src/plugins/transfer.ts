import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { command, native } from '../lib/bridge';
import { PluginError } from './contracts';

const LIMIT = 8 * 1024 * 1024;
export async function pickPluginFile(input: unknown) {
  const extensions = input === undefined ? [] : input;
  if (!Array.isArray(extensions) || extensions.length > 20 || extensions.some(item => typeof item !== 'string' || !/^[a-z0-9]{1,12}$/i.test(item))) throw new PluginError('INVALID_ARGUMENT', '文件类型无效');
  let name: string, bytes: Uint8Array;
  if (native) {
    const android = /Android/i.test(navigator.userAgent);
    const path = await open({ multiple: false, directory: false, title: '选择文件', ...(extensions.length && !android ? { filters: [{ name: '文件', extensions }] } : {}) });
    if (!path) return null;
    name = path.startsWith('content://') ? await command<string>('get_transfer_name', { uri: path }) : path.split(/[\\/]/).pop() || '文件';
    bytes = await readFile(path);
  } else {
    const file = await new Promise<File | null>(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = extensions.map(extension => `.${extension}`).join(',');
      input.oncancel = () => resolve(null); input.onchange = () => resolve(input.files?.[0] ?? null); input.click();
    });
    if (!file) return null;
    if (file.size > LIMIT) throw new PluginError('LIMIT_EXCEEDED', '文件不能超过 8 MiB');
    name = file.name; bytes = new Uint8Array(await file.arrayBuffer());
  }
  if (bytes.length > LIMIT) throw new PluginError('LIMIT_EXCEEDED', '文件不能超过 8 MiB');
  if (extensions.length && !extensions.some(extension => name.toLowerCase().endsWith(`.${extension.toLowerCase()}`))) throw new PluginError('INVALID_ARGUMENT', '文件类型不匹配');
  return { name, bytes: Array.from(bytes) };
}
export async function savePluginFile(inputName: unknown, inputBytes: unknown) {
  if (typeof inputName !== 'string' || !inputName || inputName.length > 160 || /[\\/\x00-\x1f]/.test(inputName) || !Array.isArray(inputBytes) || inputBytes.length > LIMIT || inputBytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new PluginError('INVALID_ARGUMENT', '导出文件无效');
  const bytes = new Uint8Array(inputBytes);
  if (native) {
    const path = await save({ title: '导出文件', defaultPath: inputName }); if (!path) return false;
    if (path.startsWith('content://')) await command('write_transfer_uri', { uri: path, bytes: inputBytes }); else await writeFile(path, bytes);
  } else {
    const url = URL.createObjectURL(new Blob([bytes])); const link = document.createElement('a'); link.href = url; link.download = inputName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}
