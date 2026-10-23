# TypePro NAS API v1

所有业务请求使用 `Authorization: Bearer <你的令牌>`。只通过 HTTPS 远程访问；令牌不放 URL。域名示例和 UUID 只是说明，不会自动连接或写入服务。

## 最小接入流程

1. `GET /api/v1/info` 获取 `instanceId`、协议版本和容量限制。
2. 首次 `GET /api/v1/snapshot` 获取清单与基线 cursor；文档正文通过 `GET /api/v1/items/document/<id>` 读取。期间发生的新变更从 snapshot.cursor 拉取，不能按时间戳猜版本。
3. 本地变更先落本地，再提交 `POST /api/v1/commit`。新建 `baseRevision:0`，修改为已读取版本。附件先上传，文档再引用。
4. `GET /api/v1/changes?cursor=<上次位置>&limit=50` 拉取变更；`hasMore:true` 时继续。成功持久应用本页后才推进 cursor。每条含不可变 item 版本及来源。
5. 409 版本冲突时保留本地待同步内容，重新获取远端再处理，不能使用旧 baseRevision 反复覆盖。重试同一次请求使用相同 operationId 和相同请求体。

`snapshot.items` 的文档省略 Markdown，避免列表下载正文；获取单项和变更流返回完整 `value.markdown`。cursor 属于特定 instanceId，换服务不能混用。恢复旧服务备份后客户端应重新建立基线，而非沿用未确认有效的 cursor。

## 创建一本笔记和一篇文档

请求 `POST /api/v1/commit`，`Content-Type: application/json`：

```json
{
  "deviceId": "my-mac-device-id",
  "operationId": "cf6050b1-7140-43ea-85e7-c210642d2aa1",
  "source": "MacBook Pro",
  "operations": [
    {
      "kind": "notebook",
      "id": "22b37ad3-e9d6-42b0-bcf9-119d5a6656a5",
      "baseRevision": 0,
      "action": "put",
      "updatedAt": "2026-10-21T09:00:00Z",
      "value": {"name": "工作笔记", "cover": null}
    },
    {
      "kind": "document",
      "id": "7f605752-2903-4f60-9cb1-b0ee400db95a",
      "baseRevision": 0,
      "action": "put",
      "updatedAt": "2026-10-21T09:05:00Z",
      "value": {
        "notebookId": "22b37ad3-e9d6-42b0-bcf9-119d5a6656a5",
        "title": "第一篇笔记",
        "markdown": "# 第一篇笔记\n\n保存在 NAS。\n",
        "assetIds": []
      }
    }
  ]
}
```

成功响应 `{cursor,items}`，每个 item 含 `revision:1`、调用方内容时间 `updatedAt`、服务端提交时间 `syncedAt`、`source:{deviceId,name}` 和完整 value。下一次更新提交新的 operationId、相应 baseRevision 和完整 value。整个批次一起成功或失败；不能省略旧 value 字段来做局部更新。

`source` 由设备独立上报，如 `MacBook Pro` 或 `Pixel / Android`。`updatedAt` 必须带时区，服务端规范化 UTC；省略时按服务端时间记录。

## 附件

计算文件内容 SHA-256，使用 `<64位小写SHA256>.<小写扩展名>` 作为 assetId：

- `PUT /api/v1/assets/<assetId>`：原始二进制正文。`X-Filename` 使用 UTF-8 URL 编码文件名，默认名称为 assetId。服务端校验 hash 与容量。
- `GET /api/v1/assets/<assetId>`：下载原始字节，同样要求 Authorization。
- 文档中使用 `../../assets/<assetId>`，并把 assetId 放入 `value.assetIds`。服务端不会抓取文档外链。

附件不可变，相同 assetId 重试返回首次元数据。新增内容须生成新 hash；不提供永久删除接口。图片预览仅可使用 `?inline=true` 的安全位图响应，其他格式强制下载。

## 其他读取／状态接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/items?kind=notebook&deleted=false&offset=0&limit=100` | 活动笔记列表 |
| `GET /api/v1/items?kind=document&notebookId=<id>` | 对应文档清单 |
| `GET /api/v1/items/<kind>/<id>` | 获取完整对象及版本，kind 为 notebook/document |
| `GET /api/v1/assets?offset=0&limit=100` | 附件清单 |
| `GET /api/v1/status` | 服务统计与最新 cursor |

列表支持 `search`、分页，limit 最大 200。删除／恢复在 commit 中使用 `action:delete` / `action:restore` 和当前 baseRevision，不带 value；内容修改时间保留，成功同步时间与来源更新。不能删除仍有活动文档的笔记；可在同批次显式删除各文档及笔记，所有版本都须匹配。

## 失败处理

错误统一为 `{error:{code,message,details?}}`。401 要重新连接；409 表示版本、幂等键或结构冲突，不得静默覆盖；413 需缩小文档／附件／批次；400/422 是输入格式问题；5xx 可以退避重试同一操作，但不能擅自生成新 operationId。

默认：单附件 32 MiB、单文档 16 MiB、JSON 请求 32 MiB、批次最多 200 个操作。变更页最多返回 32 MiB 左右的内容，第一条过大时仍完整返回，不截断文档。每页以实际返回 cursor 为准，不能使用 `cursor + limit` 推算。

本版只实现服务端协议。Mac/安卓还需实现本地队列、基线、附件引用映射、冲突保留与后台调度，之后才能完成自动双向同步。
