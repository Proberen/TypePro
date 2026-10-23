# Native application

The Tauri window uses the operating system WebView. The native layer owns Markdown files, the index, attachments, portable ZIP import/export, and Android document-provider writes. It does not require a login or storage-wide Android permissions.

## Storage

The root is the platform app-data directory followed by `workspace/`:

- `index.json`: notebook/document metadata and installed plugin records.
- `notebooks/<notebook UUID>/<document UUID>.md`: the actual UTF-8 document.
- `assets/<UUID>.<extension>`: local attachments.
- `pending.json`: a temporary recovery journal for an interrupted save.

Commands serialize storage access. Each changed Markdown file and the index use atomic replacement. The journal completes an interrupted save on the next load. Invalid indexes or missing files produce an error instead of silently replacing the library. Files removed from a committed index are deleted afterward. Unused attachments are retained until application data is removed; exporting does not delete local data.

Portable ZIPs contain `manifest.json`, ordinary Markdown files, and the attachments referenced by those documents. Import allocates new UUIDs and keeps existing data, including same-name notebooks/documents. Plugins are installed separately from their own packages. Limits: 16 MB per Markdown document, 32 MB per attachment, 128 MB per ZIP, 256 MB expanded ZIP, 10,000 ZIP entries, 5,000 documents. Markdown exports alone do not include attachments.

## Building

Use the locked npm and Cargo dependencies. macOS requires Xcode command-line tools and an Apple Silicon host. Android requires Java 17+, Android SDK Platform 36, and an NDK (this delivery used 27.2.12479018). `ANDROID_HOME`, `NDK_HOME`, and `JAVA_HOME` must refer to those local installations.

```sh
npm ci
npm run tauri -- build --target aarch64-apple-darwin
npm run tauri -- android build --apk --target aarch64 armv7 --ci
```

Android's `personalRelease` signing configuration reads these environment variables:

- `NOTEBOOK_KEYSTORE_PATH`
- `NOTEBOOK_KEYSTORE_PASSWORD`
- `NOTEBOOK_KEY_ALIAS` (defaults to `notebook`)
- `NOTEBOOK_KEY_PASSWORD`

Keep the signing key for future updates; it is intentionally outside this source directory. The macOS package uses ad-hoc signing for personal installation and is not notarized by Apple.

## Validation

`cargo test --manifest-path src-tauri/Cargo.toml --lib` checks saving/reloading real Markdown, external Markdown edits, journal recovery, damaged-index protection, ZIP/attachment round trips with duplicate imports, traversal rejection, committed deletion, and UTF-8 imports. App UI and system document-provider behavior require device or WebView checks in addition to these tests.

## Android file transfer

The official dialog plugin obtains system-granted content URIs. Imports use the official filesystem plugin. Exports use the app-local `TransferPlugin` so the ContentResolver OutputStream remains open until writes finish; plugin-fs 2.7.1 detaches the provider descriptor before writing (upstream issue tauri-apps/plugins-workspace#3356). No additional storage permission is requested. Android backup is disabled; export notes before uninstalling.
