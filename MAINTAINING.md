# Maintaining The Fork

[English](#english) | [中文](#中文)

## Table of Contents
[English](#english)
[Goals](#goals)
[Layered Compatibility Rules](#layered-compatibility-rules)
[Public Contract Rules](#public-contract-rules)
[Commit Hygiene](#commit-hygiene)
[Upstream Merge Routine](#upstream-merge-routine)
[Merge Smoke Checklist](#merge-smoke-checklist)
[中文](#中文)
[目标](#目标)
[分层兼容规则](#分层兼容规则)
[公开契约规则](#公开契约规则)
[提交卫生](#提交卫生)
[上游合并流程](#上游合并流程)
[合并冒烟清单](#合并冒烟清单)

---

## English

### Goals
This fork keeps LM tools and related contract/formatter features, while reducing long-term merge cost against `upstream/master`.

The default strategy is layered compatibility:
- keep fork-only behavior near adapter and contract boundaries
- avoid invasive edits in upstream-heavy entrypoints
- prefer additive public API changes over replacement

### Layered Compatibility Rules
Treat these files as upstream-sensitive. Change them only for small bugfixes or unavoidable integration work:
- `extension/src/extension.ts`
- `language-server/src/server.ts`
- `language-server/src/symbols.ts`

Prefer landing fork-only behavior in these boundary layers:
- `extension/src/toolRegistry.ts`
- `extension/src/toolShared.ts`
- `extension/src/toolTextFormatter.ts`
- `extension/src/toolResultTransport.ts`
- `language-server/src/api_search.ts`

Avoid pushing LM text rendering, structured output shaping, and prompt-facing tool behavior into parser/database core files unless no boundary-layer option exists.

### Public Contract Rules
All `angelscript_*` tool contracts should evolve additively by default:
- add optional request fields
- add optional response fields
- add optional notices or output modes

Do not make these changes in place unless a new opt-in path exists:
- rename or remove public fields
- flip default behavior for `filePath`, line/character indexing, or default search mode
- replace structured output with text-only output, or the reverse

If a semantic break is unavoidable, add either:
- a new opt-in flag, or
- a new `v2`-style tool name

### Commit Hygiene
Keep each commit focused on one dimension only:
- contract
- formatter
- transport
- search behavior
- docs
- CI

Do not mix behavior changes with docs rewrites, release metadata, and workflow churn in the same commit.

Recommended prefixes for fork-only work:
- `fork(tooling):`
- `fork(contract):`
- `fork(release):`
- `fork(docs):`

### Upstream Merge Routine
1. Fetch upstream:
   `git fetch upstream`
2. Review current divergence:
   `npm run upstream:divergence:stat`
   `npm run upstream:divergence:log`
3. Create a temporary merge-smoke branch from current work:
   `git switch -c codex/upstream-smoke-YYYYMMDD`
4. Attempt a non-final merge:
   `git merge --no-commit --no-ff upstream/master`
5. Inspect high-risk files first:
   `extension/src/extension.ts`
   `language-server/src/server.ts`
   `package.json`
6. Run the fork boundary regression suite:
   `npm run test:fork-boundary`
7. If the smoke pass is only for inspection, abort the merge:
   `git merge --abort`

If a change looks generally useful and low-coupling, consider extracting it into a standalone commit that can be proposed upstream.

### Merge Smoke Checklist
- Has any `angelscript_*` tool schema changed?
- Has any activation/config behavior changed in `package.json` or `extension/src/extension.ts`?
- Has any search request/response payload changed?
- Do README and CHANGELOG still match the actual contract?
- Did new fork work stay inside boundary layers when possible?
- Were upstream-sensitive files touched only for bugfixes or unavoidable integration?

---

## 中文

### 目标
这个 fork 会继续保留 LM tools 及其 contract/formatter 能力,同时尽量降低与 `upstream/master` 的长期合并成本.

默认采用分层兼容策略:
- 把 fork 专属行为尽量留在 adapter 和 contract 边界层
- 避免频繁修改 upstream 高频入口
- 公开 API 优先采用加法式演进,不要直接替换旧语义

### 分层兼容规则
以下文件视为 upstream 敏感文件. 只有在小型 bugfix 或确实无法绕开的集成场景下才修改:
- `extension/src/extension.ts`
- `language-server/src/server.ts`
- `language-server/src/symbols.ts`

以下边界层优先承载 fork 专属能力:
- `extension/src/toolRegistry.ts`
- `extension/src/toolShared.ts`
- `extension/src/toolTextFormatter.ts`
- `extension/src/toolResultTransport.ts`
- `language-server/src/api_search.ts`

LM 文本渲染、structured output 组织、prompt-facing tool 行为,默认不要继续下沉到 parser/database 核心层,除非边界层确实无法承载.

### 公开契约规则
所有 `angelscript_*` tool contract 默认只允许加法式演进:
- 新增 optional 请求字段
- 新增 optional 响应字段
- 新增 optional notice 或 output mode

以下变化不要直接原地修改,除非已经提供新的 opt-in 路径:
- 重命名或删除公开字段
- 修改 `filePath`、line/character 基准、默认 search mode 这类默认行为
- 把 structured output 改成 text-only,或反过来

如果确实必须引入语义破坏,请优先采用:
- 新增显式 opt-in 开关,或
- 新增 `v2` 风格 tool 名称

### 提交卫生
每个 commit 只覆盖一个维度:
- contract
- formatter
- transport
- search behavior
- docs
- CI

不要把行为改动、文档重写、发布元数据和 workflow 调整混在同一个 commit 里.

fork-only 提交推荐前缀:
- `fork(tooling):`
- `fork(contract):`
- `fork(release):`
- `fork(docs):`

### 上游合并流程
1. 拉取 upstream:
   `git fetch upstream`
2. 查看当前分叉情况:
   `npm run upstream:divergence:stat`
   `npm run upstream:divergence:log`
3. 从当前工作创建一个临时 merge smoke 分支:
   `git switch -c codex/upstream-smoke-YYYYMMDD`
4. 执行一次不落盘的合并尝试:
   `git merge --no-commit --no-ff upstream/master`
5. 优先检查高风险文件:
   `extension/src/extension.ts`
   `language-server/src/server.ts`
   `package.json`
6. 运行 fork 边界回归测试:
   `npm run test:fork-boundary`
7. 如果这次只是做 smoke 检查,则中止合并:
   `git merge --abort`

如果某些改动本身通用、耦合低,优先把它们抽成独立 commit,必要时尝试回灌 upstream.

### 合并冒烟清单
- `angelscript_*` tool schema 是否发生变化?
- `package.json` 或 `extension/src/extension.ts` 中的 activation/config 行为是否发生变化?
- search request/response payload 是否发生变化?
- README 和 CHANGELOG 是否仍然与实际 contract 一致?
- 新的 fork 能力是否尽量留在边界层?
- upstream 敏感文件是否只因 bugfix 或无法避免的集成需求而被修改?
