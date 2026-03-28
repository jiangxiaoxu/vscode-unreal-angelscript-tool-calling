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
<!-- BEGIN GENERATED:LM_TOOLS_EN -->
Exposed tools:
- `angelscript_searchApi`
- `angelscript_resolveSymbolAtPosition`
- `angelscript_getTypeMembers`
- `angelscript_getClassHierarchy`
- `angelscript_findReferences`

Tool notes:
- `angelscript_searchApi`: Requires `query`. Default `mode` is `smart`; use `regex` only with `/pattern/flags`. `kinds` is a hard filter. `symbolLevel=type` still lets members or mixins match, but only returns owner `class|struct|enum` results. `scope` narrows a known namespace or type before ranking, `includeInheritedFromScope` only changes class scopes, and `includeDocs=true` adds docs without changing ranking.
- `angelscript_resolveSymbolAtPosition`: Requires absolute `filePath` plus 1-based `position`. `includeDocumentation` defaults to `true`.
- `angelscript_getTypeMembers`: Requires exact `name`; `namespace` only disambiguates collisions. `type.description` is always returned, while member docs need `includeDocs=true`.
- `angelscript_getClassHierarchy`: Requires exact class `name`. `maxSuperDepth`, `maxSubDepth`, and `maxSubBreadth` bound the returned tree and default to `3/2/10`.
- `angelscript_findReferences`: Requires absolute `filePath` plus 1-based `position`. `limit` defaults to `30` and caps results at `200`.
<!-- END GENERATED:LM_TOOLS_EN -->

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
<!-- BEGIN GENERATED:LM_TOOLS_ZH -->
提供以下工具:
- `angelscript_searchApi`
- `angelscript_resolveSymbolAtPosition`
- `angelscript_getTypeMembers`
- `angelscript_getClassHierarchy`
- `angelscript_findReferences`

工具说明:
- `angelscript_searchApi`: 需要 `query`. `mode` 默认是 `smart`, 只有明确提供 `/pattern/flags` 时才使用 `regex`. `kinds` 是硬过滤. `symbolLevel=type` 允许成员或 mixin 参与命中, 但最终只返回 owner `class|struct|enum`. `scope` 会在排序前收窄已知 namespace 或 type, `includeInheritedFromScope` 只改变 class scope, `includeDocs=true` 只补全文档而不改变排序.
- `angelscript_resolveSymbolAtPosition`: 需要绝对路径 `filePath` 和 1-based 的 `position`. `includeDocumentation` 默认是 `true`.
- `angelscript_getTypeMembers`: 需要精确 `name`; `namespace` 只用于消除重名歧义. `type.description` 始终返回, 成员文档需要 `includeDocs=true`.
- `angelscript_getClassHierarchy`: 需要精确 class `name`. `maxSuperDepth`, `maxSubDepth` 和 `maxSubBreadth` 用来裁剪返回层级, 默认值是 `3/2/10`.
- `angelscript_findReferences`: 需要绝对路径 `filePath` 和 1-based 的 `position`. `limit` 默认 `30`, 最大 `200`.
<!-- END GENERATED:LM_TOOLS_ZH -->

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

