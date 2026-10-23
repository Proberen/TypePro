//! AI transport is native-only. Plugins receive responses, never credentials.
use crate::ai_secrets::{self, Credential};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, AppHandle, State, WebviewWindow};

type Result<T> = std::result::Result<T, String>;
const MAX_INPUT: usize = 16 * 1024 * 1024;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_EVENT: usize = 1024 * 1024;
const MAX_WIRE: usize = 64 * 1024 * 1024;
const CANCEL_TTL: Duration = Duration::from_secs(300);
const MAX_CANCELLATIONS: usize = 256;

#[derive(Default)]
struct RequestState {
    active: HashMap<String, tokio::task::AbortHandle>,
    cancelled: HashMap<String, Instant>,
}

impl RequestState {
    fn expire_cancellations(&mut self, now: Instant) {
        self.cancelled
            .retain(|_, cancelled_at| now.duration_since(*cancelled_at) < CANCEL_TTL);
    }

    fn cancel(&mut self, request_id: String, now: Instant) {
        self.expire_cancellations(now);
        if let Some(handle) = self.active.get(&request_id) {
            handle.abort();
        }
        if self.cancelled.len() >= MAX_CANCELLATIONS {
            if let Some(oldest) = self
                .cancelled
                .iter()
                .min_by_key(|(_, cancelled_at)| **cancelled_at)
                .map(|(id, _)| id.clone())
            {
                self.cancelled.remove(&oldest);
            }
        }
        // The cancel command may be dispatched before the chat command.
        self.cancelled.insert(request_id, now);
    }
}

pub struct AiService {
    client: Result<Client>,
    requests: Mutex<RequestState>,
}

impl AiService {
    pub fn new() -> Self {
        Self {
            client: make_client(),
            requests: Mutex::new(RequestState::default()),
        }
    }
    fn client(&self) -> Result<Client> {
        self.client.as_ref().cloned().map_err(Clone::clone)
    }
}

fn make_client() -> Result<Client> {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| "无法初始化 AI TLS 连接")?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Client::builder()
        .tls_backend_preconfigured(tls)
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("TypePro-AI/1")
        .build()
        .map_err(|_| "无法初始化 AI 网络连接".into())
}

fn access(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err("窗口无权访问 AI".into());
    }
    Ok(())
}

fn identifier(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(format!("{label}无效"));
    }
    Ok(())
}

fn endpoint(value: &str) -> Result<String> {
    if value.len() > 2048
        || value.trim() != value
        || value.contains('\\')
        || value.chars().any(char::is_control)
    {
        return Err("AI 接口地址无效".into());
    }
    let mut url = Url::parse(value).map_err(|_| "AI 接口地址无效")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("AI 接口必须使用不含账号、查询参数或片段的 HTTPS 地址".into());
    }
    // A key is bound to this full canonical base, including any /v1 prefix.
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn credential(app: &AppHandle, provider_id: &str, base_url: &str) -> Result<Credential> {
    identifier(provider_id, "模型服务 id")?;
    let value = ai_secrets::load(app, provider_id)?.ok_or("请先在本设备填写 AI Key")?;
    if value.base_url != base_url {
        return Err("AI 接口地址已变更，请在本设备为新地址重新填写 Key".into());
    }
    Ok(value)
}

#[tauri::command]
pub fn ai_configure_key(
    window: WebviewWindow,
    app: AppHandle,
    provider_id: String,
    base_url: String,
    key: String,
) -> Result<()> {
    access(&window)?;
    identifier(&provider_id, "模型服务 id")?;
    let base_url = endpoint(&base_url)?;
    if key.is_empty() || key.len() > 8192 || !key.bytes().all(|b| (33..=126).contains(&b)) {
        return Err("API Key 不能为空，且不能包含空白或控制字符".into());
    }
    ai_secrets::save(&app, &provider_id, &Credential { base_url, key })
}

#[tauri::command]
pub fn ai_key_status(
    window: WebviewWindow,
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<bool> {
    access(&window)?;
    identifier(&provider_id, "模型服务 id")?;
    let base_url = endpoint(&base_url)?;
    Ok(ai_secrets::load(&app, &provider_id)?.is_some_and(|value| value.base_url == base_url))
}

#[tauri::command]
pub fn ai_remove_key(window: WebviewWindow, app: AppHandle, provider_id: String) -> Result<()> {
    access(&window)?;
    identifier(&provider_id, "模型服务 id")?;
    ai_secrets::remove(&app, &provider_id)
}

#[derive(Serialize)]
pub struct AiModel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

fn http_error(status: StatusCode) -> Result<()> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status.as_u16() {
        401 | 403 => "AI Key 无效或没有所选模型的权限，请检查本设备的配置",
        402 => "AI 服务余额不足，请检查服务账户",
        404 => "AI 接口或模型不存在，请检查服务地址与模型名称",
        413 => "会话内容超过 AI 服务的请求限制，请新建会话或减少引用",
        429 => "AI 请求频率或额度受限，请稍后再试",
        500..=599 => "AI 服务暂不可用，请稍后再试",
        300..=399 => "AI 接口返回了重定向，请直接配置最终 HTTPS 地址",
        _ => "AI 请求被服务拒绝，请检查模型、上下文长度和工具支持",
    }
    .into())
}

fn connection_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "AI 连接超时，请稍后重试"
    } else {
        "无法连接 AI 服务，请检查网络与接口地址"
    }
    .into()
}

async fn read_json(mut response: reqwest::Response, limit: usize) -> Result<Value> {
    http_error(response.status())?;
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("AI 响应超过容量限制".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(connection_error)? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("AI 响应超过容量限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "AI 服务返回了无法读取的数据".into())
}

#[tauri::command]
pub async fn ai_models(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, AiService>,
    provider_id: String,
    base_url: String,
) -> Result<Vec<AiModel>> {
    access(&window)?;
    let base_url = endpoint(&base_url)?;
    let secret = credential(&app, &provider_id, &base_url)?;
    let response = service
        .client()?
        .get(format!("{base_url}/models"))
        .bearer_auth(&secret.key)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(connection_error)?;
    let value = read_json(response, MAX_EVENT).await?;
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or("AI 模型列表格式无效")?;
    if models.len() > 1000 {
        return Err("AI 模型列表超过容量限制".into());
    }
    models
        .iter()
        .map(|item| {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .ok_or("AI 模型 id 无效")?;
            short_text(id, 200, "模型 id")?;
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| name.len() <= 200)
                .map(str::to_owned);
            Ok(AiModel {
                id: id.into(),
                name,
            })
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRequest {
    request_id: String,
    provider_id: String,
    base_url: String,
    model: String,
    messages: Vec<Value>,
    #[serde(default)]
    tools: Vec<Value>,
    thinking: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AiEvent {
    Delta { text: String },
    Reasoning { text: String },
    Done,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[derive(Default, Serialize)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}
#[derive(Serialize)]
pub struct ToolCall {
    pub id: String,
    pub r#type: &'static str,
    pub function: ToolFunction,
}

fn short_text(value: &str, limit: usize, label: &str) -> Result<()> {
    if value.is_empty() || value.len() > limit || value.chars().any(char::is_control) {
        return Err(format!("{label}无效"));
    }
    Ok(())
}

fn message_shape(value: &Value) -> Result<()> {
    let object = value.as_object().ok_or("会话消息格式无效")?;
    let role = value
        .get("role")
        .and_then(Value::as_str)
        .ok_or("会话角色无效")?;
    if !matches!(role, "system" | "user" | "assistant" | "tool")
        || object.keys().any(|key| {
            ![
                "role",
                "content",
                "tool_calls",
                "tool_call_id",
                "name",
                "reasoning_content",
            ]
            .contains(&key.as_str())
        })
    {
        return Err("会话消息含不支持的字段或角色".into());
    }
    if !value
        .get("content")
        .is_some_and(|content| content.is_string() || (role == "assistant" && content.is_null()))
    {
        return Err("会话消息只支持文字内容".into());
    }
    if let Some(reasoning) = value.get("reasoning_content") {
        if role != "assistant" || !reasoning.is_string() {
            return Err("会话思考内容格式无效".into());
        }
    }
    if role == "tool" {
        short_text(
            value
                .get("tool_call_id")
                .and_then(Value::as_str)
                .ok_or("工具结果缺少调用 id")?,
            200,
            "工具调用 id",
        )?;
    }
    if let Some(calls) = value.get("tool_calls") {
        let calls = calls
            .as_array()
            .filter(|calls| calls.len() <= 64)
            .ok_or("工具调用格式无效")?;
        if role != "assistant" {
            return Err("工具调用必须由 assistant 发起".into());
        }
        for call in calls {
            if call.get("type").and_then(Value::as_str) != Some("function") {
                return Err("不支持的工具调用类型".into());
            }
            short_text(
                call.get("id")
                    .and_then(Value::as_str)
                    .ok_or("工具调用缺少 id")?,
                200,
                "工具调用 id",
            )?;
            short_text(
                call.pointer("/function/name")
                    .and_then(Value::as_str)
                    .ok_or("工具调用缺少名称")?,
                64,
                "工具名称",
            )?;
            if call
                .pointer("/function/arguments")
                .and_then(Value::as_str)
                .is_none()
            {
                return Err("工具调用参数必须为 JSON 字符串".into());
            }
        }
    }
    Ok(())
}

fn request_body(request: &AiRequest) -> Result<(String, Value)> {
    identifier(&request.request_id, "请求 id")?;
    identifier(&request.provider_id, "模型服务 id")?;
    let base_url = endpoint(&request.base_url)?;
    short_text(&request.model, 200, "模型 id")?;
    if request.messages.is_empty() || request.messages.len() > 512 || request.tools.len() > 64 {
        return Err("会话消息或工具数量超过限制".into());
    }
    for message in &request.messages {
        message_shape(message)?;
    }
    for tool in &request.tools {
        if tool.get("type").and_then(Value::as_str) != Some("function")
            || !tool
                .pointer("/function/parameters")
                .is_some_and(Value::is_object)
        {
            return Err("工具定义格式无效".into());
        }
        short_text(
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .ok_or("工具缺少名称")?,
            64,
            "工具名称",
        )?;
    }
    let mut body = json!({ "model": request.model, "messages": request.messages, "stream": true });
    if !request.tools.is_empty() {
        body["tools"] = json!(request.tools);
    }
    if let Some(enabled) = request.thinking {
        body["thinking"] = json!({ "type": if enabled { "enabled" } else { "disabled" } });
    }
    if serde_json::to_vec(&body)
        .map_err(|_| "无法编码 AI 请求")?
        .len()
        > MAX_INPUT
    {
        return Err("会话内容超过 16 MB，请新建会话或减少引用".into());
    }
    Ok((base_url, body))
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    data: Vec<String>,
    event_size: usize,
    wire_size: usize,
}

impl SseDecoder {
    fn line(&mut self, line: &[u8], emit: &mut impl FnMut(&str) -> Result<()>) -> Result<()> {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let line = std::str::from_utf8(line).map_err(|_| "AI 流式响应不是有效 UTF-8")?;
        if line.is_empty() {
            if !self.data.is_empty() {
                emit(&self.data.join("\n"))?;
                self.data.clear();
                self.event_size = 0;
            }
        } else if let Some(data) = line.strip_prefix("data:") {
            let data = data.strip_prefix(' ').unwrap_or(data);
            self.event_size = self.event_size.saturating_add(data.len() + 1);
            if self.event_size > MAX_EVENT {
                return Err("AI 单条流式响应超过容量限制".into());
            }
            self.data.push(data.into());
        }
        Ok(())
    }
    fn push(&mut self, chunk: &[u8], emit: &mut impl FnMut(&str) -> Result<()>) -> Result<()> {
        self.wire_size = self.wire_size.saturating_add(chunk.len());
        if self.wire_size > MAX_WIRE {
            return Err("AI 流式响应超过容量限制".into());
        }
        self.buffer.extend_from_slice(chunk);
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            if position > MAX_EVENT {
                return Err("AI 单条流式响应超过容量限制".into());
            }
            let mut line: Vec<u8> = self.buffer.drain(..=position).collect();
            line.pop();
            self.line(&line, emit)?;
        }
        if self.buffer.len() > MAX_EVENT {
            return Err("AI 单条流式响应超过容量限制".into());
        }
        Ok(())
    }
    fn finish(&mut self, emit: &mut impl FnMut(&str) -> Result<()>) -> Result<()> {
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.line(&line, emit)?;
        }
        self.line(b"", emit)
    }
}

#[derive(Default)]
struct PendingCall {
    id: String,
    name: String,
    arguments: String,
}
#[derive(Default)]
struct Completion {
    response: AiResponse,
    calls: BTreeMap<u64, PendingCall>,
    output_size: usize,
    done: bool,
}

impl Completion {
    fn event(&mut self, data: &str, emit: &mut impl FnMut(AiEvent) -> Result<()>) -> Result<()> {
        if self.done {
            return Ok(());
        }
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).map_err(|_| "AI 流式响应格式无效")?;
        if value.get("error").is_some() {
            return Err("AI 服务返回错误，请检查模型、额度和上下文长度".into());
        }
        let choices = value
            .get("choices")
            .and_then(Value::as_array)
            .ok_or("AI 流式响应缺少 choices")?;
        for choice in choices {
            if choice.get("index").and_then(Value::as_u64).unwrap_or(0) != 0 {
                continue;
            }
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                short_text(reason, 64, "AI 完成状态")?;
                if reason == "content_filter" {
                    return Err("AI 服务拒绝了本次内容".into());
                }
                self.response.finish_reason = Some(reason.into());
            }
            let Some(delta) = choice.get("delta").filter(|delta| delta.is_object()) else {
                continue;
            };
            for (field, reasoning) in [("content", false), ("reasoning_content", true)] {
                if let Some(text) = delta
                    .get(field)
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                {
                    self.output_size = self.output_size.saturating_add(text.len());
                    if self.output_size > MAX_OUTPUT {
                        return Err("AI 回复超过 16 MB 限制".into());
                    }
                    if reasoning {
                        self.response
                            .reasoning_content
                            .get_or_insert_with(String::new)
                            .push_str(text);
                        emit(AiEvent::Reasoning { text: text.into() })?;
                    } else {
                        self.response.content.push_str(text);
                        emit(AiEvent::Delta { text: text.into() })?;
                    }
                }
            }
            if let Some(calls) = delta.get("tool_calls") {
                let calls = calls.as_array().ok_or("AI 工具调用格式无效")?;
                for call in calls {
                    if call
                        .get("type")
                        .is_some_and(|kind| kind.as_str() != Some("function"))
                    {
                        return Err("AI 返回了不支持的工具类型".into());
                    }
                    let index = call
                        .get("index")
                        .and_then(Value::as_u64)
                        .filter(|index| *index < 64)
                        .ok_or("AI 工具调用索引无效")?;
                    let pending = self.calls.entry(index).or_default();
                    for (field, target) in [
                        ("/id", &mut pending.id),
                        ("/function/name", &mut pending.name),
                        ("/function/arguments", &mut pending.arguments),
                    ] {
                        if let Some(part) = call.pointer(field).and_then(Value::as_str) {
                            self.output_size = self.output_size.saturating_add(part.len());
                            if self.output_size > MAX_OUTPUT {
                                return Err("AI 回复超过 16 MB 限制".into());
                            }
                            target.push_str(part);
                        }
                    }
                    if pending.id.len() > 200
                        || pending.name.len() > 64
                        || pending.arguments.len() > MAX_EVENT
                    {
                        return Err("AI 工具调用超过容量限制".into());
                    }
                }
            }
        }
        Ok(())
    }
    fn finish(mut self) -> Result<AiResponse> {
        if !self.done && self.response.finish_reason.is_none() {
            return Err("AI 连接中断，回复未完成，请重试".into());
        }
        if !self.calls.is_empty() {
            if self.response.finish_reason.as_deref() == Some("length") {
                return Err("AI 工具调用被长度限制截断，请重试或减少上下文".into());
            }
            let calls = self
                .calls
                .into_values()
                .map(|call| {
                    short_text(&call.id, 200, "AI 工具调用 id")?;
                    short_text(&call.name, 64, "AI 工具名称")?;
                    if !serde_json::from_str::<Value>(&call.arguments)
                        .is_ok_and(|value| value.is_object())
                    {
                        return Err("AI 工具参数不是有效 JSON 对象，请重试".into());
                    }
                    Ok(ToolCall {
                        id: call.id,
                        r#type: "function",
                        function: ToolFunction {
                            name: call.name,
                            arguments: call.arguments,
                        },
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            let ids: std::collections::HashSet<&str> =
                calls.iter().map(|call| call.id.as_str()).collect();
            if ids.len() != calls.len() {
                return Err("AI 返回了重复的工具调用 id，请重试".into());
            }
            self.response.tool_calls = Some(calls);
        }
        Ok(self.response)
    }
}

async fn stream(
    client: Client,
    base_url: String,
    key: String,
    body: Value,
    channel: Channel<AiEvent>,
) -> Result<AiResponse> {
    let mut response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(&key)
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(connection_error)?;
    http_error(response.status())?;
    if response
        .content_length()
        .is_some_and(|n| n > MAX_WIRE as u64)
    {
        return Err("AI 响应超过容量限制".into());
    }
    let mut decoder = SseDecoder::default();
    let mut completion = Completion::default();
    let mut send = |event| channel.send(event).map_err(|_| "AI 会话已关闭".to_string());
    while let Some(chunk) = response.chunk().await.map_err(connection_error)? {
        decoder.push(&chunk, &mut |data| completion.event(data, &mut send))?;
        if completion.done {
            break;
        }
    }
    if !completion.done {
        decoder.finish(&mut |data| completion.event(data, &mut send))?;
    }
    let response = completion.finish()?;
    send(AiEvent::Done)?;
    Ok(response)
}

#[tauri::command]
pub async fn ai_chat(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, AiService>,
    request: AiRequest,
    on_event: Channel<AiEvent>,
) -> Result<AiResponse> {
    access(&window)?;
    let (base_url, body) = request_body(&request)?;
    let secret = credential(&app, &request.provider_id, &base_url)?;
    let client = service.client()?;
    let handle = {
        let mut requests = service
            .requests
            .lock()
            .map_err(|_| "AI 请求状态不可用，请重启应用")?;
        requests.expire_cancellations(Instant::now());
        if requests.cancelled.contains_key(&request.request_id) {
            return Err("AI 请求已停止或会话已关闭".into());
        }
        if requests.active.contains_key(&request.request_id) {
            return Err("AI 请求 id 已存在".into());
        }
        if requests.active.len() >= 4 {
            return Err("同时最多运行 4 个 AI 请求，请先停止其他会话".into());
        }
        let handle =
            tauri::async_runtime::spawn(stream(client, base_url, secret.key, body, on_event));
        requests
            .active
            .insert(request.request_id.clone(), handle.inner().abort_handle());
        handle
    };
    let result = handle.await;
    if let Ok(mut requests) = service.requests.lock() {
        requests.active.remove(&request.request_id);
    }
    result.map_err(|_| "AI 请求已停止或会话已关闭".to_string())?
}

#[tauri::command]
pub fn ai_cancel(
    window: WebviewWindow,
    service: State<'_, AiService>,
    request_id: String,
) -> Result<()> {
    access(&window)?;
    identifier(&request_id, "请求 id")?;
    let mut requests = service
        .requests
        .lock()
        .map_err(|_| "AI 请求状态不可用，请重启应用")?;
    requests.cancel(request_id, Instant::now());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_survives_command_dispatch_race_and_expires() {
        let mut requests = RequestState::default();
        let now = Instant::now();
        requests.cancel("before-chat".into(), now);
        assert!(requests.cancelled.contains_key("before-chat"));
        requests.expire_cancellations(now + CANCEL_TTL);
        assert!(requests.cancelled.is_empty());
    }

    #[test]
    fn early_cancellation_memory_is_bounded() {
        let mut requests = RequestState::default();
        let now = Instant::now();
        for index in 0..MAX_CANCELLATIONS + 1 {
            requests.cancel(index.to_string(), now + Duration::from_millis(index as u64));
        }
        assert_eq!(requests.cancelled.len(), MAX_CANCELLATIONS);
        assert!(!requests.cancelled.contains_key("0"));
        assert!(requests
            .cancelled
            .contains_key(&MAX_CANCELLATIONS.to_string()));
    }

    #[test]
    fn endpoint_preserves_prefix_and_rejects_credential_routes() {
        assert_eq!(
            endpoint("https://api.deepseek.com/").unwrap(),
            "https://api.deepseek.com"
        );
        assert_eq!(
            endpoint("https://EXAMPLE.com:443/v1///").unwrap(),
            "https://example.com/v1"
        );
        for value in [
            "http://example.com",
            "https://user@example.com",
            "https://example.com?key=x",
            "https://example.com/#x",
            "https://example.com\\x",
            " https://example.com",
        ] {
            assert!(endpoint(value).is_err(), "{value}");
        }
    }

    #[test]
    fn sse_handles_utf8_and_json_split_across_every_byte() {
        let input = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        let mut decoder = SseDecoder::default();
        let mut completion = Completion::default();
        let mut events = Vec::new();
        for byte in input.bytes() {
            decoder
                .push(&[byte], &mut |data| {
                    completion.event(data, &mut |event| {
                        events.push(event);
                        Ok(())
                    })
                })
                .unwrap();
        }
        decoder
            .finish(&mut |data| completion.event(data, &mut |_| Ok(())))
            .unwrap();
        assert_eq!(completion.finish().unwrap().content, "你好");
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn tools_accumulate_arguments_and_retain_reasoning() {
        let mut completion = Completion::default();
        for delta in [
            json!({"reasoning_content":"先搜索", "tool_calls":[{"index":0,"id":"call-1","function":{"name":"search_notes","arguments":"{\"q\":"}}]}),
            json!({"tool_calls":[{"index":0,"function":{"arguments":"\"计划\"}"}}]}),
        ] {
            completion
                .event(
                    &json!({"choices":[{"index":0,"delta":delta}]}).to_string(),
                    &mut |_| Ok(()),
                )
                .unwrap();
        }
        completion
            .event(
                &json!({"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]})
                    .to_string(),
                &mut |_| Ok(()),
            )
            .unwrap();
        let response = completion.finish().unwrap();
        assert_eq!(response.reasoning_content.as_deref(), Some("先搜索"));
        let call = &response.tool_calls.unwrap()[0];
        assert_eq!(call.id, "call-1");
        assert_eq!(call.function.arguments, "{\"q\":\"计划\"}");
    }

    #[test]
    fn rejects_truncated_stream_and_invalid_tool_json() {
        let mut completion = Completion::default();
        completion
            .event(
                &json!({"choices":[{"delta":{"content":"部分"}}]}).to_string(),
                &mut |_| Ok(()),
            )
            .unwrap();
        assert!(completion.finish().is_err());
        let mut completion = Completion::default();
        completion.event(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"read_note","arguments":"{"}}]},"finish_reason":"tool_calls"}]}).to_string(), &mut |_| Ok(())).unwrap();
        assert!(completion.finish().is_err());
    }

    #[test]
    fn sse_rejects_large_frames_and_wrong_encoding() {
        let mut decoder = SseDecoder::default();
        assert!(decoder
            .push(&vec![b'x'; MAX_EVENT + 1], &mut |_| Ok(()))
            .is_err());
        assert!(SseDecoder::default()
            .push(&[0xff, b'\n'], &mut |_| Ok(()))
            .is_err());
    }

    #[test]
    fn validates_messages_and_thinking_without_model_aliases() {
        let request = AiRequest {
            request_id: "request-1".into(),
            provider_id: "deepseek".into(),
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-flash".into(),
            messages: vec![json!({"role":"user","content":"你好"})],
            tools: vec![],
            thinking: Some(true),
        };
        let (base, body) = request_body(&request).unwrap();
        assert_eq!(base, "https://api.deepseek.com");
        assert_eq!(body["thinking"]["type"], "enabled");
        assert!(message_shape(&json!({"role":"tool","content":"a"})).is_err());
        assert!(message_shape(&json!({"role":"user","content":[],"apiKey":"x"})).is_err());
        assert!(message_shape(
            &json!({"role":"assistant","content":null,"reasoning_content":"想法","tool_calls":[]})
        )
        .is_ok());
    }

    #[test]
    fn service_errors_never_include_remote_body_or_key() {
        for code in [301, 400, 401, 402, 403, 404, 413, 429, 500] {
            let error = http_error(StatusCode::from_u16(code).unwrap()).unwrap_err();
            assert!(!error.contains("sk-"));
            assert!(!error.contains("http"));
        }
    }
}
