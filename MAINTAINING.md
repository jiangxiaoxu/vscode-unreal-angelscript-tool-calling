# Maintaining The Fork

[English](#english) | [中文](#中文)

## Table of Contents
[English](#english)
[File Tier Rules](#file-tier-rules)
[Public Contract Rules](#public-contract-rules)
[Commit Hygiene](#commit-hygiene)
[Required Checks](#required-checks)
[Upstream Merge Routine](#upstream-merge-routine)
[中文](#中文)
[文件分层规则](#文件分层规则)
[公开契约规则](#公开契约规则)
[提交卫生](#提交卫生)
[必跑检查](#必跑检查)
[上游合并流程](#上游合并流程)

---

## English

This fork keeps LM tools and related contract/formatter features, while reducing long-term merge cost against `upstream/master`.

The default strategy is layered compatibility:
- keep fork-only behavior near adapter, contract, formatter, and query boundaries
- keep upstream-sensitive entrypoints thin
- prefer additive public API evolution over replacement

### File Tier Rules
Use these file tiers to decide where new work should land.

Frozen / minimize changes:
- `extension/src/extension.ts`
- `language-server/src/server.ts`
- `language-server/src/symbols.ts`
- `package.json`

These files should only take small bugfixes, thin glue, registration wiring, or unavoidable integration edits.

Cautious / change deliberately:
- `extension/src/apiRequests.ts`
- `README.md`
- `AGENTS.md`
- `MAINTAINING.md`
- `scripts/merge-smoke.mjs`

Boundary / preferred expansion area:
- `extension/src/apiPanel.ts`
- `extension/src/scriptRoots.ts`
- `extension/src/toolRegistry.ts`
- `extension/src/toolShared.ts`
- `extension/src/toolTextFormatter.ts`
- `extension/src/toolResultTransport.ts`
- `extension/src/toolContractUtils.ts`
- `extension/src/angelscriptApiSearch.ts`
- `language-server/src/apiRequestHandlers.ts`
- `language-server/src/workspaceLayout.ts`
- `language-server/src/unrealCacheController.ts`
- `language-server/src/symbolResolve.ts`
- `language-server/src/api_search.ts`
- `language-server/src/api_docs.ts`
- `language-server/src/__tests__/apiSearch.test.ts`
- `language-server/src/__tests__/getTypeMembers.test.ts`
- `language-server/src/__tests__/symbolResolve.test.ts`
- `language-server/src/__tests__/workspaceLayout.test.ts`

Parser/database/core files should not be modified for fork-only features by default. This includes files such as:
- `language-server/src/as_parser.ts`
- `language-server/src/database.ts`
- `language-server/src/parsed_completion.ts`
- `language-server/src/references.ts`

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

### Required Checks
Run these checks before risky maintenance work:
- `npm run test:fork-boundary`
- `npm run merge:smoke -- --base upstream/master`
- `npm run upstream:divergence:stat`
- `npm run upstream:divergence:log`

Use this quick checklist during review:
- Did new fork work stay in boundary files when possible?
- Were frozen files touched only for bugfixes or unavoidable integration?
- Did any `angelscript_*` schema or activation/config behavior change?
- Do `README.md` and `CHANGELOG.md` still match the current contract?

### Upstream Merge Routine
1. Fetch upstream:
   `git fetch upstream`
2. Review current divergence:
   `npm run upstream:divergence:stat`
   `npm run upstream:divergence:log`
3. Run merge smoke first:
   `npm run merge:smoke -- --base upstream/master`
4. Create a temporary merge-smoke branch from current work:
   `git switch -c codex/upstream-smoke-YYYYMMDD`
5. Attempt a non-final merge:
   `git merge --no-commit --no-ff upstream/master`
6. Inspect high-risk files first:
   `extension/src/extension.ts`
   `language-server/src/server.ts`
   `package.json`
7. Run the fork boundary regression suite:
   `npm run test:fork-boundary`
8. If the smoke pass is only for inspection, abort the merge:
   `git merge --abort`

If a change looks generally useful and low-coupling, consider extracting it into a standalone commit that can be proposed upstream.

---

## 中文

这个 fork 会继续保留 LM tools 及其 contract/formatter 能力,同时尽量降低与 `upstream/master` 的长期合并成本.

默认采用分层兼容策略:
- 把 fork 专属行为尽量留在 adapter、contract、formatter、query 边界层
- 保持 upstream 敏感入口足够薄
- 公开 API 优先采用加法式演进,不要直接替换旧语义

### 文件分层规则
新增工作默认按以下分层落位.

Frozen / 尽量冻结:
- `extension/src/extension.ts`
- `language-server/src/server.ts`
- `language-server/src/symbols.ts`
- `package.json`

这些文件只应承载小型 bugfix、薄 glue、注册 wiring 或无法避免的集成改动.

Cautious / 谨慎改:
- `extension/src/apiRequests.ts`
- `README.md`
- `AGENTS.md`
- `MAINTAINING.md`
- `scripts/merge-smoke.mjs`

Boundary / 可继续扩展:
- `extension/src/apiPanel.ts`
- `extension/src/scriptRoots.ts`
- `extension/src/toolRegistry.ts`
- `extension/src/toolShared.ts`
- `extension/src/toolTextFormatter.ts`
- `extension/src/toolResultTransport.ts`
- `extension/src/toolContractUtils.ts`
- `extension/src/angelscriptApiSearch.ts`
- `language-server/src/apiRequestHandlers.ts`
- `language-server/src/workspaceLayout.ts`
- `language-server/src/unrealCacheController.ts`
- `language-server/src/symbolResolve.ts`
- `language-server/src/api_search.ts`
- `language-server/src/api_docs.ts`
- `language-server/src/__tests__/apiSearch.test.ts`
- `language-server/src/__tests__/getTypeMembers.test.ts`
- `language-server/src/__tests__/symbolResolve.test.ts`
- `language-server/src/__tests__/workspaceLayout.test.ts`

parser/database/core 文件默认不要为了 fork-only 功能去改,包括但不限于:
- `language-server/src/as_parser.ts`
- `language-server/src/database.ts`
- `language-server/src/parsed_completion.ts`
- `language-server/src/references.ts`

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

### 必跑检查
以下检查用于高风险维护动作前的基线验证:
- `npm run test:fork-boundary`
- `npm run merge:smoke -- --base upstream/master`
- `npm run upstream:divergence:stat`
- `npm run upstream:divergence:log`

评审时至少快速确认:
- 新的 fork 能力是否尽量留在 boundary 文件?
- Frozen 文件是否只因 bugfix 或无法避免的集成需求而被修改?
- `angelscript_*` schema 或 activation/config 行为是否发生变化?
- `README.md` 和 `CHANGELOG.md` 是否仍与当前 contract 一致?

### 上游合并流程
1. 拉取 upstream:
   `git fetch upstream`
2. 查看当前分叉情况:
   `npm run upstream:divergence:stat`
   `npm run upstream:divergence:log`
3. 先运行 merge smoke:
   `npm run merge:smoke -- --base upstream/master`
4. 从当前工作创建一个临时 merge smoke 分支:
   `git switch -c codex/upstream-smoke-YYYYMMDD`
5. 执行一次不落盘的合并尝试:
   `git merge --no-commit --no-ff upstream/master`
6. 优先检查高风险文件:
   `extension/src/extension.ts`
   `language-server/src/server.ts`
   `package.json`
7. 运行 fork 边界回归测试:
   `npm run test:fork-boundary`
8. 如果这次只是做 smoke 检查,则中止合并:
   `git merge --abort`

如果某些改动本身通用、耦合低,优先把它们抽成独立 commit,必要时尝试回灌 upstream.
