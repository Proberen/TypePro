import type { Notebook, NoteDocument } from "../lib/types";
import { parseSyncWorkspace, type SyncWorkspace } from "./model.ts";

interface LocatedDocument { bookId: string; document: NoteDocument }
interface Field<T> { value: T; conflict: boolean }

function mergeField<T>(base: T | undefined, local: T, remote: T, hasBase: boolean): Field<T> {
  if (local === remote || (hasBase && remote === base)) return { value: local, conflict: false };
  if (hasBase && local === base) return { value: remote, conflict: false };
  return { value: local, conflict: true };
}

function metadataEqual(a: Notebook, b: Notebook): boolean { return a.name === b.name && a.cover === b.cover; }
function documentEqual(a: LocatedDocument, b: LocatedDocument): boolean {
  return a.bookId === b.bookId && a.document.title === b.document.title && a.document.markdown === b.document.markdown;
}
function index(workspace: SyncWorkspace | null) {
  const books = new Map<string, Notebook>();
  const documents = new Map<string, LocatedDocument>();
  for (const book of workspace?.notebooks || []) {
    books.set(book.id, book);
    for (const document of book.documents) documents.set(document.id, { bookId: book.id, document });
  }
  return { books, documents };
}

function latest(a: string, b: string): string {
  const left = Date.parse(a), right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && left !== right ? (left > right ? a : b) : (a > b ? a : b);
}

function conflictTitle(title: string, suffix: string): string {
  if (title.endsWith(suffix)) return title;
  // The resulting label must remain within Storage's UTF-8 name limit.
  const encoder = new TextEncoder();
  const characters = Array.from(title);
  while (encoder.encode(characters.join("") + suffix).byteLength > 1024) characters.pop();
  return characters.join("") + suffix;
}

async function conflictId(originalId: string, value: LocatedDocument, kind: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(["typepro-github-conflict-v1", originalId, kind, value.bookId, value.document.title, value.document.markdown]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  // UUID v8: deterministic application-specific SHA-256 identity, no weak hashes.
  digest[6] = (digest[6] & 15) | 128;
  digest[8] = (digest[8] & 63) | 128;
  const hex = Array.from(digest.subarray(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Three-way merge by global UUID also recognizes documents moved between notebooks. */
export async function mergeWorkspaces(
  baseInput: SyncWorkspace | null,
  localInput: SyncWorkspace,
  remoteInput: SyncWorkspace | null,
): Promise<{ workspace: SyncWorkspace; conflicts: number }> {
  const local = index(parseSyncWorkspace(localInput));
  const remote = index(remoteInput === null ? null : parseSyncWorkspace(remoteInput));
  // An absent repository is an empty first synchronization, not a remote deletion.
  const base = index(remoteInput === null || baseInput === null ? null : parseSyncWorkspace(baseInput));
  const books = new Map<string, Notebook>();
  const documents = new Map<string, LocatedDocument>();
  const redundantCopies = new Map<string, LocatedDocument>();
  let conflicts = 0;

  function preserveBook(id: string): Notebook {
    const existing = books.get(id);
    if (existing) return existing;
    const source = local.books.get(id) || remote.books.get(id) || base.books.get(id);
    if (!source) throw new Error("同步文档缺少所属笔记");
    const recovered = { ...source, name: conflictTitle(source.name, "（删除冲突）"), documents: [] };
    books.set(id, recovered);
    return recovered;
  }

  const bookIds = new Set([...local.books.keys(), ...remote.books.keys(), ...base.books.keys()]);
  for (const id of bookIds) {
    const b = base.books.get(id), l = local.books.get(id), r = remote.books.get(id);
    if (l && r) {
      const name = mergeField(b?.name, l.name, r.name, !!b);
      const cover = mergeField(b?.cover, l.cover, r.cover, !!b);
      if (name.conflict || cover.conflict) conflicts += 1;
      books.set(id, { id, name: name.value, ...(cover.value === undefined ? {} : { cover: cover.value }), documents: [] });
    } else if ((l || r) && !b) {
      books.set(id, { ...(l || r)!, documents: [] });
    } else if ((l || r) && b && !metadataEqual((l || r)!, b)) {
      const survivor = (l || r)!;
      books.set(id, { ...survivor, name: conflictTitle(survivor.name, "（删除冲突）"), documents: [] });
      conflicts += 1;
    }
  }

  async function copyConflict(originalId: string, value: LocatedDocument, kind: "内容" | "删除"): Promise<void> {
    for (let attempt = 0; attempt <= 5000; attempt += 1) {
      const id = await conflictId(originalId, value, attempt ? `${kind}:${attempt}` : kind);
      const copy = { bookId: value.bookId, document: { ...value.document, id, title: conflictTitle(value.document.title, `（${kind}冲突）`) } };
      const existing = [local.documents.get(id), remote.documents.get(id), documents.get(id)];
      // An existing copy may have been edited by the user. Keep that edit and allocate a
      // deterministic next identity rather than overwriting it or duplicating on retry.
      if (local.books.has(id) || remote.books.has(id) || existing.some(candidate => candidate && !documentEqual(candidate, copy))) continue;
      for (const candidate of existing) if (candidate) copy.document.updatedAt = latest(copy.document.updatedAt, candidate.document.updatedAt);
      documents.set(id, copy);
      conflicts += 1;
      return;
    }
    throw new Error("同步冲突副本超过容量限制");
  }

  const documentIds = new Set([...local.documents.keys(), ...remote.documents.keys(), ...base.documents.keys()]);
  for (const id of documentIds) {
    const b = base.documents.get(id), l = local.documents.get(id), r = remote.documents.get(id);
    if (l && r) {
      const title = mergeField(b?.document.title, l.document.title, r.document.title, !!b);
      const markdown = mergeField(b?.document.markdown, l.document.markdown, r.document.markdown, !!b);
      const bookId = mergeField(b?.bookId, l.bookId, r.bookId, !!b);
      const merged = { bookId: bookId.value, document: {
        id, title: title.value, markdown: markdown.value,
        updatedAt: latest(l.document.updatedAt, r.document.updatedAt),
      } };
      documents.set(id, merged);
      if (title.conflict || markdown.conflict || bookId.conflict) {
        await copyConflict(id, r, "内容");
        // Another device may have already published this local version as its remote
        // conflict copy. Avoid retaining the identical version twice after a CAS retry.
        const copyId = await conflictId(id, merged, "内容");
        if (!base.documents.has(copyId)) redundantCopies.set(copyId, {
          bookId: merged.bookId,
          document: { ...merged.document, id: copyId, title: conflictTitle(merged.document.title, "（内容冲突）") },
        });
      }
    } else if ((l || r) && !b) {
      // Do not replace a conflict copy already created while processing its original ID.
      if (!documents.has(id)) documents.set(id, (l || r)!);
    } else if ((l || r) && b && !documentEqual((l || r)!, b)) {
      await copyConflict(id, (l || r)!, "删除");
    }
  }

  for (const [id, expected] of redundantCopies) {
    const existing = documents.get(id);
    if (existing && documentEqual(existing, expected)) documents.delete(id);
  }
  for (const value of documents.values()) preserveBook(value.bookId);
  // Keep local order, append remote additions, then deterministic recovered/conflict IDs.
  for (const book of books.values()) {
    const order = new Set([
      ...(local.books.get(book.id)?.documents.map(document => document.id) || []),
      ...(remote.books.get(book.id)?.documents.map(document => document.id) || []),
      ...documents.keys(),
    ]);
    for (const id of order) {
      const value = documents.get(id);
      if (value?.bookId === book.id) book.documents.push(value.document);
    }
  }
  // Conflict preservation can increase capacity; reject before any caller saves or publishes.
  return { workspace: parseSyncWorkspace({ version: 1, notebooks: [...books.values()] }), conflicts };
}
