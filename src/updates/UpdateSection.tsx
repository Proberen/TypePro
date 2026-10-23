import { Download, RefreshCw, X } from "lucide-react";
import { canOpenInstaller, downloadIsActive } from "./policy.js";
import type { AppUpdatesController } from "./types";
import "./updates.css";

function publishedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UpdateSection({ updates }: { updates: AppUpdatesController }) {
  const { state, downloadState: task, downloadAction: action } = updates;
  const update = state.update;
  const checking = state.status === "checking";
  const unsupported = state.status === "unsupported";
  const active = downloadIsActive(task.status);
  const hasTask = task.version !== null && task.status !== "idle" && (active || !update || task.version === update.version);
  const installReady = state.platform !== null && canOpenInstaller(task, update);
  const downloadError = updates.downloadError || (hasTask ? task.error : "");
  const busy = active || action !== null;
  const percent = task.total > 0 ? Math.min(100, Math.max(0, task.downloaded / task.total * 100)) : 0;
  const status = checking ? "正在检查…" : update ? `可更新至 ${update.version}` : state.status === "current" ? "已是最新版本" : state.status === "error" ? "检查更新失败" : unsupported ? "更新检查不可用" : "检查新版本";
  const taskLabel = task.status === "ready" ? "下载完成，校验通过" : task.status === "cancelled" ? "已取消下载" : task.status === "error" ? "下载失败" : task.status === "cancelling" || action === "cancelling" ? "正在取消…" : task.status === "verifying" ? "正在校验安装包…" : task.total === 0 ? "正在准备下载…" : `正在下载 ${task.version}`;
  return <section className="tp-app-update" aria-label="应用更新">
    <div className="tp-app-update-row">
      <div role="status" aria-live="polite"><strong>{status}</strong>{update && publishedDate(update.publishedAt) && <span>{publishedDate(update.publishedAt)} · {megabytes(update.size)}</span>}</div>
      <button type="button" className="tp-button" disabled={checking || unsupported || busy} onClick={() => void updates.check()}><RefreshCw size={14} aria-hidden="true" />{checking ? "检查中" : "检查更新"}</button>
    </div>
    {state.error && <p className="tp-app-update-error" role="alert">{state.error}</p>}
    {update && <details className="tp-app-update-notes" open><summary>升级说明</summary><div>{update.releaseNotes || "本版本暂无升级说明。"}</div></details>}
    {hasTask && <div className="tp-app-update-task">
      <div className="tp-app-update-progress-label"><span role="status" aria-live="polite">{taskLabel}</span>{active && task.total > 0 && <span>{megabytes(task.downloaded)} / {megabytes(task.total)}</span>}</div>
      {active && <progress className="tp-app-update-progress" aria-label="安装包下载进度" value={task.total > 0 ? percent : undefined} max={100} />}
      {(task.status === "downloading" || task.status === "verifying" || task.status === "cancelling") && <div className="tp-app-update-actions"><button type="button" className="tp-button" disabled={action !== null || task.status === "cancelling"} onClick={() => void updates.cancelDownload()}><X size={14} aria-hidden="true" />取消下载</button></div>}
    </div>}
    {downloadError && <p className="tp-app-update-error" role="alert">{downloadError}</p>}
    {installReady ? <div className="tp-app-update-download"><span>由系统确认安装</span><button type="button" className="tp-button tp-primary" disabled={action !== null} onClick={() => void updates.openInstaller()}><Download size={14} aria-hidden="true" />{action === "opening" ? "正在打开…" : state.platform === "android" ? "安装更新" : "打开安装包"}</button></div> : update && !active && <div className="tp-app-update-download"><span>下载完成后确认安装</span><button type="button" className="tp-button tp-primary" disabled={checking || unsupported || action !== null} onClick={() => void updates.download()}><Download size={14} aria-hidden="true" />{action === "starting" ? "准备下载…" : hasTask && task.status === "error" ? "重试下载" : hasTask && task.status === "cancelled" ? "重新下载" : "下载更新"}</button></div>}
  </section>;
}
