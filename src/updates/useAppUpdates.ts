import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { version } from "../../package.json";
import { command, native } from "../lib/bridge";
import { watchDownloadStatus } from "./download-monitor.js";
import { canOpenInstaller, downloadIsActive, newerDownloadState, shouldCheck, trustedDownloadUrl } from "./policy.js";
import type { AppUpdateState, AppUpdatesController, UpdateCheck, UpdateDownloadAction, UpdateDownloadState } from "./types";

const initialDownload: UpdateDownloadState = {
  version: null, status: "idle", downloaded: 0, total: 0, error: null, revision: 0,
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useAppUpdates(ready: boolean): AppUpdatesController {
  const [state, setState] = useState<AppUpdateState>({
    currentVersion: version,
    platform: null,
    update: null,
    status: native ? "idle" : "unsupported",
    error: native ? "" : "请在 Mac 或 Android 应用中检查更新。",
  });
  const [downloadState, setDownloadState] = useState(initialDownload);
  const [downloadAction, setDownloadAction] = useState<UpdateDownloadAction>(null);
  const [actionError, setActionError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [statusRefresh, refreshDownloadStatus] = useReducer(value => value + 1, 0);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const lastAttemptAt = useRef<number | null>(null);
  const downloadRef = useRef(downloadState);
  const actionRef = useRef<UpdateDownloadAction>(null);
  const active = downloadIsActive(downloadState.status);

  const acceptDownload = useCallback((next: UpdateDownloadState) => {
    const previous = downloadRef.current;
    const accepted = newerDownloadState(previous, next);
    if (accepted !== previous) {
      downloadRef.current = accepted;
      setDownloadState(accepted);
      if (accepted.status !== previous.status || accepted.version !== previous.version || accepted.error !== previous.error) setActionError("");
    }
  }, []);

  const check = useCallback((): Promise<void> => {
    if (!native || downloadIsActive(downloadRef.current.status) || actionRef.current) return Promise.resolve();
    if (pending.current) return pending.current;
    lastAttemptAt.current = Date.now();
    setState(previous => ({ ...previous, status: "checking", error: "" }));
    const request = command<UpdateCheck>("app_check_updates")
      .then(result => {
        setActionError("");
        setState({
          ...result,
          status: result.platform === null ? "unsupported" : result.update ? "available" : "current",
          error: result.platform === null ? "当前设备暂不提供安装包更新。" : "",
        });
      })
      .catch((error: unknown) => {
        setState(previous => ({ ...previous, status: "error", error: message(error) }));
      })
      .finally(() => { pending.current = null; });
    pending.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!ready || !native) return;
    const checkWhenDue = () => {
      if (shouldCheck(lastAttemptAt.current, Date.now(), document.visibilityState)) void check();
    };
    checkWhenDue();
    const timer = window.setInterval(checkWhenDue, 60_000);
    document.addEventListener("visibilitychange", checkWhenDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkWhenDue);
    };
  }, [check, ready]);

  useEffect(() => {
    if (!ready || !native) return;
    return watchDownloadStatus(
      () => command<UpdateDownloadState>("app_update_download_status"),
      result => {
        acceptDownload(result);
        setProgressError("");
      },
      error => {
        setProgressError(`无法读取下载进度：${message(error)}`);
      },
    );
  }, [acceptDownload, active, ready, statusRefresh]);

  const dismiss = useCallback(() => setDismissedVersion(state.update?.version ?? null), [state.update?.version]);
  const download = useCallback(async () => {
    if (!native || !ready || pending.current || actionRef.current || downloadIsActive(downloadRef.current.status)) return;
    if (!trustedDownloadUrl(state.update, state.platform)) {
      setActionError("安装包信息无效，请重新检查更新。");
      return;
    }
    actionRef.current = "starting";
    setDownloadAction("starting");
    setActionError("");
    try {
      acceptDownload(await command<UpdateDownloadState>("app_download_update", { version: state.update!.version }));
    } catch (error) {
      setActionError(`无法开始下载：${message(error)}`);
    } finally {
      actionRef.current = null;
      setDownloadAction(null);
      refreshDownloadStatus();
    }
  }, [acceptDownload, ready, state.update, state.platform]);

  const cancelDownload = useCallback(async () => {
    if (!native || actionRef.current || !["downloading", "verifying"].includes(downloadRef.current.status)) return;
    actionRef.current = "cancelling";
    setDownloadAction("cancelling");
    setActionError("");
    try {
      acceptDownload(await command<UpdateDownloadState>("app_cancel_update_download"));
    } catch (error) {
      setActionError(`无法取消下载：${message(error)}`);
    } finally {
      actionRef.current = null;
      setDownloadAction(null);
      refreshDownloadStatus();
    }
  }, [acceptDownload]);

  const openInstaller = useCallback(async () => {
    if (!native || actionRef.current || !canOpenInstaller(downloadRef.current, state.update)) return;
    actionRef.current = "opening";
    setDownloadAction("opening");
    setActionError("");
    try {
      await command<void>("app_open_update_installer");
    } catch (error) {
      setActionError(message(error));
    } finally {
      // Opening also rechecks the local package. Reflect an invalidated download before offering installation again.
      try { acceptDownload(await command<UpdateDownloadState>("app_update_download_status")); } catch { /* Keep the installation error and allow retry. */ }
      actionRef.current = null;
      setDownloadAction(null);
    }
  }, [acceptDownload, state.update]);

  return {
    state, downloadState, downloadAction, downloadError: actionError || progressError,
    visible: ready && state.update !== null && state.update.version !== dismissedVersion,
    check, dismiss, download, cancelDownload, openInstaller,
  };
}
