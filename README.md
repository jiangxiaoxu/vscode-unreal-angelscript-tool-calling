# Unreal Angelscript VS Code Extension

面向开发者与使用者的 UnrealEngine-Angelscript VS Code 扩展. 本分支增加了 Language Model Tool 调用与 MCP(HTTP) 支持.

## 快速开始(使用者)
1. 使用带 Angelscript 插件的 Unreal Editor 版本.
2. 用 VS Code 打开项目下的 `Script` 文件夹作为工作区根目录.
3. 启动 Unreal Editor, 扩展会自动建立连接.

提示:
- 多工作区时仅主 workspace 生效.
- 需要 `Script` 为根目录或 `<workspace>/Script` 存在.

## 主要功能
- 代码补全, 跳转, 重命名, 引用查找, 语义高亮.
- 保存时从 Unreal Editor 获取编译错误并显示.
- 调试支持, 断点与异常暂停.
- 右键命令: Go to Symbol, Add Import To, Quick Open Import.

部分功能依赖 Unreal Editor 连接, 未连接时会降级.

## 离线缓存
扩展启动时会尝试从缓存恢复内存数据, 以便在未连接引擎时提供基础功能.

- 缓存路径: `Script/.vscode/angelscript/unreal-cache.json`.
- 写入时机: 收到 `DebugDatabaseFinished` 或 `DebugDatabaseSettings` 后触发刷新.
- 内容包含: DebugDatabase chunks, scriptSettings, engineSupportsCreateBlueprint.
- 不包含: assets, script-index.
- 缓存损坏或版本不匹配时会被忽略, 不会加载.
- 写入为临时文件 + fsync + rename, 用于降低中断写入导致的损坏概率.

## Language Model Tool
本分支暴露以下工具调用, 供 Copilot 或其它 LM 使用:
- `angelscript_searchApi`
- `angelscript_resolveSymbolAtPosition`
- `angelscript_getTypeMembers`
- `angelscript_getClassHierarchy`

工具均返回 JSON 字符串. 详细字段定义见实现文件 `language-server/src/api_docs.ts` 和 `language-server/src/server.ts`.

使用建议:
- `angelscript_searchApi`: 需要搜索符号或文档时使用. 例如需要通过关键词搜索 AngelScript API、类型、常量、函数、方法等, 或需要模糊匹配 API.
- `angelscript_resolveSymbolAtPosition`: 已知文件与位置, 想解析该符号的定义/签名/文档时使用,会返回其种类、签名、定义位置与可选文档.
- `angelscript_getTypeMembers`: 使用精确类型名称（class/struct/enum）列出成员(方法/属性),可选包含继承来的成员和文档.
- `angelscript_getClassHierarchy`: 需要类的继承链与派生关系时使用. 传入精确类名, 通过输出的 `inheritanceChain` 查看父类链, `derived.edges` 查看子类树.

## MCP(HTTP) 支持
内置 Streamable HTTP MCP server, 复用 Angelscript language server 的 API 搜索逻辑.

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

## 开发者构建
```bash
npm run compile
```

## 已知限制
- 未连接引擎时, 仅能使用缓存中的 DebugDatabase 信息, 详细文档取决于引擎是否提供 `doc` 字段.
- 缓存在 DebugDatabase 完整结束前不会写入.

## 上游
Language Server and Debug Adapter for UnrealEngine-Angelscript:
https://angelscript.hazelight.se

## 原始说明(保留)
Language Server and Debug Adapter for use with the UnrealEngine-Angelscript plugin from https://angelscript.hazelight.se

## Getting Started
After building or downloading the Unreal Editor version with Angelscript
enabled from the github page linked above, start the editor and use visual
studio code to open the 'Script' folder created in your project directory.
Your 'Script' folder must be set as the root/opened folder for the extension to
function.

## Features
### Editor Connection
The unreal-angelscript extension automatically makes a connection to the
running Unreal Editor instance for most of its functionality. If the editor
is not running, certain features will not be available.

### Code Completion
The extension will try to complete your angelscript code as you type it
using normal visual studio code language server features.

### Error Display
When saving a file the unreal editor automatically compiles and reloads it,
sending any errors to the visual code extension. Errors will be highlighted
in the code display and in the problems window.

### Debugging
You can start debugging from the Debug sidebar or by pressing F5. While
debug mode is active, breakpoints can be set in angelscript files and
the unreal editor will automatically break and stop execution when
they are reached.

Hitting 'Stop' on the debug toolbar will not close the unreal editor,
it merely stops the debug connection, causing breakpoints to be ignored.

When the debug connection is active, any exceptions that occur during
angelscript execution will automatically cause the editor and visual
studio code to pause execution and show the exception.

### Go to Symbol
The default visual studio code 'Go to Definition' (F12) is implemented for
angelscript symbols. A separate command is added to the right click menu
(default shortcut: Alt+G), named 'Go to Symbol'. This command functions
identically to 'Go to Definition' for angelscript symbols.

If you have the Unreal Editor open as well as Visual Studio proper showing
the C++ source code for unreal, the extension will try to use its
unreal editor connection to browse your Visual Studio to the right place,
similar to double clicking a C++ class or function in blueprints.

This uses the standard unreal source navigation system, which is only
implemented for classes and functions.

### Region Blocks
The editor context menu includes a "Wrap with //#region" command for angelscript.
If there is no selection, it inserts a region template and places the cursor on the label.
Selections are expanded to full lines before wrapping.

### Add Import To
The 'Add Import To' (default shortcut: Shift+Alt+I) command from the
right click menu will try to automatically add an import statement
to the top of the file to import the type that the command was run on.

### Quick Open Import
The 'Quick Open Import' (default shortcut: Ctrl+E or Ctrl+P) command from the
right click menu will try to open the quick open navigation with the import
statement.

### More Language Features
This extension acts as a full language server for angelscript code. This includes
semantic highlighting, signature help, reference search, rename symbol and a number
of helpful code actions and quickfixes.

Some of these features require an active connection to the unreal editor.

### Semantic Symbol Colors
There are more types of semantic symbols generated by the extension than there
are colors specified by most color themes.

The default visual studio code color theme will display all variables in blue,
for example, regardless of whether the variable is a member, parameter or local.

You can add a snippet to your `.vscode/settings.json` inside your project folder
to add extra colors to make these differences more visible.

For example, to add extra colors to the default vscode dark theme:

```
    "editor.tokenColorCustomizations": {
		"[Default Dark+]": {
			"textMateRules": [
				{
					"scope": "support.type.component.angelscript",
					"settings": {
						"foreground": "#4ec962"
					}
				},
				{
					"scope": "support.type.actor.angelscript",
					"settings": {
						"foreground": "#2eb0c9"
					}
				},
				{
					"scope": "variable.parameter.angelscript",
					"settings": {
						"foreground": "#ffe5d9"
					}
				},
				{
					"scope": "variable.other.local.angelscript",
					"settings": {
						"foreground": "#e8ffed"
					}
				},
				{
					"scope": "variable.other.global.angelscript",
					"settings": {
						"foreground": "#b99cfe"
					}
				},
				{
					"scope": "variable.other.global.accessor.angelscript",
					"settings": {
						"foreground": "#b99cfe"
					}
				},
				{
					"scope": "entity.name.function.angelscript",
					"settings": {
						"foreground": "#b99cfe"
					}
				},
				{
					"scope": "invalid.unimported.angelscript",
					"settings": {
						"foreground": "#ff9000"
					}
				},
			]
		}
	}
```
