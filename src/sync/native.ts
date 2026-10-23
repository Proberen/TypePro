import { command, native, openLink } from "../lib/bridge";
import { parseSyncSnapshot, toSyncWorkspace, type SyncSnapshot, type SyncSource, type SyncWorkspace } from "./model";
import type { GithubSyncSettings } from "./GithubSync";

export const DEFAULT_GITHUB_APP = { clientId: "Iv23lipNCmyApIdzUDhY", appSlug: "typepro-proberen" } as const;
export const NATIVE_REQUIRED = "请在 TypePro 应用中连接 GitHub";

export interface NativeGithubStatus extends GithubSyncSettings {
  connected: boolean;
  account: { login: string; avatarUrl: string } | null;
  repository: { owner: string; name: string; url: string; defaultBranch: string } | null;
  deviceId: string;
  lastSyncedAt: string | null;
  lastSource: SyncSource | null;
}
export interface NativeAuthorization {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}
export interface NativeAuthorizationPoll {
  status: "pending" | "slow_down" | "expired" | "denied" | "authorized";
  interval: number | null;
  state: NativeGithubStatus | null;
}
export interface NativeRepositoryPreparation {
  status: "ready" | "installation_required";
  installationUrl: string | null;
  state: NativeGithubStatus;
}
export interface NativeRemote {
  head: string;
  base: SyncSnapshot | null;
  remote: SyncSnapshot | null;
}
export interface NativePublication {
  head: string;
  snapshot: SyncSnapshot;
}

function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!native) return Promise.reject(new Error(NATIVE_REQUIRED));
  return command<T>(name, args);
}

export const githubNative = {
  status: () => call<NativeGithubStatus>("github_status"),
  configure: (settings: GithubSyncSettings) => call<NativeGithubStatus>("github_configure", { ...settings }),
  startAuthorization: () => call<NativeAuthorization>("github_start_authorization"),
  pollAuthorization: () => call<NativeAuthorizationPoll>("github_poll_authorization"),
  cancelAuthorization: () => call<void>("github_cancel_authorization"),
  prepareRepository: () => call<NativeRepositoryPreparation>("github_prepare_repository"),
  async readRemote(): Promise<NativeRemote> {
    const result = await call<NativeRemote>("github_read_remote");
    return { head: result.head, base: result.base === null ? null : parseSyncSnapshot(result.base), remote: result.remote === null ? null : parseSyncSnapshot(result.remote) };
  },
  async publish(expectedHead: string, workspace: SyncWorkspace): Promise<NativePublication> {
    const result = await call<NativePublication>("github_publish", { expectedHead, workspace: toSyncWorkspace(workspace) });
    return { head: result.head, snapshot: parseSyncSnapshot(result.snapshot) };
  },
  checkpoint: (head: string, snapshot: SyncSnapshot) => call<void>("github_checkpoint", { head, snapshot: parseSyncSnapshot(snapshot) }),
  disconnect: () => call<NativeGithubStatus>("github_disconnect"),
};

/** Only public GitHub URLs supplied by the native authorization flow may be opened. */
export async function openGithubPage(value: string, kind: "authorization" | "installation", appSlug: string) {
  const url = new URL(value);
  const expected = kind === "authorization" ? "/login/device" : `/apps/${appSlug}/installations/new`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.pathname !== expected || url.search || url.hash) {
    throw new Error("GitHub 授权地址异常");
  }
  await openLink(url.href);
}
