import type { Options, Plugin } from 'prettier';

export const FORMAT_LANGUAGES = ['typescript', 'javascript', 'python', 'java', 'json', 'css', 'xml', 'bash', 'sql', 'rust', 'go', 'markdown', 'mermaid', 'plaintext'] as const;
export type FormatLanguage = typeof FORMAT_LANGUAGES[number];
export type WasmLanguage = 'python' | 'bash' | 'rust' | 'go';
export type WasmFormatters = Record<WasmLanguage, (source: string) => Promise<string>>;

export function formatLanguage(language: string): FormatLanguage {
  const aliases: Record<string, FormatLanguage> = { ts: 'typescript', js: 'javascript', py: 'python', html: 'xml', sh: 'bash', shell: 'bash', md: 'markdown', text: 'plaintext', txt: 'plaintext', plain: 'plaintext' };
  const value = language.trim().toLowerCase();
  const resolved = aliases[value] || value;
  if (!(FORMAT_LANGUAGES as readonly string[]).includes(resolved)) throw new Error(`暂不支持格式化此语言：${language}`);
  return resolved as FormatLanguage;
}

const options: Options = { printWidth: 88, tabWidth: 2, useTabs: false, endOfLine: 'lf', embeddedLanguageFormatting: 'off', proseWrap: 'preserve' };

/** Text-only core: native/WASM loading is supplied by the worker or Node test. */
export async function formatCodeCore(language: string, source: string, wasm: WasmFormatters): Promise<string> {
  const name = formatLanguage(language);
  if (typeof source !== 'string') throw new Error('代码内容必须是文本');
  if (name === 'plaintext') return source.replace(/[\t ]+(?=\r?$)/gm, '');
  if (name === 'python' || name === 'bash' || name === 'rust' || name === 'go') return wasm[name](source);
  if (name === 'sql') {
    const { format } = await import('sql-formatter');
    return format(source, { language: 'sql', tabWidth: 2, keywordCase: 'upper', linesBetweenQueries: 1 });
  }
  if (name === 'mermaid') {
    const { formatMermaidPreservingText } = await import('./mermaid.ts');
    return formatMermaidPreservingText(source);
  }
  const prettier = await import('prettier/standalone');
  if (name === 'java') {
    const java = (await import('prettier-plugin-java')).default;
    let firstError: unknown;
    // The plugin's parser checks its full input at each entry point. These
    // fallback roots support note snippets without wrapping/changing their code.
    for (const entrypoint of ['compilationUnit', 'classBodyDeclaration', 'blockStatements', 'expression']) {
      try { return await prettier.format(source, { ...options, parser: 'java', plugins: [java], entrypoint } as Options); }
      catch (error) { firstError ??= error; }
    }
    throw firstError;
  }
  let parser: string;
  let plugins: Plugin[];
  if (name === 'typescript' || name === 'javascript' || name === 'json') {
    const [syntax, estree] = await Promise.all([
      name === 'typescript' ? import('prettier/plugins/typescript') : import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
    plugins = [syntax.default, estree.default];
    parser = name === 'typescript' ? 'typescript' : name === 'json' ? 'json' : 'babel';
  } else if (name === 'css') {
    plugins = [(await import('prettier/plugins/postcss')).default]; parser = 'css';
  } else if (name === 'xml') {
    plugins = [(await import('prettier/plugins/html')).default]; parser = 'html';
  } else {
    plugins = [(await import('prettier/plugins/markdown')).default]; parser = 'markdown';
  }
  return prettier.format(source, { ...options, parser, plugins });
}
