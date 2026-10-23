# 0.1.0 验证记录

日期：2026-10-21（Asia/Shanghai）。范围仅 `services/nas/`，主项目 README 增加服务入口；未改 Mac／安卓客户端和原有安装包。

## 已执行

- 17 项纯标准库存储测试通过：并发相同 revision 仅一方成功、失败事务回滚、幂等结果不变、历史分页与一致快照、重启持久化、删除／恢复父子约束、附件 hash／路径／引用与容量限制、两个时间和来源字段。
- 1 项网页凭据安全测试通过：JavaScript 未加载时表单也不能将密码字段编码进 URL。该问题在集成审查中发现并修复。
- `docker compose config --quiet` 通过，仅解析配置，未连接或启动容器、未构建。
- Python 源码 AST、JavaScript `node --check`、shell `sh -n` 通过；页面 DOM ID 与脚本引用匹配，动态名称使用 `textContent`，未将令牌写入浏览器持久存储。
- 存储／路由／部署契约只读审查完成。
- 已读取并应用 Ponytail 插件的 bundled `ponytail-review`，仅审查本次新增服务和入口。采纳确定等价的重复 JSON 字段检查简化；保留原安全响应头处理，不为少几行改变安全边界。未扩展为原 App 重构。

## 本轮绿联图形界面部署验证

用户已明确允许本次本地 Docker 构建和必要依赖安装。新增 `deploy/compose.import.yaml` 与 `docs/UGREEN.md`，更新服务 README；应用代码、协议及 Mac／安卓客户端均未修改。

- 图形界面 Compose 配置解析通过：使用本地 `typepro-nas:0.1.0`，`pull_policy: never`，无源码构建、无 `.env` 插值；端口 `17890:8080`，令牌由用户填写，域名项保持空值。
- 在临时 Python 虚拟环境安装现有 requirements 后，原有 10 项 HTTP／安全测试全部通过。加上 17 项存储和 1 项网页凭据测试，共 28 项已通过。
- 安装 Colima 0.10.3／Lima 2.2.1／Docker Buildx 0.38.0，在独立 `typepro-nas-build` 配置中启动 Docker 29.5.2；未切换用户默认 Docker context，未设置开机启动。
- 已完成 `linux/arm64` 和 `linux/amd64` 两份正式离线镜像，分别保存为 `TypePro-NAS-0.1.0-linux-arm64.tar`、`TypePro-NAS-0.1.0-linux-amd64.tar`；每份归档仅包含对应架构，镜像标签均为 `typepro-nas:0.1.0`。关闭构建证明与 SBOM 附加清单，避免将无关架构附加项带入离线包。文件大小、SHA256 和镜像配置摘要记录在 [IMAGES.json](IMAGES.json)。
- Docker Hub 域名在当前网络连接超时，基础镜像从 Docker 官方发布的 ECR Public `public.ecr.aws/docker/library/python:3.13-slim-bookworm` 获取，digest 为 `sha256:73aa5faee130c60da030e105ec971ccf57473fbd22ce73bd6fc9ba99a40b838d`。构建通过标准输入提供临时 Dockerfile，仅将 pip 下载源改为本机已有使用的清华 PyPI 镜像；仓库 Dockerfile 和版本约束未修改。依赖只安装预编译 wheel，无需 NAS 启动时联网安装。
- 两份归档均检查了 `manifest.json`、唯一标签、平台、非 root 用户与不含访问令牌的环境变量；逐层核对内容 SHA256。均使用 `docker load` 重新导入，并对导入标签运行相同 HTTP 与重启检查。ARM64 在本机虚拟机中原生运行，AMD64 使用系统已有 Rosetta 模拟运行，未将模拟验证视为实际 NAS 硬件验证。
- 验证容器以非 root 用户运行，根文件系统只读、移除全部 capabilities、网络隔离，不暴露本机端口；通过容器内部 HTTP 检查健康状态、静态资源、鉴权、附件上传下载、笔记及文档批量提交、时间与来源、元数据快照、幂等重试、旧版本写入 409 冲突、增量记录。容器重启后再次读取，笔记与正文仍在。测试容器和专用数据卷已清理。
- 对本轮配置和文档差异再次应用 Ponytail `ponytail-review`，未发现需要新增抽象或删除的复杂度：`Lean already. Ship.`
- 本轮临时验证容器和数据卷均已清理，独立 Colima 实例已停止；未修改用户默认 Docker context，未部署到用户 NAS。

## 未执行

- 绿联 NAS 上的实际导入、部署及运行验证：未连接用户 NAS；用户按实际 CPU 架构选择已提供的镜像。
- 浏览器页面实际操作与截图验收、Mac／安卓自动同步接入。
- 通过用户 UGREENlink 入口的实际网页访问、转发会话与 API 请求验证。已核对绿联官方文档支持容器桌面快捷方式远程访问，但未登录或操作用户 NAS。

页面设计按用户最新收口实现为单列表，未保留早期多页控制台及 Markdown 预览依赖。本记录不将静态审查称为服务运行验证。
