# TypePro 1.3.2

本地 Markdown 笔记软件。Apple Silicon Mac 与 Android 共用编辑器和插件 API，使用系统 WebView，不捆绑 Chromium。

## 使用

- 首页选择或搜索笔记，支持六张内置封面及本地图片；笔记内创建文档，通过行末菜单重命名、移动或删除。
- 文档侧栏支持收起、展开和拖动调宽；正文左上角图标打开左侧常驻大纲，支持嵌套折叠与标题跳转；手机以抽屉展示。
- 输入 `/` 打开 Markdown 语法菜单，在当前光标处插入；代码块提供语言选择、实时高亮、行号、缩进、括号补全、撤销重做和复制。
- 外观支持浅色、深色、跟随系统、自定义主题色（默认浅蓝）和字号；正文随可用空间展开。
- 顶部眼睛／笔图标切换编辑与阅读，也可使用 `⌘/`。编辑时显示正文工具区；字体、文字颜色作用于选中文字，通过内嵌 HTML 保存在 Markdown 中。
- 工具区支持标题、文字格式、列表、任务、引用、链接、图片、公式等，表格可指定行列数（含表头）。代码块可独立折叠，重新打开保持状态。流程图支持可视化绘制与 Mermaid 实时预览；复杂 Mermaid 保留源码，可继续在 Mermaid 模式编辑。Mermaid 源码共用独立代码编辑器。
- 代码块头部「格式化」或 `⌥⇧F` 格式化当前块，支持全部现有语言；失败保留原文，成功可撤销。引擎随应用打包，首次使用按语言在后台加载。纯文本仅清除行尾空格。
- 编辑模式中，块左侧把手支持当前文档内拖拽排序；点击把手可上移、下移或删除。段落、标题、列表项、引用、代码、表格、图片、公式、图表及 HTML 块共用操作；标题仅移动自身。手机点选显示把手，长按拖动。移动和删除可撤销，阅读模式不显示操作。
- 选中图片后拖动四角等比缩放，最大宽度不超过正文；尺寸用 HTML 图片标签保存到 Markdown，重新打开和阅读时保留。行内样式与链接随所在段落移动。
- 自动保存到本机。桌面 `⌘S` 立即保存，`⌘N` 在首页新建笔记、在编辑页新建文档；更多 Typora 风格操作见应用内「键盘快捷键」。底部显示保存状态。
- 从「导入 / 导出」导入 `.md`、`.markdown` 或本应用的 ZIP。导出范围可选全部、当前笔记本或当前文档；跨设备迁移使用 ZIP，可携带图片附件。单独导出 Markdown 不携带附件。
- 可选「GitHub 同步」：每台设备首次通过 GitHub 设备授权，笔记与图片同步到账号下的私有 `typepro-notes` 仓库。默认前台每 5 分钟同步，可改为仅手动；离线编辑继续保存在本机。同文档冲突保留副本。内置 GitHub App 仅供 `Proberen` 账号使用；连接步骤、权限与其他账号配置见 [GitHub 同步](docs/GITHUB.md)。
- 在「关于 TypePro」查看版本号、更新记录及升级说明。
- 在「插件」导入 ZIP 或 JSON 插件，确认权限后启用。示例与 API 见 [插件文档](docs/PLUGINS.md)。

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

保存使用串行写入、原子替换和恢复日志。导入分配新 ID，保留同名的原有笔记和导入笔记。笔记本封面保存在索引中，上传的本地封面图片随 ZIP 导出和导入；旧数据没有封面字段也可正常读取。ZIP 不包含插件代码和授权；其他设备需单独安装插件。

Mac 新建笔记或「存储目录」中可为每本笔记选择独立的空文件夹，支持迁移与回到默认目录。每个目录含 `notebooks/<id>/<doc>.md` 和 `assets/`，保留 Markdown 的相对图片引用。迁移不删除旧文件；绝对路径仅记在本机 `locations.json`，不会写入 ZIP。手机版不提供自定义目录。

GitHub 同步只包含笔记分组、文档、封面及正文引用的本地附件。插件代码和授权、自定义目录的绝对路径、主题、折叠等界面状态留在本机。两端各自选择存储位置，Markdown 的相对附件引用保持不变。同步凭据由原生层保存在 macOS 钥匙串或 Android Keystore 保护的加密存储中，不写入笔记仓库、ZIP 或浏览器存储。断开连接保留本地笔记与远端仓库。

TypePro 1.3.0 沿用原「笔记」应用的标识和数据目录。Android 沿用原签名密钥与包名，覆盖安装保留原有笔记。

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

本项目未设置自动发布。Mac 为个人使用的 ad-hoc 签名，未经过 Apple 公证；Android 使用个人 release 签名。更新 Android 安装包必须沿用同一签名密钥。

## 验证

```sh
npx tsc -b --pretty false
node --experimental-strip-types --test src/editor/editor.test.mjs src/editor/code-editor*.test.mjs src/flow/flow.test.mjs
node --experimental-strip-types --test src/editor/code-format/*.test.mjs
node --experimental-strip-types --test src/sync/merge.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

上述命令分别检查类型、Markdown 原文保留、选区／样式／折叠契约与流程图转换、同步合并及格式校验、原生存储和导入导出。命令列表不代表本次均已执行；实际构建、界面、系统文件选择器、平台 WebView 和真实 GitHub 授权验证结果以对应交付记录为准。

## 目录

独立 NAS 服务开发目录为 [services/nas](services/nas/README.md)，提供 Docker 部署和网页同步记录列表，当前 App 尚未接入该服务。1.3.0 的可选云端同步使用 GitHub。

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/Sidebar.tsx` | 笔记本、文档与操作界面 |
| `src/lib/` | 原生桥接、共享模型、串行自动保存 |
| `src/editor/` | 编辑／阅读、原文保留、本地图片与 Markdown 渲染 |
| `src/editor/code-format/` | 离线代码格式化、后台 worker 与按需加载引擎 |
| `src/flow/` | 流程图绘制、Mermaid 解析与本地预览 |
| `src/sync/` | GitHub 同步设置、前台调度、三方合并与远端模型校验 |
| `src/plugins/`、`public/plugins/` | 插件安装、权限、沙箱和宿主 API |
| `src-tauri/src/` | 本地文件、恢复日志、导入导出、平台桥接 |
| `src-tauri/src/github/` | GitHub 设备授权、专用私库校验、Git 数据接口与同步基线 |
| `src-tauri/src/github_secrets.rs` | macOS 钥匙串与 Android 安全凭据桥接 |
| `src-tauri/gen/android/` | Android 原生工程 |
| `docs/GITHUB.md`、`docs/CONTRACT.md` | GitHub 使用与限制、共享数据及原生接口契约 |
| `examples/` | 可安装的日期与字数示例插件 |

`public/vendor/` 为构建前从已安装 Vditor 依赖复制的离线资源，不需提交。源代码压缩包不包含依赖目录、编译缓存、签名密钥或本机笔记。
