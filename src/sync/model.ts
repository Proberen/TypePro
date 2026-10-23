import type { Notebook, NoteDocument, Workspace } from "../lib/types";

export interface SyncWorkspace {
  version: 1;
  notebooks: Notebook[];
}

export interface SyncSource {
  deviceId: string;
  name: string;
  platform: string;
}

export interface SyncSnapshot extends SyncWorkspace {
  format: "typepro-github";
  source: SyncSource;
  syncedAt: string;
}

export const SYNC_LIMITS = {
  notebooks: 1000,
  documents: 5000,
  documentBytes: 16 * 1024 * 1024,
  markdownBytes: 256 * 1024 * 1024,
  nameBytes: 1024,
} as const;

const encoder = new TextEncoder();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assetPattern = /^\.\.\/\.\.\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,12}$/;

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error(`${label}含不支持的字段`);
  return result;
}

function text(value: unknown, maxBytes: number, label: string): string {
  if (typeof value !== "string" || value.length > maxBytes || encoder.encode(value).byteLength > maxBytes) {
    throw new Error(`${label}无效或超过容量限制`);
  }
  return value;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error("同步数据含无效 UUID");
  return value;
}

function notebooks(value: unknown): Notebook[] {
  if (!Array.isArray(value) || value.length > SYNC_LIMITS.notebooks) throw new Error("同步笔记数量无效");
  const ids = new Set<string>();
  let count = 0;
  let total = 0;
  const unique = (value: unknown) => {
    const result = id(value);
    if (ids.has(result)) throw new Error("同步数据含重复的笔记或文档 UUID");
    ids.add(result);
    return result;
  };
  return value.map(raw => {
    const book = object(raw, ["id", "name", "cover", "documents"], "笔记");
    const bookId = unique(book.id);
    const name = text(book.name, SYNC_LIMITS.nameBytes, "笔记名称");
    let cover: string | undefined;
    if (book.cover !== undefined) {
      cover = text(book.cover, 128, "笔记封面");
      if (!/^preset:[0-5]$/.test(cover) && !assetPattern.test(cover)) throw new Error("同步数据含无效的封面路径");
    }
    if (!Array.isArray(book.documents) || book.documents.length + count > SYNC_LIMITS.documents) {
      throw new Error("同步文档数量无效");
    }
    const documents: NoteDocument[] = book.documents.map(rawDocument => {
      const document = object(rawDocument, ["id", "title", "markdown", "updatedAt"], "文档");
      const documentId = unique(document.id);
      const title = text(document.title, SYNC_LIMITS.nameBytes, "文档标题");
      const markdown = text(document.markdown, SYNC_LIMITS.documentBytes, "文档正文");
      const updatedAt = text(document.updatedAt, 128, "文档更新时间");
      count += 1;
      total += encoder.encode(markdown).byteLength;
      if (total > SYNC_LIMITS.markdownBytes) throw new Error("同步笔记库超过 256 MB");
      return { id: documentId, title, markdown, updatedAt };
    });
    return { id: bookId, name, ...(cover === undefined ? {} : { cover }), documents };
  });
}

export function parseSyncWorkspace(value: unknown): SyncWorkspace {
  const workspace = object(value, ["version", "notebooks"], "同步笔记库");
  if (workspace.version !== 1) throw new Error("不支持的同步笔记版本");
  return { version: 1, notebooks: notebooks(workspace.notebooks) };
}

export function parseSyncSnapshot(value: unknown): SyncSnapshot {
  const snapshot = object(value, ["format", "version", "notebooks", "source", "syncedAt"], "GitHub 同步快照");
  if (snapshot.format !== "typepro-github" || snapshot.version !== 1) throw new Error("不支持的 GitHub 同步格式");
  const source = object(snapshot.source, ["deviceId", "name", "platform"], "同步来源");
  const deviceId = id(source.deviceId);
  const name = text(source.name, 256, "设备名称");
  const platform = text(source.platform, 64, "设备平台");
  if (!name.trim() || !platform.trim() || /[\u0000-\u001f\u007f]/.test(name + platform)) throw new Error("同步来源无效");
  const syncedAt = text(snapshot.syncedAt, 128, "同步时间");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(syncedAt) || !Number.isFinite(Date.parse(syncedAt)) || new Date(syncedAt).toISOString().slice(0, 19) !== syncedAt.slice(0, 19)) {
    throw new Error("同步时间格式无效");
  }
  return { format: "typepro-github", version: 1, notebooks: notebooks(snapshot.notebooks), source: { deviceId, name, platform }, syncedAt };
}

/** Only document data crosses devices; plugins and device/UI settings stay local. */
export function toSyncWorkspace(workspace: Workspace | SyncWorkspace): SyncWorkspace {
  return parseSyncWorkspace({ version: workspace.version, notebooks: workspace.notebooks.map(book => ({
    id: book.id, name: book.name, ...(book.cover === undefined ? {} : { cover: book.cover }),
    documents: book.documents.map(document => ({ id: document.id, title: document.title, markdown: document.markdown, updatedAt: document.updatedAt })),
  })) });
}

export function createSyncSnapshot(workspace: Workspace | SyncWorkspace, source: SyncSource, syncedAt = new Date().toISOString()): SyncSnapshot {
  return parseSyncSnapshot({ format: "typepro-github", ...toSyncWorkspace(workspace), source, syncedAt });
}
