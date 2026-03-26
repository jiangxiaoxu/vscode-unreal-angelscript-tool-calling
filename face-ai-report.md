# 面相AI报告

## 目的
帮助 AI agent 在不扫描全仓的前提下,快速理解当前 `angelscript_*` 工具的公共契约,关键实现入口,以及这次 LM-only 搜索协议改造后的维护边界.

## 当前工具契约基线
适用工具:
- `angelscript_searchApi`
- `angelscript_resolveSymbolAtPosition`
- `angelscript_getTypeMembers`
- `angelscript_getClassHierarchy`
- `angelscript_findReferences`

统一公共契约:
- 当前仓库只实现 VS Code `Language Model Tool`.
- LM tool 始终返回可读文本.
- 结构化 JSON 仅在 `UnrealAngelscript.languageModelTools.outputMode=text+structured` 时返回.
- `UnrealAngelscript.languageModelTools.outputMode` 默认值为 `text-only`.
- 结构化结果继续沿用内部 `{ ok, data/error }` envelope.

统一文本风格:
- 首行使用稳定标题,例如 `Angelscript API search`.
- 成功文本默认采用 code-first 风格,主体优先是声明式文本或源码片段.
- 文档统一归一化后渲染为 `/** ... */`.
- owner、origin、range、scope、truncation 等元信息统一使用 `// ...` 注释.
- 源码预览使用 `lineNumber + ':'/'-' + 4 spaces + source text`.
- 无结果时输出代码风格注释,例如 `// No matches found.`.
- 错误统一输出:
  - 标题
  - `error: ...`
  - `code: ...`
  - 可选 `hint: ...`
- 可选 `details: ...`

## 各工具文本形态
| Tool | 主要文本主体 | 注释元信息 | 预览规则 |
| --- | --- | --- | --- |
| `angelscript_searchApi` | owner/namespace 分组后的类型桩或成员声明 | `// scope: ...`、`// notice [...]`、`// native`、`// mixin from ...`、`// inherited from ...` | 无源码预览 |
| `angelscript_resolveSymbolAtPosition` | `/** ... */` + 声明,或 `/** ... */` + definition preview | `// definition: <file>:<start>-<end>`、`// source unavailable` | 宏回溯行用 `-`, 定义命中行用 `:` |
| `angelscript_getTypeMembers` | 目标类型说明 + 成员声明列表 | `// inherited from ...`、`// mixin from ...` | 无源码预览 |
| `angelscript_getClassHierarchy` | `// lineage: ...`、`// derived:` 树,再接源码预览或声明桩 | `// native`、`// truncated: ...`、`// source unavailable` | 脚本类预览默认按真实行号输出 |
| `angelscript_findReferences` | 每个文件下的 `// range: ...` + preview | `// <filePath>`、`// truncated at limit ...` | 命中引用行用 `:` |

## `angelscript_searchApi` 查询契约
面板与 LM tool 已拆分:
- Angelscript API 面板继续使用 `smart search`.
- LM tool 默认使用 `plain search`, 对外输入为 `query`、`limit`、`source`、`scope`、`includeInheritedFromScope`、`includeDocs`、`regex`.

plain search 规则:
- 大小写不敏感.
- 优先识别 `Type.Member`、`Namespace::Func` 这类代码形态查询.
- 支持 ordered token gap,例如 `Status AI`.
- 支持 weak token reorder fallback,但优先级较低.
- 尾部 `(` 或 `()` 表示 callable-only,只限制到 `method/function`,不匹配完整 signature.

regex search 规则:
- 仅在 `regex=true` 时启用.
- `query` 必须使用 `/pattern/flags` 形式.
- 仅匹配名字视图:
  - `shortName`
  - `qualifiedName`
  - `alias`
  - callable `shortName()`
  - callable `qualifiedName()`
  - callable `alias()`

scope 规则:
- `scope` 用于在排序前收窄已知 namespace 或 containing type 的搜索域.
- 对 type scope, `includeInheritedFromScope=true` 会扩展 inherited members 与 mixin member views.

## 路径与行号规则
输入路径:
- 支持 absolute path.

输出路径:
- 统一输出 absolute path.
- 路径分隔符统一 `/`.

行号规则:
- `resolve/findReferences` 工具输入使用 1-based `line/character`.
- 文本中的 `position` 与 `range` 标签也是 1-based.
- 预览行号使用真实源码行号.

## 预览规则
统一预览入口:
- `extension/src/toolShared.ts`
  - `buildSourcePreviewSection`
  - `buildResolveSuccessData`
  - `buildFindReferencesItems`
  - `buildTypeHierarchyToolData`

文本渲染入口:
- `extension/src/toolTextFormatter.ts`
  - `formatToolText`
  - `renderPreviewBlockLines`
  - `formatPreviewLine`

宏回溯规则:
- 仅 `resolve` 使用.
- 仅检查定义起始行上一行.
- 匹配集合:
  - `UCLASS`
  - `UPROPERTY`
  - `UFUNCTION`
  - `UENUM`
- 命中时,宏行作为预览上下文输出,因此文本中该行使用 `-`.

截断规则:
- 预览最多 20 行.
- 超出时追加 `... (truncated)`.
- 文件不可读时输出 `<source unavailable>`.

## 实现映射
`extension/src/toolRegistry.ts`
- 注册 LM tools.
- 当前职责是把内部 `{ ok, data/error }` 中间结果转换为 LM result parts.
- 会根据 `UnrealAngelscript.languageModelTools.outputMode` 决定返回 `text+structured` 还是 `text-only`.

`extension/src/toolResultTransport.ts`
- 纯函数层.
- 用于约束 LM 最终返回 `text` 或 `text+json` parts.
- 测试会直接检查这里的 LM output mode 行为.

`extension/src/toolTextFormatter.ts`
- 纯文本契约核心.
- 所有 code-first 标题、声明清洗、注释归一化与预览渲染都在这里统一完成.

`extension/src/toolShared.ts`
- 仍保留内部 `{ ok, data/error }` 中间结构,仅作为实现细节.
- 会补充 formatter 所需的内部 request 信息与定义命中行信息.

`extension/src/apiRequests.ts`
- 保留内部 `ToolSuccess<T>/ToolFailure/ToolResult<T>` 类型基线.
- `angelscript_searchApi` 的新 request/result 类型也在这里定义.

## 测试与验收
测试入口:
- `npm test`

当前新增测试覆盖:
- 5 个工具各至少 1 个成功文本样例.
- 5 个工具各 1 个失败文本样例.
- 预览行格式/标记规则.
- LM `text+structured` transport.
- LM `text-only` transport.
- language-server search: smart/plain/regex、ordered token gap、weak reorder、scope、inheritance、override dedupe.

提交前最低验收:
- `npm run compile`
- `npm test`

## 维护要求
凡是再次修改 `angelscript_*` 工具公共契约,必须同步更新:
- `README.md`
- `CHANGELOG.md`
- `face-ai-report.md`
- `package.json` 中对应 tool 的 `modelDescription`
- `extension/src/toolRegistry.ts` 中对应 tool 的 `description`

高风险回归点:
- 不要重新引入仓库内 MCP server/runtime 实现.
- 不要破坏 `text+structured` / `text-only` 配置切换.
- 不要让 success text 退回到旧的 `Title + key: value + ==== + ---` 摘要风格.
- 不要破坏 `resolve` 的宏回溯上下文行渲染.
