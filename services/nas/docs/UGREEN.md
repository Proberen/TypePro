# 绿联 NAS：全程图形界面部署

本方案使用已经构建的离线镜像。NAS 不需要 SSH、终端、运行 `setup.sh`、创建 `.env` 或构建源码。网页仍然只有笔记／文档列表；TypePro Mac／安卓客户端尚未接入同步。

## 需要的文件

- 按 NAS CPU 选择一份镜像，直接上传 `.tar`，无需解压：

  | NAS CPU 架构 | 镜像文件 |
  | --- | --- |
  | x86_64／AMD64（Intel 或 AMD） | `TypePro-NAS-0.1.0-linux-amd64.tar` |
  | ARM64／aarch64 | `TypePro-NAS-0.1.0-linux-arm64.tar` |

  在 NAS「设置 → 设备信息」中查看处理器；不确定时按实际型号核对架构。两份文件分别约 50 MB，只导入匹配的一份，导入后的镜像标签均为 `typepro-nas:0.1.0`。
- [compose.import.yaml](../deploy/compose.import.yaml)。这份配置只使用本地镜像，未导入镜像时会报错，不会尝试从不存在的仓库下载。

镜像构建和运行验收结果见 [VERIFICATION.md](VERIFICATION.md)，文件大小、SHA256 与镜像配置摘要见 [IMAGES.json](IMAGES.json)。源码 ZIP 不是 Docker 镜像，不能在「添加镜像」里导入。

## 1. 导入镜像

1. 在绿联「文件管理」中，将镜像 `.tar` 上传到共享文件夹，例如 `docker/typepro-nas/`。
2. 打开「Docker → 镜像 → 本地镜像 → 添加镜像 → 从 NAS 导入」，选择该 `.tar`。
3. 导入后确认镜像名称和标签为 `typepro-nas:0.1.0`。

按钮名称可能随 UGOS／Docker 版本变化。绿联官方说明见[镜像管理](https://support.ugnas.com/detail/article/zh-CN/290)。

## 2. 创建项目

1. 打开「Docker → 项目 → 创建」，项目名称填 `typepro-nas`，选择项目存放文件夹。
2. 在「Compose 配置」中导入 `compose.import.yaml`，也可以粘贴文件全文。不要使用源码构建用的根目录 `compose.yaml`。
3. 填写访问令牌，保持域名项为空：

   | 配置 | 填写内容 |
   | --- | --- |
   | `TYPEPRO_TOKEN` | 使用密码管理器生成并保存至少 32 位随机英文字母和数字，建议 64 位；保留双引号，不使用示例密码 |
   | `TYPEPRO_PUBLIC_URL` | 保持 `""`，通过 UGREENlink 打开网页列表，无需填写自建域名或 `ug.link` 地址 |

4. 保持数据卷名称 `typepro-nas-data` 不变，勾选「创建完成后立即运行」，点击「立即部署」。
5. 在项目的容器列表确认运行状态，查看日志确认启动成功。令牌留空或少于 32 位时，服务会拒绝启动。

页面上的 `PUID`／`PGID` 提示不适用于本镜像；镜像内部使用 `10001:10001`，无需添加这两个环境变量。默认使用命名数据卷，无需手动修改共享目录所有者。

绿联官方说明见[项目部署](https://support.ugnas.com/detail/article/en-US/411)。

## 3. 从局域网或 UGREENlink 打开

默认映射 `17890:8080`：NAS 的 `17890` 端口转到容器的 `8080` 端口。部署完成后，同一局域网可访问 `http://NAS的实际局域网IP:17890`；将地址中的中文替换为 NAS 的实际 IP。

远程访问使用你现有的 UGREENlink，绿联官方支持通过容器桌面快捷方式打开网页，无需另设域名或手动配置反向代理：

1. 打开「Docker → 容器」，找到 TypePro 容器，点击「··· → 桌面快捷方式」。
2. 名称填 `TypePro NAS`；Bridge 网络只有一个端口时，绿联会自动填入访问端口，保留自动识别结果。若需要手动选择映射，选择 NAS `17890` → 容器 `8080`。
3. 通过你自己的 UGREENlink 入口登录 NAS，点击桌面的 `TypePro NAS` 快捷方式。
4. 在 TypePro 页面输入 Compose 中设置的令牌连接。首次没有上传数据时显示「暂无笔记」，这是正常状态。

官方步骤见[设置 Docker 容器桌面快捷方式并使用远程访问功能](https://support.ugnas.com/detail/article/zh-CN/715)。此功能要求通过 UGREENlink ID 登录；不要给 `https://ug.link/你的ID` 直接拼上 `:17890`。

这里说明的是网页列表的访问入口。Mac／安卓客户端尚未接入 NAS，后续接入时需要另外验证 UGREENlink 的实际服务地址和认证方式，不能将 NAS 门户地址直接作为同步 API 地址。

## 更新与常见问题

- **镜像找不到**：检查是否已导入正确架构的镜像，名称／标签是否为 `typepro-nas:0.1.0`。离线镜像不需要开启镜像仓库自动更新。
- **架构错误／exec format error**：镜像架构与 NAS CPU 不一致，需换用匹配的镜像。
- **容器反复重启**：先查看日志，核对令牌长度与域名格式。
- **通过 NAS IP 打不开**：检查容器运行状态、`17890` 端口是否冲突，以及访问设备能否连接 NAS 局域网。远程访问使用 UGREENlink 桌面快捷方式。
- **重新部署后保留数据**：保持 `typepro-nas-data` 数据卷不变。更新前备份整个数据卷，不要删除卷；仅导入新镜像不会更新已运行的容器，需要在项目中重新部署。

项目 Compose 包含访问令牌，按密码文件保管，不要分享含真实令牌的配置或截图。镜像不包含令牌和个人笔记。
