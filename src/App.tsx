import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  FilePlus2,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Puzzle,
} from "lucide-react";
import Sidebar from "./Sidebar";
import Modal from "./Modal";
import MarkdownEditor, { type EditorHandle } from "./editor/MarkdownEditor";
import { PluginHost, PluginManager } from "./plugins";
import {
  command,
  native,
  openLink,
  pickFile,
  resolveAsset,
  saveAsset,
  uuid,
  writeTransfer,
} from "./lib/bridge";
import { useWorkspace } from "./lib/useWorkspace";
import type {
  EditorMode,
  NoteDocument,
  TransferFile,
  Workspace,
} from "./lib/types";

type Dialog =
  | null
  | { type: "create" }
  | { type: "transfer" }
  | { type: "plugins" }
  | { type: "menu"; bookId: string; docId?: string }
  | {
      type: "name";
      kind: "book" | "document" | "rename-book" | "rename-document";
      bookId?: string;
      docId?: string;
      value: string;
    }
  | { type: "delete"; bookId: string; docId?: string }
  | { type: "move"; bookId: string; docId: string };

export default function App() {
  const { workspace, current, update, flush, replacePersisted, status, error } =
    useWorkspace();
  const [bookId, setBookId] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = docId;
  const [mode, setMode] = useState<EditorMode>("edit");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [mobileDocument, setMobileDocument] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [, setPluginVersion] = useState(0);
  const [showPanels, setShowPanels] = useState(false);
  const [exportScope, setExportScope] = useState("book");
  const editor = useRef<EditorHandle | null>(null);
  const host = useRef<PluginHost | null>(null);
  const activeBook = workspace?.notebooks.find((n) => n.id === bookId);
  const activeDocument = activeBook?.documents.find((d) => d.id === docId);

  const report = useCallback(
    (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    [],
  );
  const writeDocument = useCallback(
    (id: string, markdown: string) => {
      update((old) => ({
        ...old,
        notebooks: old.notebooks.map((n) => ({
          ...n,
          documents: n.documents.map((d) =>
            d.id === id
              ? { ...d, markdown, updatedAt: new Date().toISOString() }
              : d,
          ),
        })),
      }));
    },
    [update],
  );
  const collect = useCallback(() => {
    const id = activeRef.current;
    if (!id || !editor.current) return;
    const value = editor.current.getValue();
    const doc = current.current?.notebooks
      .flatMap((n) => n.documents)
      .find((d) => d.id === id);
    if (doc && value !== doc.markdown) writeDocument(id, value);
  }, [current, writeDocument]);
  const persist = useCallback(async () => {
    collect();
    await flush();
  }, [collect, flush]);

  useEffect(() => {
    if (!workspace) return;
    if (!bookId || !workspace.notebooks.some((n) => n.id === bookId)) {
      const first = workspace.notebooks[0];
      setBookId(first?.id || null);
      setDocId(first?.documents[0]?.id || null);
    }
  }, [workspace, bookId]);

  useEffect(() => {
    const runtime = new PluginHost({
      getWorkspace: () => {
        collect();
        return current.current || { version: 1, notebooks: [], plugins: [] };
      },
      getActiveDocumentId: () => activeRef.current,
      replaceDocument: async (id, markdown) => {
        writeDocument(id, markdown);
        await flush();
      },
      createDocument: async (notebookId, title, markdown) => {
        if (!current.current?.notebooks.some((n) => n.id === notebookId))
          throw new Error("笔记本不存在");
        const doc: NoteDocument = {
          id: uuid(),
          title,
          markdown,
          updatedAt: new Date().toISOString(),
        };
        update((old) => ({
          ...old,
          notebooks: old.notebooks.map((n) =>
            n.id === notebookId
              ? { ...n, documents: [...n.documents, doc] }
              : n,
          ),
        }));
        await flush();
        return doc;
      },
      insertText: (text) => {
        if (!activeRef.current || !editor.current)
          throw new Error("请先打开文档");
        editor.current.insertText(text);
      },
      onStateChange: () => setPluginVersion((v) => v + 1),
      onError: report,
      onPluginStopped: (id) =>
        update((old) => ({
          ...old,
          plugins: old.plugins.map((p) =>
            p.manifest.id === id ? { ...p, enabled: false } : p,
          ),
        })),
    });
    host.current = runtime;
    return () => {
      runtime.dispose();
      host.current = null;
    };
  }, [current, update, flush, writeDocument, report, collect]);
  useEffect(() => {
    host.current?.setPlugins(workspace?.plugins || []);
  }, [workspace?.plugins]);
  useEffect(() => {
    const timeout = setTimeout(() => host.current?.notifyDocumentChange(), 300);
    return () => clearTimeout(timeout);
  }, [activeDocument?.markdown, docId]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const saveOnHide = () => {
      if (document.visibilityState === "hidden") void persist().catch(report);
    };
    const saveOnLeave = () => {
      void persist().catch(report);
    };
    document.addEventListener("visibilitychange", saveOnHide);
    window.addEventListener("pagehide", saveOnLeave);
    return () => {
      document.removeEventListener("visibilitychange", saveOnHide);
      window.removeEventListener("pagehide", saveOnLeave);
    };
  }, [persist, report]);

  useEffect(() => {
    if (!native || /Android/i.test(navigator.userAgent)) return;
    let disposed = false,
      cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        const off = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await persist();
            await win.destroy();
          } catch (e) {
            report(e);
          }
        });
        if (disposed) off();
        else cleanup = off;
      })
      .catch(report);
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [persist, report]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void persist().catch(report);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDialog({
          type: "name",
          kind: bookId ? "document" : "book",
          bookId: bookId || undefined,
          value: "",
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [bookId, persist, report]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function select(notebookId: string, documentId?: string) {
    if (!documentId) {
      setBookId(notebookId);
      if (notebookId !== bookId) {
        collect();
        setDocId(null);
        editor.current = null;
      }
      return;
    }
    collect();
    setBookId(notebookId);
    setDocId(documentId);
    setMobileDocument(true);
    if (documentId !== docId) editor.current = null;
  }
  function openDialog(next: Dialog) {
    collect();
    setMessage("");
    setDialog(next);
  }

  async function submitName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.type !== "name") return;
    const name = String(
      new FormData(event.currentTarget).get("name") || "",
    ).trim();
    if (!name) return;
    const state = dialog;
    await run(async () => {
      await persist();
      if (state.kind === "book") {
        const id = uuid();
        update((old) => ({
          ...old,
          notebooks: [...old.notebooks, { id, name, documents: [] }],
        }));
        setBookId(id);
        setDocId(null);
        editor.current = null;
      } else if (state.kind === "document") {
        const id = uuid();
        const doc = {
          id,
          title: name,
          markdown: `# ${name}\n\n`,
          updatedAt: new Date().toISOString(),
        };
        update((old) => ({
          ...old,
          notebooks: old.notebooks.map((n) =>
            n.id === state.bookId
              ? { ...n, documents: [...n.documents, doc] }
              : n,
          ),
        }));
        setBookId(state.bookId!);
        setDocId(id);
        setMode("edit");
        setMobileDocument(true);
        editor.current = null;
      } else {
        update((old) => ({
          ...old,
          notebooks: old.notebooks.map((n) =>
            n.id !== state.bookId
              ? n
              : state.kind === "rename-book"
                ? { ...n, name }
                : {
                    ...n,
                    documents: n.documents.map((d) =>
                      d.id === state.docId ? { ...d, title: name } : d,
                    ),
                  },
          ),
        }));
      }
      await flush();
      setDialog(null);
    });
  }
  async function remove() {
    if (dialog?.type !== "delete") return;
    const target = dialog;
    await run(async () => {
      await persist();
      update((old) => ({
        ...old,
        notebooks: target.docId
          ? old.notebooks.map((n) =>
              n.id === target.bookId
                ? {
                    ...n,
                    documents: n.documents.filter((d) => d.id !== target.docId),
                  }
                : n,
            )
          : old.notebooks.filter((n) => n.id !== target.bookId),
      }));
      if (
        docId === target.docId ||
        (!target.docId && bookId === target.bookId)
      ) {
        setDocId(null);
        editor.current = null;
        setMobileDocument(false);
      }
      await flush();
      setDialog(null);
    });
  }
  async function move(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.type !== "move") return;
    const target = String(new FormData(event.currentTarget).get("notebook"));
    const from = dialog;
    await run(async () => {
      await persist();
      const doc = current.current?.notebooks
        .find((n) => n.id === from.bookId)
        ?.documents.find((d) => d.id === from.docId);
      if (!doc) throw new Error("文档不存在");
      update((old) => ({
        ...old,
        notebooks: old.notebooks.map((n) =>
          n.id === from.bookId
            ? { ...n, documents: n.documents.filter((d) => d.id !== doc.id) }
            : n.id === target
              ? { ...n, documents: [...n.documents, doc] }
              : n,
        ),
      }));
      if (docId === from.docId) setBookId(target);
      await flush();
      setDialog(null);
    });
  }
  async function importNotes() {
    await run(async () => {
      const file = await pickFile();
      if (!file) return;
      host.current?.setPlugins([]);
      try {
        await persist();
        const next = await command<Workspace>("import_bundle", {
          name: file.name,
          bytes: Array.from(file.bytes),
          notebookId: bookId,
        });
        replacePersisted(next);
        setNotice("已导入");
        setDialog(null);
      } finally {
        host.current?.setPlugins(current.current?.plugins || []);
      }
    });
  }
  async function exportNotes(markdown = false) {
    await run(async () => {
      await persist();
      const file = await command<TransferFile>(
        markdown ? "export_markdown" : "export_bundle",
        {
          notebookId: markdown || exportScope !== "all" ? bookId : null,
          documentId: markdown || exportScope === "document" ? docId : null,
        },
      );
      if (await writeTransfer(file)) setNotice("已导出");
    });
  }
  function followLink(event: React.MouseEvent) {
    const element = event.target as HTMLElement;
    const link = element.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      const href = link.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        void openLink(href).catch(report);
      } else if (!href.startsWith("#")) event.preventDefault();
    } else if (event.metaKey || event.ctrlKey) {
      const span = element.closest('[data-type="a"]');
      const href = span?.querySelector(".vditor-ir__marker--link")?.textContent;
      if (href) {
        event.preventDefault();
        void openLink(href).catch(report);
      }
    }
  }

  const commands = host.current?.getCommands() || [];
  const panels = host.current?.getPanels() || [];
  const targetBook =
    dialog && "bookId" in dialog
      ? workspace?.notebooks.find((n) => n.id === dialog.bookId)
      : undefined;
  const targetDoc =
    dialog && "docId" in dialog
      ? targetBook?.documents.find((d) => d.id === dialog.docId)
      : undefined;

  if (!workspace)
    return (
      <main className="startup">
        <BookOpen size={30} />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => location.reload()}>重新加载</button>
          </>
        ) : (
          <p>正在打开…</p>
        )}
      </main>
    );
  return (
    <div
      className={`app ${sidebarVisible ? "" : "sidebar-hidden"} ${mobileDocument ? "mobile-document" : ""}`}
    >
      <header className="window-bar" data-tauri-drag-region>
        <div className="window-left" data-tauri-drag-region>
          <span className="traffic-spacer" />
          <button
            className="icon-button"
            aria-label="切换侧栏"
            title="切换侧栏"
            onClick={() => setSidebarVisible((v) => !v)}
          >
            <PanelLeft size={20} />
          </button>
        </div>
        <div className="document-header" data-tauri-drag-region>
          <button
            className="icon-button mobile-back"
            aria-label="返回笔记本"
            onClick={() => {
              collect();
              setMobileDocument(false);
            }}
          >
            <ArrowLeft size={21} />
          </button>
          <div className="breadcrumb" data-tauri-drag-region>
            <span>{activeBook?.name || "笔记"}</span>
            {activeDocument && (
              <>
                <span className="breadcrumb-slash">/</span>
                <strong>{activeDocument.title}</strong>
              </>
            )}
          </div>
          {activeDocument && (
            <>
              <div className="mode-switch" role="group" aria-label="编辑模式">
                {(["edit", "source", "read"] as EditorMode[]).map((m) => (
                  <button
                    key={m}
                    aria-pressed={mode === m}
                    className={mode === m ? "selected" : ""}
                    onClick={() => {
                      collect();
                      setMode(m);
                    }}
                  >
                    {m === "edit" ? "编辑" : m === "source" ? "源码" : "阅读"}
                  </button>
                ))}
              </div>
              {panels.length > 0 && (
                <button
                  className="icon-button"
                  aria-label="插件面板"
                  onClick={() => setShowPanels((v) => !v)}
                >
                  <Puzzle size={18} />
                </button>
              )}
              <button
                className="icon-button document-more"
                aria-label="文档操作"
                onClick={() =>
                  openDialog({ type: "menu", bookId: bookId!, docId: docId! })
                }
              >
                <MoreHorizontal size={22} />
              </button>
            </>
          )}
        </div>
      </header>
      <Sidebar
        notebooks={workspace.notebooks}
        activeId={docId}
        onSelect={(b, d) => {
          void select(b, d).catch(report);
        }}
        onCreate={() => openDialog({ type: "create" })}
        onMenu={(b, d) => openDialog({ type: "menu", bookId: b, docId: d })}
        onTransfer={() => openDialog({ type: "transfer" })}
        onPlugins={() => openDialog({ type: "plugins" })}
      />
      <main className="main-pane" onClick={followLink}>
        <div className="editor-and-panels">
          {activeDocument ? (
            <MarkdownEditor
              key={activeDocument.id}
              documentId={activeDocument.id}
              markdown={activeDocument.markdown}
              mode={mode}
              onChange={(value) => writeDocument(activeDocument.id, value)}
              onReady={(api) => {
                editor.current = api;
              }}
              onError={report}
              saveAsset={saveAsset}
              resolveAsset={resolveAsset}
            />
          ) : (
            <div className="empty-state">
              <BookOpen size={32} strokeWidth={1.3} />
              <h2>{activeBook?.name || "笔记"}</h2>
              <button
                className="primary"
                onClick={() =>
                  openDialog({
                    type: "name",
                    kind: bookId ? "document" : "book",
                    bookId: bookId || undefined,
                    value: "",
                  })
                }
              >
                <Plus size={17} />
                {bookId ? "新建文档" : "新建笔记本"}
              </button>
            </div>
          )}
          {showPanels && panels.length > 0 && (
            <aside className="plugin-panels">
              {panels.map((panel) => (
                <section key={panel.id}>
                  <h3>{panel.title}</h3>
                  <p>{panel.text}</p>
                </section>
              ))}
            </aside>
          )}
        </div>
        <footer
          className={`save-status ${status === "error" ? "save-error" : ""}`}
          role="status"
        >
          {status === "saved"
            ? "已保存"
            : status === "saving"
              ? "保存中…"
              : "保存失败"}
          {status === "error" && (
            <button
              onClick={() => {
                void persist().catch(report);
              }}
            >
              重试
            </button>
          )}
        </footer>
      </main>
      {(message || error) && (
        <div className="error-toast" role="alert">
          <span>{message || error}</span>
          <button onClick={() => setMessage("")}>关闭</button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {dialog && (
        <Modal
          title={
            dialog.type === "plugins"
              ? "插件"
              : dialog.type === "transfer"
                ? "导入 / 导出"
                : dialog.type === "name"
                  ? dialog.kind.includes("rename")
                    ? "重命名"
                    : dialog.kind === "book"
                      ? "新建笔记本"
                      : "新建文档"
                  : dialog.type === "delete"
                    ? "删除"
                    : dialog.type === "move"
                      ? "移动文档"
                      : dialog.type === "create"
                        ? "新建"
                        : targetDoc?.title || targetBook?.name || "操作"
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
          wide={dialog.type === "plugins"}
        >
          {dialog.type === "create" && (
            <div className="action-list">
              <button
                onClick={() =>
                  setDialog({ type: "name", kind: "book", value: "" })
                }
              >
                <Plus size={18} />
                新建笔记本
              </button>
              <button
                disabled={!bookId}
                onClick={() =>
                  setDialog({
                    type: "name",
                    kind: "document",
                    bookId: bookId!,
                    value: "",
                  })
                }
              >
                <FilePlus2 size={18} />
                新建文档
              </button>
            </div>
          )}
          {dialog.type === "name" && (
            <form onSubmit={submitName}>
              <label className="field">
                名称
                <input
                  name="name"
                  aria-label="名称"
                  defaultValue={dialog.value}
                  maxLength={120}
                  required
                  autoFocus
                  autoComplete="off"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  disabled={busy}
                >
                  取消
                </button>
                <button className="primary" disabled={busy}>
                  保存
                </button>
              </div>
            </form>
          )}
          {dialog.type === "menu" && (
            <div className="action-list">
              {!dialog.docId && (
                <button
                  onClick={() =>
                    setDialog({
                      type: "name",
                      kind: "document",
                      bookId: dialog.bookId,
                      value: "",
                    })
                  }
                >
                  新建文档
                </button>
              )}
              <button
                onClick={() =>
                  setDialog({
                    type: "name",
                    kind: dialog.docId ? "rename-document" : "rename-book",
                    bookId: dialog.bookId,
                    docId: dialog.docId,
                    value: targetDoc?.title || targetBook?.name || "",
                  })
                }
              >
                重命名
              </button>
              {dialog.docId && (
                <button
                  disabled={workspace.notebooks.length < 2}
                  onClick={() =>
                    setDialog({
                      type: "move",
                      bookId: dialog.bookId,
                      docId: dialog.docId!,
                    })
                  }
                >
                  移动到…
                </button>
              )}
              {dialog.docId === docId &&
                commands.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setDialog(null);
                      void host.current?.runCommand(c.id).catch(report);
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              <button
                className="danger-text"
                onClick={() =>
                  setDialog({
                    type: "delete",
                    bookId: dialog.bookId,
                    docId: dialog.docId,
                  })
                }
              >
                删除
              </button>
            </div>
          )}
          {dialog.type === "delete" && (
            <>
              <p className="dialog-copy">
                删除“{targetDoc?.title || targetBook?.name}”
                {dialog.docId ? "？" : "及其中的全部文档？"}
              </p>
              <div className="form-actions">
                <button disabled={busy} onClick={() => setDialog(null)}>
                  取消
                </button>
                <button className="danger" disabled={busy} onClick={remove}>
                  删除
                </button>
              </div>
            </>
          )}
          {dialog.type === "move" && (
            <form onSubmit={move}>
              <label className="field">
                笔记本
                <select name="notebook">
                  {workspace.notebooks
                    .filter((n) => n.id !== dialog.bookId)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  移动
                </button>
              </div>
            </form>
          )}
          {dialog.type === "transfer" && (
            <div className="transfer-content">
              <button
                className="import-button"
                disabled={busy}
                onClick={importNotes}
              >
                导入 Markdown / ZIP
              </button>
              <div className="transfer-divider" />
              <label className="field">
                导出范围
                <select
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value)}
                >
                  <option value="book" disabled={!bookId}>
                    当前笔记本
                  </option>
                  <option value="document" disabled={!docId}>
                    当前文档
                  </option>
                  <option value="all">全部笔记</option>
                </select>
              </label>
              <p className="muted">图片和附件随 ZIP 导出。</p>
              <div className="form-actions">
                <button
                  disabled={busy || !docId}
                  onClick={() => exportNotes(true)}
                >
                  导出 Markdown
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    workspace.notebooks.length === 0 ||
                    (exportScope === "book" && !bookId) ||
                    (exportScope === "document" && !docId)
                  }
                  onClick={() => exportNotes()}
                >
                  导出 ZIP
                </button>
              </div>
            </div>
          )}
          {dialog.type === "plugins" && (
            <>
              <div className="builtin-plugin">
                <strong>Markdown 编辑器</strong>
                <span>内置</span>
              </div>
              <PluginManager
                plugins={workspace.plugins}
                onImport={() => pickFile(true)}
                onChange={async (plugins) => {
                  update((old) => ({ ...old, plugins }));
                  await flush();
                }}
              />
              {commands.length > 0 && (
                <div className="plugin-commands">
                  <h3>操作</h3>
                  {commands.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setDialog(null);
                        void host.current?.runCommand(c.id).catch(report);
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
