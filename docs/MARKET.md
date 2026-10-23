# 插件市场

市场使用独立公开仓库 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins)。API 3 宿主读取 `main/catalog-v3.json`；旧版客户端继续读取原有的 `catalog.json`（API 1）或 `catalog-v2.json`（API 1／2）。插件包放在各版本不可变的 GitHub Release，浏览下载不使用私有笔记仓库的凭据。

TypePro 1.6.0 DMG／APK 已生成，每日打卡 1.1.0 与 AI 助手初版 1.1.0 已通过 [Publish plugins #7](https://github.com/Proberen/typepro-plugins/actions/runs/39759657722) 发布；AI 助手 1.1.1 独立样式补丁已通过 [Publish plugins #8](https://github.com/Proberen/typepro-plugins/actions/runs/39761719863) 发布，新包已由原生模块真实下载并通过大小／SHA-256 及包结构校验。App 1.6.0 安装包不变。首次发布的三个市场包真实下载校验通过，旧目录条目保持不变。插件源码由独立仓库维护。此次 App 升级提供通用能力，之后已有接口范围内的插件业务和界面可以独立发布。源码上传、工作流发布与实际下载检查均有独立证据，见 [构建记录](BUILD.md)；本轮未验收真实设备中的安装启用与模型调用。完整接口和权限以 [插件规范](PLUGIN-SPEC.md) 为准。

## 使用与恢复

进入市场立即检查，也支持手动刷新；市场页面在前台打开时每 60 秒检查。新安装插件默认停用，在本设备确认权限后启用。更新需要手动确认；新权限或新增网络来源会停用插件，等待重新授权。下载安装失败保留旧版本。最多安装 24 个插件。

安装时核对用户审阅的 id、版本、Manifest、网络来源、包大小与 SHA-256。包内的脚本和全部资源都属于校验内容。同一版本禁止替换字节，发布新业务逻辑或界面必须提高插件版本；使用已有 API 的插件更新不要求修改宿主。

GitHub 笔记同步保存安装清单、准确版本、卸载记录及插件 JSON 数据。本地导入包还保存全部脚本和资源；市场包保存不可变 Release 地址与哈希。恢复时下载原版本并完整校验，新的或变化的包默认停用。完全相同的本地字节可保留本机启用决定。卸载保留业务数据。

启用状态、授权和 API Key 不跨设备同步。API 3 增加了资源与网络来源字段，所有同步设备都应先更新到支持 API 3 的宿主，再安装新版插件；旧版严格解析器不能读取新字段。笔记 ZIP 不包含插件安装清单、脚本、资源或数据。

## 源码与远程打包

简单脚本继续使用两文件格式；带界面的插件使用以下结构：

```text
plugins/<插件 id>/
  manifest.json
  source/
    main.ts        # export default async function init()
    ui.tsx         # 可选，界面入口，自带业务逻辑与样式导入
```

远程工作流把 Worker 入口打包为 `main.js`，再等待其导出的初始化函数。界面打包为 `files/ui.js` 和可选的 `files/ui.css`。构建产物是独立浏览器脚本，不能引用宿主源码、宿主 React 或外部远程脚本。根 `package.json` 固定构建依赖版本，业务插件通过 SDK 与宿主通信。现有纯 JavaScript 插件仍可直接维护 `manifest.json`、`main.js`。

`build-plugins.mjs` 仅允许 GitHub Actions 发布环境执行。此次已获准发布插件，仍使用真实远程发布工作流，不通过伪装 CI 环境在本地执行该入口。必要检查已通过分发 35 项及独立插件 17 项；具体构建与发布状态见 [构建记录](BUILD.md)。

公开源码只放可公开的材料，不放笔记、令牌和 API Key。更新源码后，Actions 的 Publish plugins 工作流依次安装固定依赖、打包插件界面、校验发布器、生成确定性 ZIP、发布并下载核对所有版本包。整批成功后才一次提交三个版本目录；失败不提交部分市场清单。

发布器优先读取 `catalog-v3.json`，不存在时才读取 v2 或旧目录。已存在但损坏的高版本目录直接报错。目录版本不可降级，同版本不得改变包大小或哈希。`catalog-v3.json` 发布最新兼容插件；同一插件升级 API 后，旧目录保留最后一个兼容版本。删除源码目录则从各目录下架，已安装包与历史 Release 保留。

## 包格式与限制

ZIP 根目录包含 `manifest.json`、`main.js`，API 3 可包含 `files/` 下的 UTF-8 资源。JSON 导入格式为 `{manifest,code,files?}`。资源名为安全相对路径，扩展名限定 `.js`、`.css`、`.json`、`.txt`、`.md`、`.svg`；拒绝路径穿越、重复路径、符号链接和原生可执行文件。

| 对象 | 限制 |
| --- | --- |
| ZIP 与解压后总量 | 各 8 MiB |
| 文件数量 | 128，包含 Manifest 与 main.js |
| Manifest | 16 KiB |
| main.js | 512 KiB |
| 单个资源 | 4 MiB |
| 市场目录 | 1 MiB、500 个唯一插件 ID |

Manifest 支持 API 1／2／3，API 3 使用通用权限，可额外声明 `networkOrigins`，最多 32 个精确 HTTPS 来源。来源只包含协议、主机和可选端口，不含通配符、路径、查询、片段或用户信息。运行期间新增的来源仍需本设备确认。

API 2 专用的打卡／AI 注册入口已退出宿主业务实现；旧包保留在旧目录供旧版 App 使用，新宿主会提示更新到 API 3 插件。API 1 的日期等通用插件继续兼容。

市场版本采用严格语义版本，最多 40 字符：允许 `1.0.0`、`1.0.0-rc.10`，拒绝 `+` 构建标记、数字段前导零和空预发布段。本地历史版本不能严格排序时，不提供市场更新提示。

目录结构仍为 `{schemaVersion:1,updatedAt,plugins}`。每条插件包含 Manifest 字段及 `downloadUrl`、`sha256`、`size`；API 3 的 `networkOrigins` 同样必须与包内一致。原生层只下载指定公开仓库的 Release，并校验大小和 SHA-256，前端再验证包结构与 Manifest。
