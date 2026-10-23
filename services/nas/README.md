# TypePro NAS 0.1.0

个人笔记文件服务。网页只有一个列表：展开笔记查看文档，显示内容更新时间、成功同步时间、更新来源，支持搜索与手动刷新。没有账号注册、在线编辑、预览或多页管理后台。

服务提供带版本检查的文档写入、附件上传下载、增量变更读取。Markdown 和附件可直接在 NAS 数据卷读取，API 使用令牌保护。绿联部署使用 NAS 本地端口和现有 UGREENlink 网页入口，无需自建域名；其他部署也可使用 HTTPS 反向代理。

**当前交付是服务端。TypePro 1.2.2 的 Mac／安卓客户端尚未接入 NAS，不会自动上传现有笔记。** 未接入客户端、未通过 API 上传时，网页显示「暂无笔记」。

## 在 NAS 上部署

绿联 NAS 全程图形界面部署见 [UGREEN.md](docs/UGREEN.md)：使用离线镜像和 [compose.import.yaml](deploy/compose.import.yaml)，开放 `17890` 端口，通过 UGREENlink 容器桌面快捷方式远程访问，不需要 SSH 或 `.env`。镜像构建／运行验收状态见 [验证记录](docs/VERIFICATION.md)。

离线镜像提供 `TypePro-NAS-0.1.0-linux-amd64.tar`（Intel／AMD）和 `TypePro-NAS-0.1.0-linux-arm64.tar` 两份，按 NAS CPU 选择一份导入；标签均为 `typepro-nas:0.1.0`。文件校验信息见 [IMAGES.json](docs/IMAGES.json)。

### 可选：在 NAS 上从源码构建

以下为可选的源码构建方式。本项目包含 Dockerfile 和 Compose；目前没有预置的在线镜像仓库。

1. 解压项目到 NAS 目录，进入包含 `compose.yaml` 的文件夹。
2. 运行 `sh setup.sh`，自动生成随机令牌到 `.env`（仅首次生成，不覆盖已有配置）。
3. 编辑 `.env`，将 `TYPEPRO_PUBLIC_URL` 填为实际域名，例如 `https://notes.example.com`，不带路径。令牌在 `TYPEPRO_TOKEN`，不要发送给别人。
4. 在 NAS 上运行：

   ```sh
   docker compose up -d --build
   ```

5. NAS 反向代理将 HTTPS 域名转发到 `http://127.0.0.1:17890`，保留原始 Host，允许 `Authorization` 请求头。访问该域名，输入 `.env` 中的令牌连接。

默认只绑定宿主回环地址，适合 NAS 自带反向代理。若反代运行在另一容器或机器，需根据实际网络调整 `TYPEPRO_BIND_IP` 或加入同一个私有 Docker 网络。不要把令牌放进 URL。服务不依赖 CDN，不需要访问第三方站点才能显示网页。

### 配置

| 变量 | 默认值／作用 |
| --- | --- |
| `TYPEPRO_TOKEN` | 必填，至少 32 个无空白 ASCII 字符；setup.sh 生成 64 位随机十六进制 |
| `TYPEPRO_PUBLIC_URL` | 域名部署填写实际 HTTPS origin，用于浏览器写请求来源校验 |
| `TYPEPRO_BIND_IP` | `127.0.0.1` |
| `TYPEPRO_PORT` | `17890` |
| `TYPEPRO_VOLUME_NAME` | `typepro-nas-data`，升级时保持不变 |

直接运行应用时，也可用 `TYPEPRO_TOKEN_FILE` 读取令牌文件，与 `TYPEPRO_TOKEN` 二选一。Docker 默认使用 uid/gid `10001`，单 worker，根文件系统只读，只有 `/data` 和临时目录可写。

如需把数据放在 NAS 指定文件夹，可把 Compose 中 `data:/data` 改为 `/你的NAS目录/typepro-data:/data`；先创建目录并将所有权设为 `10001:10001`。不要把正在使用的数据库放在由多台机器共同写入的网络目录。

## 时间和来源

- **内容更新时间**：调用方提交的 `updatedAt`；未提供时使用服务端接收时间。统一存为 UTC，网页按浏览设备时区显示。
- **同步时间**：NAS 成功提交该次更新的 `syncedAt`，不代表其他设备已经下载。
- **更新源**：调用方提交的 `source` 名称，未提供时显示 `deviceId`。不根据浏览器或 IP 猜测设备。
- 笔记行显示该笔记及其文档最近一次服务端记录的时间与来源；展开后各文档显示自己的记录。重试同一幂等请求不会刷新时间。

时间仅用于展示。并发修改使用 `revision` 检查，避免设备时钟不一致导致覆盖。

## 存储和备份

默认命名卷 `typepro-nas-data` 持久保存：

```text
/data/
  metadata.sqlite3          元数据、版本、变更与幂等记录
  metadata.sqlite3-wal      SQLite 运行期间可能存在
  metadata.sqlite3-shm      SQLite 运行期间可能存在
  documents/<文档ID>/<内容SHA256>.md
  assets/<内容SHA256>.<扩展名>
```

Markdown 是不可变版本文件，附件按内容寻址。不要直接修改这些文件来模拟同步，应通过接口更新索引。删除标记和历史文件首版不自动清理，便于后续离线客户端识别删除和重试。

最简单的一致备份：`docker compose stop` 后，在 NAS 中备份整个数据卷，再 `docker compose start`。只复制 `metadata.sqlite3` 或只复制 Markdown 都不是完整备份。令牌 `.env` 单独妥善保存。

升级前先备份数据；保留 `.env` 与同一数据卷，再在 NAS 上重建容器。不要执行 `docker compose down -v`，该命令会删除卷。0.1.0 为初始服务版本，暂无旧服务数据迁移。

## 接入和验证

- 接口及可复制请求体见 [API.md](docs/API.md)，完整语义见 [CONTRACT.md](CONTRACT.md)。
- 健康检查：`GET /healthz`，不需要令牌；业务接口全部要求 Bearer 令牌。
- [验证记录](docs/VERIFICATION.md) 区分已执行测试与未运行项目。

## 更新记录

### 0.1.0 · 2026-10-21

- 新增单页笔记／文档同步列表，记录内容更新时间、同步时间和更新来源。
- 新增本地文件存储、版本检查、幂等提交、附件接口与增量读取。
- 提供 Docker/Compose、令牌初始化及部署说明。
- 增加绿联离线镜像导入配置与 UGREENlink 图形界面部署说明。
- 交付 AMD64／ARM64 离线镜像，通过重新导入、接口读写与重启持久化检查。

服务和 TypePro App 分别版本化，本次不会升级 Mac／安卓安装包。
