import type { AppUpdate, UpdateCheck } from "./types";

export const UPDATE_INTERVAL_MS: number;
export function shouldCheck(lastAttemptAt: number | null, now: number, visibility: string): boolean;
export function trustedDownloadUrl(update: AppUpdate | null, platform: UpdateCheck["platform"]): boolean;
