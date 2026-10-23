# 构建记录

已构建版本：TypePro 1.2.0（Android versionCode `1002000`）。本次顺序生成 Apple Silicon DMG 与包含 ARM64、ARMv7 的个人签名 APK；Mac arm64 架构、应用版本与标识、严格签名校验和 DMG 完整性均通过，APK 版本、ABI、SDK、旧签名一致性、ZIP 16KB 对齐及 ARM64 ELF LOAD 段 16KB 对齐均通过。仅在此前任务专用 Android 16 模拟器 `emulator-5556` 上由 1.1.0 覆盖升级：原索引哈希、4 本笔记、4 篇文档、3 个附件和 1 个启用插件的代码哈希均保持一致。未访问真实用户 Mac 笔记，也未使用物理 Android 设备。

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
bash scripts/package-dmg.sh \
  src-tauri/target/release/bundle/macos/TypePro.app \
  ../../outputs/TypePro-1.2.0-mac-arm64.dmg
```

`package-dmg.sh` 使用 `hdiutil` 包装已签名的 `.app`，包括 Applications 快捷入口；随后执行磁盘映像完整性校验。可通过第一个参数指定 `.app`，第二个参数指定输出 DMG。此步骤不依赖 Finder 的窗口装饰脚本。

应用为 arm64 可执行文件，使用 ad-hoc 签名，未经过 Apple 公证。DMG 只是安装容器；打开后将「TypePro」拖入 Applications。本次显式指定输出为 `TypePro-1.2.0-mac-arm64.dmg`。

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

alias 为 `notebook`。沿用 1.0.0 的相同密钥与包名 `com.localnotes.notebook`，可以覆盖升级并保留应用私有数据。1.2.0 的 Android versionCode 明确配置为 `1002000`，高于 1.1.0 的 `1001000` 与 1.0.0 的 `1000000`；CLI 构建时重新生成 `tauri.properties`。

```sh
npm run tauri -- android build --apk --target aarch64 armv7 --ci
```

APK 输出到 `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`。本次为个人 release 签名，包含 ARM64 和 ARMv7，minSdk 26、targetSdk 36。ARM64 原生库使用 16KB 页面对齐。

保留随源码交付的 Android 工程与自定义 Kotlin 文件，不要再次执行 `android init`。首次构建时 CLI 会生成 `tauri.settings.gradle`、`tauri.build.gradle.kts`、平台资源和本机路径；这些生成文件与构建缓存不在源码压缩包内。

## 检查安装包

```sh
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/TypePro.app
hdiutil verify TypePro-1.2.0-mac-arm64.dmg
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose path/to/app.apk
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 path/to/app.apk
```

源码包包含 npm 和 Cargo 锁文件，不包含 `node_modules`、`target`、Gradle 缓存、应用数据或签名密钥。

## Mac 每本笔记的本地目录

默认布局保持不变：应用数据目录下的 `workspace/index.json`、`workspace/notebooks/<笔记 UUID>/<文档 UUID>.md` 与 `workspace/assets/<附件 UUID>.<扩展名>`。每本笔记可以选择一个已存在的空文件夹，或这本笔记以前使用过的目录；输入支持绝对路径和 `~/`。自定义根目录采用相同的 `notebooks/<笔记 UUID>/<文档 UUID>.md` 与 `assets/…` 布局，Markdown 中的 `../../assets/…` 相对引用无需改写，封面附件一并复制。

本机路径保存在应用私有 `workspace/locations.json`；自定义根目录的 `.typepro-notebook.json` 绑定笔记 UUID。这两份配置不进入 Workspace、笔记 ZIP 或其他设备的导入结果。Android 的目录查询／设置命令会明确拒绝调用，使用固定应用目录。

迁移先在目的根目录内建立隐藏临时目录，完成文档与附件写入，再安装完整文档目录，最后原子更新本机路径映射。源目录与原始文件不删除；再次迁入曾使用的目录时，已有文档目录先保留在 `.typepro-history/<笔记 UUID>/<备份 UUID>/`。默认目录的原副本会标记保留，避免后续清理误删。目的目录中的同名附件内容不一致时拒绝覆盖；目录互相包含、其他笔记占用、路径跳转、符号链接及无效目录标识都会报错。

应用继续直接读取所选目录的 Markdown，外部编辑器改动会在重新加载时读入。自定义目录缺失或失去权限时明确报错，禁止退回默认目录的旧副本；恢复目录后可重新加载。新的附件、从其他笔记移动来的文档及外部相邻附件在保存时复制到相应根目录，原有本地缺失图片不会阻止普通 Markdown 保存，但缺失附件会阻止需要完整副本的迁移和 ZIP 导出。保存仍沿用 `pending.json` 恢复日志，日志恢复遵循当前已提交的目录映射。

原生命令：`get_notebook_location({notebookId})` 返回 `{path, custom}`；`set_notebook_location({notebookId, path})` 使用相同返回值，`path: null` 迁回默认根目录。迁移前界面必须先完成待保存内容；原生命令由既有全局存储互斥锁串行执行。

本次原生存储验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib storage::tests --offline` 通过 22 项测试，覆盖旧版格式／ZIP、真实临时目录迁移、附件相对路径、外部改动、跨目录移动、回迁备份、目标冲突、失效目录、保存恢复日志及路径映射提交失败后保留旧目录并重试。另用已有依赖将同一存储模块以 `--cfg mobile` 编译为独立测试程序，通过 14 项测试，包含手机目录命令在访问文件前拒绝调用。此项为手机条件分支验证，不代替 Android APK 安装验收。

## 1.2.0 安装包验收记录

- Mac：`file` 与 `lipo -archs` 确认为 arm64，Info.plist 为 1.2.0／`com.localnotes.notebook`；`codesign --verify --deep --strict` 与 `hdiutil verify` 通过。未运行真实用户目录下的 Mac 应用或替换 Applications 中的安装。
- Android：`aapt dump badging` 确认为 1.2.0／1002000、minSdk 26、targetSdk 36、ARM64 + ARMv7；`apksigner verify --verbose --print-certs` 通过，证书 SHA-256 与 1.1.0 完全一致。`zipalign -c -P 16 -v 4` 通过，提取 ARM64 原生库用 NDK `llvm-readelf -lW` 检查，全部 LOAD 段均为 `0x4000` 对齐。
- 升级：专用模拟器使用原 userdata，执行 `adb -s emulator-5556 install -r` 返回 Success；没有卸载、清数据或重建模拟器。索引 SHA-256 完全一致；4 本旧笔记、4 篇文档、3 个附件和启用插件的代码／启用状态逐项一致。
- 启动：无窗口的专用模拟器中，真实 APK 的 MainActivity 冷启动返回 `Status: ok`；观察 80 秒后进程仍存活，启动后 crash buffer 无新增记录，应用日志没有 fatal exception、native fatal signal 或 Rust panic。
- 验收边界：APK 未做原生界面操作；实际交互通过本任务的本地浏览器与手机视口验收，不能将其记为 Android 设备原生 UI 验收。Mac 本次为架构、签名与镜像检查，未在真实用户数据上启动。模拟器保留运行，未触碰物理设备。

| 安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.2.0-mac-arm64.dmg | 9,415,321 | `1417aa20ab3d55953a963af4c5fca6f130549416e65810d4ee8a576b694d57e7` |
| TypePro-1.2.0-android.apk | 24,287,341 | `4c51c1b43879025bc560f1c5dd093a3f00daa043633605a9a824c26e2650276b` |
