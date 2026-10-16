# Language-server 集成参考

旧版 VS Code LM tool calling 集成已删除. 当前查询接口供 API 面板和外部 language-server client 使用, 不注册 VS Code LM tools.

## 接口入口

| 用途 | 定义 |
| --- | --- |
| Initialization options, role 和项目标识 | [languageServerContract.ts](../language-server/src/languageServerContract.ts) |
| API 查询, 符号详情, 成员和类层级 | [apiRequestHandlers.ts](../language-server/src/apiRequestHandlers.ts) |
| Smart search 语法 | [structured-search-matching.md](../structured-search-matching.md) |
| 就绪状态和缓存状态字段 | [languageServerReadiness.ts](../language-server/src/languageServerReadiness.ts) |
| Project-daemon script snapshot 协议 | [scriptSnapshotProtocol.ts](../language-server/src/scriptSnapshotProtocol.ts) |

## Role 和缓存

两种 role 都维持 Unreal 连接, 分别发布缓存. 路径相对项目根目录:

| Role | 缓存路径 |
| --- | --- |
| `vscode` | `Script/.vscode/angelscript/debug-database.json.gz` |
| `project-daemon` | `Saved/ASEditorAutomation/LanguageServer/debug-database.json.gz` |

- VS Code 只有定位到唯一物理 `.uproject` 时才启用缓存读写, 否则保留语言功能并警告.
- 缓存格式由 envelope 的 schema/version 判断. 损坏, 超预算, 不完整, 项目标识不匹配或格式不兼容的缓存会被忽略.
- 不读取或自动迁移旧 `debug-database.v2.json.gz` 和 `unreal-cache.json`. 当前 VS Code process 成功发布 live cache 后清理旧 `unreal-cache.json`.
- 完整且获确认的 native generation 才能发布缓存. 写入异步执行; 失败保留 active TypeDB 和旧缓存, 不降低语义就绪状态. API 直接读取内存 TypeDB, 不导出 standalone query index.
- Windows 在 TCP connect 前后校验 listener 属于目标项目的同一 Unreal Editor process. 空闲端口按正常离线处理; 无严格 owner 校验的平台拒绝 live refresh (`unsupported-platform`).

## 就绪状态和一致性

- `angelscript/diagnosticsStatus` 同时支持 request 和 notification. 检查 `fullReady`, `semanticGeneration`, `settledSemanticGeneration`; 缓存持久化状态通过 `activeRevision`, `persistedRevision`, `cacheState`, `cacheDirty`, `persistenceAttempt`, `lastPersistenceError` 观察.
- 普通 request 的稳定快照要求 status-before/request/status-after 的两个 semantic counter 均相等且不变, 并且 `fullReady` 为 true.
- 标准 `textDocument/diagnostic` 和 `workspace/diagnostic` 支持 result ID 与 unchanged report. 未就绪时返回 `ServerCancelled` 和 `retriggerRequest: true`; API 等待超时返回 `NotReady`, 可重试. 请求支持取消.
- API readiness, diagnostics, owner query, DebugDatabase 消息间隔及 shutdown flush 的等待预算为 30s, 不是整体初始化期限. 完整数值见 [languageServerTimeouts.ts](../language-server/src/languageServerTimeouts.ts).
- 每轮 TypeDB 同步另有共享的 30s 总预算, 包括 transport, replacement, reconnect 和 rollback. 新 generation 在 script resolution settled 且同步获确认后 ready; 失败或被替代时恢复 prior accepted generation, 不覆盖旧缓存. 成功后的异步持久化不计入该预算.

## Project-daemon

- 使用 typed initialization options, 提供精确的项目路径和 identity, 项目对应的 `unreal.debuggerPort`, 以及 `initialize.processId`. Parent 退出或 stdio 关闭后, child 在有限时间内 flush 并退出.
- Host 通过 `angelscript/beginTypeDatabaseSync` 授予和确认同步轮次, 并负责外部 watchdog. VS Code 使用本地 best-effort 预算.
- `angelscript/synchronizeScriptSnapshot` 校验 raw-byte manifest; `angelscript/queryAtScriptSequence` 和 `angelscript/queryDiagnosticsAtScriptSequence` 等待所需 script sequence 并携带 provenance. Diagnostics 返回标准 `WorkspaceDiagnosticReport`.
- 协议边界和 wire 示例见 [scriptSnapshotProtocol.test.ts](../language-server/src/__tests__/scriptSnapshotProtocol.test.ts). 旧 `ue-resident` / `cli-direct` roles 和 API query index 契约已移除.
