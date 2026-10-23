import { isIndentSensitive, parse } from 'mermaid-formatter';

/** Use the formatter's AST for layout, preserving every statement's text.
 * Its default printer collapses spaces inside labels/messages; that is unsafe
 * for a note editor. Syntax validity is checked with the existing Mermaid
 * parser before and after this worker operation.
 */
export function formatMermaidPreservingText(source: string): string {
  const saved: string[] = [];
  const tokenPrefix = `TYPEPRO${crypto.randomUUID().replace(/-/g, '')}`;
  const hold = (value: string) => { const key = `${tokenPrefix}_${saved.length}_END`; saved.push(value); return key; };
  // Quoted (including multiline/Markdown) labels and directives are opaque to
  // layout. Front matter is also opaque, so YAML block scalars keep their data.
  let text = source.replace(/\r\n/g, '\n');
  let frontMatter = '';
  text = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, (value) => { frontMatter = value; return ''; });
  text = text.replace(/%%\{[\s\S]*?\}%%/g, (value) => `%%{${hold(value)}}%%`);
  text = text.replace(/"(?:[^"\\]|\\[\s\S])*"/g, (value) => `"${hold(value)}"`);
  // An unquoted multiline node label is also data. Preserve its complete
  // delimiter pair while indenting only the line where that node starts.
  text = text.replace(/\[[^\[\]]*\n[^\[\]]*\]|\([^()]*\n[^()]*\)/g, (value) => `"${hold(value)}"`);
  if (/\{[^{}]*\n[^{}]*\}/.test(text) && (text.trimStart().startsWith('flowchart') || text.trimStart().startsWith('graph'))) {
    text = text.replace(/\{[^{}]*\n[^{}]*\}/g, (value) => `"${hold(value)}"`);
  }
  const diagram = parse(text);
  if (diagram.type === 'unknown') throw new Error('无法识别 Mermaid 图表类型，原文已保留');
  if (isIndentSensitive(diagram.type)) {
    // Mindmaps/timelines encode hierarchy in indentation. The upstream engine
    // intentionally preserves that hierarchy rather than guessing new levels.
    return source.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n');
  }
  let blocks = 0, braces = 0, declared = false;
  const lines: string[] = [];
  for (const statement of diagram.statements) {
    const kind = statement.type;
    if (kind === 'blank-line') {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    if (kind === 'block-end') blocks = Math.max(0, blocks - 1);
    if (kind === 'brace-block-end') braces = Math.max(0, braces - 1);
    let depth = declared ? 1 + blocks + braces : 0;
    if (['block-else', 'block-and', 'block-option'].includes(kind)) depth = Math.max(1, depth - 1);
    if (kind === 'diagram-decl' || kind === 'directive') depth = 0;
    lines.push('  '.repeat(depth) + statement.content);
    if (kind === 'diagram-decl') declared = true;
    if (kind === 'block-start') blocks++;
    if (kind === 'brace-block-start') braces++;
  }
  while (lines[lines.length - 1] === '') lines.pop();
  let output = frontMatter + lines.join('\n') + '\n';
  // Reverse masking so quote-token wrappers disappear along with the token.
  for (let index = saved.length - 1; index >= 0; index--) {
    const token = `${tokenPrefix}_${index}_END`;
    output = output.replace(`%%{${token}}%%`, () => saved[index]).replace(`"${token}"`, () => saved[index]);
  }
  return output;
}
