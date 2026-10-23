import type { NoteDocument, Workspace } from '../lib/types';

export type PluginSlot = 'home.widget' | 'app.page' | 'plugin.settings';
export interface PluginView {
  id: string; pluginId: string; localId: string; slot: PluginSlot;
  title: string; script: string; styles: string[]; height: number; icon?: string;
}
export interface PluginCommand {
  id: string; label: string; pluginId: string; locations: string[]; icon?: string; shortcut?: string;
}
export interface PluginPanel { id: string; title: string; text: string; pluginId: string }
export interface PluginTheme { mode: 'light' | 'dark'; accent: string }
export interface DocumentChange {
  documentId: string; title: string; beforeMarkdown: string; afterMarkdown: string;
  beforePlain?: string; afterPlain?: string; origin: 'human' | 'plugin' | 'sync' | 'import';
  history?: 'undo' | 'redo'; timestamp: string; transactionId: string;
}
export type PluginDialog =
  | { kind: 'confirm'; title: string; message: string }
  | { kind: 'secret'; title: string; origin: string }
  | { kind: 'review'; title: string; before: string; after: string };
export interface PluginHostOptions {
  getWorkspace: () => Workspace;
  getActiveDocumentId: () => string | null;
  getTheme: () => PluginTheme;
  replaceDocument: (id: string, markdown: string, expectedMarkdown?: string) => void | Promise<void>;
  createDocument: (notebookId: string, title: string, markdown: string) => Promise<NoteDocument>;
  openDocument: (id: string) => void;
  insertText: (text: string) => void;
  getSelection: () => { documentId: string | null; text: string };
  onStateChange: () => void;
  onError: (message: string) => void;
  onPluginStopped?: (id: string) => void;
  getPluginData: (pluginId: string, key: string) => unknown;
  listPluginData: (pluginId: string, prefix: string) => { key: string; value: unknown }[];
  setPluginData: (pluginId: string, key: string, value: unknown, remove?: boolean) => Promise<void>;
  onOpenView: (view: PluginView) => void;
  onCloseView: (viewId: string) => void;
  showDialog: (pluginId: string, pluginName: string, dialog: PluginDialog, signal: AbortSignal) => Promise<string | boolean>;
  cancelDialogs: (pluginId: string) => void;
  notify: (message: string) => void;
  reservedShortcuts: string[];
}

export class PluginError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'PluginError'; }
}
export function pluginError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error)
    return { code: String(error.code), message: String(error.message).slice(0, 500) };
  return { code: 'INTERNAL_ERROR', message: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
}
