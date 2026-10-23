# 构建记录

当前交付为 TypePro 1.6.0（Android versionCode `1006000`）及每日打卡 1.1.0、AI 助手 1.1.1（API 3）。本次已按授权完成 DMG／APK 构建、必要检查与插件远程发布；以下记录来自本版实际证据，历史版本记录不代替本版验收。

## 1.6.0 通用插件宿主交付记录（2026-10-22）

- 本次 App 升级将打卡与 AI 的业务、界面迁出主程序，提供 API 3 通用宿主。之后已有接口范围内的插件业务和界面可独立发布，只有新增宿主能力或不兼容接口才需要升级 App。
- 已通过：TypeScript 类型检查、Rust 41 项、独立插件 17 项（打卡 7、AI 数据／Skill／工具 7、SSE 3）、分发 35 项、纯 JavaScript SDK 8 项。插件测试使用 Node.js 22.23.2 的类型擦除与已有依赖；未在本地执行插件发布打包入口。详细范围见 [审查记录](PLUGIN-REFACTOR-REVIEW.md)。
- 已完成静态契约核对与 Ponytail review；删除两个无用字段，最终复查无新增简化项。
- Mac：1.6.0、`com.localnotes.notebook`、arm64，严格 codesign 与 hdiutil 校验通过，ad-hoc 签名、未公证。实际证据在工作区 `work/typepro-160-review/mac-package.json`。
- Android：1.6.0／1006000、`com.localnotes.notebook`、ARM64＋ARMv7，minSdk 26、targetSdk 36。构建生成 unsigned APK 后，使用已有个人 release 密钥由 apksigner 签名；签名校验通过，证书与 1.5.0 相同。ZIP 16 KiB 与 ARM64 ELF 全部 LOAD 段 `0x4000` 对齐检查通过。实际证据在工作区 `work/typepro-160-review/android-package.json`。
- 插件：[Publish plugins #7](https://github.com/Proberen/typepro-plugins/actions/runs/39759657722) 于源提交 `218ec1d6cc2a3ae573de860e0d83cc645d73e588` 成功，耗时 29 秒。首次每日打卡 1.1.0、AI 助手 1.1.0 Release 与 `catalog-v3.json` 已发布，目录 `updatedAt` 为 `2026-10-22T09:59:40Z`。实际 App `plugin_market.rs` 的 `Market::catalog`／`Market::download` 真实读取目录并下载全部 3 个包，大小和 SHA-256 校验通过；ZIP CRC、Manifest 与 JS/CSS 资源结构核对通过。`catalog.json` 和 `catalog-v2.json` 的条目与冻结基线完全一致；此次检查没有执行下载的插件代码。证据在工作区 `work/typepro-160-review/native-market-result.json` 与 `native-market-packages.json`。
- AI 助手 1.1.1：只将插件 `ui.tsx` 中的 `base.css` 导入移至组件样式前，修复桌面错误显示移动端按钮的样式覆盖问题；App 1.6.0 和每日打卡 1.1.0 保持不变。[Publish plugins #8](https://github.com/Proberen/typepro-plugins/actions/runs/39761719863) 在源提交 `9a0d4b3b3398d699e84f53bad31239d65101c536` 上成功，耗时 24 秒；补丁已由原生模块真实下载，300248 字节、SHA-256 `f9c3ffc4e2614ee17b585eb4aebc9f0bdeb164b4d4fdbfa720466bc0b7b89599`，ZIP CRC 与资源结构校验通过；v1／v2 及 v3 其他条目未变。证据在工作区 `work/typepro-160-review/native-market-ai-111-result.json` 与 `native-market-ai-111-packages.json`。
- 独立 WKWebView 在模拟 Tauri 资源 CSP／nonce 注入下完成 9／9 项检查：Worker 与视图启动、动态 Blob 脚本和样式、opaque origin 隔离、Worker 直连网络移除及缺少脚本／样式 nonce 的负对照通过。该检查使用真实 WKWebView，但不是打包 Tauri App UI 验收；证据在工作区 `work/typepro-160-review/wkwebview-csp-result.json`。
- 本轮未验收打包 App UI、物理手机、系统文件选择器、Keychain／Keystore、真实模型流式响应和两台设备联网同步恢复。API Key 仍每台设备单独配置，不进入 GitHub。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.6.0-mac-arm64.dmg | 13453572 | `0ef7fa2d86399dd12a5aca5c6880bfc3abdead69f0c0828d3eba7a06c893e0c7` |
| TypePro-1.6.0-android.apk | 34314140 | `85563a416e7edc8a1017e83430b95957a286af10e52b1d0824e95f9212b74e86` |
| notebook.ai-assistant 1.1.1 ZIP | 300248 | `f9c3ffc4e2614ee17b585eb4aebc9f0bdeb164b4d4fdbfa720466bc0b7b89599` |
| notebook.daily-checkin 1.1.0 ZIP | 237939 | `644ca726105fb7fa779175c0a5ab0fec305a00afc95f345a7dc59ae5aaf186e0` |

已发布的每日打卡 1.1.0 与 AI 助手 1.1.1 ZIP 视图资源另经独立 WKWebView 验证：打卡首页 13 项、AI 桌面会话页 15 项、AI 设置页 16 项、AI 窄屏页 17 项，共 61 项通过，包含桌面移动按钮隐藏和窄屏历史栏开关。使用模拟存储、Key 状态及受限 RPC，不启动业务 Worker、不访问真实笔记或模型；窄屏历史栏的 fixture 使用 `transition: none` 模拟 reduced-motion，默认动画时序未验证。结果在工作区 `work/typepro-160-review/plugin-ui-summary.json`，截图在交付目录 `TypePro-1.6.0-验收/`。这仍不等同正式 App、物理设备、真实模型或双设备联网同步验收。

## 构建参考环境

以下为可复现构建参考，工具表来自此前已完成的 1.5.0 构建；1.6.0 的实际构建结果以上方交付记录与证据为准。命令示例不代替执行授权或成功回执。

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
  ../../outputs/TypePro-1.6.0-mac-arm64.dmg
```

`package-dmg.sh` 使用 `hdiutil` 包装已签名的 `.app`，包括 Applications 快捷入口；随后执行磁盘映像完整性校验。可通过第一个参数指定 `.app`，第二个参数指定输出 DMG。此步骤不依赖 Finder 的窗口装饰脚本。

构建目标为 arm64 可执行文件，使用 ad-hoc 签名，未经过 Apple 公证。DMG 只是安装容器；打开后将「TypePro」拖入 Applications。示例显式指定输出为 `TypePro-1.6.0-mac-arm64.dmg`；本版已生成并通过以上检查，详见上方交付记录。

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

alias 为 `notebook`。沿用 1.0.0 的相同密钥与包名 `com.localnotes.notebook`，可以覆盖升级并保留应用私有数据。1.6.0 的 Android versionCode 配置为 `1006000`，高于 1.5.0 的 `1005000`；CLI 构建时重新生成 `tauri.properties`。本版已完成构建和独立签名，详见上方交付记录。

```sh
npm run tauri -- android build --apk --target aarch64 armv7 --ci
```

本轮 Gradle 先生成 `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`，随后使用已有个人 release 密钥，通过 apksigner 签名输出交付 APK；密钥及密码从独立签名备份读取，密码不写入参数或日志。以下示例使用已配置的环境变量：

```sh
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign \
  --ks "$NOTEBOOK_KEYSTORE_PATH" \
  --ks-key-alias "$NOTEBOOK_KEY_ALIAS" \
  --ks-pass env:NOTEBOOK_KEYSTORE_PASSWORD \
  --key-pass env:NOTEBOOK_KEY_PASSWORD \
  --out ../../outputs/TypePro-1.6.0-android.apk \
  src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

后续构建应沿用个人 release 签名、ARM64 和 ARMv7、minSdk 26、targetSdk 36，并检查 ZIP 与 ARM64 原生库的 16 KiB 对齐；本版实际检查结果见上方交付记录。未签名 APK 不能作为升级交付包。

保留随源码交付的 Android 工程与自定义 Kotlin 文件，不要再次执行 `android init`。首次构建时 CLI 会生成 `tauri.settings.gradle`、`tauri.build.gradle.kts`、平台资源和本机路径；这些生成文件与构建缓存不在源码压缩包内。

### Android 桌面图标

已确认的图标源为 `src-tauri/icons/icon.png`，App 内 Logo 为 `public/typepro-logo.png`。Android 不直接使用这两个文件，而是使用独立的 mipmap 资源。修改图标时，用 Tauri 自带的 `icon` 命令从图标源生成临时资源，将生成的 `android/mipmap-*/` 中的 PNG 同时更新到 `src-tauri/icons/android/` 和 `src-tauri/gen/android/app/src/main/res/` 对应目录；不要覆盖自定义原生工程。所有五种密度的普通、圆形及自适应前景均需更新。

Manifest 的 `@mipmap/ic_launcher` 在 Android 8 及以上通过 `mipmap-anydpi-v26/ic_launcher.xml` 引用 `@mipmap/ic_launcher_foreground`，背景为白色。交付前应核对 APK 内实际打包的资源，不能只检查 App 内 Logo 或 Mac 的 `.icns`。

## 检查安装包

```sh
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/TypePro.app
hdiutil verify TypePro-1.6.0-mac-arm64.dmg
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose path/to/app.apk
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 path/to/app.apk
```

源码包包含 npm 和 Cargo 锁文件，不包含 `node_modules`、`target`、Gradle 缓存、应用数据或签名密钥。

## 1.5.0 每日打卡、AI 与插件同步交付（2026-10-22）

- 两个 API 2 插件均为 1.0.0，已提交并发布到 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins)。[自动发布 #6](https://github.com/Proberen/typepro-plugins/actions/runs/39746913710) 成功，远端 10 份源码逐字节等于本地；新目录包含三个插件，旧目录继续只包含日期与字数 API 1 插件。
- 实际原生市场模块读取公开目录，对全部三个插件执行下载与固定版本恢复，验证 Release 跳转、包大小、SHA-256 与恢复字节一致；未执行下载的插件代码或使用私有仓库凭据。
- 前端构建与 TypeScript 检查通过。针对性前端测试 58 项通过（打卡 7、市场 5、安装恢复 7、插件状态 5、同步合并 18、同步流程 9、AI 数据／Skill／工具 7）；夏令时时区复核同组打卡 7 项通过，不重复计数。Rust 全部 46 项、发布脚本 11 项通过。
- Ponytail 按 1.4.0 源码基线仅审查本次差异，删除没有消费者的 AI usage 请求、解析和跨桥传输链路；未做无关重构。
- 页面路径为隔离服务 `http://127.0.0.1:1462/`，使用真实 AssistantPage、Home、ActivityHeatmap 与模拟笔记／模型；没有读取生产数据或发送模型请求。内置 CUA IAB 桌面 1280×720、390px 手机内嵌视口检查浅色／深色、首页热力图、日期明细、手机会话抽屉、模型／系统提示词／Skill 设置、新会话空态。
- 实际交互确认问答显示笔记来源、写入前显示差异、确认后保存、并发修改阻止旧内容覆盖、停止回复立即恢复输入。页面有有效内容，无框架错误层。服务热更新曾产生一条重复 createRoot 开发日志；新建干净验收标签页后的 warn/error 为空。
- 真实 PluginHost 加载两份已公开源码，经原版 sandbox.html／sandbox.js／Worker 注册；五条断言全部通过，2 个 iframe、1 个首页打卡组件、1 个 AI 页面和 1 个命令。运行真实命令后 `pages.open` 成功打开 AI 页；此入口稳定加载后的控制台 warn/error 为空，AI 与笔记数据仍为模拟。
- Mac：arm64、1.5.0、`com.localnotes.notebook`，严格 codesign 与 DMG 镜像校验通过，ad-hoc 签名，未公证。DMG 13458933 字节，SHA-256 `7922665cc250d747d9a67536ae71b495267c0fe3ba2f2405719f913755272fe1`。
- Android：1.5.0／1005000，ARM64＋ARMv7，minSdk 26、targetSdk 36，签名验证通过且与 1.4.0 一致；ZIP 16 KiB 与 ARM64 ELF LOAD 0x4000 对齐通过。APK 34288857 字节，SHA-256 `4763e7b90936daf20d8fb8dbafea13c52585ac17d755ca9ac5a2f35dc6e7783d`。
- API Key 存于当前设备安全存储，不随插件状态同步。会话、模型、全局提示词、导入 Skill、打卡、安装版本与卸载记录随私有笔记仓库同步；新设备恢复后仍需确认插件权限。先将 Mac 与 Android 都升级到 1.5.0，再首次同步扩展数据，1.4.x 无法读取新版扩展清单。
- 未在物理手机上验收、未覆盖或启动生产 Mac 应用、未调用真实 DeepSeek 付费接口，未执行两台设备真实联网同步。本版构建、程序检查、组件模拟验收和公共插件下载验证不能视为这些端到端验收。检查记录在工作区 `work/typepro-150-review/`，截图在交付目录 `TypePro-1.5.0-验收/`。

## 1.4.0 插件市场交付与验证（2026-10-22）

- 版本配置为 1.4.0／1004000；应用标识、笔记格式与 Android 签名证书保持不变。
- 公开仓库 [Proberen/typepro-plugins](https://github.com/Proberen/typepro-plugins) 已创建并完成首次自动发布；[工作流 #1](https://github.com/Proberen/typepro-plugins/actions/runs/39735747851) 的 7 项发布测试与实际 Release、清单提交成功。
- 前端市场针对性测试 5 项、原生市场测试 3 项通过，构建中的 TypeScript 检查通过。Ponytail 仅审查本次市场差异，结论为 `Lean already. Ship.`。
- 实际 Rust 市场模块从公开目录读取示例，并通过 GitHub Release 跳转下载 1286 字节 ZIP，大小与 SHA-256 一致；公开发布的 7 份源码与本地文件逐字节一致。未执行插件代码或访问同步凭据。
- 隔离浏览器页直接加载真实 PluginManager、Modal 与 useAppearance，仅替换原生传输，检查搜索空结果、安装默认停用、权限确认、重新打开、同权限更新保留启用、新增权限更新停用、移除及浅色／深色显示。此项为组件验收，不能替代原生设备 UI 验收。
- Mac：arm64、标识 `com.localnotes.notebook`、1.4.0，严格 codesign 与 DMG 完整性检查通过；ad-hoc 签名，未公证。DMG 为 13378431 字节，SHA-256 `f9c49d3e1194f158dd7d606f7b8333c3a1af73f8a0f59d487bfbf7bfa611f390`。
- Android：1.4.0／1004000，ARM64 与 ARMv7，minSdk 26、targetSdk 36，签名与 1.3.2 一致，ZIP 与 ARM64 ELF 的 16 KiB 对齐检查通过。APK 为 33934317 字节，SHA-256 `ad53897f56ee1024d36e18c61ab4d93fac82c7dcbfdf8c3c460a044e08b82b7c`。
- 本次未安装／覆盖用户正在运行的 Mac 应用，也未在物理手机上验收；实际笔记与私有仓库授权未用于市场验证。测试记录位于工作区 `work/typepro-140-qa/`。

## Mac 每本笔记的本地目录

默认布局保持不变：应用数据目录下的 `workspace/index.json`、`workspace/notebooks/<笔记 UUID>/<文档 UUID>.md` 与 `workspace/assets/<附件 UUID>.<扩展名>`。每本笔记可以选择一个已存在的空文件夹，或这本笔记以前使用过的目录；输入支持绝对路径和 `~/`。自定义根目录采用相同的 `notebooks/<笔记 UUID>/<文档 UUID>.md` 与 `assets/…` 布局，Markdown 中的 `../../assets/…` 相对引用无需改写，封面附件一并复制。

本机路径保存在应用私有 `workspace/locations.json`；自定义根目录的 `.typepro-notebook.json` 绑定笔记 UUID。这两份配置不进入 Workspace、笔记 ZIP 或其他设备的导入结果。Android 的目录查询／设置命令会明确拒绝调用，使用固定应用目录。

迁移先在目的根目录内建立隐藏临时目录，完成文档与附件写入，再安装完整文档目录，最后原子更新本机路径映射。源目录与原始文件不删除；再次迁入曾使用的目录时，已有文档目录先保留在 `.typepro-history/<笔记 UUID>/<备份 UUID>/`。默认目录的原副本会标记保留，避免后续清理误删。目的目录中的同名附件内容不一致时拒绝覆盖；目录互相包含、其他笔记占用、路径跳转、符号链接及无效目录标识都会报错。

应用继续直接读取所选目录的 Markdown，外部编辑器改动会在重新加载时读入。自定义目录缺失或失去权限时明确报错，禁止退回默认目录的旧副本；恢复目录后可重新加载。新的附件、从其他笔记移动来的文档及外部相邻附件在保存时复制到相应根目录，原有本地缺失图片不会阻止普通 Markdown 保存，但缺失附件会阻止需要完整副本的迁移和 ZIP 导出。保存仍沿用 `pending.json` 恢复日志，日志恢复遵循当前已提交的目录映射。

原生命令：`get_notebook_location({notebookId})` 返回 `{path, custom}`；`set_notebook_location({notebookId, path})` 使用相同返回值，`path: null` 迁回默认根目录。迁移前界面必须先完成待保存内容；原生命令由既有全局存储互斥锁串行执行。

1.2.0 时已完成的原生存储验证（1.2.1 与 1.2.2 未修改存储模块，未重复运行）：`cargo test --manifest-path src-tauri/Cargo.toml --lib storage::tests --offline` 通过 22 项测试，覆盖旧版格式／ZIP、真实临时目录迁移、附件相对路径、外部改动、跨目录移动、回迁备份、目标冲突、失效目录、保存恢复日志及路径映射提交失败后保留旧目录并重试。另用已有依赖将同一存储模块以 `--cfg mobile` 编译为独立测试程序，通过 14 项测试，包含手机目录命令在访问文件前拒绝调用。此项为手机条件分支验证，不代替 Android APK 安装验收。

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


## 1.2.1 前端验收记录

- `npx tsc -b --pretty false` 通过；编辑器、独立代码历史、跨编辑器撤销、流程图和格式化共 59 项针对性测试通过。
- 生产构建资源在严格 CSP、仅同源网络允许的独立页面验收：14 种语言成功格式化并保持幂等、12 种语言错误输入拒绝、单步撤销和异步过期结果保护，28 项全部通过。纯文本只清理行尾空白；HTML 使用 HTML 格式化器。
- 实际浏览器桌面 1280×720／手机 390×844 验证常驻左侧大纲、嵌套标题、跳转保持展开、显式关闭及焦点恢复；手机使用抽屉且页面不横向溢出。
- 实际输入验证 300 行代码与追加行、Tab／Shift+Tab、普通代码和 Mermaid 的 ⌥⇧F、格式化撤销、语法错误保留原文并提示、正文与代码交替撤销／重做、保存与阅读切换、折叠离开后重进和阅读保留、既有流程图再次编辑。相关页面控制台无 warn/error。
- Ponytail 仅审查本次差异，删除重复 Prettier alias 与重复布局规则，随后类型检查、59 项测试与生产浏览器 28 项检查再次通过。
- 浏览器使用隔离测试存储；未覆盖完整中文输入法候选交互。原生包与覆盖升级验收单独记录。Mac 专用 QA 应用使用不同标识 `com.localnotes.typepro121qa`，从 `tauri://localhost` 加载同一生产格式化模块，在真实 WKWebView 内运行上述 28 项检查全部通过；已退出，未启动生产 Mac 应用。


## 1.2.1 安装包验收记录

- Mac：顺序构建 `.app` 后包装 DMG；arm64、版本 1.2.1、标识 `com.localnotes.notebook`，严格 codesign 校验与 hdiutil 镜像校验均通过。生产 Mac 应用未启动，未访问真实笔记。
- Android：随后构建 APK，版本 1.2.1／1002001，minSdk 26、targetSdk 36，ARM64＋ARMv7；apksigner 验证通过，证书与 1.2.0 一致；ZIP 16KB 对齐、ARM64 原生库所有 ELF LOAD 段 0x4000 对齐通过。
- 覆盖升级：仅任务专用 Android 16／API 36 模拟器 NotebookTest，保留原 userdata，从 1.2.0 执行 install -r 成功。安装后和冷启动后，索引 SHA256、4 本笔记、4 篇文档、3 个附件、1 个启用插件的内容／代码哈希及状态全部保持一致。
- 冷启动：MainActivity 返回 Status ok／COLD；80.7 秒内 16 次采样保持同一 PID，crash buffer 无新增、无 fatal／native signal／Rust panic。没有应用 JS uncaught 或 CSP refused 日志。专用 AVD 已正常关闭并保留数据。
- 界限：安卓原生 UI 未操作；桌面／手机交互来自隔离浏览器测试。Mac 额外核验仅独立格式化 QA 应用，不能视为生产 Mac 全界面验收。物理手机、Android 8 与第三方文件提供器未实测。

| 安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.2.1-mac-arm64.dmg | 12,528,979 | `56d557eef348ebdb83b9c1002bc6e36b0e4f5c55c29be878d87bf481afcb4147` |
| TypePro-1.2.1-android.apk | 30,475,977 | `01ea56f30db88453c7b39fb6ed21c9bf21e7a93d76990a6e4518a56ad4a1663f` |

## 1.2.2 前端验收记录

- `npx tsc -b --pretty false`、`git diff --check` 通过。37 项针对性测试通过：块定位、标题仅移动自身、真实节点身份、任务／嵌套列表结构、跨容器排序、末块删除补正文、独立代码历史、原生单步撤销、图片四角比例／宽度约束、相对附件路径和 HTML 多图尺寸往返；同时运行相关 Markdown 与 CodeMirror 回归。
- 实际浏览器桌面 1280×720、手机视口 390×844；Browser 插件未提供，沿用内置 CUA 的 IAB 操作，未另开外部浏览器。页面标识与正文正常，无框架错误覆盖层，相关控制台 warn/error 为空。
- 实际交互：代码区 computed cursor 为 text、行号为 default；输入代码后上移／拖动、删除和单步撤销，恢复后独立代码撤销仍有效；折叠代码删除撤销保持折叠。表格、引用、公式、流程图、标题分别删除并单步恢复。列表项拖出原列表后保持合法列表结构与原内容，没有根级裸 LI，撤销恢复原位置。
- 图片实际拖动两次等比缩放至 711、481 CSS px；单步撤销／重做、阅读、离开重进文档均保留尺寸。独立 HTML 图片再次进入时仅显示图片，无源码行或灰底。手机视口响应式显示为正文宽度 307px，保留源 width=481；页面无横向溢出，把手不盖住行首。
- 阅读时隐藏块操作和缩放控件。截图在交付目录 screenshots/TypePro-1.2.2。图片 canonical 相对附件引用通过真实 Lute 往返与历史测试；浏览器临时附件仅存内存，不能用刷新后显示结果代替原生磁盘附件验收。
- Ponytail 按当前任务基线仅审查本次差异，没有新增依赖或另造撤销引擎；未发现需要进行的行为等价简化。
- 本次未改格式化引擎或原生存储，未重跑旧版完整格式化／目录迁移测试。真实触屏长按拖动、物理手机和完整中文输入法候选未实测；手机视口检查不等于 Android 原生 UI 验收。

## 1.2.2 安装包验收记录

- Mac：正常生产配置顺序构建，arm64、版本 1.2.2、标识 `com.localnotes.notebook`；严格 codesign 与 hdiutil 校验通过。未启动生产 Mac 应用，未访问真实笔记。
- Android：随后构建，版本 1.2.2／1002002、minSdk 26、targetSdk 36，ARM64＋ARMv7；apksigner 通过，证书与 1.2.1 相同；ZIP 16KB 和 ARM64 ELF LOAD 段 0x4000 对齐通过。
- 专用 NotebookTest 模拟器沿用原 userdata，1.2.1 覆盖安装 1.2.2 成功；安装后索引、4 本笔记、4 篇文档、3 个附件、1 个启用插件的内容哈希和状态逐项一致。没有卸载、清数据或操作物理设备。
- MainActivity 冷启动返回 `Status: ok / COLD`；45.6 秒内 9 次采样保持相同 PID，crash buffer 无新增，应用日志无 fatal／native signal／Rust panic／uncaught／CSP 拒绝。启动后再次核对全部数据哈希一致。专用 AVD 已正常关闭，保留 userdata。

| 安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.2.2-mac-arm64.dmg | 12,533,548 | `7b06799c975602422e8a56032a4fc26de5e355c0e326608c39212bfe4bed18d9` |
| TypePro-1.2.2-android.apk | 30,483,317 | `fa9c70b4f4759b1337167e9135e87f2151d27af876dbfc3c8131ae13669f1335` |


## 1.3.0 GitHub 同步与安装包验收记录（2026-10-21）

- `npx tsc --noEmit --pretty false`、`git diff --check` 通过。同步合并与流程共 25 项测试通过，覆盖字段合并、确定性冲突副本、文档移动、删除冲突、CAS 重试、发布期间继续输入、无变化不提交、下载／保存失败与取消。原生 `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline` 31 项通过，含完整附件收集、跨目录读取、导入附件批次预检、不覆盖不同内容、路径／SHA 与缓存隔离。
- GitHub App TypePro-Proberen 已注册并安装到 Proberen/typepro-notes（私有），仅选择此仓库；Device flow 已启用。客户端仅内置公共 Client ID 与 slug，没有 App private key、client secret 或用户访问令牌。
- 独立 Mac QA 标识 `com.localnotes.typepro130qa`，使用空应用数据目录。真实设备授权后连接成功，首次同步在私库创建 `.typepro/manifest.json`，保留已有 README；再次手动同步和重启后自动同步成功，GitHub 历史仍为 2 次提交，未制造无变化提交。验收后通过界面断开并退出 QA；没有上传真实用户笔记，没有替换或启动生产 Mac 应用。
- 本地浏览器验证首页入口和同步对话框；普通浏览器明确提示需原生应用完成 GitHub 同步。使用内置 CUA IAB／原生应用检查，未额外安装 Browser 插件。未覆盖完整手机原生同步 UI。
- Ponytail review 仅审查本次差异，去掉同步 hook 中 13 个无必要的回调转发包装；保留定时器使用的 ref，类型检查和 25 项同步测试随后通过。额外核对可选同步初始化失败不阻断本地笔记启动、授权安装阶段可断开连接、凭据不进入前端和笔记数据。
- 正式 Mac 为 arm64、1.3.0、`com.localnotes.notebook`；严格 codesign 与 hdiutil 校验通过，ad-hoc 签名，未公证。构建提示已有较大前端 chunk，不影响产物生成。
- Android 为 1.3.0／1003000、minSdk 26、targetSdk 36、ARM64＋ARMv7。apksigner 校验通过，证书 SHA256 与 1.2.2 相同；ZIP 16KB 和 ARM64 ELF 所有 LOAD 段 0x4000 对齐通过。
- 专用 NotebookTest／Android 16 模拟器沿用原 userdata，从 1.2.2 覆盖安装成功；安装后与启动后，索引哈希、4 本笔记、4 篇文档、3 个附件、1 个启用插件的内容哈希和状态均一致。冷启动返回 Status ok／COLD，45.4 秒内 9 次采样保持同一 PID，crash buffer 无新增，无 fatal／native signal／Rust panic／uncaught／CSP 拒绝。未操作安卓原生界面，AVD 已正常关闭并保留数据。
- 未实测 Mac↔Android 两台设备的双向离线冲突、Android Keystore 授权后读取、长时间令牌刷新、物理手机或 Android 8；相关合并／重试有程序测试，安全存储与平台分支有源码及构建检查，不将其记作真实设备验收。自动同步限应用前台，后台／关闭不保证定时执行。

| 安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.3.0-mac-arm64.dmg | 13,335,767 | `7b2ec98e3d54d88513e0f7969cd464f35a2784ac68ac7f400699a5bff5fd1d8e` |
| TypePro-1.3.0-android.apk | 33,583,733 | `419f8ddda1a03011ecb4b07d608962af4c38cb195d2ac2170c75d98eb74624ab` |


## 1.3.1 Android 同步权限错误修复（2026-10-22）

- 根因：同步附件在 `Storage::import_sync_assets` 中通过 `fs::hard_link` 发布。专用 NotebookTest／Android 16 的真实应用 UID 10213、`u:r:untrusted_app` SELinux 域下，1.3.0 的原始 Rust 存储模块稳定返回 `Permission denied (os error 13)`；独立 `Os.link` 也返回 EACCES／errno 13。普通启动验收无法覆盖这个附件写入路径。
- 修复：仅 Android 改为 `renameat2(RENAME_NOREPLACE)` 系统调用，在同一目录原子发布完整暂存文件；桌面保留硬链接。保留批次预检、不同内容不覆盖、竞态目标不覆盖、失败清理与不推进基线的契约；未新增 Android 存储权限，未改笔记格式、同步接口或凭据处理。
- Android 回归：签名一致的临时 Instrumentation 在 TypePro 专用模拟器进程内加载包含本次真实 `storage.rs` 的原生库，在新建临时测试目录内执行。新增附件、重复导入相同字节、拒绝同名不同内容、正文／封面保存读取、同步导出与图片解析、预检后目标出现仍不覆盖全部通过。旧代码同一入口失败、新代码通过，证据为本任务 `work/typepro-131-native-qa/hardlink-before.txt` 与 `storage-after.txt`。测试组件已卸载，临时测试目录已清理，未访问真实手机或真实用户 Mac 数据。
- 类型与回归：本次前端只有版本记录修改，随生产构建完成类型检查。`cargo test --manifest-path src-tauri/Cargo.toml --lib --offline` 32 项通过，新增预检后目标出现不覆盖的回归；`git diff --check` 通过。Ponytail review 审查本次差异，未发现必要的行为等价简化。
- 兼容性：两种 ARM 原生库均确认通过 `syscall` 调用，不动态依赖较新 Bionic `renameat2` 符号。[Android 8 官方 seccomp 白名单](https://android.googlesource.com/platform/bionic/+/android-8.0.0_r4/libc/SECCOMP_WHITELIST.TXT)包含该系统调用；这属于源码核对，不代替 Android 8 实机验收。
- Mac：正式 arm64、1.3.1、`com.localnotes.notebook`，严格 codesign 与 hdiutil 校验通过；ad-hoc 签名，未公证，没有启动生产 Mac 应用。
- Android：1.3.1／1003001，minSdk 26、targetSdk 36，ARM64＋ARMv7；apksigner 通过，证书与 1.3.0 相同，ZIP 16KB 和 ARM64 ELF LOAD 段对齐通过。没有卸载原应用，直接从 1.3.0 覆盖安装；安装后和冷启动后索引哈希、4 本笔记、4 篇文档、3 个附件、1 个启用插件代码与状态全部保持一致。
- 冷启动 Status ok／COLD；45.4 秒、9 次采样保持同一 PID，crash buffer 无新增，日志无 fatal／native signal／Rust panic／uncaught／CSP 拒绝。专用 AVD 已正常关闭并保留原 userdata。没有操作安卓原生 UI。
- 界限：本次为附件存储路径的真实 Android 沙箱回归，没有重新授权 GitHub 或执行跨设备联网同步；未在物理手机和 Android 8 实测。此前 1.3.0 的真实 Mac 授权／空库同步记录保留，不把本次离线附件检查描述为端到端 GitHub 同步验收。

| 安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.3.1-mac-arm64.dmg | 13,336,846 | `447b3629ccbeb6fb1371a5e8bd9529e61be4927355a923918cedd3087029bc0b` |
| TypePro-1.3.1-android.apk | 33,583,605 | `3441f49a3ef003e6cad015b6ad5e9d27f258d069f3bc67098a2fc220f6d824de` |


## 1.3.2 Android 桌面图标修复（2026-10-22）

- 根因：App 内 Logo 与 Mac 图标已使用新版，但 Android 独立 mipmap 资源仍为旧蓝色笔记本图标。更新两份 Android 资源目录中五种密度的普通、圆形和自适应前景 PNG；Manifest 与权限完全不变。
- 从已确认的 `src-tauri/icons/icon.png` 使用现有 Tauri 图标生成器生成尺寸资源，没有重新设计 Logo；两个资源目录逐文件一致。
- APK 中五种密度的普通图标和五种自适应前景图像逐像素等于新版资源，全部与旧图标不同；实际提取 xxxhdpi 前景并查看确认。核对 Manifest 指向自适应图标，后者指向新版前景。未引用的圆形 PNG 由现有资源缩减机制移除，系统圆形遮罩仍使用同一自适应图标。
- 1.3.2／1003002，包名 `com.localnotes.notebook`，minSdk 26、targetSdk 36，ARM64＋ARMv7；签名校验通过且证书与 1.3.1 相同，ZIP 16KB 和 ARM64 ELF LOAD 段对齐通过。APK 字节数 33,836,361，SHA-256 `69db7298e785e9a34b4f312e6b8a0d3af26dc534c678710f886e6675be7ad1ba`。
- 生产构建包含 TypeScript 检查，`git diff --check` 通过。Ponytail review 仅审查本次资源、版本和文档差异：Lean already. Ship. 没有新增运行依赖或业务逻辑。
- 边界：本次只交付 Android APK，Mac 继续使用 1.3.1。未新建模拟器验收会话、未操作物理手机、未重复 GitHub 同步或导入导出流程；1.3.1 的 Android 附件存储修复及其验证记录保持有效。
