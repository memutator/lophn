# @lophn/flow 2.2.0

Previous: 2.1.0
Breaking: no.

`@lophn/flow` 2.2.0 adds the optional `worktree?: "new" | "inherit"` option to `agent()` (and exports the `WorktreePolicy` type) so workflow steps can run in an isolated git worktree (`"new"`, creating a new managed worktree with a branch seeded from the instance title) or inherit the previous step's worktree (`"inherit"`). When omitted, the session opens in the project's original folder. Workflow completion or stop does not automatically delete worktrees.

```ts
import { agent, step } from "@lophn/flow";

const built = await step("implement", () =>
  agent({
    agent: { agent: "builder" },
    prompt: "Implement the feature in an isolated worktree.",
    worktree: "new",
  }),
);

const reviewed = await step("review", () =>
  agent({
    agent: { agent: "reviewer" },
    prompt: "Review the diff in the same worktree.",
    worktree: "inherit",
  }),
);
```

Existing 2.1.0 flows continue to run unchanged. Run `lophn workflow check <project>/<name>` after updating a flow to stamp `flow_sdk: 2.2.0`.

## Instruction diff

Follow the updated `@lophn/flow` guide when writing or updating project workflows that edit code: use `worktree: "new"` to isolate an implementation step in a dedicated git worktree, and `worktree: "inherit"` on subsequent review or verification steps so they inspect the same worktree.

```diff
# @lophn/flow guide.md
@@ -34,5 +34,6 @@
-- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, open?, step?, on?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, open?, worktree?, step?, on?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+  - `worktree`: `"new"`(project에 새 git worktree를 만들어 그 session에 고정; 브랜치 이름은 instance 제목 slug 기반 `wt/<slug>-<4hex>`) 또는 `"inherit"`(앞 step session의 worktree를 그대로 물려받음). 생략하면 원본 폴더에서 연다. instance가 끝나거나 멈춰도 worktree는 자동으로 지우지 않는다.
```
