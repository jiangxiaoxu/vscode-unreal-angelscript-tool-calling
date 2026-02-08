# Unreal Angelscript VS Code Extension

[English](#english) | [中文](#中文)

---

## English

### Overview
This extension provides language server and debugger support for UnrealEngine-Angelscript, with additional LM tools and built-in MCP(HTTP) support in this fork.

### Quick Start
1. Use an Unreal Editor build with Angelscript enabled.
2. Open your project's `Script` folder in VS Code as the workspace root.
3. Start Unreal Editor. The extension connects automatically.

Notes:
- In multi-root workspaces, only the primary workspace is used.
- The workspace must be `Script` itself, or contain `<workspace>/Script`.

### Core Features
- Code completion, go to definition, rename, find references, semantic highlighting.
- Compile errors from Unreal Editor on save.
- Debugging support, breakpoints and exception pause.
- Context commands: `Go to Symbol`, `Add Import To`, `Quick Open Import`.

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
- Most tools return JSON text.
- `angelscript_findReferences` returns preview text on success, and JSON error on failure.
- Input `filePath` supports absolute path or workspace-relative path (prefer `<workspaceFolderName>/...`).
- Output `filePath` prefers workspace-relative path with root prefix; if not in workspace, output falls back to absolute path.

Tool notes:
- `angelscript_searchApi`: Search Angelscript APIs and docs with fuzzy tokens, OR(`|`), separator constraints(`.`/`::`), optional filters, pagination, and regex.
- `angelscript_resolveSymbolAtPosition`: Input line/character is 1-based. Input `filePath` supports absolute path or workspace-relative path. Output `definition.filePath` follows workspace-relative-first rule.
- `angelscript_getTypeMembers`: List members for an exact type name, with optional inherited members/docs.
- `angelscript_getClassHierarchy`: Return compact class hierarchy JSON for an exact class name: `root`, `supers`(nearest parent first), `derivedByParent`(parent -> direct children), `sourceByClass`, `limits`, `truncated`. In `sourceByClass`, cpp classes are `{ source: "cpp" }`, script classes are `{ source: "as", filePath, startLine, endLine }` (`filePath` follows workspace-relative-first rule, line numbers are 1-based). Defaults: `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: Input line/character is 1-based. Success output is text preview with `---` separators, and preview header paths follow workspace-relative-first rule.

### MCP(HTTP) Support
Built-in Streamable HTTP MCP server reusing Angelscript language server logic.

Example settings:
```json
{
  "UnrealAngelscript.mcp.enabled": true,
  "UnrealAngelscript.mcp.port": 27199,
  "UnrealAngelscript.mcp.maxStartupFailures": 5
}
```

Codex example:
```toml
[mcp_servers.angelscript]
url = "http://127.0.0.1:27199/mcp"
```

### Build
```bash
npm run compile
```

### Known Limits
- When engine is disconnected, details depend on cached DebugDatabase and available `doc` fields.
- Cache is not written before DebugDatabase processing completes.
- This extension is incompatible with `Hazelight.unreal-angelscript`. On each startup, if that extension is installed, this extension shows an uninstall prompt and stops initialization.

### Upstream
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se

---

## 中文

### 概览
这是 UnrealEngine-Angelscript 的 VS Code 扩展分支版本,提供语言服务与调试能力,并新增 LM tools 和内置 MCP(HTTP) 支持.

### 快速开始
1. 使用启用 Angelscript 的 Unreal Editor 版本.
2. 在 VS Code 中把项目 `Script` 文件夹作为工作区根目录打开.
3. 启动 Unreal Editor,扩展会自动连接.

说明:
- 多工作区场景下仅主工作区生效.
- 工作区必须是 `Script` 本身,或包含 `<workspace>/Script`.

### 核心功能
- 代码补全、定义跳转、重命名、引用查找、语义高亮.
- 保存时展示 Unreal Editor 返回的编译错误.
- 调试支持,含断点与异常暂停.
- 右键命令: `Go to Symbol`、`Add Import To`、`Quick Open Import`.

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
- 大多数工具返回 JSON 文本.
- `angelscript_findReferences` 成功返回预览文本,失败返回 JSON error.
- 输入 `filePath` 支持绝对路径和工作区路径(建议 `<workspaceFolderName>/...`).
- 输出 `filePath` 优先返回带 root 名的工作区路径,不在工作区内时回退为绝对路径.

工具说明:
- `angelscript_searchApi`: 支持模糊 token、OR(`|`)、分隔符约束(`.`/`::`)、过滤、分页与正则搜索.
- `angelscript_resolveSymbolAtPosition`: 输入行列是 1-based. 输入 `filePath` 支持绝对路径和工作区路径. 输出 `definition.filePath` 遵循工作区路径优先规则.
- `angelscript_getTypeMembers`: 按精确类型名列出成员,可选包含继承成员和文档.
- `angelscript_getClassHierarchy`: 按精确类名返回紧凑层级 JSON: `root`, `supers`(近父到根), `derivedByParent`(父类 -> 直接子类), `sourceByClass`, `limits`, `truncated`. `sourceByClass` 中, cpp 类为 `{ source: "cpp" }`, 脚本类为 `{ source: "as", filePath, startLine, endLine }` (`filePath` 遵循工作区路径优先规则,行号是 1-based). 默认值: `maxSuperDepth=3`, `maxSubDepth=2`, `maxSubBreadth=10`.
- `angelscript_findReferences`: 输入行列是 1-based,成功返回文本预览,多结果用 `---` 分隔,且预览头路径遵循工作区路径优先规则.

### MCP(HTTP) 支持
内置 Streamable HTTP MCP server,复用 Angelscript language server 能力.

配置示例:
```json
{
  "UnrealAngelscript.mcp.enabled": true,
  "UnrealAngelscript.mcp.port": 27199,
  "UnrealAngelscript.mcp.maxStartupFailures": 5
}
```

Codex 配置示例:
```toml
[mcp_servers.angelscript]
url = "http://127.0.0.1:27199/mcp"
```

### 构建
```bash
npm run compile
```

### 已知限制
- 引擎断开时,详情能力依赖缓存 DebugDatabase 与 `doc` 字段可用性.
- DebugDatabase 完整结束前不会写入缓存.
- 本扩展与 `Hazelight.unreal-angelscript` 不兼容. 每次启动如果检测到该扩展已安装,会弹窗提示卸载并停止初始化.

### 上游
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se

