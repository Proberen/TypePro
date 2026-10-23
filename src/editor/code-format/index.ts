import { validateFlowSource } from '../../flow/preview';
import { formatLanguage } from './core.ts';
import type { FormatResult } from './worker.ts';

/** Reject on errors; callers replace the editor's original code only on success. */
export async function formatCode(language: string, code: string): Promise<string> {
  const name = formatLanguage(language);
  if (typeof code !== 'string') throw new Error('代码内容必须是文本');
  if (name === 'mermaid') await validateFlowSource(code);
  const result = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    // A worker per operation releases Rust/WASM linear memory immediately,
    // rather than retaining a formatting toolchain while the user writes.
    const finish = (error?: Error, output?: string) => {
      clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(output!);
    };
    const timer = setTimeout(() => finish(new Error('格式化超时，请检查代码后重试')), 45000);
    worker.onmessage = ({ data }: MessageEvent<FormatResult>) => {
      if (data.ok) finish(undefined, data.code);
      else finish(new Error(data.error));
    };
    worker.onerror = (event) => { event.preventDefault(); finish(new Error('格式化组件运行失败，请重试')); };
    worker.onmessageerror = () => finish(new Error('格式化结果读取失败，请重试'));
    worker.postMessage({ language: name, code });
  });
  if (name === 'mermaid') await validateFlowSource(result);
  return result;
}
