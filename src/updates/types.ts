export interface AppUpdate {
  version: string;
  releaseUrl: string;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
  size: number;
}

export interface UpdateCheck {
  currentVersion: string;
  platform: "mac-arm64" | "android" | null;
  update: AppUpdate | null;
}

export interface AppUpdateState extends UpdateCheck {
  status: "idle" | "checking" | "current" | "available" | "error" | "unsupported";
  error: string;
}

export interface UpdateDownloadState {
  version: string | null;
  status: "idle" | "downloading" | "verifying" | "ready" | "cancelling" | "cancelled" | "error";
  downloaded: number;
  total: number;
  error: string | null;
  revision: number;
}

export type UpdateDownloadAction = "starting" | "cancelling" | "opening" | null;

export interface AppUpdatesController {
  state: AppUpdateState;
  downloadState: UpdateDownloadState;
  downloadAction: UpdateDownloadAction;
  downloadError: string;
  visible: boolean;
  check: () => Promise<void>;
  dismiss: () => void;
  download: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  openInstaller: () => Promise<void>;
}
