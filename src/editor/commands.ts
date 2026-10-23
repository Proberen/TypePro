export interface EditorCommand {
  id: string;
  label: string;
  category: string;
  symbol: string;
  syntax: string;
  snippet: string;
  inline?: boolean;
}

const command = (id: string, label: string, category: string, symbol: string, syntax: string, snippet: string, inline = false): EditorCommand => ({ id, label, category, symbol, syntax, snippet, inline });
export const EDITOR_COMMANDS: EditorCommand[] = [
  command('paragraph', '正文', '基础', 'paragraph', '正文', '写下一段文字。\n'),
  ...[1, 2, 3, 4, 5, 6].map(n => command(`h${n}`, `${['一', '二', '三', '四', '五', '六'][n - 1]}级标题`, '基础', `H${n}`, '#'.repeat(n), `${'#'.repeat(n)} 新标题\n`)),
  command('bullet', '无序列表', '列表', 'list', '-', '- 列表项\n- 列表项\n'),
  command('ordered', '有序列表', '列表', 'ordered', '1.', '1. 列表项\n2. 列表项\n'),
  command('task', '任务列表', '列表', 'task', '- [ ]', '- [ ] 新任务\n'),
  command('quote', '引用', '基础', 'quote', '>', '> 一段值得留住的话。\n'),
  command('rule', '分隔线', '基础', 'rule', '---', '---\n'),
  command('code', '代码块', '插入', 'code', '```', '```typescript\nconst message = "Hello, TypePro";\nconsole.log(message);\n```\n'),
  command('table', '表格', '插入', 'table', '|', '| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n| 内容 | 内容 |\n'),
  command('link', '链接', '插入', 'link', '[ ]( )', '', true),
  command('image', '图片', '插入', 'image', '![ ]( )', '', true),
  command('bold', '粗体', '行内', 'B', '**', '**重点文字**', true),
  command('italic', '斜体', '行内', 'italic', '*', '*一段文字*', true),
  command('strike', '删除线', '行内', 'strike', '~~', '~~一段文字~~', true),
  command('mark', '高亮', '行内', 'mark', '==', '==重点文字==', true),
  command('inlinecode', '行内代码', '行内', 'code', '`', '`code`', true),
  command('sub', '下标', '行内', 'sub', '~', '~下标~', true),
  command('sup', '上标', '行内', 'sup', '^', '^上标^', true),
  command('math', '数学公式', '扩展', 'math', '$$', '$$\nE = mc^2\n$$\n'),
  command('inlinemath', '行内公式', '扩展', 'math', '$', '$x^2 + y^2$', true),
  command('mermaid', 'Mermaid 图表', '扩展', 'graph', 'mermaid', '```mermaid\ngraph LR\n  A[记录] --> B[整理]\n  B --> C[回看]\n```\n'),
  command('footnote', '脚注', '扩展', '[1]', '[^1]', '带有脚注的文字。[^1]\n\n[^1]: 补充说明。\n'),
  command('toc', '目录', '扩展', 'outline', '[TOC]', '[TOC]\n'),
  command('html', 'HTML', '扩展', 'code', '< >', '<details>\n<summary>展开内容</summary>\n\n补充内容。\n\n</details>\n'),
  command('frontmatter', '文档属性', '扩展', 'file', '---', '---\ntitle: 新文档\ntags: [笔记]\n---\n'),
  command('escape', '转义字符', '行内', 'escape', '\\', '\\*原样显示的星号\\*', true),
  command('break', '换行', '基础', 'break', '␠␠↵', '  \n', true),
];
export const EDITOR_CATEGORIES = ['全部', '基础', '列表', '插入', '行内', '扩展'];
export interface EditorShortcut { id: string; label: string; group: string; binding: string; keys: string }
const shortcut = (id: string, label: string, group: string, binding: string, keys: string): EditorShortcut => ({ id, label, group, binding, keys });
export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  shortcut('bold', '粗体', '文字', 'Mod+KeyB', '⌘ B'),
  shortcut('italic', '斜体', '文字', 'Mod+KeyI', '⌘ I'),
  shortcut('inlinecode', '行内代码', '文字', 'Mod+Shift+Backquote', '⌘ ⇧ `'),
  shortcut('strike', '删除线', '文字', 'Ctrl+Shift+Backquote', '⌃ ⇧ `'),
  shortcut('link', '链接', '文字', 'Mod+KeyK', '⌘ K'),
  shortcut('image', '图片', '文字', 'Mod+Ctrl+KeyI', '⌘ ⌃ I'),
  ...[1, 2, 3, 4, 5, 6].map(n => shortcut(`h${n}`, `${n} 级标题`, '段落', `Mod+Digit${n}`, `⌘ ${n}`)),
  shortcut('paragraph', '恢复正文', '段落', 'Mod+Digit0', '⌘ 0'),
  shortcut('code', '代码块', '段落', 'Mod+Alt+KeyC', '⌘ ⌥ C'),
  shortcut('math', '数学公式', '段落', 'Mod+Alt+KeyB', '⌘ ⌥ B'),
  shortcut('table', '表格', '段落', 'Mod+Alt+KeyT', '⌘ ⌥ T'),
  shortcut('quote', '引用', '段落', 'Mod+Alt+KeyQ', '⌘ ⌥ Q'),
  shortcut('ordered', '有序列表', '段落', 'Mod+Alt+KeyO', '⌘ ⌥ O'),
  shortcut('bullet', '无序列表', '段落', 'Mod+Alt+KeyU', '⌘ ⌥ U'),
];
export function matchesEditorShortcut(event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, binding: string) {
  const parts = binding.split('+');
  const mod = parts.includes('Mod');
  const ctrl = parts.includes('Ctrl');
  const mac = typeof navigator === 'undefined' || /Mac|iPhone|iPad/.test(navigator.platform);
  const primary = event.metaKey || (!mac && !ctrl && event.ctrlKey);
  return event.code === parts[parts.length - 1] && primary === mod && event.ctrlKey === (ctrl || (!mac && !event.metaKey && mod)) && event.shiftKey === parts.includes('Shift') && event.altKey === parts.includes('Alt');
}
export const INLINE_MARKERS: Record<string, string> = { bold: '**', italic: '*', strike: '~~', mark: '==', inlinecode: '`', sub: '~', sup: '^', inlinemath: '$' };

export function isSourceCode(text: string, position: number) {
  let fence = '';
  const before = text.slice(0, position);
  for (const line of before.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!marker) continue;
    if (!fence) fence = marker[1];
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
  }
  if (fence) return true;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  return /^(?: {4}|\t)/.test(line) || (line.match(/(?<!\\)`+/g)?.length || 0) % 2 === 1;
}

export function changeSourceFormat(text: string, start: number, end: number, id: string) {
  const marker = INLINE_MARKERS[id];
  if (marker) {
    const selected = text.slice(start, end) || (id === 'inlinecode' ? 'code' : '文字');
    if (text.slice(Math.max(0, start - marker.length), start) === marker && text.slice(end, end + marker.length) === marker) {
      return { text: text.slice(0, start - marker.length) + selected + text.slice(end + marker.length), start: start - marker.length, end: end - marker.length };
    }
    return { text: text.slice(0, start) + marker + selected + marker + text.slice(end), start: start + marker.length, end: start + marker.length + selected.length };
  }
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const to = newline < 0 ? text.length : newline;
  const lines = text.slice(from, to).split('\n');
  const prefix = /^h[1-6]$/.test(id) ? '#'.repeat(Number(id[1])) + ' ' : ({ paragraph: '', bullet: '- ', ordered: '1. ', task: '- [ ] ', quote: '> ' } as Record<string, string>)[id];
  if (prefix === undefined) return null;
  const replacement = lines.map((line, i) => {
    const clean = line.replace(/^ {0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '');
    return (id === 'ordered' ? `${i + 1}. ` : prefix) + clean;
  }).join('\n');
  return { text: text.slice(0, from) + replacement + text.slice(to), start: from, end: from + replacement.length };
}

export function headingSourceOffsets(text: string) {
  const positions: number[] = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  let offset = 0;
  let fence = '';
  let frontMatter = false;
  let previous = '';
  let previousOffset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r?\n$/, '').replace(/^(?: {0,3}> ?)+/, '');
    if (index === 0 && line === '---') frontMatter = true;
    else if (frontMatter && /^(---|\.\.\.)\s*$/.test(line)) frontMatter = false;
    else if (!frontMatter) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
      } else if (!fence) {
        if (/^ {0,3}#{1,6}(?:\s|$)/.test(line) || /^\s*<h[1-6](?:\s|>)/i.test(line)) positions.push(offset);
        else if (/^ {0,3}(?:=+|-+)\s*$/.test(line) && previous.trim() && !/^\s*(?:#|[-*+]\s|\d+[.)]\s|`{3,}|~{3,})/.test(previous)) positions.push(previousOffset);
      }
    }
    previous = frontMatter || fence ? '' : line;
    previousOffset = offset;
    offset += lines[index].length;
  }
  return positions;
}
