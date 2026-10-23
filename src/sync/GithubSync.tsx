import { useId, useState } from "react";
import { AlertCircle, Check, ChevronDown, Cloud, ExternalLink, GitBranch, LoaderCircle, LockKeyhole, RefreshCw, WifiOff } from "lucide-react";
import "./sync.css";

export interface GithubSyncSettings {
  clientId: string;
  appSlug: string;
  deviceName: string;
  intervalMinutes: number;
}

export interface GithubSyncState extends GithubSyncSettings {
  phase: "setup" | "authorizing" | "installation" | "connected";
  busy?: boolean;
  status?: "idle" | "syncing" | "offline" | "error";
  userCode?: string;
  authorizationExpiresAt?: string;
  account?: string;
  repository?: string;
  lastSyncedAt?: string;
  lastSource?: string;
  conflictCount?: number;
  error?: string;
  notice?: string;
}

export interface GithubSyncProps {
  state: GithubSyncState;
  onChange: (patch: Partial<GithubSyncSettings>) => void;
  onConnect: () => void;
  onCancelAuthorization: () => void;
  onOpenAuthorization: () => void;
  onOpenInstallation: () => void;
  onCheckInstallation: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onOpenRegistration: () => void;
  onClose: () => void;
}

const INTERVALS = [0, 1, 5, 10, 15, 30, 60];

function timestamp(value?: string, timeOnly = false) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间不可用";
  return timeOnly
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function GithubSync({
  state, onChange, onConnect, onCancelAuthorization, onOpenAuthorization,
  onOpenInstallation, onCheckInstallation, onSync, onDisconnect, onRetry,
  onOpenRegistration, onClose,
}: GithubSyncProps) {
  const id = useId();
  const [advanced, setAdvanced] = useState(!state.clientId || !state.appSlug);
  const connected = state.phase === "connected";
  const syncing = state.status === "syncing";
  const busy = Boolean(state.busy || syncing);
  const status = syncing ? "正在同步" : state.status === "offline" ? "离线 · 内容已保存在本地" : state.status === "error" ? "同步失败" : "已连接";
  const StatusIcon = syncing ? LoaderCircle : state.status === "offline" ? WifiOff : state.status === "error" ? AlertCircle : Check;
  const intervals = INTERVALS.includes(state.intervalMinutes) ? INTERVALS : [...INTERVALS, state.intervalMinutes].sort((a, b) => a - b);

  return <section className="github-sync" aria-label="GitHub 同步设置" aria-busy={busy}>
    <div className="github-sync-heading">
      <span className="github-sync-mark"><GitBranch size={24} aria-hidden="true" /></span>
      <div><h3>{connected ? state.account || "GitHub" : "GitHub"}</h3><p>{connected ? "私有仓库同步" : "笔记留在本地，设备间自动同步"}</p></div>
      {connected && <span className="github-sync-private"><LockKeyhole size={12} aria-hidden="true" />私有</span>}
    </div>

    {state.phase === "setup" && <form className="github-sync-setup" onSubmit={event => { event.preventDefault(); onConnect(); }}>
      <button className="github-sync-disclosure" type="button" aria-expanded={advanced} aria-controls={`${id}-app-settings`} disabled={busy} onClick={() => setAdvanced(value => !value)}><span>GitHub App 设置</span><ChevronDown className={advanced ? "github-sync-rotated" : ""} size={16} aria-hidden="true" /></button>
      <div id={`${id}-app-settings`} className="github-sync-app-settings" hidden={!advanced}>
        <label className="github-sync-field" htmlFor={`${id}-client-id`}>Client ID<input id={`${id}-client-id`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={state.clientId} disabled={busy} maxLength={128} placeholder="Iv…" onChange={event => onChange({ clientId: event.target.value })} /></label>
        <label className="github-sync-field" htmlFor={`${id}-app-slug`}>App 名称<input id={`${id}-app-slug`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={state.appSlug} disabled={busy} maxLength={100} placeholder="typepro-sync" onChange={event => onChange({ appSlug: event.target.value })} /></label>
        <button className="github-sync-link" type="button" disabled={busy} onClick={onOpenRegistration}>注册 GitHub App<ExternalLink size={13} aria-hidden="true" /></button>
      </div>
      <div className="github-sync-actions"><button className="btn primary" type="submit" disabled={busy || !state.clientId.trim() || !state.appSlug.trim()}>{busy ? <LoaderCircle className="github-sync-spin" size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}连接 GitHub</button></div>
    </form>}

    {state.phase === "authorizing" && <div className="github-sync-authorization">
      <h4>在 GitHub 输入验证码</h4>
      <output className="github-sync-code" aria-label="GitHub 设备验证码">{state.userCode || "获取中…"}</output>
      {state.authorizationExpiresAt && <p className="github-sync-caption">有效至 {timestamp(state.authorizationExpiresAt, true)}</p>}
      <button className="btn primary" type="button" disabled={!state.userCode} onClick={onOpenAuthorization}>打开 GitHub<ExternalLink size={15} aria-hidden="true" /></button>
      <p className="github-sync-waiting" role="status"><LoaderCircle className="github-sync-spin" size={13} aria-hidden="true" />等待授权</p>
      <button className="github-sync-link github-sync-cancel" type="button" onClick={onCancelAuthorization}>取消授权</button>
    </div>}

    {state.phase === "installation" && <div className="github-sync-installation">
      <h4>授权笔记仓库</h4>
      <p>{state.account ? `${state.account} · ` : ""}仅选择 <strong>typepro-notes</strong></p>
      <div className="github-sync-actions"><button className="btn primary" type="button" disabled={busy} onClick={onOpenInstallation}>前往授权<ExternalLink size={15} aria-hidden="true" /></button><button className="btn outline" type="button" disabled={busy} onClick={onCheckInstallation}>{busy && <LoaderCircle className="github-sync-spin" size={15} aria-hidden="true" />}我已授权，检查连接</button></div>
    </div>}

    {connected && <>
      <div className="github-sync-connection">
        <p className={`github-sync-status github-sync-status-${state.status || "idle"}`} role="status"><StatusIcon className={syncing ? "github-sync-spin" : ""} size={15} aria-hidden="true" />{status}</p>
        <dl className="github-sync-details"><div><dt>仓库</dt><dd>{state.repository || "typepro-notes"}</dd></div><div><dt>最近同步</dt><dd><time dateTime={state.lastSyncedAt}>{timestamp(state.lastSyncedAt)}</time></dd></div><div><dt>更新源</dt><dd>{state.lastSource || "—"}</dd></div></dl>
      </div>
      <div className="github-sync-preferences">
        <label className="github-sync-field" htmlFor={`${id}-device`}>设备名称<input id={`${id}-device`} value={state.deviceName} disabled={busy} maxLength={64} placeholder="这台设备" onChange={event => onChange({ deviceName: event.target.value })} /></label>
        <label className="github-sync-field" htmlFor={`${id}-interval`}>自动同步<select id={`${id}-interval`} value={state.intervalMinutes} disabled={busy} onChange={event => onChange({ intervalMinutes: Number(event.target.value) })}>{intervals.map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? "仅手动同步" : `每 ${minutes} 分钟`}</option>)}</select></label>
      </div>
      <p className="github-sync-caption">自动同步在应用打开时运行</p>
      <div className="github-sync-actions"><button className="btn primary" type="button" disabled={busy} onClick={onSync}>{syncing ? <LoaderCircle className="github-sync-spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{syncing ? "正在同步" : "立即同步"}</button></div>
      {Boolean(state.conflictCount && state.conflictCount > 0) && <p className="github-sync-conflicts"><Cloud size={15} aria-hidden="true" /><span>{state.conflictCount} 处冲突，副本已保留</span></p>}
    </>}

    {state.error && <div className="github-sync-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><p>{state.error}</p><button type="button" disabled={busy} onClick={onRetry}>重试</button></div>}
    {state.notice && <p className="github-sync-notice" role="status">{state.notice}</p>}

    <footer className="github-sync-footer">{(connected || state.phase === "installation") && <button className="github-sync-disconnect" type="button" disabled={busy} onClick={onDisconnect}>断开连接</button>}<button className="btn outline" type="button" onClick={onClose}>{connected ? "完成" : "关闭"}</button></footer>
  </section>;
}
