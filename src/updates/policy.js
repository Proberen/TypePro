export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function shouldCheck(lastAttemptAt, now, visibility) {
  return visibility === "visible" && (lastAttemptAt === null || now - lastAttemptAt >= UPDATE_INTERVAL_MS);
}

export function trustedDownloadUrl(update, platform) {
  if (!update || !/^\d+\.\d+\.\d+$/.test(update.version)) return false;
  const suffix = platform === "mac-arm64" ? "mac-arm64.dmg" : platform === "android" ? "android.apk" : null;
  if (!suffix) return false;
  const root = "https://github.com/Proberen/TypePro/releases";
  return update.releaseUrl === `${root}/tag/v${update.version}` &&
    update.downloadUrl === `${root}/download/v${update.version}/TypePro-${update.version}-${suffix}`;
}
