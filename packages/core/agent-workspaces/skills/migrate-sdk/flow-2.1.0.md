# @lophn/flow 2.1.0

Previous: 2.0.0
Breaking: no.

`@lophn/flow` 2.1.0 adds the optional `open?: "tab" | "background"` option to `agent()` and `human()` (and exports the `SessionOpenMode` type) so flows can choose whether a session opens as a visible interactive tab in the workflow desk or runs quietly in the background. `human()` defaults to `"tab"`. When `open` is omitted on `agent()`, lophn uses the agent definition's own `open` setting and default rules.

```ts
import { agent, human, step } from "@lophn/flow";

const plan = await step("design", () =>
  human({
    with: { agent: "lophn" },
    prompt: "Discuss the design with the person.",
    // defaults to open: "tab"
  }),
);

const built = await step("implement", () =>
  agent({
    agent: { agent: "builder-neon" },
    prompt: "Implement the approved design.",
    open: "tab", // open as an interactive GUI tab so the person can watch or steer
  }),
);

const reviewed = await step("review", () =>
  agent({
    agent: { agent: "reviewer" },
    prompt: "Review the diff and report pass/fail.",
    open: "background", // run quietly in the background
  }),
);
```

Existing 2.0.0 flows continue to run unchanged. Run `lophn workflow check <project>/<name>` after updating a flow to stamp `flow_sdk: 2.1.0`.

## Instruction diff

Follow the updated `@lophn/flow` guide and `write-workflow` skill when writing or updating workflows: choose `open: "tab"` for steps where the person should watch, approve, steer, or converse, and `open: "background"` for autonomous or parallel steps where only the final report matters.

```diff
# @lophn/flow guide.md
@@ -34,5 +34,6 @@
-- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, step?, on?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, open?, step?, on?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+  - `open`: `"tab"`(보이는 탭으로 열어 사람이 진행을 지켜보거나 승인·개입할 수 있게 함) 또는 `"background"`(탭을 자동으로 열지 않고 뒤에서 실행). 생략하면 agent 정의의 `open` 설정과 기본 규칙을 따른다.
-- `human({ with, prompt, input?, step?, key?, session?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+- `human({ with, prompt, input?, step?, key?, session?, open?, signal? })` — `Promise<Outcome<SoftOutput>>`. `open`을 생략하면 기본은 `"tab"`이다.
```
