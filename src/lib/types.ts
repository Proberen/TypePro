export interface NoteDocument {
  id: string;
  title: string;
  markdown: string;
  updatedAt: string;
}
export interface Notebook {
  id: string;
  name: string;
  cover?: string;
  documents: NoteDocument[];
}
export interface InstalledPlugin {
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    apiVersion: 1 | 2;
    permissions: string[];
  };
  code: string;
  enabled: boolean;
  market?: { sha256: string; size: number; downloadUrl: string };
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ExtensionEntry {
  pluginId: string;
  key: string;
  value: JsonValue;
  updatedAt: string;
  deviceId: string;
  deleted?: boolean;
}
export interface PluginInstallation {
  id: string;
  manifest: InstalledPlugin["manifest"];
  source: "market" | "local";
  code?: string;
  sha256?: string;
  size?: number;
  downloadUrl?: string;
  updatedAt: string;
  deviceId: string;
  deleted?: boolean;
}
export interface ExtensionState {
  entries: ExtensionEntry[];
  installs: PluginInstallation[];
}
export interface Workspace {
  version: 1;
  notebooks: Notebook[];
  plugins: InstalledPlugin[];
  extensions?: ExtensionState;
}
export type EditorMode = "edit" | "read";
export interface TransferFile {
  name: string;
  bytes: number[];
}
