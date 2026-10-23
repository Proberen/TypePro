# 自定义插件

插件用于添加笔记命令、编辑操作和纯文字面板。它们只在本机运行，不使用账号、市场或联网能力。此 API 不兼容 Obsidian 插件。内置 Markdown 编辑器为受信任模块；第三方插件使用独立沙箱。

## 安装与启停

在「插件」中选择「导入插件」。支持两种格式：

- ZIP 根目录包含 `manifest.json` 和 `main.js`。
- JSON 对象 `{ "manifest": { ... }, "code": "...JavaScript..." }`。

导入后默认停用。点击「启用」会展示所需权限，确认「允许并启用」后才执行。停用或移除会终止运行环境并清除命令、面板和事件订阅。相同 id 不会静默覆盖；更新时先移除旧版。安装包最多 2 MB，脚本最多 512 KB，最多安装 24 个插件。

应用在本地保存插件代码与启用状态，重启后恢复已启用插件。笔记导出包只包含笔记与附件，不传递插件或授权；另一设备需要单独导入和启用原始插件包。无插件私有存储 API；需要保留的用户内容可在获准后写入普通文档。

## Manifest

```json
{
  "id": "my.date-tool",
  "name": "日期工具",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "向当前文档插入日期。",
  "permissions": ["commands", "editor.insert"]
}
```

`id` 以小写字母开头，由小写字母、数字、点、短横线或下划线组成，长度 3–64。名称为 1–60 个字符，说明可选且最多 300 个字符。版本使用 `1.0.0` 或 `1.0.0-beta.1`。当前仅支持 `apiVersion: 1`，未知权限会拒绝安装。

| 权限 | 允许的 API |
| --- | --- |
| `notes.read` | 列出笔记、读取正文、订阅文档变化 |
| `notes.write` | 在已有笔记本中创建文档，替换已有文档的 Markdown 正文 |
| `editor.insert` | 向当前文档插入文字 |
| `commands` | 在工具菜单中注册命令 |
| `panels` | 显示、更新和关闭纯文字面板 |

只声明必要权限。读取权限覆盖所有本地笔记，写入权限允许覆盖已有正文；用户应只启用自己信任的插件。单次正文上限为 5 MiB 个 JavaScript 字符，单次插入上限为 1 MiB 个字符。面板为文字展示，不支持 HTML、CSS 或自定义 DOM。

## 执行模型

`main.js` 在异步函数中执行，可以直接使用 `await` 和全局 `notebook`。无需打包器或 npm 依赖。顶层代码应在 8 秒内完成初始化，命令应在 10 秒内结束。顶层异常和启动/命令超时会停用插件并显示错误；再次启用可重试。命令回调中的普通异常会向用户显示错误，不终止其他命令。

全部宿主 API 返回 Promise。调用失败会 reject，插件应对可恢复错误使用 `try/catch`。应用会在编辑和文档切换时发送变化事件，事件频率由宿主控制；回调应重新读取当前文档，不依赖事件携带全文。插件重启后需要重新注册命令与事件。

插件不在主窗口执行。宿主创建不含 `allow-same-origin` 的 sandbox iframe；iframe 用外部本地脚本创建 Worker。Worker 中没有 DOM、父窗口或 Tauri API。子页面 CSP 禁止网络连接，Worker 同时移除网络与嵌套 Worker API。消息桥校验 iframe 来源与每次启动的随机 token，宿主对每个请求独立检查权限和参数。无需也不允许主窗口 `eval`。这是能力隔离，不是对任意恶意代码 CPU/内存消耗的绝对防护。

## API

所有文档 id 与笔记本 id 均为宿主分配的字符串。命令和面板 id 以小写字母开头，使用小写字母、数字、点、短横线或下划线，长度 1–64。宿主自动按插件 id 隔离命名空间。

```js
// notes.read：笔记本及文档元信息，不包含正文。
const notebooks = await notebook.notes.list();
// [{ id, name, documents: [{ id, title, updatedAt }] }]

// notes.read：返回 { id, title, markdown, updatedAt }，不存在时返回 null。
const current = await notebook.notes.active();
const document = await notebook.notes.get(documentId);

// notes.write：只替换 Markdown 正文，保留文档 id 和标题。
await notebook.notes.update(documentId, '# 新正文');

// notes.write：目标笔记本必须存在；返回 { id, title, updatedAt }。
const created = await notebook.notes.create(notebookId, '新文档', '# 标题');

// editor.insert：通过当前编辑器插入；未打开文档时 reject。
await notebook.editor.insert('2026-10-20');

// commands：同名 id 更新注册，每插件最多 20 个；label 最多 60 字符。
await notebook.commands.register('insert-date', '插入日期', async () => {
  await notebook.editor.insert(new Date().toLocaleDateString());
});

// panels：同名 id 更新显示，每插件最多 6 个。
// title 最多 60 字符，text 最多 20000 字符。换行保留。
await notebook.panels.set('summary', '摘要', '第一行\n第二行');
await notebook.panels.close('summary');

// notes.read：回调收到 { documentId: string | null }。
const unsubscribe = await notebook.events.onDocumentChange(async ({ documentId }) => {
  const current = await notebook.notes.active();
  // 更新面板或执行自己的计算。
});
await unsubscribe();
```

API 不提供删除文档、重命名笔记本、任意本地文件读写、外部进程、网络或自动安装其他插件的入口。未获准的方法会明确报错。每插件每秒最多接收 120 个调用，避免意外循环耗尽宿主资源。

## 示例

`examples/date-and-count/` 的源码实现「插入日期」命令和当前文档字数面板。`examples/date-and-count.zip` 可直接安装，`examples/date-and-count.json` 为相同源码的 JSON 版本。字数按 Markdown 原文计算，排除空白，包含 Markdown 标记；行数按换行符计算。

把源码目录中两份文件压缩到 ZIP 根目录即可分发，不要把外层目录一起放入 ZIP。示例脚本只依赖上述公开 API。
