import type { WasmFormatters } from './core.ts';

// All imports are static module specifiers so Vite emits every local runtime
// and WASM asset. These functions are called only in a short-lived worker.
export const wasmFormatters: WasmFormatters = {
  async go(source) {
    const engine = await import('@wasm-fmt/gofmt/vite');
    await engine.default();
    return engine.format(source);
  },
  async python(source) {
    const engine = await import('@wasm-fmt/ruff_fmt/vite');
    await engine.default();
    return engine.format(source, 'note.py', { indent_style: 'space', indent_width: 4, line_width: 88, quote_style: 'double' });
  },
  async bash(source) {
    const engine = await import('@wasm-fmt/shfmt/vite');
    await engine.default();
    return engine.format(source, 'note.bash', { indent: 2, simplify: false });
  },
  async rust(source) {
    const [engine, artifact] = await Promise.all([import('@scalar/rust-fmt'), import('@scalar/rust-fmt/wasm?url')]);
    // The package's declaration points at its Node entry, while Vite's exact
    // alias deliberately selects its documented browser init({url}) entry.
    await (engine.init as (options: { url: string }) => Promise<void>)({ url: artifact.default });
    return engine.format(source, { maxWidth: 88, tabSpaces: 4, edition: '2021' });
  },
};
