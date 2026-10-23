import { useCallback, useEffect, useRef, useState } from "react";
import { version } from "../../package.json";
import { command, native, openLink } from "../lib/bridge";
import { shouldCheck, trustedDownloadUrl } from "./policy.js";
import type { AppUpdateState, AppUpdatesController, UpdateCheck } from "./types";

export function useAppUpdates(ready: boolean): AppUpdatesController {
  const [state, setState] = useState<AppUpdateState>({
    currentVersion: version,
    platform: null,
    update: null,
    status: native ? "idle" : "unsupported",
    error: native ? "" : "请在 Mac 或 Android 应用中检查更新。",
  });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const lastAttemptAt = useRef<number | null>(null);

  const check = useCallback((): Promise<void> => {
    if (!native) return Promise.resolve();
    if (pending.current) return pending.current;
    lastAttemptAt.current = Date.now();
    setState(previous => ({ ...previous, status: "checking", error: "" }));
    const request = command<UpdateCheck>("app_check_updates")
      .then(result => {
        setState({
          ...result,
          status: result.platform === null ? "unsupported" : result.update ? "available" : "current",
          error: result.platform === null ? "当前设备暂不提供安装包更新。" : "",
        });
      })
      .catch((error: unknown) => {
        setState(previous => ({ ...previous, status: "error", error: error instanceof Error ? error.message : String(error) }));
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

  const dismiss = useCallback(() => setDismissedVersion(state.update?.version ?? null), [state.update?.version]);
  const download = useCallback(async () => {
    if (!trustedDownloadUrl(state.update, state.platform)) {
      setState(previous => ({ ...previous, error: "安装包地址无效，请重新检查更新。" }));
      return;
    }
    try {
      await openLink(state.update!.downloadUrl);
      setState(previous => ({ ...previous, error: "" }));
    } catch (error) {
      setState(previous => ({ ...previous, error: `无法打开下载：${error instanceof Error ? error.message : String(error)}` }));
    }
  }, [state.update, state.platform]);

  return { state, visible: ready && state.update !== null && state.update.version !== dismissedVersion, check, dismiss, download };
}
