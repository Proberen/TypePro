export interface AssistantNote {
  id: string;
  title: string;
  markdown: string;
  updatedAt: string;
}

export interface AssistantNotebook {
  id: string;
  name: string;
  documents: { id: string; title: string; updatedAt: string }[];
}

export interface AssistantAdapter {
  listNotes(): AssistantNotebook[];
  readNote(id: string): AssistantNote | null;
  activeNote(): AssistantNote | null;
  createNote(bookId: string, title: string, markdown: string): Promise<unknown>;
  updateNote(id: string, markdown: string, expectedMarkdown: string): Promise<unknown>;
  getData(key: string): unknown;
  listData(prefix: string): { key: string; value: unknown }[];
  setData(key: string, value: unknown): Promise<void>;
}

export interface AssistantSettings {
  provider: "deepseek" | "custom";
  baseUrl: string;
  model: string;
  systemPrompt: string;
  thinking: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  skillId?: string;
  deleted?: boolean;
}

export interface NoteSource { id: string; title: string }
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status?: "complete" | "stopped" | "error";
  sources?: NoteSource[];
}

export interface AssistantSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  references: { path: string; text: string }[];
  builtin?: boolean;
  deleted?: boolean;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface AiEvent { type: "delta" | "reasoning" | "done"; text?: string }
export interface AiResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
}

export interface WriteProposal {
  kind: "create" | "update";
  title: string;
  before: string;
  after: string;
}
