# Unreal Angelscript VS Code Extension

Language server, debugger, and API browser for UnrealEngine-Angelscript.
UnrealEngine-Angelscript 的语言服务, 调试器和 API 浏览扩展.

## Contents / 目录

- English: [Quick start](#quick-start) | [Features](#features) | [Limits](#limits)
- 中文: [快速开始](#快速开始) | [功能](#功能) | [使用限制](#使用限制)
- [Development / 开发](#development--开发) | [References / 参考](#references--参考)

## English

### Quick start

1. Install this extension and use an Unreal Editor build with Angelscript enabled.
2. Open the project's `Script` folder, or its parent containing `Script`, in VS Code.
3. Open an `.as` file and start Unreal Editor. The extension connects automatically.

### Features

- Completion, signature help, definition, references, rename, semantic highlighting, and code actions.
- Compile errors from Unreal Editor on save; debugging with breakpoints and exception pause.
- `Angelscript API` panel for browsing and searching symbols.
- `Go to Symbol` and `Wrap with //#region` context commands.
- Offline language support from a compatible cached DebugDatabase.

**The former VS Code LM tool calling integration has been removed.** The API panel and language-server query interfaces remain. The repository name and extension ID retain the historical `tool-calling` name.

### Limits

- Only resolved `Script` roots are indexed and watched. `UnrealAngelscript.scriptIgnorePatterns` controls exclusions. Reload the window after changing workspace folders.
- Some features require Unreal Editor; offline results depend on the cache and available documentation.
- Cache access requires exactly one physical `.uproject`. Live engine refresh currently requires Windows listener-owner verification; compatible caches remain usable offline on other platforms.
- `Hazelight.unreal-angelscript` must be uninstalled: its presence stops this extension's initialization.

## 中文

### 快速开始

1. 安装本扩展, 使用启用 Angelscript 的 Unreal Editor 版本.
2. 在 VS Code 打开项目的 `Script` 文件夹, 或包含 `Script` 的上一级目录.
3. 打开 `.as` 文件并启动 Unreal Editor, 扩展会自动连接.

### 功能

- 代码补全, 签名提示, 定义跳转, 引用查找, 重命名, 语义高亮和 code actions.
- 保存时显示 Unreal Editor 编译错误; 支持断点和异常暂停调试.
- `Angelscript API` 面板用于浏览和搜索符号.
- 右键命令 `Go to Symbol` 和 `Wrap with //#region`.
- 使用兼容的 DebugDatabase 缓存提供离线语言能力.

**旧版 VS Code LM 工具调用集成已移除.** API 面板和 language-server 查询接口仍保留. 仓库名和扩展 ID 中的 `tool-calling` 是历史命名.

### 使用限制

- 仅索引和监听解析成功的 `Script` 根目录. 使用 `UnrealAngelscript.scriptIgnorePatterns` 排除文件; 更改 workspace folders 后需重新加载窗口.
- 部分功能需要 Unreal Editor; 离线结果取决于缓存和文档字段的可用性.
- 缓存读写要求定位到唯一的物理 `.uproject`. 实时引擎刷新目前依赖 Windows listener-owner 校验; 其他平台仍可使用兼容缓存.
- 需要卸载 `Hazelight.unreal-angelscript`, 否则本扩展会停止初始化.

## Development / 开发

Run from the repository root. `npm install` also installs the nested packages.
在仓库根目录执行. `npm install` 同时安装嵌套包依赖.

```sh
npm install
npm run compile
```

| Command / 命令 | Purpose / 用途 |
| --- | --- |
| `npm run watch` | Watch both bundles / 监听构建 |
| `npm test` | Full test suite / 完整测试 |
| `npm run test:fork-boundary` | Fork boundary regression tests / Fork 边界回归测试 |

## References / 参考

- [Language-server integration / Language-server 集成](docs/language-server.md): cache paths, readiness, and daemon contracts / 缓存路径, 就绪状态和 daemon 契约.
- [Search syntax / 搜索语法](structured-search-matching.md).
- [Maintenance / 维护](MAINTAINING.md) and [Changelog / 更新记录](CHANGELOG.md).
- [Upstream UnrealEngine-Angelscript](https://angelscript.hazelight.se).
