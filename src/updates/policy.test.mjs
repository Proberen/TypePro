import assert from "node:assert/strict";
import test from "node:test";
import { shouldCheck, trustedDownloadUrl, UPDATE_INTERVAL_MS } from "./policy.js";

test("startup waits until the application is visible", () => {
  assert.equal(shouldCheck(null, 100, "hidden"), false);
  assert.equal(shouldCheck(null, 100, "visible"), true);
});

test("automatic checks respect a full day after the latest attempt", () => {
  assert.equal(shouldCheck(0, UPDATE_INTERVAL_MS - 1, "visible"), false);
  assert.equal(shouldCheck(0, UPDATE_INTERVAL_MS, "visible"), true);
  assert.equal(shouldCheck(UPDATE_INTERVAL_MS, UPDATE_INTERVAL_MS * 2 - 1, "visible"), false);
});

test("an overdue check remains paused in the background and resumes when visible", () => {
  assert.equal(shouldCheck(1, UPDATE_INTERVAL_MS * 2, "hidden"), false);
  assert.equal(shouldCheck(1, UPDATE_INTERVAL_MS * 2, "visible"), true);
});

const update = {
  version: "1.7.4",
  releaseUrl: "https://github.com/Proberen/TypePro/releases/tag/v1.7.4",
  downloadUrl: "https://github.com/Proberen/TypePro/releases/download/v1.7.4/TypePro-1.7.4-mac-arm64.dmg",
};

test("downloads match the official repository, version and current platform", () => {
  assert.equal(trustedDownloadUrl(update, "mac-arm64"), true);
  assert.equal(trustedDownloadUrl(update, "android"), false);
  assert.equal(trustedDownloadUrl(update, null), false);
  assert.equal(trustedDownloadUrl({ ...update, downloadUrl: update.downloadUrl.replace("mac-arm64.dmg", "android.apk") }, "android"), true);
});

test("foreign repositories, queries and mismatched release tags cannot be opened as updates", () => {
  for (const candidate of [
    { ...update, downloadUrl: update.downloadUrl.replace("/Proberen/TypePro/", "/other/TypePro/") },
    { ...update, downloadUrl: update.downloadUrl + "?redirect=elsewhere" },
    { ...update, releaseUrl: update.releaseUrl.replace("v1.7.4", "v1.7.5") },
    { ...update, downloadUrl: "file:///tmp/installer.dmg" },
    { ...update, version: "../1.7.4" },
  ]) assert.equal(trustedDownloadUrl(candidate, "mac-arm64"), false);
});

test("missing updates have no download action", () => {
  assert.equal(trustedDownloadUrl(null, "mac-arm64"), false);
});
