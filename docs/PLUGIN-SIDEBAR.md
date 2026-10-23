# 笔记插件侧栏改造记录

日期：2026-10-22。状态：App 1.7.0 安装包已生成，AI 1.2.0 已发布；实际交付结果见 [构建记录](BUILD.md)。

## 已确认的交互

- Mac：点击编辑页插件图标，在正文右侧并排展开；再次点击图标、关闭按钮或未被内部界面处理的 Escape 可收起，不遮挡正文。
- 侧栏可拖动调宽，首用默认关闭、宽度 400px；用户选择的插件、开关和宽度保存在当前设备。首选宽度限制为 280–640px，实际展示受窗口剩余空间约束。
- 手机：右侧抽屉，带遮罩和关闭按钮；抽屉打开时正文不能交互。保留同一套设备本地开关偏好。
- 新版宿主中 AI 会话替代原独立会话页。历史、新会话、模型选择、设置及 Skill 入口在侧栏内；历史和设置使用插件内部对话框。

## 通用宿主与插件边界

宿主新增 `editor.sidebar`，不识别 AI 插件 ID，也不处理模型、提示词、Skill 或工具业务。现有 `ui` 权限用于注册和显示，读取、修改笔记仍分别遵守原有权限及修改确认。完整契约以 [Plugin API 规范](PLUGIN-SPEC.md) 为准；独立 SDK 的槽位类型和说明已同步。

注册视图自动获得宿主编辑工具栏入口，不再额外注册同用途命令。`ui.open(id)` 在笔记编辑页幂等展开；其他页面调用返回 `NOT_FOUND`。`ui.close()` 仅收起调用视图自身；不同插件不能借此关闭其他视图。

收起时保留已挂载视图，避免丢失输入草稿或中断当前请求；切换当前文档更新上下文和 `document.active`，不重建侧栏。离开编辑页、停用或卸载插件会卸载视图，按原有机制释放连接并取消待处理调用。

`view.visibility` 由宿主结合侧栏开关和应用前后台计算；订阅先收到当前值，后续相同值不重复发送。隐藏 iframe 不再自行上报可见。内部对话框先处理 Escape，未处理的 Escape 才收起侧栏。

AI 模型调用、会话数据、笔记来源、写入前确认、系统提示词、Skill 和同步数据格式沿用原实现。API Key 仍仅保存在当前设备。此次没有迁移或重命名已有插件存储键。

## 源码入口

| 范围 | 入口 | 职责 |
| --- | --- | --- |
| App | [App.tsx](../src/App.tsx) | 编辑页布局、打开和关闭路由、设备偏好 |
| 宿主侧栏 | [PluginSidebar.tsx](../src/plugins/PluginSidebar.tsx)、[surfaces.css](../src/plugins/surfaces.css) | 通用图标、并排布局、调宽、手机抽屉 |
| 宿主生命周期 | [PluginSurface.tsx](../src/plugins/PluginSurface.tsx)、[PluginHost.ts](../src/plugins/PluginHost.ts) | 视图挂载、上下文、可见性 |
| 沙箱 | [sandbox.js](../public/plugins/sandbox.js) | Escape 和宿主可见性事件传递 |
| AI 插件 | `work/typepro-plugins/plugins/notebook.ai-assistant/source/` | 视图注册、会话、历史、模型、Skill、插件内部对话框及样式 |
| 独立 SDK | `work/typepro-plugins/sdk/typepro.d.ts` | 通用槽位和生命周期类型说明 |

## 源码阶段检查

- 静态核对了视图注册、编辑页打开路由、关闭范围、隐藏保活、文档上下文、停用清理和手机布局分支。
- 对比此前 App 1.6.0 与插件 1.1.1 源码归档，检查本轮差异；模型会话的 `send` 实现与基线相同，数据处理和同步接口未改动。
- 已先检查 `src/plugins/sandbox.test.mjs`：仅使用 Node 内置模块执行原始 JavaScript，不转译、不打包、不启动应用。该检查 10/10 通过，包含新增的可见性和 Escape 回归场景；它不验证 React 布局或宿主运行时。
- 按 Ponytail `ponytail-review` 审查本轮整合差异，结果：`Lean already. Ship.`，没有需要落实的等价简化。
- 上述为源码阶段记录；后续构建、实际页面和下载检查单独记于 [构建记录](BUILD.md)，不将源码检查替代运行验证。

## 交付与版本边界

本轮用户已明确允许生成 App 1.7.0 的 DMG／APK、必要检查，并将 AI 1.2.0 发布到公开插件仓库；沿用旧签名与包名，不覆盖旧安装包或不可变插件版本。构建、远程发布及本轮验收结果以 [构建记录](BUILD.md) 为准，上方源码阶段检查不冒充安装包验收。

AI 1.2.0 优先注册 `editor.sidebar`；仅当旧宿主返回 `INVALID_ARGUMENT` 或 `UNSUPPORTED_API` 时，在插件内回退同一视图的 `app.page` 和原有打开命令。侧栏成功时不注册独立页面入口，其他错误原样抛出。该方式继续使用 API 3 与 `catalog-v3.json`，准确版本同步恢复也能在旧 API 3 宿主运行，无需新增同步格式或主程序业务判断。
