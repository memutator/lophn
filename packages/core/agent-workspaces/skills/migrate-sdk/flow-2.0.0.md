# @lophn/flow 2.0.0

Previous: 1.1.0
Breaking: yes. Top-level calls to `agent()` or `tool()` without `step(key, fn)` or an explicit `key` option now throw immediately, and `agent()` now returns `Outcome<SoftOutput>` (`{ summary, refs?, data? }`) instead of raw text or JSON.

`@lophn/flow` 2.0.0 upgrades flows to the unified durable execution model: mandatory checkpoint keys via `step(key, fn)` (or explicit `key`), `agent()` modes (`"turn"` / `"report"`), `session` reuse, `AbortSignal` cancellation, `human()`, `workflow()` sub-workflows, `onEvent()` non-persistent subscriptions, `report()` with `refs`/`data`, `escalate()`, and the `withFallback()` recovery helper.

```ts
// Before (1.1.0)
import { agent, input, report, tool } from "@lophn/flow";

const draft = await agent<{ title: string }>({
  agent: { agent: "lophn", workspace: { app: "notes" } },
  prompt: "Write a title for this note.",
  input,
  schema: { type: "object", required: ["title"] },
});
if (draft.ok) {
  await tool({ app: "notes", tool: "notes.add", input: draft.result });
  await report({ step: "draft", text: draft.result.title, next: "end" });
}
```

```ts
// After (2.0.0)
import { agent, human, input, report, step, tool, withFallback } from "@lophn/flow";

const draft = await step("draft", async () => {
  const first = await agent({
    agent: { agent: "lophn", workspace: { app: "notes" } },
    prompt: "Write a title for this note.",
    input,
  });
  return withFallback(first, {
    fallbackAgent: { agent: "lophn" },
    retry: () =>
      agent({
        agent: { agent: "lophn", workspace: { app: "notes" } },
        prompt: "Retry writing a concise title for this note.",
        input,
      }),
  });
});

if (!draft.ok) {
  await report({ step: "draft", text: draft.message, next: "end" });
} else {
  const approved = await step("review", () =>
    human({
      with: { agent: "lophn" },
      prompt: `Approve this note title: ${draft.result.summary}`,
    }),
  );
  if (approved.ok) {
    await step("save", () =>
      tool({ app: "notes", tool: "notes.add", input: { title: approved.result.summary } }),
    );
    await report({
      step: "save",
      text: approved.result.summary,
      refs: approved.result.refs,
      next: "end",
    });
  }
}
```

Existing flows must wrap primitive calls (`agent`, `human`, `workflow`, `tool`) in `step(key, fn)` (or pass an explicit `key`), update `agent()` consumers to read `result.summary` / `result.refs` / `result.data`, and remove legacy `kind: agent` / `kind: flow` from `workflow.yaml` (mode is now determined solely by the presence of `flow.ts`). Run `lophn workflow check <project>/<name>` after updating.

## Instruction diff

Follow the updated `@lophn/flow` guide and `write-workflow` skill when writing or updating workflows: omit `kind` from `workflow.yaml` (presence of `flow.ts` selects flow mode), wrap all durable primitives in `step(key, fn)` or pass an explicit `key`, handle `SoftOutput` and `interrupted` outcomes without assuming auto-rerun, and use `human()`, `workflow()`, `onEvent()`, `escalate()`, and `withFallback()` where appropriate.

```diff
# @lophn/flow guide.md
@@ -7,4 +7,4 @@
-workflow의 `flow.ts`가 바깥과 닿는 길이다. flow code는 agent를 부르고, 앱 command를
-부르고, 진행을 report로 남긴다. 모두 core를 거친다.
+workflow의 `flow.ts`가 사람, agent, sub-workflow, 앱 tool, 앱·session event와 닿는
+통합 durable 실행 길이다. 모든 호출은 core를 거쳐 checkpoint·관측·redaction을 남긴다.
@@ -13,3 +13,16 @@
 ```ts
-import { agent, input, inputs, instance, report, tool } from "@lophn/flow";
+import {
+  agent,
+  escalate,
+  human,
+  input,
+  inputs,
+  instance,
+  onEvent,
+  report,
+  step,
+  tool,
+  withFallback,
+  workflow,
+} from "@lophn/flow";
 ```
@@ -19,27 +32,43 @@
-- `agent({ agent, prompt, input?, schema? })` — agent 한 명에게 일을 시키고 답을 기다린다.
-- `tool({ app, tool, input? })` — 앱 command를 부르고 결과를 기다린다.
-- `report({ step, text, next? })` — 진행을 남긴다.
-- `Outcome<T> = { ok: true, result: T } | { ok: false, reason, message }`
+- `step<T>(key, fn)` — durable checkpoint 단위다. `key`(비어 있지 않은 고유 문자열)는 **필수**다. 이미 `completed`로 저장된 `key`는 재시작·재개 replay 때 `fn`을 다시 돌리지 않고 저장된 값을 바로 돌려준다. `step` 안에서 순차 호출하는 primitive는 `AsyncLocalStorage`로 격리된 순번(`${key}/${kind}#${n}`)을 자동 부여받는다. `Promise.all` 병렬 분기는 각 항목을 고유 `step(key, ...)`로 감싸거나 명시적 `key`를 준다.
+- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, step?, on?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+  - `mode`: `"turn"`(기본) 또는 `"report"`.
+  - `session`: `"new"`(기본), `"same"`, 또는 session id.
+  - `on`: 다른 컴퓨터의 이름 또는 id.
+  - `signal`: `AbortSignal`. 취소되면 core가 turn을 멈추고 `cancelled`를 돌려준다.
+- `human({ with, prompt, input?, step?, key?, session?, signal? })` — `Promise<Outcome<SoftOutput>>`.
+- `workflow({ workflow, input?, inputs?, key?, signal? })` — `Promise<Outcome<SoftOutput>>`. 같은 project 안의 다른 workflow를 호출한다.
+- `tool<T = unknown>({ app, tool, input?, key?, signal? })` — `Promise<Outcome<T>>`. 2단계 checkpoint로 기록한다.
+- `onEvent({ source, event, workspace? }, handler)` — `() => void`. 비영속 구독이다.
+- `report({ step, text, refs?, data?, next? })` — `Promise<Outcome<void>>`.
+- `escalate({ step, reason })` — `Promise<Outcome<void>>`.
+- `withFallback<T>(outcome, { fallbackAgent, context?, retry?, step?, key?, signal? })` — core 밖 SDK helper.
+- `SoftOutput = { summary: string; refs?: string[]; data?: unknown }`
+- `Outcome<T> = { ok: true; result: T } | { ok: false; reason: OutcomeReason; message: string; session?: string }`
+
+## 쓰는 법과 durable replay 규칙
+
+`agent`, `human`, `workflow`, `tool`은 **반드시 `step(key, fn)` 안에서 부르거나 명시적 `key`를 줘야 한다.**
+재시작 시 돌던 `agent`·`tool`은 절대 자동 재실행하지 않고 `reason: "interrupted"`로 돌려준다.
+`human()`이 사람의 입력을 기다리며 쉬고 있던 상태는 기존 세션에 다시 붙어 report를 기다린다.
+`onEvent()`는 비영속이므로 재시작 뒤 현재 상태가 필요하면 `tool()`로 다시 조회한다.

# write-workflow SKILL.md
@@ -22,2 +22,6 @@
 ├── workflow.yaml     the declaration, read by lophn
+├── flow.ts           optional; presence selects programmatic flow mode
 ├── workflow.md       the declaration in plain words, read by people and you
+
+Execution mode is chosen solely by whether `flow.ts` exists in the folder. Do
+not write `kind: agent` or `kind: flow` (legacy `kind` is ignored).
@@ -38,7 +42,5 @@
-- `kind`: `agent`, or `flow`. With `flow`, a program (`flow.ts`) runs the steps;
-  see Flow workflows below.
-- `agent`: for a `flow`, the agent whose assignment the app
-  command calls use. It is an agent handle; when left out it is lophn.
+- `agent`: for a folder with `flow.ts`, the agent whose assignment app command
+  (`tool`) calls use. It is an agent handle; when left out it is `lophn`.
 - `steps`: a map from a step name to `{ by, with?, prompt, in?, out?, next? }`.
-  The first key is the first step.
+  Required (non-empty) when there is no `flow.ts` (YAML shorthand); optional
+  when `flow.ts` is present (for display and `report` step names).
@@ -154,18 +179,32 @@
-The SDK `@lophn/flow` gives six things: `input`, `inputs`, `instance`, `agent`, `tool`, `report`.
+`@lophn/flow` (v2.0.0) exports: `input`, `inputs`, `instance`, `step`, `agent`,
+`human`, `workflow`, `tool`, `onEvent`, `report`, `escalate`, `withFallback`.
+Calling `agent`, `human`, `workflow`, or `tool` outside `step(key, fn)` without
+an explicit `key` throws immediately.
+Durable replay: on restart, in-flight `agent`/`tool` settle to `interrupted`
+(never auto-rerun); idle `human()` waits re-attach; abnormal exit leaves the
+instance `running` (`blocked`) for `[Retry]` or `[Resume]` (`use_latest_code`).
```
