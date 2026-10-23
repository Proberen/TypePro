export interface RecentDocument {
  id: string;
  openedAt: string;
}

const STORAGE_KEY = "typepro.recent.v1";

export function readRecentDocuments(): RecentDocument[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((entry): entry is RecentDocument => entry && typeof entry.id === "string" && entry.id.length > 0 && typeof entry.openedAt === "string" && Number.isFinite(Date.parse(entry.openedAt)))
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
      .filter(entry => { if (seen.has(entry.id)) return false; seen.add(entry.id); return true; })
      .slice(0, 100);
  } catch { return []; }
}

export function recordRecentDocument(id: string): void {
  if (!id) return;
  const recent = [{ id, openedAt: new Date().toISOString() }, ...readRecentDocuments().filter(entry => entry.id !== id)].slice(0, 100);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recent)); } catch { /* Opening a document does not depend on saving this local preference. */ }
}
