# TypePro Plugin API 3

Status: implementation contract. Host capabilities are generic; feature names, provider protocols, prompts, metrics and plugin-specific UI belong to plugin packages. API 1 remains supported. API 2 business-specific registrations are retired, with an actionable update notice rather than silently running host implementations.

API 3 is the baseline contract for independent plugin releases. Changes within it must preserve existing parameter meanings, return types, permissions, defaults and storage semantics. New optional capabilities must fail explicitly on unsupported hosts; incompatible changes require a new API version and a separate compatible catalog. A plugin business/UI update using existing API 3 capabilities does not require rebuilding the host. No new application release is implied by a plugin version change.

## Package and compatibility

A ZIP contains `manifest.json`, `main.js`, and optional UTF-8 `.js`, `.css`, `.json`, `.txt`, `.md`, `.svg` resources under `files/`. Resource keys are relative paths up to 200 characters; no executable native files, path traversal, reserved object keys, duplicate paths or remote scripts. ZIP compressed and expanded totals: 8 MiB; maximum 128 files; main.js: 512 KiB; each resource: 4 MiB; manifest: 16 KiB. JSON import uses `{manifest,code,files?:Record<string,string>}` with the same limits. Every resource is included in package verification and synchronized local installation identity. Market installations remain pinned to immutable release SHA-256.

Manifest fields: existing id/name/version/description/permissions, `apiVersion:3`, optional `networkOrigins:string[]` (up to 32 exact HTTPS origins, no wildcard, path, credentials, query or fragment; a trailing slash is normalized away). New origins and permissions require approval on this device. Unknown fields are not granted as capabilities. New devices restore packages disabled. Market API 3 catalog is separate from legacy API 1/2 catalogs so old clients remain readable.

## Execution and UI

`main.js` is an async Worker entry with global `notebook`. It registers commands, views and event subscriptions. Views are isolated sandbox iframes with no same-origin, parent DOM, Tauri, direct network or external executable content. A view executes a package JS resource and optional CSS resources. JS resources must be self-contained browser scripts; build tools are a publisher concern, not host functionality. Workers and views use the same permission-checked RPC. Views have DOM only inside their own frame. Host never evals plugin code in its main window.

`notebook.context` contains `{pluginId, surfaceId:null|string, slot:null|string, deviceId, theme:{mode,accent}, activeDocumentId:null|string}`. `deviceId` is a stable device-local opaque UUID. No synchronized credentials or grants. Theme updates are events and CSS custom properties `--tp-bg`, `--tp-surface`, `--tp-text`, `--tp-muted`, `--tp-border`, `--tp-accent`, `--tp-accent-soft`, `--tp-radius`, `--tp-font`.

Generic slots (`editor.sidebar` requires TypePro 1.7.0 or later; API 3 plugins supporting older hosts may catch an unknown-slot error and register an `app.page` fallback inside the plugin):

* `home.widget`: content above the notebook list; height 100–600px, default 220; stacked on mobile.
* `app.page`: main content page, back action owned by shell.
* `plugin.settings`: settings page opened from installed plugin entry.
* `editor.sidebar`: right-hand pane alongside the open notebook editor; registered views receive a host-owned editor toolbar icon from their `icon` and `title`, without an extra command. One sidebar is visible at a time. Clicking its icon toggles it; `ui.open(id)` remains idempotent and requires an open notebook editor. Width, selected view and open/closed preference are device-local; first use is closed. At widths up to 700px it becomes a right-hand drawer with a scrim and close action. Sidebar content is plugin-owned and obtains no new permissions. An unhandled Escape inside a sidebar invokes its existing `ui.close()`; composing input, prevented keyboard events and an open native dialog are left to the plugin. Plugins must consume Escape when dismissing their own nested layers.
* Command locations: `app.menu` (default), `home.toolbar`, `editor.toolbar`. Toolbar overflow must remain usable on mobile. Icons use a small named host icon vocabulary; unknown names fall back to a generic plugin icon.

Views: `ui.register({id,slot,title,script,styles?:string[],height?:number,icon?:string})`, `ui.open(id)`, `ui.close()` (only the calling page/settings/sidebar view), `ui.resize(height)` (home.widget only), `ui.openExternal(url)` (HTTP(S) only). script/styles are relative `.js`/`.css` keys in files, e.g. `ui.js`, `ui.css`, not URLs. Commands: `commands.register(id,label,callback,{locations?:string[],icon?:string,shortcut?:string})`. Shortcut modifiers use the order Mod, Ctrl, Alt, Shift, e.g. `Mod+Shift+KeyK`; Mod is Command on Mac and Control elsewhere. Ctrl denotes the additional physical Control key on Mac. At least one modifier is required. Conflicts reject registration without overriding app/system shortcuts; plugins can retry without a shortcut. Approved plugin shortcuts work in the shell and that plugin's own views. All registrations disappear on disable/uninstall. A page/view never grants additional capabilities.

## Permissions and SDK

All calls are Promise-based; unknown methods fail. Permission is checked on every call against currently running instance, not supplied by plugin code. The public TypeScript declarations live in the independent plugin repository at `sdk/typepro.d.ts`; they have no dependency on application source.

| Permission | API |
| --- | --- |
| `notes.read` | notes.list(), notes.search(query,{limit?,offset?}), notes.get(id), notes.active(), notes.open(id); events with document content |
| `notes.write` | notes.create(notebookId,title,markdown), notes.update(id,markdown,{expectedMarkdown?}); no arbitrary file paths |
| `editor.read` | editor.selection(): {documentId,text}; editor.context(): current document metadata |
| `editor.insert` | editor.insert(text), editor.replaceSelection(text); normal undo history |
| `commands` | commands.register as above |
| `panels` | panels.set(id,title,text), panels.close(id); up to 6 plain-text panels |
| `ui` | ui registration/navigation/resize, dialogs.confirm, dialogs.reviewChanges, notifications.show |
| `storage` | storage.get(key), list(prefix?), set(key,value), remove(key); own synchronized JSON namespace |
| `network` | network.request(options), network.stream(options,onChunk,{signal?}); exact approved HTTPS origins |
| `secrets` | secrets.configure(id,{label,origin}), status(id,{origin}), remove(id); trusted host input; no secret read |
| `files.pick` | files.pick({extensions?:string[]}), returns null or {name,bytes:number[]}; system chooser, max 8 MiB |
| `files.export` | files.save({name,bytes:number[]}), returns boolean; system save chooser, max 8 MiB |

Legacy API 1 methods retain their existing permissions. No process execution, unrestricted filesystem, plugin-to-plugin data access or raw native bridge.

`notes.search` returns `{results:[{id,title,notebookId,notebook,updatedAt,snippet}],hasMore}`. The limit is 1–50 (default 20), offset is nonnegative, and snippets are at most 300 characters. No whole-workspace body dump is needed for search.

Network request: `{url,method?:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',headers?:Record<string,string>,body?:string,credential?:{id,header?:string,prefix?:string}}`. Default credential header is Authorization with prefix `Bearer `. Credentials are scoped by plugin ID, credential ID and exact HTTPS origin. Credential use requires both network and secrets permissions. Request API returns `{status,headers,body}`; stream passes raw UTF-8 chunks and returns `{status,headers}`. Host does not parse SSE, JSON models, tool calls or provider payloads. Request body max 5 MiB; response max 8 MiB; max 4 concurrent/plugin; 15s connect/300s total; redirects disabled; cancel on abort/disable. Plugin may request up to 32 additional exact HTTPS origins through `network.authorize(origin)`, which invokes trusted host confirmation and persists a device-local grant; a synchronized URL change alone never grants access. Up to 64 declared and device-granted origins may be active together.

`secrets.configure` opens a trusted host input, saves on device, and returns only `{configured:true}`. The secret is never returned to worker/view or stored in plugin JSON. Changing target origin requires separate configuration. No reuse of another plugin's credentials.

`dialogs.confirm({title,message},{signal?})` returns boolean. `dialogs.reviewChanges(proposal,{signal?})` shows a host-owned concrete before/after preview and, on approval, applies that exact change with a final revision check; returns `{applied:boolean,documentId?:string}`. A creation proposal is `{notebookId,title,markdown}`; an update is `{documentId,title,markdown,expectedMarkdown}`. `expectedMarkdown` is required for review of existing content. Abort dismisses the pending review and prevents later approval from writing. All plugin-driven proposed note creation/update requiring confirmation can use this API. Plugins cannot forge approval tokens; review applies the change, not a later arbitrary request.

## Events, provenance and lifecycle

`events.on(name,callback)` returns async unsubscribe. Names: `document.changed`, `document.active`, `storage.changed`, `sync.completed`, `theme.changed`, `view.visibility`. Body access requires notes.read. `document.changed` payload: `{documentId,title,beforeMarkdown,afterMarkdown,beforePlain?,afterPlain?,origin:'human'|'plugin'|'sync'|'import',history?:'undo'|'redo',timestamp,transactionId}`. Origin is assigned by host. No counting, dates or activity interpretation in host. Events are ordered in the current runtime, not a durable event log. At enable/restart plugins establish their own baseline. Document active event contains `{documentId}`. Storage event contains `{keys:string[]|null}` in the receiving plugin's namespace; null means reload namespace after sync. Theme event contains `{mode,accent}`. `view.visibility` delivers `{visible:boolean}` only to the subscribing connection. Subscribing receives the current state; later changes are deduplicated. For views, the host combines the surface open/closed state with its own document foreground state; a sidebar retained in a hidden iframe never reports visible merely because the application is foreground. Workers receive only the host foreground state, without another view's visibility. A collapsed sidebar may retain its mounted iframe and local draft; hiding does not imply cancellation. Unmount, disable or uninstall disposes the connection and cancels its pending calls. Switching editor documents updates the existing context and `document.active`, without requiring a sidebar remount. Background operation only while TypePro is running; no guarantee of Android execution after suspension.

Main init: 8s, command callback: 10s, general RPC: 10s; user dialogs, secure configuration, file pick/save and network RPC: 360s. Network itself retains its 300s limit. SDK abort/timeout sends `request.cancel` for that connection's exact request. Max 120 RPC/s/plugin and 100 pending calls per connection; host stops failed/abusive instances and disposes its views, pending requests and network operations. Plugin callbacks serialize business operations where needed. Disable/re-enable does not discard stored data. UI scripts report errors to host; one failing plugin must not stop others.

## Storage and migration

Existing plugin IDs and JSON keyspaces are retained. Storage entries synchronize using the existing per-key LWW and delete tombstones. Equal timestamps are ordered by device ID and canonical content. No append guarantee for concurrently overwritten single keys: plugins split independent records into keys. storage.changed notifies local and remote changes. Limits remain 32 MiB / 20000 entries combined, 128 install records. Plugins own schemaVersion and idempotent data migrations; host treats values as JSON. Uninstall retains plugin data and emits synchronized uninstall tombstone. API keys, local runtime grants and enable state never synchronize.

Retired API 2 feature registration calls fail with `UNSUPPORTED_API` and prompt updating the plugin. Keep no host daily-checkin or assistant implementation. Existing credential records may be reconfigured via generic secure credential UI; no silent sharing across namespaces. Existing plugin business data is retained when updating to API 3.

## Errors and acceptance

RPC errors: `{code,message}` with codes `PERMISSION_DENIED`, `INVALID_ARGUMENT`, `NOT_FOUND`, `CONFLICT`, `CANCELLED`, `LIMIT_EXCEEDED`, `UNSUPPORTED_API`, `NETWORK_ERROR`, `INTERNAL_ERROR`. SDK rejects Error with stable `code`; plugins may display localized message. No secret/request authorization header in messages or logs.

Acceptance: app import/native command graph has no daily/assistant implementation or plugin-ID special case; both plugins implement business logic and UI inside their own package; unchanged API 3 permits plugin-only business/UI updates; disable removes surfaces and cancels work; public market and synchronized imported packages preserve all resource bytes; first-run permissions and private keys remain device-local. Static verification and runtime verification are reported separately.
