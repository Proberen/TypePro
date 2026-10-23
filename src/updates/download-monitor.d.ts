import type { UpdateDownloadState } from "./types";

export function watchDownloadStatus(
  read: () => Promise<UpdateDownloadState>,
  onResult: (state: UpdateDownloadState) => void,
  onError: (error: unknown) => void,
): () => void;
