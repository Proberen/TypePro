# TypePro 插件开发

## 1.7.0 编辑页侧栏

`ui.register({id, slot: 'editor.sidebar', title, script, styles, icon})` 在正文右侧提供通用插件侧栏。宿主自动生成编辑工具栏按钮，不需要再注册同用途命令；只有打开笔记后可使用。`ui.open(id)` 幂等展开，视图内 `ui.close()` 收起自身；用户再次点击当前图标也可收起。一个侧栏可见，其他插件位置和权限保持原样。完整时序、可见性和设备记忆以 [通用规范](PLUGIN-SPEC.md) 为准。

此槽位需要 TypePro 1.7.0。AI 助手 1.2.0 在旧 API 3 宿主上仅针对未知槽位错误回退 `app.page`，并恢复旧工具入口；支持侧栏的新版宿主不注册独立会话页。沿用 API 3、现有市场目录和同步格式，不给主程序加入业务插件判断。

以下为此前 1.6.0 交付记录，本轮状态见 [构建记录](BUILD.md)。

TypePro 1.6.0 提供 API 3 通用插件宿主，DMG／APK 已生成；每日打卡 1.1.0 已在独立市场发布，AI 助手 1.1.1 的独立样式补丁已由 [Publish plugins #8](https://github.com/Proberen/typepro-plugins/actions/runs/39761719863) 发布，新包已由原生模块真实下载并通过大小／SHA-256 及包结构校验。App 1.6.0 无需因该补丁重新构建。接口、权限、页面位置、资源限额和生命周期以 [Plugin API 3 规范](PLUGIN-SPEC.md) 为准；市场构建和发布以 [市场维护说明](MARKET.md) 为准。可复用的 SDK 类型在独立插件仓库 `sdk/typepro.d.ts`，业务代码不导入 TypePro App 源码。

## 职责

宿主提供笔记、编辑器、事件、同步存储、按域名授权的 HTTPS、设备凭据、用户文件选择及隔离页面。模型协议、提示词、工具调用、会话、Skill、打卡统计和热力图都属于插件。宿主不识别具体插件 ID，不提供业务专用注册入口。

`main.js` 在 Worker 中初始化并注册界面和命令。插件视图的自包含 JS/CSS 放在包内 `files/`，由隔离 iframe 加载；只能通过同一套权限检查的 SDK 访问宿主。插件可以使用自己的框架和依赖，发布前由插件仓库构建，App 不需要编译这些业务模块。

```json
{
  "id": "example.summary",
  "name": "摘要工具",
  "version": "1.0.0",
  "apiVersion": 3,
  "permissions": ["commands", "ui", "notes.read", "storage"]
}
```

```js
await notebook.ui.register({
  id: 'summary', slot: 'app.page', title: '摘要工具',
  script: 'ui.js', styles: ['ui.css']
});
await notebook.commands.register('open', '摘要工具', () => notebook.ui.open('summary'), {
  locations: ['app.menu', 'editor.toolbar'], icon: 'message'
});
```

ZIP 根目录包含 manifest.json、main.js 和可选 files/。JSON 导入为 `{manifest,code,files?}`。资源只允许规范定义的 UTF-8 文本类型，总包与解压内容最多 8 MiB，最多 128 个文件；不要把源码和 node_modules 放入安装包。JS/CSS 完整参加 SHA-256、安装恢复和本地导入插件同步。

## 安装、更新与同步

市场进入、手动刷新和页面前台每分钟检查更新，安装与更新由用户确认。新安装默认停用；新增权限或目标来源需要重新授权。同步恢复的新设备默认停用，不继承其他设备的授权。停用清理页面、事件和网络请求；卸载同步卸载记录，保留插件业务数据。

插件 ID 下的普通 JSON 数据同步到 GitHub 私有笔记仓库；会话、Skill、统计等数据的结构和迁移由插件维护。API Key 通过宿主可信输入框配置，只在本机 Keychain／Keystore 保存，插件只能引用凭据，不能读取明文。请求带凭据需要同时有 network 和 secrets 权限，并匹配已批准的完整 HTTPS 来源。

跨设备同步 API 3 插件之前，Mac 与 Android 都需要升级到 1.6.0。此次是一次宿主能力升级，后续已有 API 范围内的插件业务与界面更新可独立发布，无需再次升级 App。笔记 ZIP 不包含插件安装清单与业务数据。

## 旧版迁移

API 1 的日期、字数等命令插件继续可用，原有命令、文字面板和笔记操作语义保留。API 2 的通用 storage 继续可用；home.activity、pages.assistant 等业务注册停用，会提示更新插件。

每日打卡 1.1.0 和 AI 助手 1.1.x 使用 API 3，保留原插件 ID、存储键和会话记录。旧版专用 AI 凭据不会静默分享给新命名空间，需要在每台设备重新配置一次。插件源码与自己的迁移说明在独立市场仓库对应目录。

## 验证边界

SDK 规范、源码和测试源码不能证明已发布或在设备运行成功。本轮类型检查、Rust 41 项、独立插件 17 项、分发 35 项、JavaScript SDK 8 项及独立 WKWebView CSP 9 项已通过；安装包及首次发布三个市场包的真实下载校验已完成；AI 助手 1.1.1 仅修复插件样式顺序，补丁已由 [Publish plugins #8](https://github.com/Proberen/typepro-plugins/actions/runs/39761719863) 发布，新包已由原生模块真实下载并通过大小／SHA-256 及包结构校验，证据见 [构建记录](BUILD.md)。独立 WebView 检查不代表打包 App UI 或真实模型服务已验收。静态契约审查及未验收范围见 [本次审查记录](PLUGIN-REFACTOR-REVIEW.md)。
