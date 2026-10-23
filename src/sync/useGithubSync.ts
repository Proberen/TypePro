import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { native, openLink } from "../lib/bridge";
import type { Notebook, Workspace } from "../lib/types";
import type { GithubSyncProps, GithubSyncSettings, GithubSyncState } from "./GithubSync";
import { mergeWorkspaces } from "./merge";
import { toSyncWorkspace, type SyncWorkspace } from "./model";
import { DEFAULT_GITHUB_APP, githubNative, NATIVE_REQUIRED, openGithubPage, type NativeGithubStatus, type NativePublication } from "./native";

export interface GithubSyncOptions {
  current: MutableRefObject<Workspace | null>;
  ready: boolean;
  collect: () => void;
  flush: () => Promise<void>;
  /** Must synchronously update current and preserve local plugins. */
  apply: (notebooks: Notebook[]) => void;
}
export type GithubSyncCallbacks = Omit<GithubSyncProps, "state" | "onClose">;

function settings(state: GithubSyncSettings): GithubSyncSettings {
  return { clientId: state.clientId, appSlug: state.appSlug, deviceName: state.deviceName, intervalMinutes: state.intervalMinutes };
}
function equal(left: SyncWorkspace, right: SyncWorkspace) { return JSON.stringify(left) === JSON.stringify(right); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

/** Shared by the hook and focused tests; all local access stays behind current. */
export async function synchronizeGithubWorkspace(
  getOptions: () => GithubSyncOptions,
  api: Pick<typeof githubNative, "readRemote" | "publish" | "checkpoint" | "status"> = githubNative,
  check: () => void = () => {},
): Promise<{ status: NativeGithubStatus; conflicts: number } | undefined> {
  if (!getOptions().ready || !getOptions().current.current) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    check();
    getOptions().collect();
    await getOptions().flush();
    check();
    const remote = await api.readRemote();
    check();
    getOptions().collect();
    const current = getOptions().current.current;
    if (!current) throw new Error("笔记尚未加载");
    const captured = toSyncWorkspace(current);
    const merged = await mergeWorkspaces(remote.base ? toSyncWorkspace(remote.base) : null, captured, remote.remote ? toSyncWorkspace(remote.remote) : null);
    check();
    let publication: NativePublication;
    try {
      // An unchanged remote snapshot needs no new Git commit.
      publication = remote.remote && equal(merged.workspace, toSyncWorkspace(remote.remote))
        ? { head: remote.head, snapshot: remote.remote }
        : await api.publish(remote.head, merged.workspace);
    } catch (error) {
      if (message(error).startsWith("REMOTE_CHANGED:") && attempt < 2) continue;
      throw error;
    }
    check();
    let conflicts = merged.conflicts;
    // Typing and plugin writes can happen while publication or merge awaits.
    for (;;) {
      getOptions().collect();
      const latest: Workspace | null = getOptions().current.current;
      if (!latest) throw new Error("笔记尚未加载");
      const local = toSyncWorkspace(latest);
      const reconciled = await mergeWorkspaces(captured, local, toSyncWorkspace(publication.snapshot));
      check();
      // Collect debounced editor changes before comparing references as well.
      getOptions().collect();
      if (getOptions().current.current !== latest) continue;
      if (!equal(local, reconciled.workspace)) getOptions().apply(reconciled.workspace.notebooks);
      conflicts += reconciled.conflicts;
      break;
    }
    await getOptions().flush();
    check();
    // The baseline is exactly what GitHub accepted, never a newer local draft.
    await api.checkpoint(publication.head, publication.snapshot);
    check();
    const status = await api.status();
    check();
    return { status, conflicts };
  }
}

export function useGithubSync(options: GithubSyncOptions): { state: GithubSyncState; callbacks: GithubSyncCallbacks } {
  const [state, setState] = useState<GithubSyncState>(() => ({ ...DEFAULT_GITHUB_APP, phase: "setup", deviceName: /Android/i.test(navigator.userAgent) ? "我的 Android" : "我的 Mac", intervalMinutes: 5, busy: native, status: "idle", ...(!native ? { notice: NATIVE_REQUIRED } : {}) }));
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const session = useRef(0), mounted = useRef(true), running = useRef(false);
  const configRevision = useRef(0), savedConfigRevision = useRef(0), attemptedConfigRevision = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const authorization = useRef<{ url: string; expiresAt: number; interval: number } | null>(null);
  const installationUrl = useRef<string | null>(null);
  const actions = useRef({ initialize: async () => {}, synchronize: () => {}, saveSettings: () => {} });

  function patch(value: Partial<GithubSyncState>) {
    stateRef.current = { ...stateRef.current, ...value };
    if (mounted.current) setState(stateRef.current);
  }
  function active(generation: number) { return mounted.current && session.current === generation; }
  function check(generation: number) { if (!active(generation)) throw new Error("CANCELLED:同步已取消"); }
  function clearPoll() { clearTimeout(pollTimer.current); pollTimer.current = undefined; }
  function fail(error: unknown) {
    const raw = message(error);
    if (raw.startsWith("CANCELLED:")) return;
    const phase = raw.startsWith("AUTH_REQUIRED:") ? "setup" : raw.startsWith("INSTALLATION_REQUIRED:") ? "installation" : stateRef.current.phase;
    patch({ phase, status: navigator.onLine === false ? "offline" : "error", error: raw.replace(/^[A-Z_]+:/, ""), notice: "" });
  }
  function adopt(value: NativeGithubStatus, phase?: GithubSyncState["phase"], preserveDraft = false) {
    patch({ ...(preserveDraft ? {} : settings(value)), phase: phase || (value.connected ? value.repository ? "connected" : "installation" : "setup"), account: value.account?.login, repository: value.repository ? `${value.repository.owner}/${value.repository.name}` : undefined, lastSyncedAt: value.lastSyncedAt || undefined, lastSource: value.lastSource?.name, userCode: undefined, authorizationExpiresAt: undefined });
  }
  async function exclusive(action: (generation: number) => Promise<void>) {
    if (!native) { patch({ notice: NATIVE_REQUIRED }); return; }
    if (running.current) return;
    const generation = session.current;
    running.current = true;
    patch({ busy: true, error: "", notice: "" });
    try { await action(generation); }
    catch (error) { if (active(generation)) fail(error); }
    finally { if (active(generation)) { running.current = false; patch({ busy: false, ...(stateRef.current.status === "syncing" ? { status: "idle" } : {}) }); } }
  }
  async function saveSettings(generation: number) {
    const revision = configRevision.current;
    attemptedConfigRevision.current = revision;
    const result = await githubNative.configure(settings(stateRef.current));
    check(generation);
    savedConfigRevision.current = revision;
    adopt(result, undefined, configRevision.current !== revision);
  }
  async function prepare(generation: number) {
    const result = await githubNative.prepareRepository();
    check(generation);
    installationUrl.current = result.installationUrl;
    if (result.status !== "ready" && result.status !== "installation_required") throw new Error("GitHub 仓库状态异常");
    adopt(result.state, result.status === "ready" ? "connected" : "installation");
    return result.status === "ready";
  }

  async function synchronize(generation: number) {
    if (!optionsRef.current.ready || !optionsRef.current.current.current) return;
    patch({ status: "syncing", error: "", notice: "" });
    const result = await synchronizeGithubWorkspace(() => optionsRef.current, githubNative, () => check(generation));
    if (result) { adopt(result.status); patch({ status: "idle", conflictCount: result.conflicts }); }
  }

  function schedulePoll(generation: number) {
    clearPoll();
    if (!authorization.current || !active(generation)) return;
    pollTimer.current = setTimeout(() => {
      if (!active(generation) || !authorization.current) return;
      if (running.current) { schedulePoll(generation); return; }
      void exclusive(async generation => {
        if (!authorization.current) return;
        if (Date.now() >= authorization.current.expiresAt) {
          authorization.current = null;
          await githubNative.cancelAuthorization();
          check(generation);
          patch({ phase: "setup", error: "验证码已过期，请重新连接", status: "error", userCode: undefined, authorizationExpiresAt: undefined });
          return;
        }
        const result = await githubNative.pollAuthorization();
        check(generation);
        if (result.status === "pending" || result.status === "slow_down") {
          authorization.current.interval = Math.max(5, result.interval || authorization.current.interval);
          schedulePoll(generation);
        } else if (result.status === "authorized" && result.state) {
          authorization.current = null;
          adopt(result.state);
          if (await prepare(generation) && stateRef.current.intervalMinutes > 0) await synchronize(generation);
        } else if (result.status === "expired" || result.status === "denied") {
          authorization.current = null;
          patch({ phase: "setup", status: "error", error: result.status === "expired" ? "验证码已过期，请重新连接" : "GitHub 授权已取消", userCode: undefined, authorizationExpiresAt: undefined });
        } else throw new Error("GitHub 授权状态异常，请重新连接");
      }).then(() => { if (active(generation) && authorization.current && pollTimer.current === undefined) schedulePoll(generation); });
      pollTimer.current = undefined;
    }, Math.max(5, authorization.current.interval) * 1000);
  }
  async function connect(generation: number) {
    clearPoll();
    await saveSettings(generation);
    const result = await githubNative.startAuthorization();
    check(generation);
    const expiresAt = Date.now() + Math.min(3600, Math.max(1, result.expiresIn)) * 1000;
    authorization.current = { url: result.verificationUri, expiresAt, interval: Math.max(5, result.interval) };
    patch({ phase: "authorizing", status: "idle", userCode: result.userCode, authorizationExpiresAt: new Date(expiresAt).toISOString() });
    schedulePoll(generation);
    await openGithubPage(result.verificationUri, "authorization", stateRef.current.appSlug);
  }
  const callbacks: GithubSyncCallbacks = {
    onChange: value => { configRevision.current++; patch({ ...value, error: "", notice: "" }); },
    onConnect: () => { void exclusive(connect); },
    onCancelAuthorization: () => {
      session.current++;
      clearPoll();
      authorization.current = null;
      running.current = false;
      patch({ phase: "setup", busy: false, status: "idle", userCode: undefined, authorizationExpiresAt: undefined, error: "" });
      if (native) void githubNative.cancelAuthorization().catch(fail);
    },
    onOpenAuthorization: () => { const value = authorization.current; if (value) void openGithubPage(value.url, "authorization", stateRef.current.appSlug).catch(fail); },
    onOpenInstallation: () => { void exclusive(async generation => {
      if (!installationUrl.current && await prepare(generation)) return;
      if (!installationUrl.current) throw new Error("无法获取 GitHub 仓库授权地址");
      await openGithubPage(installationUrl.current, "installation", stateRef.current.appSlug);
    }); },
    onCheckInstallation: () => { void exclusive(async generation => {
      if (configRevision.current > savedConfigRevision.current) await saveSettings(generation);
      if (await prepare(generation)) await synchronize(generation);
    }); },
    onSync: () => { void exclusive(async generation => {
      if (stateRef.current.phase !== "connected") return;
      if (configRevision.current > savedConfigRevision.current) await saveSettings(generation);
      await synchronize(generation);
    }); },
    onDisconnect: () => { void exclusive(async generation => {
      clearPoll(); authorization.current = null;
      const result = await githubNative.disconnect();
      check(generation);
      installationUrl.current = null;
      adopt(result);
      patch({ status: "idle", conflictCount: 0 });
    }); },
    onRetry: () => { void exclusive(async generation => {
      if (configRevision.current > savedConfigRevision.current) await saveSettings(generation);
      if (stateRef.current.phase === "connected") await synchronize(generation);
      else if (stateRef.current.phase === "installation") { if (await prepare(generation)) await synchronize(generation); }
      else if (stateRef.current.phase === "authorizing") schedulePoll(generation);
      else await connect(generation);
    }); },
    onOpenRegistration: () => { void openLink("https://github.com/settings/apps/new").catch(fail); },
  };
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;


  actions.current = {
    initialize: async () => {
      const generation = session.current;
      running.current = true;
      patch({ busy: true });
      try {
        const result = await githubNative.status();
        check(generation);
        adopt(result);
        if (result.connected && !result.repository) await prepare(generation);
      } catch (error) { if (active(generation)) fail(error); }
      finally { if (active(generation)) { running.current = false; patch({ busy: false }); } }
    },
    synchronize: () => { if (stateRef.current.phase === "connected" && stateRef.current.intervalMinutes > 0) callbacksRef.current.onSync(); },
    saveSettings: () => { if (!running.current) void exclusive(saveSettings); },
  };
  useEffect(() => {
    mounted.current = true;
    session.current++;
    if (native) void actions.current.initialize();
    return () => { mounted.current = false; session.current++; running.current = false; clearTimeout(pollTimer.current); if (native) void githubNative.cancelAuthorization().catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!native || state.busy || configRevision.current <= savedConfigRevision.current || configRevision.current <= attemptedConfigRevision.current) return;
    const timer = setTimeout(() => actions.current.saveSettings(), 400);
    return () => clearTimeout(timer);
  }, [state.clientId, state.appSlug, state.deviceName, state.intervalMinutes, state.busy]);
  useEffect(() => {
    if (!native || !options.ready || state.phase !== "connected" || state.intervalMinutes <= 0) return;
    const sync = () => { if (document.visibilityState !== "hidden" && navigator.onLine !== false) actions.current.synchronize(); };
    const initial = setTimeout(sync, 0);
    const timer = setInterval(sync, state.intervalMinutes * 60_000);
    document.addEventListener("visibilitychange", sync);
    return () => { clearTimeout(initial); clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [options.ready, state.phase, state.intervalMinutes]);
  useEffect(() => {
    if (!native) return;
    const offline = () => { if (stateRef.current.phase === "connected") patch({ status: "offline" }); };
    const online = () => { if (stateRef.current.phase === "connected") { if (!running.current) patch({ status: "idle" }); actions.current.synchronize(); } };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, []);
  return { state, callbacks };
}
