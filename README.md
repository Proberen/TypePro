# 笔记

本地 Markdown 笔记软件。Apple Silicon Mac 与 Android 共用编辑器和插件 API，使用系统 WebView，不捆绑 Chromium。

## 使用

- 创建笔记本，在笔记本内创建文档；通过行末菜单重命名、移动或删除。
- 「编辑」直接编辑排版后的正文；「源码」编辑 Markdown；「阅读」为只读视图。
- 自动保存到本机。桌面 `⌘S` 立即保存，`⌘N` 新建文档。底部显示保存状态。
- 从「导入 / 导出」导入 `.md`、`.markdown` 或本应用的 ZIP。导出范围可选全部、当前笔记本或当前文档；跨设备迁移使用 ZIP，可携带图片附件。单独导出 Markdown 不携带附件。
- 在「插件」导入 ZIP 或 JSON 插件，确认权限后启用。示例与 API 见 [插件文档](docs/PLUGINS.md)。

Markdown 支持标题、段落、引用、列表、任务列表、表格、代码高亮、链接、图片、脚注、目录、数学公式和 Mermaid 图表。数学与图表资源随应用打包，可离线使用。外链图片仍需要对应网络地址可访问。HTML 会清理脚本及危险属性；不执行笔记内的 JavaScript，也不调用外部 PlantUML 等渲染服务。

仅切换视图不会重写原始 Markdown；在排版视图实际编辑时，编辑器会规范化空格、列表等 Markdown 写法。特殊方言可以在源码视图保留和编辑，其预览效果取决于编辑器支持范围。

## 数据

正文为真实 UTF-8 `.md` 文件。Mac 数据目录为：

```text
~/Library/Application Support/com.localnotes.notebook/workspace/
```

Android 数据保存在应用私有目录，通过系统文件选择器导入导出，无需整个存储空间访问权限。没有账号、同步服务或应用自有遥测。卸载 Android 应用会删除应用私有数据，请先导出需要保留的笔记。

```text
workspace/
  index.json
  notebooks/<notebook-id>/<document-id>.md
  assets/<asset-id>.<extension>
```

保存使用串行写入、原子替换和恢复日志。导入分配新 ID，保留同名的原有笔记和导入笔记。ZIP 不包含插件代码和授权；其他设备需单独安装插件。

## 开发与构建

技术栈：Tauri 2、React、TypeScript、Vditor/Lute。依赖版本由 `package-lock.json` 与 `src-tauri/Cargo.lock` 锁定。构建前需要 Node.js（本次使用的精确版本见 [构建记录](docs/BUILD.md)）、Rust、macOS Xcode 命令行工具；Android 还需要 Java、SDK 与 NDK。

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
node --experimental-strip-types --test src/editor/editor.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

上述命令分别检查类型、Markdown 源文保留及解析行为、原生存储和导入导出。实际界面、系统文件选择器和平台 WebView 验证结果见交付目录的「安装与使用.md」。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/Sidebar.tsx` | 笔记本、文档与操作界面 |
| `src/lib/` | 原生桥接、共享模型、串行自动保存 |
| `src/editor/` | 三种视图、原文保留、本地图片与 Markdown 渲染 |
| `src/plugins/`、`public/plugins/` | 插件安装、权限、沙箱和宿主 API |
| `src-tauri/src/` | 本地文件、恢复日志、导入导出、平台桥接 |
| `src-tauri/gen/android/` | Android 原生工程 |
| `examples/` | 可安装的日期与字数示例插件 |

`public/vendor/` 为构建前从已安装 Vditor 依赖复制的离线资源，不需提交。源代码压缩包不包含依赖目录、编译缓存、签名密钥或本机笔记。
