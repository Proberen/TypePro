import { Download, RefreshCw } from "lucide-react";
import type { AppUpdatesController } from "./types";
import "./updates.css";

function publishedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export default function UpdateSection({ updates }: { updates: AppUpdatesController }) {
  const { state } = updates;
  const update = state.update;
  const checking = state.status === "checking";
  const unsupported = state.status === "unsupported";
  const status = checking ? "正在检查…" : update ? `可更新至 ${update.version}` : state.status === "current" ? "已是最新版本" : state.status === "error" ? "检查更新失败" : unsupported ? "更新检查不可用" : "检查新版本";
  return <section className="tp-app-update" aria-label="应用更新">
    <div className="tp-app-update-row">
      <div role="status" aria-live="polite"><strong>{status}</strong>{update && publishedDate(update.publishedAt) && <span>{publishedDate(update.publishedAt)} · {(update.size / 1024 / 1024).toFixed(1)} MB</span>}</div>
      <button type="button" className="tp-button" disabled={checking || unsupported} onClick={() => void updates.check()}><RefreshCw size={14} aria-hidden="true" />{checking ? "检查中" : "检查更新"}</button>
    </div>
    {state.error && <p className="tp-app-update-error" role="alert">{state.error}</p>}
    {update && <>
      <details className="tp-app-update-notes" open><summary>升级说明</summary><div>{update.releaseNotes || "本版本暂无升级说明。"}</div></details>
      <div className="tp-app-update-download"><span>下载后手动安装</span><button type="button" className="tp-button tp-primary" onClick={() => void updates.download()}><Download size={14} aria-hidden="true" />下载更新</button></div>
    </>}
  </section>;
}
