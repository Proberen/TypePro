import { downloadIsActive } from "./policy.js";

// Read immediately, then follow an active native task without overlapping IPC requests.
export function watchDownloadStatus(read, onResult, onError) {
  let stopped = false;
  let timer;
  const poll = async () => {
    let delay;
    try {
      const result = await read();
      if (stopped) return;
      onResult(result);
      if (downloadIsActive(result.status)) delay = 500;
    } catch (error) {
      if (stopped) return;
      onError(error);
      // Also retry the initial idle read: an IPC failure does not prove there is no native task.
      delay = 5_000;
    }
    if (!stopped && delay !== undefined) timer = setTimeout(poll, delay);
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
