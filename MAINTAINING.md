# Maintaining the Fork / Fork 维护

Use this guide for local validation and upstream integration. Product usage is in [README.md](README.md), and release history is in [CHANGELOG.md](CHANGELOG.md).

本页仅保留本地验证和 upstream 整合入口. 使用说明见 [README.md](README.md), 版本记录见 [CHANGELOG.md](CHANGELOG.md).

## Validation / 验证

Run from the repository root after `npm install`.

执行 `npm install` 后, 在仓库根目录运行.

| Command | Purpose / 用途 |
| --- | --- |
| `npm run compile` | Build extension and language server / 构建 extension 和 language server |
| `npm test` | Full regression suite / 完整回归测试 |
| `npm run test:fork-boundary` | Focused fork contract and query regression / fork 契约与查询回归 |
| `npm run upstream:divergence:stat` | Changed files relative to upstream / 相对 upstream 的文件差异 |
| `npm run upstream:divergence:log` | Fork commits relative to upstream / 相对 upstream 的提交 |
| `npm run merge:smoke -- --base upstream/master` | Report integration-sensitive changes / 报告整合敏感改动 |

The smoke command compares committed `HEAD` with the base ref. It reports likely conflicts and documentation gaps; it does not attempt a merge or run tests.

smoke 命令比较已提交的 `HEAD` 与基线 ref, 报告可能的冲突和文档遗漏, 不会尝试合并或运行测试.

## Upstream integration / 上游整合

1. Preserve local work, then fetch and review divergence:
   保存本地工作, 然后获取并检查差异:

   ```sh
   git fetch upstream
   npm run upstream:divergence:stat
   npm run upstream:divergence:log
   npm run merge:smoke -- --base upstream/master
   npm run test:fork-boundary
   ```

2. Integrate `upstream/master` on a review branch. Inspect the files flagged by the report and resolve conflicts against the current API behavior.
   在评审分支整合 `upstream/master`. 检查报告标出的文件, 按当前 API 行为解决冲突.
3. After integration, run `npm test`. Check that user-facing changes are reflected in README and CHANGELOG.
   整合后运行 `npm test`, 并确认 README 和 CHANGELOG 已反映用户可见的变化.
