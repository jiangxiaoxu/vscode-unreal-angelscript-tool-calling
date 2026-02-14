# Unreal Angelscript VS Code Extension

[English](#english) | [中文](#中文)

---

## English

### Overview
This extension provides language server and debugger support for UnrealEngine-Angelscript, with additional LM tools in this fork.

### Quick Start
1. Use an Unreal Editor build with Angelscript enabled.
2. Open your project's `Script` folder in VS Code as the workspace root.
3. Start Unreal Editor. The extension connects automatically.

Notes:
- Core language features still follow the primary workspace.
- LM tool `filePath` resolution supports multi-root with explicit root prefix (`<workspaceFolderName>/...`).
- Supported workspace layouts are strict: the root must be `Script` itself, or contain `<workspace>/Script`.
- Startup indexing scans only resolved `Script` roots (`Script/**/*.as`), not the entire workspace tree.
- Runtime file watching and incremental parse/update handling are also restricted to resolved `Script` roots only.
- Unsupported workspace layouts fail fast with an error message and skip initial indexing.

### Core Features
- Code completion, go to definition, rename, find references, semantic highlighting.
- Compile errors from Unreal Editor on save.
- Debugging support, breakpoints and exception pause.
- Context commands: `Go to Symbol`, `Wrap with //#region`.

Some features degrade when Unreal Editor is disconnected.

### Offline Cache
The extension restores cache data at startup to provide baseline capabilities without an active engine connection.

- Cache path: `Script/.vscode/angelscript/unreal-cache.json`
- Refresh trigger: `DebugDatabaseFinished` or `DebugDatabaseSettings`
- Includes: DebugDatabase chunks, scriptSettings, engineSupportsCreateBlueprint
- Excludes: assets, script-index
- Corrupt or version-mismatched cache is ignored safely
- Write strategy: temp file + fsync + rename

### Language Model Tools
Exposed tools:
- `angelscript_searchApi`
- `angelscript_resolveSymbolAtPosition`
- `angelscript_getTypeMembers`
- `angelscript_getClassHierarchy`
- `angelscript_findReferences`

If you need an HTTP MCP endpoint, install this extension to bridge VS Code `languageModelTools`: https://marketplace.visualstudio.com/items?itemName=jiangxiaoxu.lm-tools-bridge


Output rules:
- All tools expose machine-readable JSON payload plus a human-readable multi-line text channel.
- Success response is unified as `{ ok: true, data: ... }`.
- Failure response is unified as `{ ok: false, error: { code, message, ... } }`.
- In VS Code LM tools, `LanguageModelToolResult.content` now includes both:
  - `LanguageModelDataPart.json(payload)` for machine-readable JSON
  - `LanguageModelTextPart` for human-readable multi-line text summary
- Clients should treat structured JSON (`LanguageModelDataPart.json`) as the only machine contract.
- Input `filePath` supports absolute path or workspace-relative path (prefer `<workspaceFolderName>/...`).
- In structured JSON output, `filePath` is always absolute path.
- In human-readable text output (`LanguageModelTextPart`), `filePath` prefers workspace-relative path with root prefix; if not in workspace, output falls back to absolute path.
- For line-based results, tools include `preview` source snippets (max 20 lines, truncated with `... (truncated)`, fallback `<source unavailable>`).

Tool notes:
- `angelscript_searchApi`: Search Angelscript APIs and docs with fuzzy tokens, OR(`|`), separator constraints(`.`/`::`), optional filters, pagination, and regex.
- `angelscript_resolveSymbolAtPosition`: All line/character indices in tool input/output are 1-based. Success `data.symbol` includes `kind/name/signature`, optional `doc`, and optional `definition{ filePath, startLine, endLine, preview }`. It checks the line before definition start for `UCLASS/UPROPERTY/UFUNCTION/UENUM`; when matched, that macro line is used as preview start.
- `angelscript_getTypeMembers`: List members for an exact type name, with optional inherited members/docs.
- `angelscript_getClassHierarchy`: Return compact class hierarchy JSON for an exact class name: `root`, `supers`(nearest parent first), `derivedByParent`(parent -> direct children), `sourceByClass`, `limits`, `truncated`. In `sourceByClass`, cpp classes are `{ source: "cpp" }`, script classes are `{ source: "as", filePath, startLine, endLine, preview }` (`filePath` is absolute in structured JSON; text output shows workspace-relative-first, line numbers are 1-based). Defaults: `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: All line/character indices in tool input/output are 1-based. Success `data` is `{ total, references[] }`; each reference includes `{ filePath, startLine, endLine, range, preview }`; `range` is also 1-based.

### Build
```bash
npm run compile
```

### Known Limits
- When engine is disconnected, details depend on cached DebugDatabase and available `doc` fields.
- Cache is not written before DebugDatabase processing completes.
- This extension is incompatible with `Hazelight.unreal-angelscript`. On each startup, if that extension is installed, this extension shows an error message with an `Open Extensions` action, then stops initialization.

### Upstream
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se

---

## 中文

### 概览
这是 UnrealEngine-Angelscript 的 VS Code 扩展分支版本,提供语言服务与调试能力,并新增 LM tools 支持.

### 快速开始
1. 使用启用 Angelscript 的 Unreal Editor 版本.
2. 在 VS Code 中把项目 `Script` 文件夹作为工作区根目录打开.
3. 启动 Unreal Editor,扩展会自动连接.

说明:
- 核心语言功能仍按主工作区运行.
- LM tool 的 `filePath` 解析支持多工作区,可用 root 前缀(`<workspaceFolderName>/...`)精确定位.
- 工作区兼容策略为严格模式: 根目录必须是 `Script` 本身,或包含 `<workspace>/Script`.
- 启动索引只扫描解析后的 `Script` 根目录(`Script/**/*.as`),不会全盘递归扫描工作区.
- 运行期文件监听与增量解析/更新同样严格限制在解析后的 `Script` 根目录内.
- 对不受支持的工作区形态会快速报错并跳过初始索引.

### 核心功能
- 代码补全、定义跳转、重命名、引用查找、语义高亮.
- 保存时展示 Unreal Editor 返回的编译错误.
- 调试支持,含断点与异常暂停.
- 右键命令: `Go to Symbol`、`Wrap with //#region`.

部分能力依赖 Unreal Editor 连接,断开时会降级.

### 离线缓存
扩展启动时会恢复缓存,在未连接引擎时提供基础能力.

- 缓存路径: `Script/.vscode/angelscript/unreal-cache.json`
- 刷新时机: `DebugDatabaseFinished` 或 `DebugDatabaseSettings`
- 包含: DebugDatabase chunks、scriptSettings、engineSupportsCreateBlueprint
- 不包含: assets、script-index
- 缓存损坏或版本不匹配会被安全忽略
- 写入策略: 临时文件 + fsync + rename

### Language Model Tools
提供以下工具:
- `angelscript_searchApi`
- `angelscript_resolveSymbolAtPosition`
- `angelscript_getTypeMembers`
- `angelscript_getClassHierarchy`
- `angelscript_findReferences`

如果需要 HTTP MCP 服务,可以安装这个插件,把 VS Code `languageModelTools` 桥接出来: https://marketplace.visualstudio.com/items?itemName=jiangxiaoxu.lm-tools-bridge


输出规则:
- 所有工具都同时提供 machine-readable JSON payload 与 human-readable 多行文本通道.
- 成功返回统一为 `{ ok: true, data: ... }`.
- 失败返回统一为 `{ ok: false, error: { code, message, ... } }`.
- 在 VS Code LM tool 中,`LanguageModelToolResult.content` 现在同时包含:
  - `LanguageModelDataPart.json(payload)` 用于 machine-readable JSON
  - `LanguageModelTextPart` 用于 human-readable 多行文本摘要
- 客户端应仅将 structured JSON(`LanguageModelDataPart.json`)视为 machine contract.
- 输入 `filePath` 支持绝对路径和工作区路径(建议 `<workspaceFolderName>/...`).
- structured JSON 输出中的 `filePath` 始终为绝对路径.
- human-readable 文本输出(`LanguageModelTextPart`)中的 `filePath` 优先返回带 root 名的工作区路径,不在工作区内时回退为绝对路径.
- 涉及行号/范围的结果会包含 `preview` 源码片段(最多 20 行,超出追加 `... (truncated)`,不可读时为 `<source unavailable>`).

工具说明:
- `angelscript_searchApi`: 支持模糊 token、OR(`|`)、分隔符约束(`.`/`::`)、过滤、分页与正则搜索.
- `angelscript_resolveSymbolAtPosition`: 工具输入/输出中的行列索引全部为 1-based. 成功 `data.symbol` 包含 `kind/name/signature`,可选 `doc`,可选 `definition{ filePath, startLine, endLine, preview }`. 会检查定义起始行上一行是否为 `UCLASS/UPROPERTY/UFUNCTION/UENUM`,命中则把宏行作为预览起始行.
- `angelscript_getTypeMembers`: 按精确类型名列出成员,可选包含继承成员和文档.
- `angelscript_getClassHierarchy`: 按精确类名返回紧凑层级 JSON: `root`, `supers`(近父到根), `derivedByParent`(父类 -> 直接子类), `sourceByClass`, `limits`, `truncated`. `sourceByClass` 中, cpp 类为 `{ source: "cpp" }`, 脚本类为 `{ source: "as", filePath, startLine, endLine, preview }` (`filePath` 在 structured JSON 中为绝对路径; 文本输出遵循工作区路径优先规则,行号是 1-based). 默认值: `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: 工具输入/输出中的行列索引全部为 1-based,成功 `data` 为 `{ total, references[] }`,每条引用包含 `{ filePath, startLine, endLine, range, preview }`,其中 `range` 也是 1-based.

### 构建
```bash
npm run compile
```

### 已知限制
- 引擎断开时,详情能力依赖缓存 DebugDatabase 与 `doc` 字段可用性.
- DebugDatabase 完整结束前不会写入缓存.
- 本扩展与 `Hazelight.unreal-angelscript` 不兼容. 每次启动如果检测到该扩展已安装,会弹出错误提示并提供 `Open Extensions` 入口,随后停止初始化.

### 上游
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se

