# Unreal Angelscript VS Code Extension

[English](#english) | [中文](#中文)

## Table of Contents
[English](#english)
[Overview](#overview)
[Quick Start](#quick-start)
[Core Features](#core-features)
[Offline Cache](#offline-cache)
[Language Model Tools](#language-model-tools)
[Build](#build)
[Known Limits](#known-limits)
[Upstream](#upstream)
[中文](#中文)
[概览](#概览)
[快速开始](#快速开始)
[核心功能](#核心功能)
[离线缓存](#离线缓存)
[Language Model Tools](#language-model-tools-1)
[构建](#构建)
[已知限制](#已知限制)
[上游](#上游)

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
- LM tool `filePath` inputs and outputs use normalized absolute paths.
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

Output rules:
- This repository now implements VS Code `Language Model Tool` only.
- There is no built-in MCP server/runtime in this repository.
- LM tools return human-readable text and, by default, structured JSON payloads.
- `UnrealAngelscript.languageModelTools.outputMode` controls LM output mode:
  - `text+structured` (default)
  - `text-only`
- Output style follows qgrep closely:
  - stable title line
  - `key: value` summary fields
  - `====` section headers
  - `---` item separators
  - source previews rendered as `lineNumber + ':'/'-' + 4 spaces + source text`
- Input and output `filePath` use normalized absolute paths.
- For line-based results, text output includes source previews (max 20 lines, truncated with `... (truncated)`, fallback `<source unavailable>`).

Tool notes:
- `angelscript_searchApi`: Uses `query` plus optional `mode=smart|exact|regex`, `limit`, `kinds`, `source`, `scopePrefix`, and `includeInheritedFromScope`. Results now return `matches`, optional `notices`, optional `scopeLookup`, optional `inheritedScopeOutcome`, and tool-layer `request`.
- `angelscript_resolveSymbolAtPosition`: Requires an absolute `filePath`. All line/character indices in tool input are 1-based. Output includes symbol summary, optional definition preview, and optional doc block. It checks the line before definition start for `UCLASS/UPROPERTY/UFUNCTION/UENUM`; when matched, that macro line is rendered as preview context.
- `angelscript_getTypeMembers`: List members for an exact type name, with optional inherited members/docs.
- `angelscript_getClassHierarchy`: Returns compact hierarchy text with `root`, `supers`, `derivedByParent`, limits/truncation summary, and per-class source blocks. Script classes include preview lines when a source path can be resolved; otherwise the preview degrades to `<source unavailable>`. Defaults are `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: Requires an absolute `filePath`. All line/character indices in tool input are 1-based. Optional `limit` defaults to `30` and caps the returned references at `200`. Output includes `total`, `returned`, `limit`, `truncated`, per-file grouping, 1-based `range` labels, and preview lines.

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
- LM tool 的 `filePath` 输入和输出统一使用标准化后的绝对路径.
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

输出规则:
- 当前仓库只实现 VS Code `Language Model Tool`.
- 仓库内不再提供内建 MCP server/runtime.
- LM tool 会返回可读文本,并且默认同时返回结构化 JSON payload.
- `UnrealAngelscript.languageModelTools.outputMode` 用于控制 LM 输出模式:
  - `text+structured`(默认)
  - `text-only`
- 输出风格尽量贴近 qgrep:
  - 稳定标题行
  - `key: value` 摘要字段
  - `====` 分段
  - `---` 条目分隔
  - 源码预览使用 `行号 + ':'/'-' + 4 个空格 + 源码`
- 输入和输出 `filePath` 统一使用标准化后的绝对路径.
- 涉及行号/范围的结果会直接在文本中渲染源码片段(最多 20 行,超出追加 `... (truncated)`,不可读时为 `<source unavailable>`).

工具说明:
- `angelscript_searchApi`: 使用 `query` 和可选 `mode=smart|exact|regex`、`limit`、`kinds`、`source`、`scopePrefix`、`includeInheritedFromScope`. 结果返回 `matches`、可选 `notices`、可选 `scopeLookup`、可选 `inheritedScopeOutcome`,并在 tool 层补充 `request`.
- `angelscript_resolveSymbolAtPosition`: 需要传入绝对路径 `filePath`. 工具输入中的行列索引全部为 1-based. 输出会展示 symbol 摘要、可选定义预览与可选 doc 块. 会检查定义起始行上一行是否为 `UCLASS/UPROPERTY/UFUNCTION/UENUM`,命中时把宏行作为预览上下文输出.
- `angelscript_getTypeMembers`: 按精确类型名列出成员,可选包含继承成员和文档.
- `angelscript_getClassHierarchy`: 按精确类名返回紧凑层级文本,包含 `root`、`supers`、`derivedByParent`、limits/truncated 摘要与按类输出的源码块. 脚本类仅在能解析到源码路径时附带预览,否则降级为 `<source unavailable>`. 默认值: `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: 需要传入绝对路径 `filePath`. 工具输入中的行列索引全部为 1-based. 可选 `limit` 默认值为 `30`,最大值为 `200`. 输出会返回 `total`、`returned`、`limit`、`truncated`,并按文件分组展示引用,附带 1-based 的 `range` 标签与源码预览.

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

