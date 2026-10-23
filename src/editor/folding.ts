export interface FoldEntry { id: string; code: string; collapsed: boolean }
const STORAGE = 'typepro.code-folds.v1';
/** Surviving DOM identities win; equal code blocks are matched in occurrence order. */
export function reconcileFolds(previous: FoldEntry[], blocks: { id?: string; code: string }[], nextId: () => string): FoldEntry[] {
  const used = new Set<string>();
  const known = new Map(previous.map(entry => [entry.id, entry]));
  const reserved = new Set(blocks.map(block => block.id).filter((id): id is string => !!id && known.has(id)));
  const exact = new Set(blocks.map(block => previous.find(entry => entry.code === block.code)?.id).filter(Boolean));
  return blocks.map((block, index) => {
    const existing = block.id && !used.has(block.id) ? known.get(block.id) : undefined;
    const slot = previous[index];
    const positional = previous.length === blocks.length && slot && !used.has(slot.id) && !reserved.has(slot.id) && !exact.has(slot.id) ? slot : undefined;
    const match = existing || previous.find(entry => entry.code === block.code && !used.has(entry.id) && !reserved.has(entry.id)) || positional;
    const entry = { id: match?.id || nextId(), code: block.code, collapsed: match?.collapsed || false };
    used.add(entry.id); return entry;
  });
}
export function loadFolds(documentId: string): FoldEntry[] {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE) || '{}')[documentId];
    return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.id === 'string' && typeof entry.code === 'string' && typeof entry.collapsed === 'boolean') : [];
  } catch { return []; }
}
export function saveFolds(documentId: string, entries: FoldEntry[]) {
  let saved: Record<string, FoldEntry[]> = Object.create(null);
  try { saved = Object.assign(saved, JSON.parse(localStorage.getItem(STORAGE) || '{}')); } catch { /* Recreate malformed local view preferences. */ }
  saved[documentId] = entries;
  localStorage.setItem(STORAGE, JSON.stringify(saved));
}
