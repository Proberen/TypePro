# 应用版本更新

TypePro 1.7.3 起提供应用更新提醒。更新源固定为公开仓库 [Proberen/TypePro 的 Releases](https://github.com/Proberen/TypePro/releases)，不需要 GitHub 登录，与笔记同步和插件市场独立。

TypePro 1.7.5 起在应用内下载安装包；1.7.3／1.7.4 仍将下载交给系统浏览器，需先用原入口安装 1.7.5。

## 使用方式

- 启动并进入应用时检查；持续使用期间，每隔 24 小时在前台检查一次。后台不发起自动检查，回到前台后补查已到期的检查。
- 「关于 TypePro」提供手动检查，不受每日间隔限制；同时进行的检查合并为一次。
- 发现更新后显示可关闭的轻提示，点击「查看更新」打开关于页面，阅读升级说明并选择「下载更新」。关闭提示只对本次应用会话中的该版本生效，关于页面仍可查看。
- 点击「下载更新」后在应用内显示下载进度、已下载和总大小，可取消；网络或校验失败可重试。下载中不重复创建任务，不检查其他版本。
- 下载完成且校验通过后，Mac 点击「打开安装包」打开 Apple Silicon DMG；Android 点击「安装更新」进入系统安装确认。若 Android 尚未允许本来源安装，先打开系统授权页面，返回后再次点击安装。不会自动覆盖或重启应用。
- 网络失败不会阻塞笔记功能；关于页面显示错误并可手动重试。自动检查按最近一次尝试计算间隔，不持续重试。

旧版本首次升级到 1.7.3 仍需从 Releases 手动下载安装包，此后才能使用应用内提醒。

## 发布约定

更新检查按版本号数值比较，选择高于当前应用、且有当前平台安装包的最高正式版。草稿、预发布、未发布记录和非 `v主版本.次版本.修订号` 标签不会提示；发布先后顺序不影响选择。某版只有 APK 时，Mac 继续检查其他有 DMG 的正式版。

发布时必须使用以下标签和附件名，附件上传完整后再公开 Release：

```text
标签：v1.7.5
Mac：TypePro-1.7.5-mac-arm64.dmg
Android：TypePro-1.7.5-android.apk
```

Release 正文作为升级说明按纯文本显示。源码 ZIP、校验文件不作为应用安装包。下载地址必须精确匹配同一仓库、版本及平台的 Release 附件，不接受其他来源。

下载前重新读取所选版本的正式 Release。完整性校验优先使用 GitHub 附件的 `sha256:` digest；没有 digest 时读取同一 Release 的 `SHA256SUMS.txt` 中精确对应安装包的记录。缺少有效校验值时拒绝下载，不提供绕过校验的安装入口。

## 接口与边界

主窗口通过无参数原生命令 `app_check_updates()` 获取：

```ts
{
  currentVersion: string;
  platform: "mac-arm64" | "android" | null;
  update: null | {
    version: string;
    releaseUrl: string;
    downloadUrl: string;
    releaseNotes: string;
    publishedAt: string;
    size: number; // 字节
  };
}
```

原生层仅请求固定 GitHub Releases API，每页最多 100 条、4 MiB，最多读取 5 页；列表不完整时返回错误，不误报已是最新。连接超时 10 秒，单次请求超时 20 秒，限流、网络和格式错误返回可读提示。检查无需文件存储权限，不读取或发送笔记、同步凭据和 API Key。

下载命令只接收版本号；地址、大小和校验值由原生层从固定公开仓库取得：

```ts
app_download_update({version: string}): Promise<DownloadState>;
app_update_download_status(): Promise<DownloadState>;
app_cancel_update_download(): Promise<DownloadState>;
app_open_update_installer(): Promise<void>;

interface DownloadState {
  version: string | null;
  status: "idle" | "downloading" | "verifying" | "ready" |
    "cancelling" | "cancelled" | "error";
  downloaded: number;
  total: number;
  error: string | null;
  revision: number;
}
```

所有命令仅向主窗口开放。启动命令立即返回，下载在原生任务中继续；同时只允许一个任务。取消先进入 `cancelling`，清理半包后进入 `cancelled`，此后可重新下载。每次状态变化增加 `revision`，界面忽略迟到的旧状态。应用存活期间关闭关于页面不停止下载；不承诺退出应用后的系统后台下载或断点续传。

安装包流式写入应用专用缓存 `updates/`，不通过前端传输整包，不进入笔记目录或 GitHub 同步。最大安装包 512 MiB，校验文件最大 64 KiB；任务从元数据查询到保存完成有 15 分钟总时限。每个附件最多 3 次跳转，只接受 HTTPS／443 的 `github.com`、`release-assets.githubusercontent.com` 和 `objects.githubusercontent.com`。下载后检查字节数和 SHA-256，再发布为可打开文件；取消或失败清理半包，清理失败显示错误。点击打开时再次校验，文件丢失或被更改需重新下载。重启应用后再次下载同一版本会重取元数据，已有完整缓存通过校验即可复用。Android 另校验包名、签名和更高的 versionCode，通过专用 FileProvider 只授予安装文件读取权限，不申请公共存储访问权限。

更新下载与插件市场独立，不提供系统后台推送或静默安装。历史发布校验方式见[历史版本说明](RELEASES.md)。

## 验证范围

1.7.5 前端类型检查、生产构建和定向 JavaScript 检查 12／12 通过。最终生产页面在桌面与 390px 手机视口完成 8／8 组真实 Chrome 交互验收，控制台无错误或警告；页面验收使用合成工作区及原生 IPC，不等于系统安装实测。

原生定向检查 16／16 通过。通过真实 GitHub HTTP 下载已发布的 DMG、APK，验证跳转、大小、SHA-256、错误校验拒绝、取消后清理和重试、缓存复用及损坏后重新下载。该验收仅在测试中放宽当前版本门槛以使用已发布附件，生产入口仍固定实际版本、平台与公开仓库。两端安装包及系统安装入口的最终验收结果见 [BUILD.md](BUILD.md)。

Android 16 隔离模拟器通过旧版覆盖升级及私有状态保留，并实际检查首次来源授权、返回后重试、系统 Update 确认页和错误包拒绝。使用最终 APK 的真实安装插件与仅用于验证的高版本候选，未安装该候选；未验证物理手机或 Android 上完整联网下载流程。Mac DMG 完整性与包内容核对通过，未执行 Mac 覆盖安装。
