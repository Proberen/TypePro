// Development-only browser harness; production builds require the native filesystem.
import type { Workspace } from "./types";
import { uuid } from "./bridge";
const key = "notebook-ui-preview-v1";
const assets = new Map<string, string>();
export async function previewCommand(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (name === "load_workspace")
    return JSON.parse(
      localStorage.getItem(key) || '{"version":1,"notebooks":[],"plugins":[]}',
    );
  if (name === "save_workspace") {
    localStorage.setItem(key, JSON.stringify(args.workspace));
    return;
  }
  if (name === "save_asset") {
    const path = `../../assets/${uuid()}.${String(args.name).split(".").pop()}`;
    const bytes = new Uint8Array(args.bytes as number[]);
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(new Blob([bytes]));
    });
    assets.set(path, url);
    return { path, url };
  }
  if (name === "resolve_asset") return assets.get(String(args.path)) || "";
  if (name === "export_markdown") {
    const ws = (await previewCommand("load_workspace")) as Workspace;
    const doc = ws.notebooks
      .find((n) => n.id === args.notebookId)
      ?.documents.find((d) => d.id === args.documentId);
    if (!doc) throw new Error("文档不存在");
    return {
      name: `${doc.title}.md`,
      bytes: Array.from(new TextEncoder().encode(doc.markdown)),
    };
  }
  throw new Error("此操作需要在安装后的笔记应用中验证。");
}
