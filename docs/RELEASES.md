# 下载与历史版本

[最新版](https://github.com/Proberen/TypePro/releases/latest) · [所有 Releases](https://github.com/Proberen/TypePro/releases)

| 版本 | Mac（Apple Silicon） | Android | 源码 |
| --- | --- | --- | --- |
| [1.7.6](https://github.com/Proberen/TypePro/releases/tag/v1.7.6) | DMG | APK | 标签与源码 ZIP |
| [1.7.5](https://github.com/Proberen/TypePro/releases/tag/v1.7.5) | DMG | APK | 标签与源码 ZIP |
| [1.7.4](https://github.com/Proberen/TypePro/releases/tag/v1.7.4) | DMG | APK | 标签与源码 ZIP |
| [1.7.3](https://github.com/Proberen/TypePro/releases/tag/v1.7.3) | DMG | APK | 标签与源码 ZIP |
| [1.7.2](https://github.com/Proberen/TypePro/releases/tag/v1.7.2) | DMG | APK | 标签与原始 ZIP |
| [1.7.1](https://github.com/Proberen/TypePro/releases/tag/v1.7.1) | DMG | APK | 标签与原始 ZIP |
| [1.7.0](https://github.com/Proberen/TypePro/releases/tag/v1.7.0) | DMG | APK | 标签与原始 ZIP |
| [1.6.0](https://github.com/Proberen/TypePro/releases/tag/v1.6.0) | DMG | APK | 标签与原始 ZIP |
| [1.5.0](https://github.com/Proberen/TypePro/releases/tag/v1.5.0) | DMG | APK | 标签与原始 ZIP |
| [1.4.0](https://github.com/Proberen/TypePro/releases/tag/v1.4.0) | DMG | APK | 标签与原始 ZIP |
| [1.3.2](https://github.com/Proberen/TypePro/releases/tag/v1.3.2) | 没有此版安装包，沿用 1.3.1 | APK | 标签与原始 ZIP |
| [1.3.1](https://github.com/Proberen/TypePro/releases/tag/v1.3.1) | DMG | APK | 标签与原始 ZIP |
| [1.3.0](https://github.com/Proberen/TypePro/releases/tag/v1.3.0) | DMG | APK | 标签与原始 ZIP |
| [1.2.2](https://github.com/Proberen/TypePro/releases/tag/v1.2.2) | DMG | APK | 标签与原始 ZIP |
| [1.2.1](https://github.com/Proberen/TypePro/releases/tag/v1.2.1) | DMG | APK | 标签与原始 ZIP |
| [1.2.0](https://github.com/Proberen/TypePro/releases/tag/v1.2.0) | DMG | APK | 标签与原始 ZIP |
| [1.1.0](https://github.com/Proberen/TypePro/releases/tag/v1.1.0) | DMG | APK | 标签与原始 ZIP |
| [1.0.0](https://github.com/Proberen/TypePro/releases/tag/v1.0.0) | DMG | APK | 标签与原始 ZIP |

## 安装与校验

每个 Release 附带现有安装包、`TypePro-版本-source.zip` 和 `SHA256SUMS.txt`，升级说明在 Release 正文。Mac 包为个人使用的 ad-hoc 签名，未经过 Apple 公证；Android 沿用各次原始交付签名，覆盖升级请使用对应官方附件。最早 1.0.0 原名「笔记」，附件统一改为 TypePro 文件名，安装包内容没有改变。

下载文件后可在其目录运行 `shasum -a 256 -c SHA256SUMS.txt` 校验；仅下载部分附件时，其余文件会提示缺失，可单独比对已下载文件的校验值。

## 归档来源

2026-10-23 从 14 份已交付源码 ZIP 导入 1.0.0 至 1.7.2 的版本快照，保留每版源文件内容，另加根目录 MIT 许可证，ZIP 内部的 `SOURCE_MANIFEST.sha256` 不写入 Git 树。导入提交时间是归档时间，不代表原开发时间。开源归档提交另补充下载入口、版本索引、忽略规则和许可证元数据，没有修改当时的应用业务代码；1.7.3 起继续以正常源码提交维护。

1.0.0 至 1.7.2 Release 的 `source.zip` 是原始交付附件，字节及内部文件清单保持不变；GitHub 自动提供的标签源码包则包含仓库里的 MIT 许可证和归档元数据。1.7.3 起的源码 ZIP 与发布标签逐文件核对。仓库作者的代码按 MIT 授权，第三方依赖按其原许可证使用。归档不表示已重新构建或验证全部旧版本。

应用、NAS 服务及示例源码在本仓库；独立插件、SDK 和市场发布流程在 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins)。插件版本与 App 版本独立。

笔记、同步凭据、模型 API Key、Android 签名密钥和本机环境配置不在公开仓库。GitHub 笔记同步的内置 App 当前供 Proberen 账号使用，其他账号的配置见 [GITHUB.md](GITHUB.md)。
