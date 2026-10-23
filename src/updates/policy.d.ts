import type { AppUpdate, UpdateCheck, UpdateDownloadState } from "./types";

export const UPDATE_INTERVAL_MS: number;
export function shouldCheck(lastAttemptAt: number | null, now: number, visibility: string): boolean;
export function trustedDownloadUrl(update: AppUpdate | null, platform: UpdateCheck["platform"]): boolean;
export function downloadIsActive(status: UpdateDownloadState["status"]): boolean;
export function newerDownloadState(current: UpdateDownloadState, next: UpdateDownloadState): UpdateDownloadState;
export function canOpenInstaller(download: UpdateDownloadState, update: AppUpdate | null): boolean;
