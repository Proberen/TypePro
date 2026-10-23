export interface ListMarkdownEngine {
  HTML2VditorIRDOM(html: string): string;
  VditorIRDOM2HTML(html: string): string;
  Md2VditorIRDOM(markdown: string): string;
}
export function listKind(list: HTMLElement): 'bullet' | 'decimal' | 'alpha';
export function clearListMarkers(root: ParentNode): void;
export function stripListMetadata(text: string): string;
export function listIndent(node: HTMLElement): number;
export function setListIndent(node: HTMLElement, level: number): boolean;
export function decorateLists(root: HTMLElement): void;
export function hydrateListHtml(root: HTMLElement, lute: ListMarkdownEngine): void;
export function serializeListHtml(root: HTMLElement, lute: ListMarkdownEngine): void;
