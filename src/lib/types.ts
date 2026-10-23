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
    apiVersion: 1;
    permissions: string[];
  };
  code: string;
  enabled: boolean;
}
export interface Workspace {
  version: 1;
  notebooks: Notebook[];
  plugins: InstalledPlugin[];
}
export type EditorMode = "edit" | "source" | "read";
export interface TransferFile {
  name: string;
  bytes: number[];
}
