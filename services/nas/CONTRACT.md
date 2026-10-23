# TypePro NAS · 协议 1 / 服务 0.1.0

本目录是独立 NAS 服务。当前授权仅包含服务、记录网页和 Docker 部署文件；不改 Mac/Android 客户端。网页仅展示笔记和文档的更新时间、同步时间及更新源。单用户，Bearer 令牌，HTTPS 在 NAS 反向代理终止。文件可读，不做端到端加密。

## 页面范围（以用户最新收口为准）

沿用 TypePro 白底、浅蓝强调色、细边框，仅一个列表，展示笔记及其文档的名称、内容更新时间、成功同步时间、更新源。笔记展开查看对应文档；支持搜索、刷新。首版上传下载通过接口提供，不做预览、回收站、设置、在线编辑或独立活动页。

## 数据与写入

- item: `{kind,id,revision,deleted,updatedAt,syncedAt,source,value}`；id 为小写标准 UUID，revision 从 1 开始。kind 为 notebook/document。updatedAt 是调用方提供的内容修改时间；syncedAt 是本次成功提交的服务端 UTC 时间。source 为 `{deviceId,name}`，name 来自提交 source 字段，未提供时用 deviceId，不猜测设备类型。时间仅用于展示，不能代替 revision 做冲突判断。
- notebook value: `{name,cover}`，cover 为 null、`builtin:<名称>` 或 `../../assets/<assetId>`，不接收本机绝对路径。
- document value: `{notebookId,title,markdown,assetIds}`。Markdown 为 UTF-8。assetIds 为附件 ID 数组；正文内 `../../assets/<assetId>` 引用必须存在并列入数组。附件 ID 为 SHA-256 小写十六进制 + 小写安全扩展名（如 `<64hex>.png`），内容不可变。
- 列表省略 document.value.markdown，其余字段保持一致。获取单项与变更拉取返回完整 value。
- 单事务批量修改；每个操作带 baseRevision，新建为 0。只允许一个批次内同一 kind/id 出现一次。revision 不匹配返回 409，整个批次不生效；禁止盲覆盖。
- put 是完整 value 替换；不允许 put 已删除对象。delete/restore 保留 value，revision 递增。活动文档必须属于活动笔记；非空笔记不能直接删除。删除与恢复均进入变更流。
- `(deviceId,operationId)` 为幂等键，相同键相同请求返回首次结果；相同键不同请求返回 409。重试不得重复创建变更。成功批次整体推进 cursor。
- SQLite 保存元数据、幂等结果、不可变变更记录；Markdown 版本与附件写入普通文件，先原子落文件再提交索引事务。不得因为服务重启丢失修订、cursor 或 instanceId。删除标记本版不自动清理，避免离线设备复活文件。
- 所有写入必须走同一提交接口。服务端仅拒绝冲突，客户端后续负责保留冲突副本及合并；当前版本不是完整跨设备客户端同步交付。

## HTTP API

除 `/healthz` 与网页静态文件外全部要求 `Authorization: Bearer <token>`，令牌不能放 URL、日志或文档。所有错误 JSON: `{error:{code,message,details?}}`。禁用跨域，不设置开放 CORS。

- `GET /healthz` → `{status:"ok"}`，不泄露笔记或路径。
- `GET /api/v1/info` → `{service:"TypePro NAS",version:"0.1.0",protocolVersion:1,instanceId,limits:{maxUploadBytes,maxDocumentBytes,maxBatchOperations},serverTime}`。
- `GET /api/v1/status` → `{notebookCount,documentCount,assetCount,deletedCount,storageBytes,cursor,lastChangeAt,serverTime}`。
- `GET /api/v1/items?kind=notebook|document&notebookId=<uuid>&deleted=false&search=&offset=0&limit=100` → `{items,total}`；kind 可省略，limit 最大 200，deleted 为 true 时仅回收站，默认仅活动对象。
- `GET /api/v1/items/{kind}/{id}` → 完整 item（包括已删除对象供恢复管理）。
- `GET /api/v1/snapshot` → `{instanceId,cursor,items}`，同一读取事务的完整元数据（含删除对象，不含 Markdown），用于首次同步建立清单。
- `GET /api/v1/changes?cursor=0&limit=50` → `{instanceId,cursor,hasMore,changes:[{cursor,deviceId,operationId,item}]}`。cursor 是本次最后返回变更位置，空页返回输入 cursor；超过当前最新位置返回 409 cursor_invalid。limit 最大 200，服务端限制单页实际内容，不能跳过变更。各条记录不可变，不从当前对象重建历史事件。
- `POST /api/v1/commit`，JSON `{deviceId,operationId,source?,operations:[{kind,id,baseRevision,action:"put"|"delete"|"restore",updatedAt?,value?}]}` → `{cursor,items:[完整 item]}`。成功 200。deviceId、operationId、source 为 1–128 字符。put 的 updatedAt 可传带时区 ISO 8601，规范化 UTC；未传则记录服务端时间。delete/restore 不改变原内容修改时间，但推进 syncedAt 与更新源。
- `GET /api/v1/assets?search=&offset=0&limit=100` → `{assets:[{id,name,mediaType,size,createdAt}],total}`。
- `PUT /api/v1/assets/{assetId}`：原始字节，`X-Filename` 为 URL 编码的原文件名；验证 hash、扩展名和容量。相同 ID 内容幂等。→ 附件元数据。
- `GET /api/v1/assets/{assetId}`：附件字节，默认下载，`?inline=true` 仅允许安全位图（png/jpg/jpeg/webp/gif）。SVG/HTML 等一律作为附件下载。无需查询令牌；网页经 fetch 获取 Blob URL。
- 首版不提供 ZIP 导出接口，仅通过文档和附件读取接口下载数据；整个服务数据的备份按部署文档执行。

默认单附件 32 MiB、单文档 16 MiB、提交批次 200 操作；HTTP JSON 请求大小有独立上限。413 表示超限，400/422 表示格式错误，401 未授权，404 不存在，409 版本/幂等/结构冲突。无后台垃圾回收或永久删除接口。

## 模块边界

- `app/store.py`：标准库 SQLite/文件实现，异常 `StoreError(status,code,message,details=None)`；`Store(root,max_document_bytes=16777216,max_upload_bytes=33554432,max_batch_operations=200)`。
- Store 方法：`info()`, `status()`, `list_items(kind=None,notebook_id=None,deleted=False,search="",offset=0,limit=100)`, `get_item(kind,id)`, `snapshot()`, `changes(cursor=0,limit=50)`, `commit(payload)`, `list_assets(search="",offset=0,limit=100)`, `put_asset(asset_id,data,name)`, `get_asset(asset_id)`（返回 `(metadata,Path)`）。Store 层负责全部输入验证和原子并发控制。
- `app/main.py`：FastAPI 路由、请求体容量限制、恒时令牌验证、安全响应头、静态页面。`create_app(store=None,token=None)` 便于测试；生产读取 `TYPEPRO_DATA_DIR` 与 `TYPEPRO_TOKEN`/`TYPEPRO_TOKEN_FILE`，令牌至少 32 字符，不合格拒绝启动。
- `web/`：同源静态 HTML/CSS/ES modules，沿用现有原型的轻量实现；不新增 Node 编译步骤或第三方 CDN。令牌仅当前页面内存；刷新后重新连接。
- Docker：Python slim + FastAPI/Uvicorn，单 worker，非 root，持久化 `/data`，默认绑定宿主 127.0.0.1；NAS 反代提供 HTTPS。无本地 Docker build 或前端构建。

## 验收重点

事务内版本检查、同时写入只有一方成功、批次中途失败回滚、幂等重试、删除恢复、重启持久化、附件 hash 与路径校验、引用完整性、分页 cursor 不遗漏、无令牌拒绝读取、页面把不可信名称仅作为文本展示。按当前约定不本地构建、安装依赖或擅自启动服务；验证结果区分静态审查与实际运行。
