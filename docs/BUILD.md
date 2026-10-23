# 构建记录

## TypePro 交付约定

用户于 2026-10-23 明确要求：TypePro 每次代码落地默认包含必要验收、Apple Silicon DMG 与 Android APK 打包、源码和安装包发布至本仓库 Releases，无需逐次重复确认构建。该约定仅适用于 TypePro；插件仍独立发布。发布后逐项核对公开下载文件的大小与 SHA-256，再清理已上传的本地安装包、源码 ZIP 与应用构建缓存，保留源码、原型、验收记录、签名备份、密钥及 NAS 镜像。

## 1.7.6 C2 图标（2026-10-23）

- 用户确认采用 C2 紫色机器人。App 内 Logo 保存原始 1536×1536 图像，SHA-256 为 `705fd471ace9a5a09929fcdd9dc9df0228cd74608204f233d068e916c3427e49`。NAS 网页沿用 128×128 尺寸。
- 使用既有 Tauri `icon` 资源转换能力更新原生图标，两份 Android 五密度 PNG 保持一致。自适应背景采用原图左上角的 `#B8D9EF`，避免原白底露边。未改包名、签名、笔记存储、同步或插件接口。
- 版本为 1.7.6／Android `1007006`。前端类型检查与生产构建、Mac 和 Android release 构建通过；两端共用冻结的 140 份前端资源。Mac 签名可执行文件中的 138 份非 HTML 资源解压后逐字节一致，包含 C2 原图；HTML 的当前 JS／CSS 入口也已核对。
- Mac：arm64、包名不变，严格 codesign 与 DMG 校验通过；只读挂载后核对应用、C2 `icon.icns` 与 Applications 链接。ad-hoc 签名，未公证。
- Android：ARM64＋ARMv7、minSdk26／targetSdk36；实际 APK 的 10 张普通与自适应前景 PNG 逐像素等于新资源，均不同于上一版。Manifest、自适应图标和浅蓝背景引用核对通过。CRC、ZIP 16 KiB 和 ARM64 ELF LOAD 对齐、原生库载荷核对通过，签名证书与 1.7.5 相同。
- 本轮按 Ponytail `ponytail-review` 审查图标、版本元数据与文档差异：`Lean already. Ship.`，没有增加运行依赖或业务逻辑。
- 证据位于 `work/typepro-logo-review/`。本次核对源码与最终安装包资源，没有启动用户正式应用、替换已安装应用或验证真实桌面图标缓存刷新；没有重复笔记编辑、同步或物理安卓设备验收。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.6-mac-arm64.dmg | 13260444 | `7c6acca675cf8e50f1f5e1d965d952d225ef5018980456bd027e2394d63ae8df` |
| TypePro-1.7.6-android.apk | 34541913 | `81a7262c2a861260b4feaa4db8c04085604fee2fdbd1f1aa26de50aa51f2e077` |

## 1.7.5 应用内下载与系统安装入口（2026-10-23）

版本为 1.7.5／Android `1007005`。更新下载由应用原生任务处理；笔记、GitHub 同步和插件 API 格式不变，未新增依赖或发布插件。1.7.4 及更早版本需先通过原有浏览器入口安装本版，后续更新才使用应用内下载。

- 「关于 TypePro」显示下载进度与大小，支持取消、清理半包和失败重试；关闭关于页面不停止任务。原生层重新获取正式 Release，只接收版本号，按实际平台选择固定公开仓库附件；流式保存后验证大小与 SHA-256，打开时再次验证。
- Mac 打开已校验的 DMG；Android 校验包名、更高 versionCode 与签名，经只共享专用缓存的 FileProvider 进入系统安装确认。首次未允许本来源安装时跳转授权页，返回后可再次点击。没有公共存储权限或静默覆盖安装。
- 前端类型检查、生产构建、两平台 release 构建通过；JavaScript 定向检查 12／12、原生定向检查 16／16 通过。另有 1 项实际原生网络整合验收：从公开 Release 下载已发布的两平台安装包，验证大小、SHA-256、错误 SHA／大小拒绝、传输中取消与清理、重试、重新查询元数据后的缓存复用，以及损坏缓存检测与重新下载。仅测试入口允许使用旧版附件，生产版本／平台判断未绕过。
- 最终生产页面在真实 Chrome 与隔离合成工作区／原生 IPC 下完成 8／8 组交互：桌面及 390px 手机视口，覆盖进度、校验、完成、取消、重试、未知来源提示、关闭重开、防双击、丢失回执恢复、旧 revision 保护和新旧包区分。控制台 error／warning、pageerror 均为 0。实际验收修复了一处取消回执迟到时终态文案被覆盖的问题，随后重建并完成整组复验；两端最终包包含修复。
- Mac：arm64、1.7.5、`com.localnotes.notebook`；严格 codesign、DMG 完整性及只读挂载内容核对通过。最终 140 文件与冻结清单匹配，138 个非 HTML 文件解压后逐字节匹配签名二进制内嵌内容。ad-hoc 签名，未经过 Apple 公证。
- Android：1.7.5／1007005、ARM64＋ARMv7、minSdk26／targetSdk36；签名与留存的 1.7.4 证书一致，CRC、ZIP 16 KiB、ARM64 ELF LOAD 对齐和原生载荷核对通过。最终前端入口与冻结清单一致；APK 内权限、专用私有 Provider 和 R8 后插件／参数／Provider 字节码核对通过。
- Android 16／API36 的隔离 ARM64 模拟器实际安装官方 1.7.4 后覆盖到最终 1.7.5，私有状态标记保留。调用最终 APK 内真实安装插件，验证缓存范围、旧版本、错误包名和错误签名被拒绝；首次打开系统来源授权页，实际点击开关后返回重试，最终显示可点击的 Update 确认按钮。更高版候选仅为同签名微型 QA 包，停在系统确认页，未安装；不等于 Android 上从 GitHub 下载到安装的完整端到端验收。
- 已按 Ponytail `ponytail-review` 审查整合差异。先前单独移除流式下载的冗余内部 async 包装（3 行）；最终审查结果为 `Lean already. Ship.`，保留下载取消、错误清理、校验和竞态保护。
- 证据位于工作区 `work/typepro-175-review/`。真实网络检查仅使用临时目录与公开附件；页面采用合成笔记，没有读取、覆盖正式笔记或生产凭据。未启动已安装的正式 Mac App、未执行 Mac 系统覆盖安装或验证物理安卓设备／输入法与双设备联网同步。本轮临时模拟器与 QA 包在验收后清理。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.5-mac-arm64.dmg | 13510693 | `a124f270fd6d75d418e80969d0615ef1f8e7a146107624653065729ea2484589` |
| TypePro-1.7.5-android.apk | 34493729 | `ce0ba9a0295b3427ea8ca6dddb8639992b7ef69d3f3ef36b3fd8356e0a81fb8d` |

## 1.7.4 列表缩进、组件把手与撤销视口（2026-10-23）

本轮用户明确要求打包、发布并实际验收。版本为 1.7.4／Android `1007004`；包名、GitHub 同步格式、插件 API 与安卓签名继承关系不变，未新增依赖，未修改或发布插件。

- 列表首项、单独一项和嵌套首项可原行 Tab 缩进，Shift+Tab 逐级还原；有前项时使用真实子列表，没有前项时只缩进当前项，不增加占位父项。独立缩进以 HTML 保存，重新打开还原；普通列表的 Markdown 序列化保持原行为。
- 组件与六点把手之间保持连续鼠标命中范围，移向把手时不再因经过空白而隐藏，仍仅对组件提供操作。
- 页面验收实际发现撤销保护误用了不滚动的 DIV，已改为保护实际滚动的 IR PRE。Mac WebKit 验收进一步发现图片异步恢复高度会截断滚动位置；现在同步恢复后等待本地资产、图片解码和单帧布局，再进行一次受保护的恢复。新输入、指针／滚轮／触摸、窗口失焦、后续历史操作或销毁会取消；文档、选区和焦点改变时也不执行。不使用轮询或固定延时。
- 前端 TypeScript 检查及生产构建、Mac 与 Android release 构建通过。列表 JavaScript／Lute 存储 22/22、编辑 39/39 检查与 4/4 原始 CSS 桌面／手机列表几何检查通过；编辑器相关的 TypeScript／Vditor 历史定向检查 41/41 通过，其中 12 组覆盖文档历史、异步布局和取消边界。把手几何路径／边界 175 个断言通过。
- 最终生产前端在真实 Chrome、隔离合成 Tauri 工作区中完成 14/14 组实际交互验收：三种列表前缀、首／单／嵌套项连续缩进和续项、保存重开、慢速鼠标移向把手后点击／拖拽／删除／撤销、长文档键盘与工具栏撤销／重做、390px 触摸菜单，以及待恢复期间新指针和滚轮输入的保护。控制台 error／warning、pageerror 均为 0，140 个生产文件与冻结 SHA 清单一致。
- 独立、非持久的 Mac WKWebView QA.app 通过正常应用启动后，使用同一生产入口完成 5/5 组 Cocoa 原生按键验收：6 个代码编辑器与 6 张图片的长文档深处 Cmd+Z／Cmd+Shift+Z，三种列表首项 Tab／Shift+Tab、双缩进后 Enter 继承和继续输入，及首项缩进不影响后续同级。滚动位置保持 6635，光标留在可视区域；实际显示帧 607。此前裸 Swift CLI 宿主无显示帧的无效尝试已独立保存，没有计入最终结果。
- Mac：1.7.4、arm64、`com.localnotes.notebook`，严格 codesign、DMG 校验及只读挂载内容核对通过，包内入口与最终 140 文件清单匹配。使用 ad-hoc 签名，未经过 Apple 公证。
- Android：1.7.4／1007004、ARM64＋ARMv7、minSdk26／targetSdk36，签名与留存的 1.7.3 验收证书一致；CRC、ZIP 16 KiB、ARM64 ELF LOAD 对齐、两架构原生库与本轮输出逐字节核对通过，包内最终前端入口与冻结清单匹配。
- 已按 Ponytail `ponytail-review` 审查本轮整合差异，移除操作函数的冗余真值判断与同一节点的重复连接性判断；必要的布局等待和用户输入取消保护保留。最终代码审查：`Lean already. Ship.`。
- 证据位于工作区 `work/typepro-174-review/`。验收使用合成笔记，未读取或覆盖正式笔记、启动已安装 TypePro、执行系统覆盖安装、安卓实机／输入法或双设备联网同步验收。独立 WKWebView 宿主不等于打包 Tauri App 的完整 UI 验收。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.4-mac-arm64.dmg | 13474851 | `cf1f8e61c471e98807db1cbfd4669136cf45930a77acacf70cedf6e5d94c2af0` |
| TypePro-1.7.4-android.apk | 34340021 | `b6a2ababaf553f4ea075587927c64e5602a1826e85069c15bbf3a51e6c6450b0` |

## 1.7.3 应用更新提醒（2026-10-23）

本轮用户明确允许本地构建、必要检查并发布到公开仓库。版本为 1.7.3／Android `1007003`；包名、笔记存储、同步格式、插件 API 和现有签名继承关系不变，未新增依赖。

- 新增固定公开 GitHub Releases 检查、前台每日检查、关于页面手动检查、轻提示、纯文本升级说明及当前平台下载入口。下载由系统浏览器处理，手动安装。发布命名与接口见 [UPDATES.md](UPDATES.md)。
- 前端类型检查和生产构建、Mac 与 Android release 构建通过。定向检查为原生版本／平台筛选 7 项、纯 JavaScript 调度／下载来源 6 项，均通过；公开 GitHub 返回字段已匿名核对。
- 最终生产前端在隔离 Chrome、合成笔记和原生接口下完成 4 组流程：桌面浅色、手机深色的新版本提示与下载、失败重试、无更新；控制台错误／警告均为 0。已检查截图，未出现横向溢出；验收资源与冻结的 140 文件清单一致，浏览器和服务已关闭。
- Mac：1.7.3、arm64、`com.localnotes.notebook`，严格 codesign、DMG 校验和及只读挂载内容核对通过。使用 ad-hoc 签名、未经过 Apple 公证。
- Android：1.7.3／1007003、ARM64＋ARMv7、minSdk26／targetSdk36，签名证书与 1.7.2 相同。CRC、ZIP 16 KiB、ARM64 ELF LOAD 对齐及两架构原生／前端载荷核对通过。
- 整合差异完成 Ponytail `ponytail-review`，移除未使用的检查时间展示状态，调度行为不变；最终结果为 `Lean already. Ship.`。
- 证据位于本次工作区 `work/typepro-update-review/`。未读取生产笔记、启动已安装 TypePro、验证原生 WebView 或物理安卓设备，也未执行真实系统浏览器下载和覆盖安装；隔离浏览器中的原生下载调用为合成接口。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.3-mac-arm64.dmg | 13474233 | `3e2c5998cc65828be755d3fc04fa6b71a4f7db29bb12cacfa16237fb04e0c802` |
| TypePro-1.7.3-android.apk | 34337845 | `58779e4093bbe851c610ea12db66a588f96e2f71c1405b04adea9aebff98772c` |

## 1.7.2 列表光标与原行缩进返修（2026-10-23）

本次为用户“落地打包”交付后的返修，用户确认问题发生在 Mac，并确认空项 Enter 应原行减少一级缩进。版本为 1.7.2／Android `1007002`，包名、签名继承、插件 API 和同步格式未变。

- 根因：前缀转换生成无 BR 的空段落，没有可编辑的行内光标锚点；空项 Enter 原先改为父列表内段落；编辑态列表底边距 24px 与列表项 6px 间距不一致，退出时额外下移 18px。
- 修复：复用既有空段落补位、列表 outdent 和 unlist 能力。空嵌套项 Enter 直接在原行减少一级并保留符号，最外层空项原行取消符号；有内容时 Enter 续项。编辑态列表底间距与列表项保持 6px，阅读态不变。
- 前端类型检查与生产构建、Mac／Android release 构建通过，未安装依赖。原生浏览器 DOM／Lute 检查存储 14/14、编辑 24/24；最终 App 资源在隔离 Chrome 中 5/5 通过，无相关控制台异常。
- 独立非持久 Mac WKWebView 使用最终 App 资源、合成存储及实际 Cocoa keyDown/keyUp 完成 5/5 检查（含三种前缀空格暂停／继续、有内容 Enter 与 Command+Z、空嵌套／外层 Enter）。空 BR 行框与输入后 DOM caret 行框均 y187／h20；嵌套 Enter 垂直差 0、水平减少 28px；外层取消符号垂直差 0、水平减少 25px。离屏未激活窗口无法可靠捕获闪烁系统光标，NSTextInputClient firstRect 也返回零矩形，因此未把系统光标像素坐标视为已验证。
- Mac：1.7.2、arm64、`com.localnotes.notebook`，严格签名与 DMG 校验通过；只读挂载后核对最终应用、图标和 Applications 链接。ad-hoc 签名、未公证。
- Android：1.7.2／1007002，ARM64＋ARMv7，minSdk26／targetSdk36；签名证书与 1.7.1 相同，CRC、ZIP 16 KiB、ARM64 ELF 对齐与本轮原生载荷一致性通过。
- 本轮 Ponytail `ponytail-review` 复核：`Lean already. Ship.`；移除了 Enter 退出路径撤销后只剩 true 单一调用的冗余 pending 参数，退格语义不变。未提交、推送或发布插件。
- 证据位于 `work/typepro-172-review/` 与本版交付验收目录。隔离浏览器、WK 窗口和静态服务均已关闭。未操作生产笔记、启动已安装 TypePro 或验证安卓实机／输入法与双设备联网同步。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.2-mac-arm64.dmg | 13458925 | `8ed86288c920ba1e26571d26e83229e3338610ef1f9d5a6f1f212c49a2d4d26d` |
| TypePro-1.7.2-android.apk | 34284869 | `14e70476c9fd19f599c93b80820f640d8285c98a60b00cd16baf297dbfca743f` |

## 1.7.1 列表与组件交付（2026-10-23）

本轮用户明确要求“落地打包”，已完成 Apple Silicon DMG 与 Android APK。版本为 1.7.1／Android `1007001`；应用包名、签名继承关系、插件 API 3 和同步格式保持不变，未改动或发布插件。

- 修复 `-`／`1.`／`a.` 加空格创建列表；Enter 续项、Shift+Enter 项内换行、空项退格分步退出、Tab／Shift+Tab 调整层级。移动与删除只对代码、表格、独立图片、公式、流程图及 HTML 组件开放，含列表内组件。
- 真实页面验证发现原生重绘会丢失字母列表类型；在捕获光标前复用既有列表恢复逻辑，保留字母／数字混合分组和光标位置。新增的原生重绘回归先失败、修复后通过。
- 前端 TypeScript 与生产打包、Mac 与 Android 原生 release 构建通过；未安装新依赖。定向检查共 54 项通过：列表存储 14、列表编辑 23、组件操作 17。最终产物中的真实 App／Vditor 在隔离 Chrome 与合成数据中完成 8 项交互检查，控制台 warn／error、pageerror 为 0；包含字母列表快速续项、缩进、撤销及保存重开。原生 DOM 检查覆盖手机 beforeinput 路径，不能替代安卓输入法实机验证。
- Mac：实际 1.7.1、arm64、`com.localnotes.notebook`，严格 codesign 与 hdiutil 校验通过；只读挂载 DMG 后的可执行文件、图标、Info.plist 与最终构建一致，Applications 链接正常。ad-hoc 签名、未公证。
- Android：实际 1.7.1／1007001、包名不变、ARM64＋ARMv7、minSdk26／targetSdk36，签名证书与 1.7.0 相同；CRC、ZIP 16 KiB 与 ARM64 ELF LOAD 对齐通过，APK 原生载荷与本轮编译输出一致，可直接覆盖升级。
- 按 Ponytail `ponytail-review` 对本次编辑器修正及版本交付差异统一复查：`Lean already. Ship.`。未提交、推送或发布远端代码。
- 验证记录：`work/typepro-171-release-review/`；交付目录包含升级说明、验收记录与源码压缩包。浏览器和隔离服务已关闭；未读取正式笔记、覆盖生产 App，未验证打包 App 原生 WebView、物理安卓设备／输入法或双设备联网同步。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.1-mac-arm64.dmg | 13460356 | `3a99d09a132356195cfb417ba46597a9721e9497c246566c522660da34d33686` |
| TypePro-1.7.1-android.apk | 34284741 | `5589bdff4f056d922af4e73faaed524a82f86f3d262a0f5d7ac6aae85789b2e5` |

## 1.7.0 笔记侧栏交付（2026-10-22）

已获用户明确允许本轮 DMG／APK 构建、必要检查和 AI 插件发布。App 1.7.0／Android `1007000` 提供通用 `editor.sidebar`；AI 助手 1.2.0 在插件内选择侧栏或旧宿主兼容页面，沿用 API 3 和既有同步格式。改造细节见 [侧栏改造记录](PLUGIN-SIDEBAR.md)。

- Mac 与 Android 生产构建通过，均包含 TypeScript 与前端打包。未安装新依赖。
- Mac：实际 1.7.0、arm64、`com.localnotes.notebook`，严格 codesign 和 hdiutil 校验通过；ad-hoc 签名、未公证。证据：`work/typepro-sidebar-release-review/mac-package.json`。
- Android：实际 1.7.0／1007000、包名不变、ARM64＋ARMv7、minSdk26／targetSdk36。个人 release 签名通过且证书与 1.6.0 相同；ZIP 16 KiB 与 ARM64 ELF LOAD `0x4000` 对齐通过。证据：`work/typepro-sidebar-release-review/android-package.json`。
- AI 初始化兼容检查 8/8 通过：新宿主侧栏不注册旧入口、两个旧槽位错误回退、权限／资源／内部错误原样传播、回退失败不生成无效命令。源码阶段纯 JavaScript SDK 检查 10/10 通过。
- AI 1.2.0 已由 [Publish plugins #9](https://github.com/Proberen/typepro-plugins/actions/runs/39774454371) 成功发布，源提交 `e95d60f32e8f201c7f8197b30440e7cd2a1957a9`。发布的 10 份源码与本地审阅文件逐字节一致；正式 ZIP 已按公开目录校验大小、SHA-256、CRC、Manifest 和 JS/CSS 资源。未覆盖旧插件版本，未本地运行远程专用插件打包入口。
- 本轮整合差异已按 Ponytail `ponytail-review` 审查：`Lean already. Ship.`。
- 当前 App 原生 `Market::catalog`／`Market::download` 实际下载 AI 1.2.0，固定版本、大小、SHA-256 和 ZIP 结构检查通过，下载字节与交付 ZIP 完全相同；v3 其他插件及 v1／v2 插件条目未变。证据：`work/typepro-sidebar-release-review/native-market-ai-120-result.json`、`native-market-ai-120-packages.json`。
- 页面使用真实 App、PluginHost、PluginSidebar 与正式 AI 1.2.0 ZIP，在独立 `http://127.0.0.1:1467/`、合成笔记数据下完成桌面 1440×900 的 23 项与手机 390×844 的 19 项检查，共 42 项通过。并排／抽屉、调宽与开关刷新记忆、草稿保留、切文档上下文、历史／系统提示词／Skill、Escape 内层优先和停用清理均通过；控制台 warn／error 及 pageerror 为 0。Browser plugin not available，使用 regular Playwright CLI。截图已检查，隔离服务与浏览器已关闭；证据：`work/typepro-sidebar-release-review/ui-qa-summary.json`。
- 未启动或覆盖生产 Mac App，未使用用户正式笔记、物理手机或付费模型，未执行双设备实际联网同步。浏览器验收不等于打包 App 的原生 WebView 验收。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TypePro-1.7.0-mac-arm64.dmg | 13455114 | `56ab8bc4d086538d1355656b896dd56ffa648b86a120d1e01c2fffcfcc468475` |
| TypePro-1.7.0-android.apk | 34280777 | `5a12f236d7d55241f52951892e47a384b2af5cc368ebc10dbb46772b9174cf89` |
| AI 助手 1.2.0 ZIP | 297764 | `9e005bcc64d096df3f575631b742de6df37a6013a0ad4e1759fc966ecbfc145f` |

以下 1.6.0 为历史交付记录。

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

Manifest 的 `@mipmap/ic_launcher` 在 Android 8 及以上通过 `mipmap-anydpi-v26/ic_launcher.xml` 引用 `@mipmap/ic_launcher_foreground`，背景使用所选图像的背景色（C2 为 `#B8D9EF`）。交付前应核对 APK 内实际打包的资源，不能只检查 App 内 Logo 或 Mac 的 `.icns`。

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
