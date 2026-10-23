import { Compartment, Transaction, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { createCodeEditorState, formattedCodeTransaction } from './code-editor-state';
import './code-editor.css';

export interface CodeEditorOptions {
  value: string;
  language: string;
  ariaLabel?: string;
  onChange?: (value: string) => void;
  onFormatError?: (message: string) => void;
  onFormatStateChange?: (pending: boolean) => void;
}
export interface CodeEditorHandle {
  getValue(): string;
  setValue(value: string): void;
  setLanguage(language: string): void;
  focus(): void;
  format(): Promise<boolean>;
  undo(): boolean;
  redo(): boolean;
  destroy(): void;
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.bool, tags.null], class: 'cm-code-keyword' },
  { tag: [tags.string, tags.regexp, tags.attributeValue], class: 'cm-code-string' },
  { tag: [tags.number, tags.integer, tags.float], class: 'cm-code-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'cm-code-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.heading], class: 'cm-code-function' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: 'cm-code-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'cm-code-property' },
  { tag: [tags.operator, tags.punctuation], class: 'cm-code-punctuation' },
  { tag: [tags.meta, tags.annotation], class: 'cm-code-meta' },
]);

// Mermaid's renderer remains local and separate; this mode only colors its source.
const mermaid = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/(?:-->|---|==>|-.->|<-->|--|==|:::+)/)) return 'operator';
    if (stream.match(/\b(?:flowchart|graph|subgraph|end|direction|sequenceDiagram|participant|actor|Note|loop|alt|else|opt|par|and|rect|activate|deactivate|classDef|class|style|linkStyle|stateDiagram-v2|state|erDiagram|gantt|journey|pie|mindmap|timeline|gitGraph|LR|RL|TB|BT|TD)\b/)) return 'keyword';
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/[\[\]{}()|:;,]/)) return 'punctuation';
    stream.next(); return null;
  },
});
const languageCache = new Map<string, Promise<Extension>>();
async function loadLanguage(language: string): Promise<Extension> {
  const name = language.toLowerCase();
  if (!languageCache.has(name)) languageCache.set(name, (async () => {
    switch (name) {
      case 'js': case 'jsx': case 'javascript': return (await import('@codemirror/lang-javascript')).javascript({ jsx: name === 'jsx' });
      case 'ts': case 'tsx': case 'typescript': return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: name === 'tsx' });
      case 'py': case 'python': return (await import('@codemirror/lang-python')).python();
      case 'java': return (await import('@codemirror/lang-java')).java();
      case 'json': return (await import('@codemirror/lang-json')).json();
      case 'css': return (await import('@codemirror/lang-css')).css();
      case 'html': case 'htm': return (await import('@codemirror/lang-html')).html();
      case 'xml': return (await import('@codemirror/lang-xml')).xml();
      case 'sql': return (await import('@codemirror/lang-sql')).sql();
      case 'rust': case 'rs': return (await import('@codemirror/lang-rust')).rust();
      case 'md': case 'markdown': return (await import('@codemirror/lang-markdown')).markdown();
      case 'go': return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/go')).go);
      case 'sh': case 'shell': case 'bash': case 'zsh': return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell);
      case 'yaml': case 'yml': return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml);
      case 'mermaid': return mermaid;
      default: return [];
    }
  })());
  return languageCache.get(name)!;
}

/** A standalone code editor, shared by document blocks and the flow source pane. */
export function mountCodeEditor(host: HTMLElement, options: CodeEditorOptions): CodeEditorHandle {
  const languageSlot = new Compartment();
  let language = options.language;
  let languageExtension: Extension = [];
  let languageRequest = 0;
  let revision = 0;
  let formatRequest = 0;
  let disposed = false;
  let syncing = false;
  let formatting = false;
  const setFormatting = (pending: boolean) => { formatting = pending; options.onFormatStateChange?.(pending); };
  const extensions: Extension = [
    languageSlot.of(languageExtension),
    lineNumbers(), highlightActiveLineGutter(), drawSelection(), highlightActiveLine(),
    syntaxHighlighting(highlight),
    EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel || '代码编辑器', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
    EditorView.editorAttributes.of({ class: 'typepro-code-editor' }),
    EditorView.domEventHandlers({ keydown(event) {
      if (event.code !== 'KeyF' || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey || event.isComposing) return false;
      event.preventDefault(); void handle.format(); return true;
    } }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      revision++;
      if (!syncing) options.onChange?.(update.state.doc.toString());
    }),
  ];
  const view = new EditorView({ parent: host, state: createCodeEditorState(options.value, extensions) });
  async function updateLanguage() {
    const request = ++languageRequest;
    try {
      const extension = await loadLanguage(language);
      if (!disposed && request === languageRequest) {
        languageExtension = extension;
        view.dispatch({ effects: languageSlot.reconfigure(extension) });
      }
    } catch { /* Unsupported or unavailable language parsers retain editable plain text. */ }
  }
  const handle: CodeEditorHandle = {
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      if (disposed || value === handle.getValue()) return;
      formatRequest++;
      if (formatting) setFormatting(false);
      syncing = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) });
      } finally { syncing = false; }
    },
    setLanguage(value) {
      if (disposed || value === language) return;
      language = value; formatRequest++;
      if (formatting) setFormatting(false);
      void updateLanguage();
    },
    focus() { if (!disposed) view.focus(); },
    async format() {
      if (disposed || view.composing || formatting) return false;
      const request = ++formatRequest, version = revision, currentLanguage = language, original = handle.getValue();
      setFormatting(true);
      try {
        const { formatCode } = await import('./code-format/index');
        const next = await formatCode(currentLanguage, original);
        if (disposed || request !== formatRequest || version !== revision || currentLanguage !== language || view.composing) return false;
        if (next !== original) view.dispatch(formattedCodeTransaction(view.state, next));
        return true;
      } catch (error) {
        if (!disposed && request === formatRequest && version === revision) options.onFormatError?.(error instanceof Error ? error.message : String(error));
        return false;
      } finally { if (!disposed && request === formatRequest) setFormatting(false); }
    },
    undo: () => !disposed && undo(view),
    redo: () => !disposed && redo(view),
    destroy() { if (disposed) return; disposed = true; formatRequest++; languageRequest++; view.destroy(); },
  };
  void updateLanguage();
  return handle;
}
