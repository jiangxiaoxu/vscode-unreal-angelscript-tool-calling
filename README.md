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
The extension restores cache data at startup to provide baseline capabilities without an active engine connection.

- Cache path: `Script/.vscode/angelscript/unreal-cache.json`
- Refresh trigger: `DebugDatabaseFinished` or `DebugDatabaseSettings`
- Includes: DebugDatabase chunks, scriptSettings, engineSupportsCreateBlueprint
- Excludes: assets, script-index
- Corrupt or version-mismatched cache is ignored safely
- Write strategy: temp file + fsync + rename

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
扩展启动时会恢复缓存,在未连接引擎时提供基础能力.

- 缓存路径: `Script/.vscode/angelscript/unreal-cache.json`
- 刷新时机: `DebugDatabaseFinished` 或 `DebugDatabaseSettings`
- 包含: DebugDatabase chunks、scriptSettings、engineSupportsCreateBlueprint
- 不包含: assets、script-index
- 缓存损坏或版本不匹配会被安全忽略
- 写入策略: 临时文件 + fsync + rename

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
