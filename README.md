# TypePro 1.7.2

## 1.7.2 列表光标与原行缩进

- 列表前缀加空格后，空项立即具有可编辑的光标行，继续输入前后位置一致。
- 空的嵌套项按 Enter 在原行减少一级缩进并保留符号；最外层空项原行取消符号。有内容时 Enter 仍续下一项。

## 1.7.1 列表与组件修正

本版调整组件操作范围与列表键盘行为。构建与交付状态见 [构建记录](docs/BUILD.md)。列表的回车、退格和缩进参考本机 Typora 1.13.2 核对；字母列表为 TypePro 扩展。

## 1.7.0 笔记侧栏

通用 `editor.sidebar` 在正文右侧并排展开，可收起、调宽，并在当前设备记住选择、开关和宽度；手机采用右侧抽屉。AI 助手 1.2.0 迁入此位置，历史、模型、提示词和 Skill 仍由独立插件提供。旧版 API 3 宿主回退独立页面，新版仅显示侧栏；API 和同步格式保持不变。

本轮已获准构建 DMG／APK 并发布插件，实际交付状态见 [构建记录](docs/BUILD.md)，改造和验收范围见 [侧栏改造记录](docs/PLUGIN-SIDEBAR.md)。此前 1.6.0 的验证记录不代替本次验收。

本地 Markdown 笔记软件。Apple Silicon Mac 与 Android 共用编辑器和插件 API，使用系统 WebView，不捆绑 Chromium。

1.6.0 是一次 API 3 通用宿主升级：打卡和 AI 的完整逻辑、界面迁入独立插件，App 只提供通用接口与挂载位置。此后，已有接口范围内的插件业务和界面可以独立发布，无需升级 App；新增宿主能力或不兼容接口仍需升级 App。规范见 [PLUGIN-SPEC.md](docs/PLUGIN-SPEC.md)。

1.6.0 DMG／APK 已生成并通过签名、包结构与完整性检查；每日打卡 1.1.0 已发布并校验；AI 助手 1.1.1，仅修复独立插件的样式加载顺序，已通过 [Publish plugins #8](https://github.com/Proberen/typepro-plugins/actions/runs/39761719863) 发布，新包已由原生模块真实下载并通过大小／SHA-256 及包结构校验。App 1.6.0 安装包保持不变。首次 [自动发布 #7](https://github.com/Proberen/typepro-plugins/actions/runs/39759657722) 的三个市场包已完成原生真实下载校验，旧版目录条目保持不变。类型检查、Rust 41 项、独立插件 17 项、分发 35 项、SDK 8 项及独立 WKWebView CSP 9 项检查通过，范围见 [本次审查记录](docs/PLUGIN-REFACTOR-REVIEW.md) 与 [构建记录](docs/BUILD.md)。本轮未验收打包 App UI、真实模型服务和两台设备联网同步。

插件普通业务数据及安装资源继续同步，API Key 每台设备单独配置。API 2 专用插件需更新，原数据保留。

## 使用

- 首页选择或搜索笔记，支持六张内置封面及本地图片；笔记内创建文档，通过行末菜单重命名、移动或删除。
- 文档侧栏支持收起、展开和拖动调宽；正文左上角图标打开左侧常驻大纲，支持嵌套折叠与标题跳转；手机以抽屉展示。
- 输入 `/` 打开 Markdown 语法菜单，在当前光标处插入；代码块提供语言选择、实时高亮、行号、缩进、括号补全、撤销重做和复制。
- 外观支持浅色、深色、跟随系统、自定义主题色（默认浅蓝）和字号；正文随可用空间展开。
- 顶部眼睛／笔图标切换编辑与阅读，也可使用 `⌘/`。编辑时显示正文工具区；字体、文字颜色作用于选中文字，通过内嵌 HTML 保存在 Markdown 中。
- 工具区支持标题、文字格式、列表、任务、引用、链接、图片、公式等，表格可指定行列数（含表头）。代码块可独立折叠，重新打开保持状态。流程图支持可视化绘制与 Mermaid 实时预览；复杂 Mermaid 保留源码，可继续在 Mermaid 模式编辑。Mermaid 源码共用独立代码编辑器。
- 代码块头部「格式化」或 `⌥⇧F` 格式化当前块，支持全部现有语言；失败保留原文，成功可撤销。引擎随应用打包，首次使用按语言在后台加载。纯文本仅清除行尾空格。
- 编辑模式中，代码块、表格、独立图片、公式、流程图和 HTML 块左侧显示操作把手，支持当前文档内拖拽、上移、下移或删除，也支持列表内的组件。普通段落、标题、引用、列表及分隔线不显示把手。手机点选显示把手，长按拖动。移动和删除可撤销，阅读模式不显示操作。
- 行首输入 `- `、`1. ` 或 `a. ` 自动创建无序、数字或字母列表。回车续项，`Shift+Enter` 在项内换行，`Tab`／`Shift+Tab` 调整层级；空项按退格先取消符号，再按一次减少一级缩进。数字与无序列表保留 Markdown，字母列表用 `<ol type="a">` HTML 保存，重新编辑时还原列表。
- 选中图片后拖动四角等比缩放，最大宽度不超过正文；尺寸用 HTML 图片标签保存到 Markdown，重新打开和阅读时保留。
- 自动保存到本机。桌面 `⌘S` 立即保存，`⌘N` 在首页新建笔记、在编辑页新建文档；更多 Typora 风格操作见应用内「键盘快捷键」。底部显示保存状态。
- 从「导入 / 导出」导入 `.md`、`.markdown` 或本应用的 ZIP。导出范围可选全部、当前笔记本或当前文档；跨设备迁移使用 ZIP，可携带图片附件。单独导出 Markdown 不携带附件。
- 可选「GitHub 同步」：每台设备首次通过 GitHub 设备授权，笔记与图片同步到账号下的私有 `typepro-notes` 仓库。默认前台每 5 分钟同步，可改为仅手动；离线编辑继续保存在本机。同文档冲突保留副本。内置 GitHub App 仅供 `Proberen` 账号使用；连接步骤、权限与其他账号配置见 [GitHub 同步](docs/GITHUB.md)。
- 在「关于 TypePro」查看版本号、更新记录及升级说明。
- 在「插件市场」搜索并安装公开插件，无需 GitHub 登录。进入市场、手动刷新及页面前台打开期间每分钟检查目录；更新由用户确认后执行。新插件默认停用，更新新增权限时需重新确认；ZIP／JSON 导入继续保留。发布方法见 [插件市场](docs/MARKET.md)，示例与 API 见 [插件文档](docs/PLUGINS.md)。
- 启用「每日打卡」后，首页显示近一年编辑热力图，点击日期查看文档及 `+新增／−删除` 字数。统计启用后的人工正文变化，排除空白和 Markdown 标记；可识别的编辑撤销抵消原记录。同步、导入与 AI／插件自动写入不计入。
- 启用「AI 助手」后，从首页或插件命令进入会话。默认支持 DeepSeek，填写本设备的 API Key 后获取模型列表，也可填写模型 id 或配置兼容 OpenAI 的 HTTPS 接口。支持多会话、停止生成、全局系统提示词和 Skill；读取相关笔记会发送给所选模型。创建或修改文档先显示差异，确认后写入；不提供任意本地文件或系统命令工具。

Markdown 支持标题、段落、引用、列表、任务列表、表格、代码高亮、链接、图片、脚注、目录、数学公式和 Mermaid 图表。数学与图表资源随应用打包，可离线使用。外链图片仍需要对应网络地址可访问。HTML 会清理脚本及危险属性；不执行笔记内的 JavaScript，也不调用外部 PlantUML 等渲染服务。

仅切换视图不会重写原始 Markdown；在排版视图实际编辑时，编辑器会规范化空格、列表等 Markdown 写法。特殊方言的预览效果取决于编辑器支持范围，不提供源码视图。

## 数据

正文为真实 UTF-8 `.md` 文件。Mac 数据目录为：

```text
~/Library/Application Support/com.localnotes.notebook/workspace/
```

Android 数据保存在应用私有目录，通过系统文件选择器导入导出，无需整个存储空间访问权限。默认仅使用本地存储，无需 TypePro 账号，没有应用自有遥测；启用 GitHub 同步才需要首次授权 GitHub。卸载 Android 应用会删除应用私有数据，请先导出或确认需要保留的笔记已同步。

```text
workspace/
  index.json
  notebooks/<notebook-id>/<document-id>.md
  assets/<asset-id>.<extension>
```

保存使用串行写入、原子替换和恢复日志。导入分配新 ID，保留同名的原有笔记和导入笔记。笔记本封面保存在索引中，上传的本地封面图片随 ZIP 导出和导入；旧数据没有封面字段也可正常读取。笔记 ZIP 只携带笔记与附件，不包含插件安装清单、插件代码、插件数据或授权。

Mac 新建笔记或「存储目录」中可为每本笔记选择独立的空文件夹，支持迁移与回到默认目录。每个目录含 `notebooks/<id>/<doc>.md` 和 `assets/`，保留 Markdown 的相对图片引用。迁移不删除旧文件；绝对路径仅记在本机 `locations.json`，不会写入 ZIP。手机版不提供自定义目录。

GitHub 同步包含笔记分组、文档、封面、正文引用的本地附件，以及插件安装清单、版本、卸载记录和插件数据。市场插件按锁定的版本与校验值重新下载；本地导入插件的 Manifest、代码和 JS/CSS 等资源保存到私有笔记仓库。新设备恢复的插件默认停用，需在该设备确认权限后启用；远端卸载会移除本地安装，但保留插件数据。启用状态、授权、自定义目录绝对路径、主题和折叠等界面状态仍留在本机。

打卡记录、AI 会话历史、模型设置、全局系统提示词与导入的 Skill 随插件数据同步。API Key 每台设备单独填写，由原生层保存在 macOS 钥匙串或 Android Keystore 保护的加密存储中，不进入 Workspace、GitHub 或 ZIP；模型接口地址变更后需重新填写 Key。GitHub 授权凭据也仅保存在本机安全存储。断开连接保留本地内容与远端仓库。

插件数据存入私库的 `.typepro/extensions.json`，由清单引用。1.5.0 开始支持插件扩展数据，1.4.x 不能读取包含该扩展字段的远端清单。本次 API 3 增加插件资源和网络来源字段，安装新版插件并同步前，请先将 Mac 与 Android 都升级到 1.6.0；旧笔记和已有插件业务数据保留。

TypePro 沿用原「笔记」应用的标识和数据目录。Android 升级需沿用原签名密钥与包名，覆盖安装保留原有笔记。

公开插件市场固定使用独立仓库 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins) 的目录和 Release 安装包，不读取私有笔记仓库，也不使用笔记同步凭据。1.6.0 使用 `catalog-v3.json`；1.5.0 的 `catalog-v2.json` 和 API 1 的 `catalog.json` 保留各自可读版本。API 3 提供通用页面、事件、同步存储和受授权的网络／凭据接口，业务逻辑与界面由插件包实现。旧 API 2 业务插件提示更新，原数据保留。

## 开发与构建

技术栈：Tauri 2、React、TypeScript、Vditor/Lute 与 CodeMirror 6。依赖版本由 `package-lock.json` 与 `src-tauri/Cargo.lock` 锁定。构建前需要 Node.js（本次使用的精确版本见 [构建记录](docs/BUILD.md)）、Rust、macOS Xcode 命令行工具；Android 还需要 Java、SDK 与 NDK。

```sh
npm ci
npm run tauri -- dev
```

`npm run dev` 仅供界面开发，使用独立浏览器预览存储。正式包中的存储接口只连接原生层，浏览器预览实现不会进入发行包。

```sh
npm run tauri -- build --bundles app
npm run tauri -- android build --apk --target aarch64 armv7 --ci
```

Android 签名环境变量和原生存储实现见 [原生说明](src-tauri/README.md)；实际使用的环境、构建和 DMG 打包步骤见 [构建记录](docs/BUILD.md)。Android 项目包含自定义 `MainActivity.kt` 与 `TransferPlugin.kt`，不要重新执行 `android init` 覆盖它们。

应用安装包未设置自动发布。本版 Mac 安装包为个人使用的 ad-hoc 签名，未经过 Apple 公证；Android 使用沿用的个人 release 密钥通过 apksigner 签名，与 1.5.0 证书一致，更新必须沿用同一签名密钥。独立插件仓库通过 GitHub Actions 校验、打包并发布插件，与应用安装包构建分开。

## 验证

```sh
npx tsc -b --pretty false
node --experimental-strip-types --test src/editor/editor.test.mjs src/editor/code-editor*.test.mjs src/flow/flow.test.mjs
node --experimental-strip-types --test src/editor/code-format/*.test.mjs
node --experimental-strip-types --test src/sync/merge.test.mjs
node --experimental-strip-types --test src/plugins/market.test.mjs
node --experimental-strip-types --test src/plugins/state.test.mjs src/plugins/restore.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

上述命令是开发检查参考，不代表本次已全部执行。本次已完成的类型检查、Rust 41 项、独立插件 17 项、分发 35 项、SDK 8 项及独立 WKWebView CSP 9 项检查，范围见 [本次审查记录](docs/PLUGIN-REFACTOR-REVIEW.md)；构建、发布及安装包结果以 [构建记录](docs/BUILD.md) 为准。界面、系统文件选择器、平台 WebView 和真实 GitHub／AI 服务的验收不能用静态审查或单元测试代替。

## 目录

独立 NAS 服务开发目录为 [services/nas](services/nas/README.md)，提供 Docker 部署和网页同步记录列表，当前 App 尚未接入该服务。应用的可选云端同步使用 GitHub。

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/Sidebar.tsx` | 笔记本、文档与操作界面 |
| `src/lib/` | 原生桥接、共享模型、串行自动保存 |
| `src/editor/` | 编辑／阅读、原文保留、本地图片与 Markdown 渲染 |
| `src/editor/code-format/` | 离线代码格式化、后台 worker 与按需加载引擎 |
| `src/flow/` | 流程图绘制、Mermaid 解析与本地预览 |
| `src/sync/` | GitHub 同步设置、前台调度、三方合并与远端模型校验 |
| `src/plugins/`、`public/plugins/` | 插件市场、安装更新、权限、沙箱和宿主 API |
| 独立插件仓库 `plugins/*/source/` | 打卡与 AI 的业务、界面、数据迁移及依赖 |
| `src-tauri/src/` | 本地文件、恢复日志、导入导出、平台桥接 |
| `src-tauri/src/github/` | GitHub 设备授权、专用私库校验、Git 数据接口与同步基线 |
| `src-tauri/src/github_secrets.rs` | macOS 钥匙串与 Android 安全凭据桥接 |
| `src-tauri/src/plugin_market.rs` | 固定公开目录、Release 下载、大小与 SHA-256 校验 |
| `src-tauri/src/plugin_services.rs`、`src-tauri/src/plugin_secrets.rs` | 通用 HTTPS、原始流传输、取消和插件隔离的设备凭据 |
| `src-tauri/gen/android/` | Android 原生工程 |
| `docs/GITHUB.md`、`docs/CONTRACT.md` | GitHub 使用与限制、共享数据及原生接口契约 |
| `docs/MARKET.md`、`docs/PLUGINS.md` | 插件发布、市场使用和插件 API |
| `examples/` | 可安装的日期与字数示例插件 |

`public/vendor/` 为构建前从已安装 Vditor 依赖复制的离线资源，不需提交。源代码压缩包不包含依赖目录、编译缓存、签名密钥或本机笔记。
