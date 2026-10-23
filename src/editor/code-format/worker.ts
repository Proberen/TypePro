import { formatCodeCore } from './core.ts';
import { wasmFormatters } from './wasm.ts';

export interface FormatRequest { language: string; code: string }
export type FormatResult = { ok: true; code: string } | { ok: false; error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<FormatRequest>) => void) | null;
  postMessage(message: FormatResult): void;
};
scope.onmessage = async ({ data }) => {
  try {
    const code = await formatCodeCore(data.language, data.code, wasmFormatters);
    scope.postMessage({ ok: true, code });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
