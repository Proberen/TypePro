"use strict";

// Credentials live only in this page's memory, never localStorage, cookies or URLs.
const state = { token: "", items: [], expanded: new Set(), request: 0, controller: null };
const $ = (id) => document.getElementById(id);
const encoder = new Intl.DateTimeFormat("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false });

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(kind === "chevron" ? "chevron" : "file-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", kind === "chevron" ? "m9 6 6 6-6 6" : kind === "notebook" ? "M4 5h6l2 2h8v13H4z" : "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h4");
  svg.append(path);
  return svg;
}

function timestamp(value) {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime()) ? encoder.format(parsed).replaceAll("/", "-") : "—";
}

function showError(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function disconnect() {
  state.controller?.abort();
  state.request += 1;
  state.token = "";
  state.items = [];
  state.expanded.clear();
  $("token").value = "";
  $("notes").replaceChildren();
  $("search").value = "";
  $("count").textContent = "";
  $("connect-panel").hidden = false;
  $("notes-panel").hidden = true;
  $("disconnect").hidden = true;
  $("connection-status").textContent = "未连接";
  document.querySelector(".connection").classList.remove("connected");
  $("connect-button").disabled = false;
  $("refresh").disabled = false;
  $("token").focus();
}

async function api(path, signal) {
  const response = await fetch(`/api/v1/${path}`, { headers:{ Authorization:`Bearer ${state.token}` }, cache:"no-store", credentials:"omit", signal });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const error = new Error(response.status === 401 ? "访问令牌无效，请重新连接" : response.status >= 500 ? "服务暂不可用，请稍后重试" : problem?.error?.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function appendMetadata(row, item) {
  for (const key of ["updatedAt", "syncedAt"]) {
    const cell = node("td", "timestamp", timestamp(item[key]));
    if (item[key]) cell.title = item[key];
    row.append(cell);
  }
  const cell = node("td");
  const label = node("span", "source", item.source?.name || item.source?.deviceId || "—");
  label.title = item.source?.deviceId || "";
  cell.append(label);
  row.append(cell);
}

function render() {
  const query = $("search").value.trim().toLocaleLowerCase();
  const books = state.items.filter(item => item.kind === "notebook" && !item.deleted);
  const documents = state.items.filter(item => item.kind === "document" && !item.deleted);
  const children = new Map();
  const latest = new Map();
  for (const item of state.items) {
    const parent = item.kind === "notebook" ? item.id : item.value.notebookId;
    if (!latest.has(parent) || item.syncedAt > latest.get(parent).syncedAt) latest.set(parent, item);
    if (item.kind === "document" && !item.deleted) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item);
    }
  }
  books.sort((a,b) => (latest.get(b.id)?.syncedAt || "").localeCompare(latest.get(a.id)?.syncedAt || ""));
  const fragment = document.createDocumentFragment();
  let visibleBooks = 0;
  for (const book of books) {
    const docs = children.get(book.id) || [];
    docs.sort((a,b) => b.syncedAt.localeCompare(a.syncedAt));
    const bookMatches = book.value.name.toLocaleLowerCase().includes(query);
    const matches = docs.filter(doc => bookMatches || doc.value.title.toLocaleLowerCase().includes(query));
    if (query && !bookMatches && !matches.length) continue;
    visibleBooks += 1;
    const expanded = query !== "" || state.expanded.has(book.id);
    const row = node("tr", "notebook");
    const title = node("td");
    const button = node("button", "book-toggle");
    button.type = "button";
    button.setAttribute("aria-expanded", String(expanded));
    button.append(icon("chevron"), icon("notebook"), node("span", "name", book.value.name), node("span", "doc-count", `${docs.length} 篇`));
    button.addEventListener("click", () => {
      if (expanded) state.expanded.delete(book.id); else state.expanded.add(book.id);
      // A search deliberately exposes matching documents until the query is cleared.
      if (query) $("search").value = "";
      render();
      for (const candidate of $("notes").querySelectorAll(".book-toggle")) {
        if (candidate.dataset.id === book.id) candidate.focus();
      }
    });
    button.dataset.id = book.id;
    title.append(button);
    row.append(title);
    // A notebook row summarizes its most recently received metadata/document change.
    appendMetadata(row, latest.get(book.id) || book);
    fragment.append(row);
    if (expanded) {
      for (const doc of matches) {
        const child = node("tr", "document");
        const nameCell = node("td");
        const name = node("div", "name-cell");
        name.append(icon("document"), node("span", "name", doc.value.title));
        nameCell.append(name);
        child.append(nameCell);
        appendMetadata(child, doc);
        fragment.append(child);
      }
    }
  }
  $("notes").replaceChildren(fragment);
  $("empty").hidden = visibleBooks > 0;
  $("empty-title").textContent = query ? "没有找到匹配的笔记" : "暂无笔记";
  $("empty-copy").textContent = query ? "试试其他关键词" : "设备上传后会显示在这里";
  $("count").textContent = `${books.length} 本笔记 · ${documents.length} 篇文档`;
}

async function refresh(connecting = false) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const request = ++state.request;
  const timeout = setTimeout(() => controller.abort(), 20000);
  $("refresh").disabled = true;
  $("connect-button").disabled = true;
  showError("connect-error", "");
  showError("page-error", "");
  try {
    const [snapshot, info] = await Promise.all([api("snapshot", controller.signal), api("info", controller.signal)]);
    if (request !== state.request) return;
    state.items = snapshot.items;
    render();
    $("connect-panel").hidden = true;
    $("notes-panel").hidden = false;
    $("disconnect").hidden = false;
    $("connection-status").textContent = "已连接";
    document.querySelector(".connection").classList.add("connected");
    $("version").textContent = info.version;
    $("last-refresh").textContent = `刷新于 ${timestamp(new Date().toISOString())}`;
    $("token").value = "";
    $("announcement").textContent = "笔记列表已刷新";
    if (connecting) $("search").focus();
  } catch (error) {
    if (request !== state.request) return;
    const message = error.name === "AbortError" ? "连接超时，请重试" : error instanceof TypeError ? "无法连接服务，请检查网络" : error.message;
    if (error.status === 401 || connecting) {
      disconnect();
      showError("connect-error", message);
    } else showError("page-error", message);
  } finally {
    clearTimeout(timeout);
    if (request === state.request) {
      $("refresh").disabled = false;
      $("connect-button").disabled = false;
    }
  }
}

$("connect-form").addEventListener("submit", event => {
  event.preventDefault();
  state.token = $("token").value.trim();
  refresh(true);
});
$("disconnect").addEventListener("click", disconnect);
$("refresh").addEventListener("click", () => refresh());
$("search").addEventListener("input", render);
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && state.token) {
    event.preventDefault();
    $("search").focus();
  }
});
