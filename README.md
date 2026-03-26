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
[Fork Maintenance](#fork-maintenance)
[Upstream](#upstream)
[中文](#中文)
[概览](#概览)
[快速开始](#快速开始)
[核心功能](#核心功能)
[离线缓存](#离线缓存)
[Language Model Tools](#language-model-tools-1)
[构建](#构建)
[已知限制](#已知限制)
[维护策略](#维护策略)
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
- LM tools always return human-readable text. Structured JSON is optional.
- `UnrealAngelscript.languageModelTools.outputMode` controls LM output mode:
  - `text-only` (default)
  - `text+structured`
- Human-readable success text now defaults to a code-first style:
  - stable title line
  - declarations/snippets as the primary body
  - `/** ... */` for normalized docs
  - `// ...` comments for owner, origin, range, scope, and truncation metadata
  - source previews rendered as `lineNumber + ':'/'-' + 4 spaces + source text`
- Human-readable text is always returned.
- Structured JSON is returned only when `UnrealAngelscript.languageModelTools.outputMode=text+structured`.
- `text+structured` and `text-only` do not change the text style.
- Input and output `filePath` use normalized absolute paths.
- For line-based results, text output includes source previews (max 20 lines, truncated with `... (truncated)`, fallback `<source unavailable>`).

Tool notes:
- `angelscript_searchApi`: The Angelscript API panel continues to use smart search, but the LM tool now uses plain search by default. Public input is `query` plus optional `limit`, `source`, `scope`, `includeInheritedFromScope`, `includeDocs`, and `regex`. Plain search is case-insensitive, favors code-like queries such as `Type.Member` and `Namespace::Func`, supports ordered token gaps such as `Status AI`, and uses weak token reorder only as a low-priority fallback. A trailing `(` or `()` means callable-only and limits plain results to `method` and `function`; it does not match argument lists or zero-arg signatures. `scope` narrows the search domain to a known namespace or containing type before ranking; when a namespace and type share the same name, the default scope resolves to the type, and appending `::` to the scope value forces namespace resolution. `includeInheritedFromScope=true` expands inherited members and mixin member views for type scopes. When `regex=true`, `query` must use VS Code-style `/pattern/flags` syntax and matches only symbol name views: short names, qualified names, mixin member-view aliases, and callable `...()` views for methods/functions. Results return `matches`, optional `notices`, optional `scopeLookup`, optional `inheritedScopeOutcome`, and tool-layer `request`. Structured matches include `matchReason`, and full docs are returned through `documentation` only when requested. Human-readable text now groups matches by owner/namespace and renders type/member hits as declarations with comment-based metadata.
- `angelscript_resolveSymbolAtPosition`: Requires an absolute `filePath`. All line/character indices in tool input are 1-based. Human-readable text now prefers `/** ... */` plus declaration or definition preview. It still checks the line before definition start for `UCLASS/UPROPERTY/UFUNCTION/UENUM`; when matched, that macro line is rendered as preview context.
- `angelscript_getTypeMembers`: List members for an exact type name. The target type description is always returned in `type.description`; member descriptions are included only when `includeDocs=true`. Human-readable text now renders members as Angelscript-style declarations, with inherited/mixin origin and docs emitted as comments.
- `angelscript_getClassHierarchy`: Returns `root`, `supers`, `derivedByParent`, `limits`, `truncated`, and `sourceByClass` in structured JSON. Human-readable text now uses comment-based lineage/derived trees plus code-first source blocks. Script classes prefer preview lines; native classes render as declaration stubs such as `class AActor;`; unresolved script sources degrade to `// source unavailable` plus a declaration stub. Defaults are `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: Requires an absolute `filePath`. All line/character indices in tool input are 1-based. Optional `limit` defaults to `30` and caps the returned references at `200`. Human-readable text now renders `// <filePath>` + `// range: ...` + preview blocks, with truncation surfaced as a final comment.



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
- LM tool 始终返回可读文本,结构化 JSON 为可选附加内容.
- `UnrealAngelscript.languageModelTools.outputMode` 用于控制 LM 输出模式:
  - `text-only`(默认)
  - `text+structured`
- 可读成功文本默认采用 code-first 风格:
  - 稳定标题行
  - 以声明式文本或源码片段作为主体
  - 文档统一归一化后渲染为 `/** ... */`
  - owner、来源、range、scope、truncation 等元信息统一使用 `// ...` 注释
  - 源码预览仍使用 `行号 + ':'/'-' + 4 个空格 + 源码`
- LM tool 始终返回可读文本.
- 只有在 `UnrealAngelscript.languageModelTools.outputMode=text+structured` 时才会附带结构化 JSON.
- `text+structured` 和 `text-only` 不会改变文本风格.
- 输入和输出 `filePath` 统一使用标准化后的绝对路径.
- 涉及行号/范围的结果会直接在文本中渲染源码片段(最多 20 行,超出追加 `... (truncated)`,不可读时为 `<source unavailable>`).

工具说明:
- `angelscript_searchApi`: Angelscript API 面板继续使用 smart search, 但 LM tool 默认改为 plain search. 对外输入为 `query` 和可选 `limit`、`source`、`scope`、`includeInheritedFromScope`、`includeDocs`、`regex`. plain search 大小写不敏感,优先识别 `Type.Member`、`Namespace::Func` 这类代码形态查询,支持 `Status AI` 这类 ordered token gap,并只把 weak token reorder 作为低优先级回退. 尾部 `(` 或 `()` 表示 callable-only,会把 plain 结果限制为 `method` 和 `function`,但不会匹配参数列表,也不表示零参数签名. `scope` 用于在排序前先收窄已知 namespace 或 containing type 的搜索域; 当 namespace 与 type 同名时,默认优先解析为 type scope,如需强制 namespace,可在 `scope` 末尾追加 `::`; 对 type scope, `includeInheritedFromScope=true` 会扩展 inherited members 与 mixin member views. 当 `regex=true` 时,`query` 必须使用 VS Code 风格的 `/pattern/flags`,且只匹配 symbol name views: short name、qualified name、mixin member-view alias,以及 method/function 额外提供的 callable `...()` 视图. 结果返回 `matches`、可选 `notices`、可选 `scopeLookup`、可选 `inheritedScopeOutcome`,并在 tool 层补充 `request`. 结构化命中会附带 `matchReason`,只有显式请求时才会通过 `documentation` 返回全文文档. 可读文本现在会按 owner/namespace 分组,把类型和成员命中渲染成声明式文本,并通过注释补充 scope、来源和 notice.
- `angelscript_resolveSymbolAtPosition`: 需要传入绝对路径 `filePath`. 工具输入中的行列索引全部为 1-based. 可读文本默认优先输出 `/** ... */` 加声明或定义预览. 仍会检查定义起始行上一行是否为 `UCLASS/UPROPERTY/UFUNCTION/UENUM`,命中时把宏行作为预览上下文输出.
- `angelscript_getTypeMembers`: 按精确类型名列出成员. 目标类型自身描述始终通过 `type.description` 返回; 成员描述仅在 `includeDocs=true` 时返回. 可读文本现在会按 Angelscript 风格声明渲染成员,并用注释补充 inherited/mixin 来源与文档.
- `angelscript_getClassHierarchy`: 结构化结果返回 `root`、`supers`、`derivedByParent`、`limits`、`truncated` 与 `sourceByClass`. 可读文本现在会用注释化 lineage/derived tree 加 code-first 的源码块展示层级. 脚本类优先显示预览, native 类显示 `class AActor;` 这类声明桩,脚本源码不可解析时降级为 `// source unavailable` 加声明桩. 默认值: `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: 需要传入绝对路径 `filePath`. 工具输入中的行列索引全部为 1-based. 可选 `limit` 默认值为 `30`,最大值为 `200`. 可读文本现在会按 `// <filePath>` + `// range: ...` + 预览块的形式输出引用,只有截断时才追加最小注释提示.


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

