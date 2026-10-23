import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TransferFile, Workspace } from "./types";

export const native = isTauri();
export async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (native) return invoke<T>(name, args);
  if (import.meta.env.DEV) {
    const { previewCommand } = await import("./preview");
    return previewCommand(name, args) as Promise<T>;
  }
  throw new Error("请通过 TypePro 应用打开。");
}
export const loadWorkspace = () => command<Workspace>("load_workspace");
export const saveWorkspace = (workspace: Workspace) =>
  command<void>("save_workspace", { workspace });

export interface NotebookLocation { path: string; custom: boolean }
export const getNotebookLocation = (notebookId: string) =>
  command<NotebookLocation>("get_notebook_location", { notebookId });
export const setNotebookLocation = (notebookId: string, path: string | null) =>
  command<NotebookLocation>("set_notebook_location", { notebookId, path });
export async function pickNotebookDirectory(): Promise<string | null> {
  if (!native) throw new Error("请在 Mac 应用中选择文件夹；浏览器预览可输入目录。");
  if (/Android/i.test(navigator.userAgent)) throw new Error("手机版不支持自定义目录。");
  const path = await open({ directory: true, multiple: false, title: "选择笔记存储目录" });
  return typeof path === "string" ? path : null;
}

export async function pickFile(
  plugin = false,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!native) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = plugin ? ".zip,.json" : ".md,.markdown,.zip";
      input.oncancel = () => resolve(null);
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(
          file
            ? {
                name: file.name,
                bytes: new Uint8Array(await file.arrayBuffer()),
              }
            : null,
        );
      };
      input.click();
    });
  }
  const android = /Android/i.test(navigator.userAgent);
  const extensions = android
    ? plugin
      ? ["application/zip", "application/json", "application/octet-stream"]
      : [
          "text/markdown",
          "text/plain",
          "application/zip",
          "application/octet-stream",
        ]
    : plugin
      ? ["zip", "json"]
      : ["md", "markdown", "zip"];
  const path = await open({
    multiple: false,
    directory: false,
    title: plugin ? "导入插件" : "导入笔记",
    filters: [{ name: plugin ? "插件" : "笔记", extensions }],
  });
  if (!path) return null;
  const name = path.startsWith("content://")
    ? await command<string>("get_transfer_name", { uri: path })
    : path.split(/[\\/]/).pop() || "导入文档.md";
  return { name, bytes: await readFile(path) };
}

export async function writeTransfer(file: TransferFile): Promise<boolean> {
  if (!native) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)]));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  const extension = file.name.endsWith(".zip") ? "zip" : "md";
  const path = await save({
    title: "导出笔记",
    defaultPath: file.name,
    filters: [
      {
        name: extension === "zip" ? "ZIP" : "Markdown",
        extensions: [extension],
      },
    ],
  });
  if (!path) return false;
  if (path.startsWith("content://"))
    await command<void>("write_transfer_uri", { uri: path, bytes: file.bytes });
  else await writeFile(path, new Uint8Array(file.bytes));
  return true;
}

export async function saveAsset(
  file: File,
): Promise<{ path: string; url: string }> {
  return command("save_asset", {
    name: file.name,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  });
}
export const resolveAsset = (path: string) =>
  command<string>("resolve_asset", { path });
export async function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (native) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
