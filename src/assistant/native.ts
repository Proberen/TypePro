import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { AiEvent, AiMessage, AiResponse } from "./types";

function available() {
  if (!isTauri()) throw new Error("请在 TypePro 应用中连接 AI 模型");
}

export const aiNative = {
  async keyStatus(providerId: string, baseUrl: string) {
    available();
    return invoke<boolean>("ai_key_status", { providerId, baseUrl });
  },
  async saveKey(providerId: string, baseUrl: string, key: string) {
    available();
    await invoke("ai_configure_key", { providerId, baseUrl, key });
  },
  async removeKey(providerId: string) {
    available();
    await invoke("ai_remove_key", { providerId });
  },
  async models(providerId: string, baseUrl: string) {
    available();
    return invoke<{ id: string; name?: string }[]>("ai_models", { providerId, baseUrl });
  },
  async chat(
    request: { requestId: string; providerId: string; baseUrl: string; model: string; messages: AiMessage[]; tools?: unknown[]; thinking?: boolean },
    onDelta: (event: AiEvent) => void,
    signal: AbortSignal,
  ): Promise<AiResponse> {
    available();
    if (signal.aborted) throw new DOMException("会话已停止", "AbortError");
    const onEvent = new Channel<AiEvent>();
    onEvent.onmessage = event => { if (!signal.aborted) onDelta(event); };
    let rejectAbort: (reason: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = () => {
      void invoke("ai_cancel", { requestId: request.requestId }).catch(() => {});
      rejectAbort(new DOMException("会话已停止", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await Promise.race([invoke<AiResponse>("ai_chat", { request, onEvent }), stopped]);
      if (signal.aborted) throw new DOMException("会话已停止", "AbortError");
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
      onEvent.onmessage = () => {};
    }
  },
};
