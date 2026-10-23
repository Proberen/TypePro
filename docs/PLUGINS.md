# 自定义插件

插件用于添加笔记命令、编辑操作、纯文字面板，以及 API 2 的同步存储、首页打卡组件和 AI 页面。插件代码只在本机沙箱运行，没有直接联网能力；应用宿主负责公开市场下载和获准的 AI 请求。此 API 不兼容 Obsidian 插件。内置 Markdown 编辑器为受信任模块；第三方插件使用独立沙箱。

## 安装与启停

在「插件 → 插件市场」搜索、查看版本与权限，再确认安装。进入市场立即获取目录，支持手动刷新；市场页面在前台打开时每 60 秒检查，隐藏、离开市场或关闭窗口后停止。网络和 GitHub 缓存可能延迟目录更新，已安装插件离线时继续可用。

新安装的插件默认停用，进入「已安装」点击「启用」，确认「允许并启用」后才执行。市场更新需要用户手动确认，不自动替换代码，也不降级。更新未新增权限时保留原启用状态；新增权限时先停用，重新确认权限后才能启用。下载或校验失败保留旧插件；保存失败会恢复旧插件列表并尝试回写，存储持续不可写时显示错误。

「导入插件」继续支持两种本地格式：

- ZIP 根目录包含 `manifest.json` 和 `main.js`。
- JSON 对象 `{ "manifest": { ... }, "code": "...JavaScript..." }`。

本地导入同样默认停用，相同 id 仍需先移除旧版再导入；市场安装支持上述更新流程。停用或移除会终止运行环境并清除命令、面板、首页组件、AI 页面和事件订阅。安装包最多 2 MiB，脚本最多 512 KiB，最多安装 24 个插件。

应用在本地保存插件代码与启用状态，重启后恢复已启用插件。开启 GitHub 同步后，安装清单、版本、卸载操作和 API 2 存储数据进入私有笔记仓库；市场插件保存不可变版本的下载地址、大小和 SHA-256，本地导入插件保存 Manifest 与代码。新设备自动恢复对应版本，但默认停用，首次运行需在该设备确认权限。已有完全相同的本地代码保留本地启用选择；同步带来的版本或权限变化先停用。恢复失败保留原安装并显示错误，卸载同步只移除安装，不清空数据。

启用状态和权限决定不跨设备同步；笔记 ZIP 不包含安装清单、代码或插件数据。API Key 也不属于插件存储，由宿主在本设备安全保存。首次同步插件数据前，Mac 和 Android 都应升级到 1.5.0，旧版不能读取扩展后的远端清单。市场仅连接 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins) 的公开清单与 Release，不接触私有笔记或同步令牌；发布步骤见 [插件市场](MARKET.md)。

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

`id` 以小写字母开头，由小写字母、数字、点、短横线或下划线组成，长度 3–64。名称为 1–60 个字符，说明可选且最多 300 个字符。版本使用 `1.0.0` 或 `1.0.0-beta.1`。TypePro 1.5.0 支持 `apiVersion: 1` 和 `2`，旧 API 保持可用；新增的 `storage`、`home.activity`、`assistant` 权限必须声明 API 2。API 1 声明新权限或声明未知权限都会拒绝安装。API 2 插件不能安装到 1.4.x。

市场发布和更新采用严格语义版本（最多 40 个字符，不含 `+` 构建标记）：数字段不含多余前导零，预发布段不为空；例如 `01.0.0`、`1.0.0-rc.01`、`1.0.0-a..b` 不接受。本地 ZIP／JSON 导入沿用原有版本校验；旧插件版本不能严格排序时，不提供市场更新，原插件仍可使用。

| 权限 | 允许的 API |
| --- | --- |
| `notes.read` | 列出笔记、读取正文、订阅文档变化 |
| `notes.write` | 在已有笔记本中创建文档，替换已有文档的 Markdown 正文 |
| `editor.insert` | 向当前文档插入文字 |
| `commands` | 在工具菜单中注册命令 |
| `panels` | 显示、更新和关闭纯文字面板 |
| `storage`（API 2） | 保存、查询和删除当前插件的可同步 JSON 数据 |
| `home.activity`（API 2） | 注册宿主采集人工编辑的首页热力图；同时需要 `storage` |
| `assistant`（API 2） | 注册、打开宿主 AI 会话页；注册同时需要 `storage`、`notes.read` |

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

## API 2：同步存储与宿主页面

以下方法也返回 Promise，数据按 Manifest 的插件 id 隔离，不可访问其他插件的空间。新数据先保存本地，再随现有 GitHub 笔记同步传输；未连接 GitHub 时仍可离线使用。

```js
// apiVersion: 2，permissions 包含 storage。
await notebook.storage.set('settings', { color: 'blue', enabled: true });
const settings = await notebook.storage.get('settings'); // 未设置或已删除时返回 null。
const entries = await notebook.storage.list('activity.'); // [{ key, value }]，省略前缀则列出全部。
await notebook.storage.remove('settings'); // 保存同步删除标记。

// permissions: ['storage', 'home.activity']。
await notebook.home.activity.register('daily', { title: '每日打卡' });

// permissions 至少包含 ['storage', 'assistant', 'notes.read']；
// 创建/修改文档另外需要 notes.write，菜单命令另外需要 commands。
await notebook.pages.assistant.register('assistant', {
  title: 'AI 助手',
  systemPrompt: '你是笔记助手。按需读取笔记，标注来源，写入前等待确认。',
});
await notebook.commands.register('open-assistant', 'AI 助手', async () => {
  await notebook.pages.open('assistant');
});
```

存储键为 1–128 位字母、数字、点、短横线或下划线，以字母或数字开头；`__proto__`、`prototype`、`constructor` 为保留值。存储内容必须是有限数字、字符串、布尔、null、数组或普通对象组成的 JSON，不能包含函数、循环引用、undefined 或上述保留对象字段；嵌套最多 64 层。所有插件合计最多 32 MiB、20000 条数据及 128 条安装记录（含删除记录）。不要将凭据放进此 API：内容会同步到有权读取的私有仓库，不是安全密钥库。

同一数据键并发修改按 `updatedAt` 决定，时间相同时由 `deviceId` 及规范化内容确定唯一结果；删除通过显式标记传播。需要跨设备保留多份记录时应拆成独立键，不把持续增长的全部历史放在一个值中。每个插件最多注册一个打卡组件、两个 AI 页面；标题最多 60 字符，系统提示词最多 20000 字符。页面由宿主绘制，不接受自定义 HTML 或任意渲染代码。

## 每日打卡

`notebook.daily-checkin` 是 API 2 插件。启用后由宿主记录人工编辑，不依赖插件自行解析全文。首页以近一年热力图展示，点击某天可查看该天各文档的 `+新增／−删除` 字数；按编辑设备的本地日期归属，字数按正文 Unicode 字符计算，排除空白与 Markdown 标记。启用前的历史不会回填。

自动保存不会重复记数，导入、同步及 AI／插件自动写入不计入。可识别的编辑撤销抵消原编辑日期的计数，重做恢复；编辑历史为内存中有界记录，应用重启、外部写入或历史淘汰后不能追溯旧撤销。数据按 `activity.<日期>.<文档UUID>.<设备UUID>` 分开保存，值为 `{day,documentId,title,added,removed}`；Mac 与 Android 同步后按日期汇总，避免两台设备互相覆盖计数。

## AI 助手

`notebook.ai-assistant` 注册宿主会话页。支持 DeepSeek 和用户自定义的 HTTPS OpenAI-compatible 接口；模型列表从服务端获取，可手填模型 id，不把固定模型名当成完整列表。API Key 在本设备单独填写，只由原生 AI 客户端调用；Mac 使用钥匙串，Android 使用 Keystore 保护的加密存储，插件脚本无法读取。Key 按服务 id 与完整接口地址绑定，改地址后必须重新填写，防止同步配置把既有 Key 发往新地址。

会话可浏览、搜索所有本地笔记并读取当前文档，默认不一次上传整个笔记库。实际读取到的正文、搜索片段、会话与选中 Skill 的指令会发送给所选模型。内置工具是 `list_notes`、`search_notes`、`read_note`、`read_current_note`、`create_note`、`update_note`、`read_skill_reference`；读工具提供分页，新建只允许已有笔记本，修改只替换正文，不提供删除或任意文件路径工具。

AI 新建和修改文档会展示修改前后差异，用户确认后才写入；替换前必须读取完整正文，确认后正文已变化则停止并要求重新读取。同一轮拒绝的相同修改不会重复请求。此确认机制属于宿主 AI 工具；旧版直接 `notebook.notes.update` 的授权语义不变。

设置支持全局系统提示词；内置笔记问答、总结、润色和周报 Skill。可导入单个 `.md` 或包含一份 `SKILL.md` 的 ZIP，指令按会话选中后加载，文本参考资料通过工具按需读取。ZIP 总量最多 2 MiB、128 个条目，`SKILL.md` 最多 64 KiB；仅保留同目录下的 Markdown、TXT、JSON、YAML、CSV 资料，单份最多 128 KiB。脚本等文件忽略，不执行 Skill 中的程序。笔记、Skill、参考资料和工具返回都视作资料，不作为绕过权限或写入确认的授权。

会话历史、模型设置、全局提示词和导入的 Skill 存在该插件的同步空间，API Key 除外。删除会话也会同步到其他设备。开始会话、停止生成和笔记写入由宿主完成，不受插件初始化或菜单命令的 8／10 秒计时限制。

## 示例

`examples/date-and-count/` 的源码实现「插入日期」命令和当前文档字数面板。`examples/date-and-count.zip` 可直接安装，`examples/date-and-count.json` 为相同源码的 JSON 版本。字数按 Markdown 原文计算，排除空白，包含 Markdown 标记；行数按换行符计算。

把源码目录中两份文件压缩到 ZIP 根目录即可分发，不要把外层目录一起放入 ZIP。示例脚本只依赖上述公开 API。
