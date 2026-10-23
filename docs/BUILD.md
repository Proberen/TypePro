# 构建记录

已构建版本：TypePro 1.1.0。以下环境已实际生成 Apple Silicon DMG 与包含 ARM64、ARMv7 的个人签名 APK。Mac 应用签名和 DMG 完整性校验通过，APK 签名及 16KB 对齐校验通过；独立 Android 16 模拟器由 1.0.0 覆盖升级成功，旧笔记与插件保留。

| 工具 | 版本 |
| --- | --- |
| 主机 | Apple Silicon，macOS 26.2，Xcode Command Line Tools |
| Node.js / npm | 25.9.0 / 11.12.1 |
| Rust | 1.95.0 |
| Tauri CLI / Rust | 2.12.3 / 2.12.4 |
| Java | Temurin 17.0.19 |
| Android SDK / Build Tools | API 36 / 36.0.0 |
| Android NDK | 27.2.12479018 |
| Gradle / Android Gradle Plugin | 9.6.1 / 9.3.1 |
| Kotlin | 2.2.10 |

## Mac

在 Apple Silicon Mac 的项目目录执行：

```sh
npm ci
CARGO_BUILD_JOBS=2 npm run tauri -- build --bundles app
bash scripts/package-dmg.sh
```

`package-dmg.sh` 使用 `hdiutil` 包装已签名的 `.app`，包括 Applications 快捷入口；随后执行磁盘映像完整性校验。可通过第一个参数指定 `.app`，第二个参数指定输出 DMG。此步骤不依赖 Finder 的窗口装饰脚本。

应用为 arm64 可执行文件，使用 ad-hoc 签名，未经过 Apple 公证。DMG 只是安装容器；打开后将「TypePro」拖入 Applications。默认输出为 `TypePro-1.1.0-mac-arm64.dmg`。

## Android

先安装 SDK 包 `platforms;android-36`、`build-tools;36.0.0`、`ndk;27.2.12479018`，并将 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 设置为对应本地路径。

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export CARGO_BUILD_JOBS=2
npm ci
```

从单独保管的 Android 签名备份设置下列环境变量。不要写入源代码、公开脚本或日志。

```text
NOTEBOOK_KEYSTORE_PATH
NOTEBOOK_KEYSTORE_PASSWORD
NOTEBOOK_KEY_ALIAS
NOTEBOOK_KEY_PASSWORD
```

alias 为 `notebook`。沿用 1.0.0 的相同密钥与包名 `com.localnotes.notebook`，可以覆盖升级并保留应用私有数据。1.1.0 的 Android versionCode 明确配置为 `1001000`，高于 1.0.0 的 `1000000`；CLI 构建时重新生成 `tauri.properties`。

```sh
npm run tauri -- android build --apk --target aarch64 armv7 --ci
```

APK 输出到 `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`。本次为个人 release 签名，包含 ARM64 和 ARMv7，minSdk 26、targetSdk 36。ARM64 原生库使用 16KB 页面对齐。

保留随源码交付的 Android 工程与自定义 Kotlin 文件，不要再次执行 `android init`。首次构建时 CLI 会生成 `tauri.settings.gradle`、`tauri.build.gradle.kts`、平台资源和本机路径；这些生成文件与构建缓存不在源码压缩包内。

## 检查安装包

```sh
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/TypePro.app
hdiutil verify TypePro-1.1.0-mac-arm64.dmg
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose path/to/app.apk
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 path/to/app.apk
```

源码包包含 npm 和 Cargo 锁文件，不包含 `node_modules`、`target`、Gradle 缓存、应用数据或签名密钥。
