# Unreal Angelscript VS Code Extension

[English](#english) | [中文](#中文)

## Table of Contents
[English](#english)
[Overview](#overview)
[Quick Start](#quick-start)
[Core Features](#core-features)
[More Language Features](#more-language-features)
[Semantic Symbol Colors](#semantic-symbol-colors)
[Offline Cache](#offline-cache)
[Build](#build)
[Known Limits](#known-limits)
[Fork Maintenance](#fork-maintenance)
[Upstream](#upstream)

## 目录
[中文](#中文)
[概览](#概览)
[快速开始](#快速开始)
[核心功能](#核心功能)
[更多语言功能](#更多语言功能)
[语义符号颜色](#语义符号颜色)
[离线缓存](#离线缓存)
[构建](#构建)
[已知限制](#已知限制)
[维护策略](#维护策略)
[上游](#上游)

---

## English

### Overview
This extension provides language server and debugger support for UnrealEngine-Angelscript.

### Quick Start
1. Use an Unreal Editor build with Angelscript enabled.
2. Open either your project's `Script` folder itself, or its parent folder that contains `Script`, in VS Code.
3. Start Unreal Editor. The extension connects automatically.

Notes:
- Core language features run across all resolved `Script` roots from the current workspace folders.
- Supported workspace layouts are strict: the root must be `Script` itself, or contain `<workspace>/Script`.
- Startup indexing scans only resolved `Script` roots (`Script/**/*.as`), not the entire workspace tree.
- Runtime file watching and incremental parse/update handling are also restricted to resolved `Script` roots only.
- Initial indexing honors `UnrealAngelscript.scriptIgnorePatterns`.
- If workspace folders change after activation, reload the window to refresh Script-root watchers and indexing.
- Unsupported workspace layouts fail fast with an error message and skip initial indexing.

### Core Features
- Code completion, go to definition, rename, find references, semantic highlighting.
- Compile errors from Unreal Editor on save.
- Debugging support, breakpoints and exception pause.
- Context commands: `Go to Symbol`, `Wrap with //#region`.

Some features degrade when Unreal Editor is disconnected.

### More Language Features
The language server also provides signature help, code actions and quick fixes. Some of these features require an active Unreal Editor connection.

### Semantic Symbol Colors
Themes do not always distinguish every AngelScript semantic scope. Add `editor.tokenColorCustomizations` to the workspace settings when extra visual distinction is useful. Common scopes include `support.type.component.angelscript`, `support.type.actor.angelscript`, `variable.parameter.angelscript`, `variable.other.local.angelscript`, `variable.other.global.angelscript`, and `entity.name.function.angelscript`.

```json
{
    "editor.tokenColorCustomizations": {
        "[Default Dark+]": {
            "textMateRules": [
                {
                    "scope": "support.type.component.angelscript",
                    "settings": { "foreground": "#4ec962" }
                },
                {
                    "scope": "support.type.actor.angelscript",
                    "settings": { "foreground": "#2eb0c9" }
                }
            ]
        }
    }
}
```

### Offline Cache
The language server restores its role-owned cache at startup to provide baseline capabilities without an active engine connection.

- Roles are limited to `vscode` and `project-daemon`; both keep the Unreal connection online and publish an independent v2 cache.
- VS Code cache: `<Project>/Script/.vscode/angelscript/debug-database.v2.json.gz`.
- Project daemon cache: `<Project>/Saved/ASEditorAutomation/LanguageServer/debug-database.v2.json.gz`.
- VS Code enables cache access only when its workspace resolves to exactly one physical `.uproject`; otherwise it keeps language features active, disables cache I/O, and warns.
- The compact gzip envelope preserves ordered DebugDatabase chunks and records project identity, revision, content hash, producer metadata, script settings, and completion state.
- Corrupt, oversized, incomplete, identity-mismatched, or unsupported cache files are ignored safely.
- A complete native generation is validated and accepted into the in-memory TypeDB before cache I/O. API queries continue to use that active generation while an immutable snapshot is published asynchronously.
- A worker thread serializes, hashes, compresses, writes, fsyncs, and verifies a unique same-directory temporary file. The main thread then rechecks the generation token, atomically replaces the final cache, and asynchronously fsyncs the parent directory. A superseded or invalid temporary file never touches the prior final cache.
- The single writer retries the latest generation after 1s, 3s, and 5s. Permanent failure keeps the active TypeDB and prior final cache, reports the cache as dirty, and waits for the next complete native generation or bounded shutdown flush.
- After this VS Code process successfully publishes a live v2 generation, it safely removes the exact legacy `Script/.vscode/angelscript/unreal-cache.json` regular file.
- Before and after each Windows TCP connection, the server verifies that the listener belongs to the same Unreal Editor process whose command line contains the exact physical `.uproject`.
- Platforms without strict listener-owner verification fail closed for live TCP refresh and report `unsupported-platform`; a compatible existing v2 cache remains available offline.
- `project-daemon` requires `initialize.processId`; the child performs a bounded cache flush and exits when its daemon parent dies or its stdio stream closes.
- API queries use the live in-memory TypeDB. There is no API query index export or standalone index bundle.
- Standard `textDocument/diagnostic` and `workspace/diagnostic` pull requests return deterministic result IDs and support unchanged reports through previous-result IDs.
- `angelscript/diagnosticsStatus` exposes monotonic `semanticGeneration` and `settledSemanticGeneration` counters plus `activeRevision`, `persistedRevision`, `cacheState`, `cacheDirty`, `persistenceAttempt`, and `lastPersistenceError`. Persistence failure does not reduce semantic readiness. A request snapshot is stable only when both semantic counters match, `fullReady` is true, and the counters remain unchanged across status-before/request/status-after.
- Each `DebugDatabaseSettings` message starts a new native transaction on the verified socket. A completed generation becomes queryable immediately, while full readiness and pull diagnostics wait for its generation-bound script resolution and diagnostics pass; superseded passes cannot settle readiness or request a semantic-token refresh.

### Build
- `npm install` installs the root dependencies and the nested `extension` and `language-server` packages via `postinstall`.
- `npm run compile` builds both the extension bundle and the language server bundle.
- `npm run watch` watches both bundles during development.
- `npm test` runs the full test suite.
- `npm run test:fork-boundary` runs the fork-boundary regression suite for the language-server API query core and workspace layout behavior.

### Known Limits
- When engine is disconnected, details depend on cached DebugDatabase and available `doc` fields.
- Cache is not written before DebugDatabase processing completes.
- This extension is incompatible with `Hazelight.unreal-angelscript`. On each startup, if that extension is installed, this extension shows an error message with an `Open Extensions` action, then stops initialization.

### Fork Maintenance
This fork uses a layered-compatibility maintenance strategy to keep future upstream merges manageable.

- This repository follows a layered-compatibility strategy for future upstream merges.
- Detailed maintenance rules live in [MAINTAINING.md](./MAINTAINING.md).
- Agent and automation execution rules live in [AGENTS.md](./AGENTS.md).

### Upstream
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se

---

## 中文

### 概览
这是 UnrealEngine-Angelscript 的 VS Code 扩展分支版本,提供语言服务与调试能力.

### 快速开始
1. 使用启用 Angelscript 的 Unreal Editor 版本.
2. 在 VS Code 中打开项目的 `Script` 文件夹本身,或打开其上一级且包含 `Script` 的目录.
3. 启动 Unreal Editor,扩展会自动连接.

说明:
- 核心语言功能会覆盖当前 workspace folders 中所有解析成功的 `Script` 根目录.
- 工作区兼容策略为严格模式: 根目录必须是 `Script` 本身,或包含 `<workspace>/Script`.
- 启动索引只扫描解析后的 `Script` 根目录(`Script/**/*.as`),不会全盘递归扫描工作区.
- 运行期文件监听与增量解析/更新同样严格限制在解析后的 `Script` 根目录内.
- 初始索引会遵守 `UnrealAngelscript.scriptIgnorePatterns`.
- 如果激活后发生 workspace folders 变更,需要 reload window 才会刷新 `Script` watcher 和索引.
- 对不受支持的工作区形态会快速报错并跳过初始索引.

### 核心功能
- 代码补全、定义跳转、重命名、引用查找、语义高亮.
- 保存时展示 Unreal Editor 返回的编译错误.
- 调试支持,含断点与异常暂停.
- 右键命令: `Go to Symbol`、`Wrap with //#region`.

部分能力依赖 Unreal Editor 连接,断开时会降级.

### 更多语言功能
Language server 还提供 signature help、code actions 和 quick fixes. 部分功能需要 Unreal Editor 保持连接.

### 语义符号颜色
Color theme 不一定能区分所有 AngelScript semantic scope. 如需更明显的视觉区分,可在 workspace settings 中配置 `editor.tokenColorCustomizations`;常用 scope 与上方 English 示例相同.

### 离线缓存
Language Server 启动时会恢复当前 role 独占的缓存,在未连接引擎时提供基础能力.

- Role 仅保留 `vscode` 和 `project-daemon`;两者都保持 Unreal connection online,并发布彼此独立的 v2 cache.
- VS Code cache: `<Project>/Script/.vscode/angelscript/debug-database.v2.json.gz`.
- Project daemon cache: `<Project>/Saved/ASEditorAutomation/LanguageServer/debug-database.v2.json.gz`.
- VS Code workspace 只有解析到唯一 physical `.uproject` 时才启用 cache I/O;否则保留语言功能、禁用 cache 并警告.
- compact gzip envelope 保留 DebugDatabase chunks 的原始顺序,并记录 project identity、revision、content hash、producer metadata、script settings 和完成状态.
- 损坏、超预算、不完整、identity 不匹配或 schema 不受支持的缓存会被安全忽略.
- 完整 native generation 会先完成校验并成为 in-memory TypeDB 的 active authority,之后才进行 cache I/O. Immutable snapshot 异步发布期间,API query 继续使用该 active generation.
- Worker thread 负责 serialize、hash、compress、写入、fsync 并验证同目录唯一临时文件. Main thread 随后再次检查 generation token、atomic replace final cache,再异步 fsync parent directory. 已被替代或无效的临时文件不会触碰旧 final cache.
- Single writer 会在 1s、3s、5s 后重试 latest generation. 永久失败时保留 active TypeDB 与旧 final cache,报告 cache dirty,并等待下一轮完整 native generation 或 bounded shutdown flush.
- 当前 VS Code process 成功发布 live v2 generation 后,才会安全删除 exact legacy `Script/.vscode/angelscript/unreal-cache.json` regular file.
- Windows 下每次 TCP connect 前后都会验证 listener owner 是同一个 Unreal Editor process,且其 command line 包含 exact physical `.uproject`.
- 无 strict listener-owner verification 的平台会拒绝 live TCP refresh 并报告 `unsupported-platform`;已有 compatible v2 cache 仍可用于 offline 能力.
- `project-daemon` 必须提供 `initialize.processId`;daemon parent 退出或 stdio 关闭时 child 会执行 bounded cache flush 后退出.
- API query 直接使用常驻内存 TypeDB,不再导出 API query index 或 standalone index bundle.
- 标准 `textDocument/diagnostic` 与 `workspace/diagnostic` pull request 会返回确定性的 result ID,并通过 previous-result ID 支持 unchanged report.
- `angelscript/diagnosticsStatus` 提供单调递增的 `semanticGeneration` 与 `settledSemanticGeneration`,以及 `activeRevision`、`persistedRevision`、`cacheState`、`cacheDirty`、`persistenceAttempt` 和 `lastPersistenceError`. Persistence failure 不会降低 semantic readiness. 只有两个 semantic counter 相等、`fullReady` 为 true,且 status-before/request/status-after 的计数保持不变时,request snapshot 才稳定.
- Verified socket 上每个 `DebugDatabaseSettings` message 都会开始新的 native transaction. 完整 generation 会立即用于 query,但 full readiness 与 pull diagnostics 必须等待绑定该 generation 的 script resolve/diagnostics pass;被 supersede 的 pass 不能 settle readiness 或请求 semantic-token refresh.

### 构建
- `npm install` 会安装根目录依赖,并通过 `postinstall` 安装嵌套的 `extension` 和 `language-server` 包依赖.
- `npm run compile` 会同时构建 extension bundle 和 language server bundle.
- `npm run watch` 会在开发时同时监听这两个 bundle.
- `npm test` 会运行完整测试集.
- `npm run test:fork-boundary` 会运行 fork boundary 回归测试,重点覆盖 language-server API query core 和 workspace layout 行为.

### 已知限制
- 引擎断开时,详情能力依赖缓存 DebugDatabase 与 `doc` 字段可用性.
- DebugDatabase 完整结束前不会写入缓存.
- 本扩展与 `Hazelight.unreal-angelscript` 不兼容. 每次启动如果检测到该扩展已安装,会弹出错误提示并提供 `Open Extensions` 入口,随后停止初始化.

### 维护策略
这个 fork 默认采用分层兼容维护策略,以便后续继续合并 upstream 时把冲突控制在可管理范围内.

- 本仓库采用 layered compatibility 策略来降低未来合并 upstream 的成本.
- 更完整的维护规则见 [MAINTAINING.md](./MAINTAINING.md).
- agent 和自动化执行约束见 [AGENTS.md](./AGENTS.md).

### 上游
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se
