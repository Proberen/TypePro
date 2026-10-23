# 应用版本更新

TypePro 1.7.3 起提供应用更新提醒。更新源固定为公开仓库 [Proberen/TypePro 的 Releases](https://github.com/Proberen/TypePro/releases)，不需要 GitHub 登录，与笔记同步和插件市场独立。

## 使用方式

- 启动并进入应用时检查；持续使用期间，每隔 24 小时在前台检查一次。后台不发起自动检查，回到前台后补查已到期的检查。
- 「关于 TypePro」提供手动检查，不受每日间隔限制；同时进行的检查合并为一次。
- 发现更新后显示可关闭的轻提示，点击「查看更新」打开关于页面，阅读升级说明并选择「下载更新」。关闭提示只对本次应用会话中的该版本生效，关于页面仍可查看。
- 下载交给系统浏览器，Mac 下载 Apple Silicon DMG，Android 下载 APK。下载完成后手动安装，不自动覆盖或重启应用。
- 网络失败不会阻塞笔记功能；关于页面显示错误并可手动重试。自动检查按最近一次尝试计算间隔，不持续重试。

旧版本首次升级到 1.7.3 仍需从 Releases 手动下载安装包，此后才能使用应用内提醒。

## 发布约定

更新检查按版本号数值比较，选择高于当前应用、且有当前平台安装包的最高正式版。草稿、预发布、未发布记录和非 `v主版本.次版本.修订号` 标签不会提示；发布先后顺序不影响选择。某版只有 APK 时，Mac 继续检查其他有 DMG 的正式版。

发布时必须使用以下标签和附件名，附件上传完整后再公开 Release：

```text
标签：v1.7.4
Mac：TypePro-1.7.4-mac-arm64.dmg
Android：TypePro-1.7.4-android.apk
```

Release 正文作为升级说明按纯文本显示。源码 ZIP、校验文件不作为应用安装包。下载地址必须精确匹配同一仓库、版本及平台的 Release 附件，不接受其他来源。

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

这是前台版本检查和浏览器下载，不提供系统后台推送、自动安装或应用内安装包完整性校验。下载后的校验方式见[历史版本说明](RELEASES.md)。插件仍由独立插件市场管理更新。
