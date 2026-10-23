# 插件市场

TypePro 的市场固定连接独立公开仓库 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins)。1.5.0 使用 `main/catalog-v2.json`，支持 API 1 和 API 2 插件；1.4.x 使用的 `main/catalog.json` 继续只提供 API 1 插件。GitHub Releases 提供每个版本的 ZIP。浏览和下载无需 GitHub 登录，也不使用私有笔记仓库或笔记同步令牌。

每日打卡与 AI 助手 1.0.0 已发布，需要 TypePro 1.5.0；本次 DMG／APK 已生成。安装包与实际验证范围见 [构建记录](BUILD.md)。

## 在应用中使用

1. 打开「插件 → 插件市场」，搜索插件，查看版本、说明和权限。进入市场立即检查，支持手动刷新；市场页面在前台打开期间每 60 秒检查一次。隐藏、离开或关闭市场后停止轮询。网络和 GitHub 缓存可能影响新版本出现时间。
2. 点击「安装」，审阅名称、版本与权限，再确认下载。新插件默认停用，需到「已安装」确认权限后启用。普通浏览器预览不执行市场下载安装，需使用 Mac 或 Android 原生应用。
3. 新版本出现后点击「更新」，审阅后手动确认。更新不会降级；未新增权限时保留原启用状态，新增权限时停用并等待重新确认。下载或校验失败保留旧插件；保存失败会恢复旧插件列表并尝试回写，存储持续不可写时显示错误。

安装与更新核对目录中的包大小、SHA-256 和包内 Manifest，拒绝与审阅信息不一致的包。同一设备最多安装 24 个插件。市场离线不影响已安装插件使用。

开启 GitHub 笔记同步后，安装清单、准确版本、卸载记录和插件 JSON 数据进入私有 `typepro-notes` 仓库。新设备按原版本的不可变 Release 下载，不要求该旧版本仍在最新目录中；原生层验证版本对应的固定 Release 地址、大小和 SHA-256，前端再次验证包内 Manifest。恢复的新插件或变化版本默认停用，首次运行需在该设备确认权限；已有相同代码保留本机启用选择。恢复失败保留旧版，远端卸载移除本机安装但保留数据。启用状态和授权仍是设备本地选择。

本地导入插件通过私有仓库保存 Manifest 和代码，恢复也默认停用。API Key 不存入插件数据；笔记 ZIP 不携带插件代码、安装清单或数据。Mac 与 Android 应先全部升级到 1.5.0，再启用新版插件同步，兼容说明见 [GitHub 同步](GITHUB.md)。

ZIP／JSON 本地导入仍可使用；相同 id 的本地导入需先移除旧版，市场则提供上述更新流程。插件 API 与沙箱限制见 [自定义插件](PLUGINS.md)。

## 上传和发布

在公开仓库的 `main` 分支维护以下文件，可通过 GitHub「Add file → Upload files」上传，或用 Git 提交：

```text
plugins/
  <插件 id>/
    manifest.json
    main.js
```

目录名与 `manifest.id` 必须一致。可参考仓库内 API 1 的 `notebook.date-and-count`，API 2 的 `notebook.daily-checkin` 和 `notebook.ai-assistant`。只上传可公开的插件源码，不放笔记、私有仓库信息、个人访问令牌或其他凭据。

新增或修改插件后查看「Actions → Publish plugins」。工作流先校验，再生成确定性 ZIP、发布独立 Release 并核对下载字节；本批全部成功后，将 `catalog.json` 和 `catalog-v2.json` 放在同一次提交中更新。旧目录只含 API 1，新目录包含 API 1／2。工作流可在 Actions 手动触发。无需自行维护服务器或在客户端配置发布凭据。

更新必须提高 `manifest.version`，例如 `1.0.0` → `1.0.1`；相同版本不能替换内容或改变校验值。发布器优先以已有 `catalog-v2.json` 核对历史版本，仅在该文件不存在时读取旧目录，不会忽略损坏的新目录。不要手改目录清单或覆盖旧 Release。删除插件源码目录并发布，可将其从市场下架，已安装副本和旧版本包仍保留。发布失败时在 Actions 查看错误并重试；清单不会发布部分成功的结果。若期间 `main` 有新提交，旧工作流不会覆盖它，可从最新 `main` 重试。

仓库需允许 GitHub Actions 写入 Contents、发布 Release 并向 `main` 提交目录。分支保护若阻止发布机器人提交，需由仓库管理员调整对应规则。完整发布规则以 [插件仓库说明](https://github.com/Proberen/typepro-plugins#readme) 为准。

## 包和目录契约

ZIP 根目录包含 `manifest.json` 与 `main.js`；脚本不依赖 npm 包。安装包与解压内容总计最多 2 MiB，脚本最多 512 KiB，Manifest 最多 16 KiB。`apiVersion` 支持 `1` 和 `2`；新增 `storage`、`home.activity`、`assistant` 权限仅允许 API 2 声明，旧版客户端不能安装 API 2。权限只允许现有插件 API，插件脚本不能直接联网或任意读写本地文件。AI 联网与笔记工具由获准的宿主页面执行。

市场版本采用严格语义版本，最多 40 个字符：支持 `1.0.0`、`1.0.0-rc.10`，不支持 `+` 构建标记、数字段多余前导零或空预发布段。`01.0.0`、`1.0.0-rc.01`、`1.0.0-a..b` 均无效。本地导入沿用原校验规则；无法严格排序的历史版本不会获得市场更新提示，仍可继续使用。

目录最大 1 MiB、最多 500 个唯一 id，结构如下；空数组表示暂无已发布插件：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-22T00:00:00Z",
  "plugins": []
}
```

每个 `plugins` 项包括：

| 字段 | 内容 |
| --- | --- |
| `id`、`name`、`version`、`description`（可选） | 与安装包 Manifest 一致 |
| `apiVersion`、`permissions` | `1` 或 `2` 及该 API 允许的实际权限集合 |
| `downloadUrl` | 本公开仓库的 `releases/download/<tag>/<文件名>.zip` HTTPS 地址 |
| `sha256` | 安装包字节的 64 位小写十六进制 SHA-256 |
| `size` | 安装包实际字节数，正整数 |

原生层仅访问固定目录和支持的 GitHub Release 下载地址；安装请求绑定用户确认时的 id、版本与 SHA-256。包内名称、版本、说明、API 和权限也必须匹配清单。目录或文件在审阅后变化时，需刷新并重新确认。接口定义见 [集成契约](CONTRACT.md)。
