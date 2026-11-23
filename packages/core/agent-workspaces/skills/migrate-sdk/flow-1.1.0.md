# @lophn/flow 1.1.0

Previous: 1.0.0
Breaking: no

`@lophn/flow` adds a frozen `inputs` export (`Readonly<Record<string, unknown>>`) containing the validated, default-filled structured inputs declared under `inputs:` in `workflow.yaml` (or `{}` when none are declared or supplied).

```ts
// After: read structured inputs declared in workflow.yaml
import { agent, input, inputs, report } from "@lophn/flow";

const mode = inputs.mode === "full" ? "full" : "quick";
const reply = await agent({
  agent: { agent: "lophn" },
  prompt: `Run in ${mode} mode.`,
  input,
});
await report({
  step: "run",
  text: reply.ok ? String(reply.result) : reply.message,
  next: "end",
});
```

Nothing is required of an existing flow. Flows that do not declare or read `inputs` continue to work unchanged.

## Instruction diff

Follow the updated `@lophn/flow` guide and `write-workflow` skill when writing or updating workflows: declare structured start-time parameters under `inputs:` (and expected results under `outputs:`) in `workflow.yaml`, use `when` for conditional fields, read `inputs` from `@lophn/flow` in `flow.ts`, and expect an `Inputs:` section in the first step message of `kind: agent` workflows.

```diff
# @lophn/flow guide.md
@@ -12,8 +12,9 @@
 
 ```ts
-import { agent, input, instance, report, tool } from "@lophn/flow";
+import { agent, input, inputs, instance, report, tool } from "@lophn/flow";
 ```
 
-- `input: string` — 이 instance를 시작할 때 받은 입력이다.
+- `input: string` — 이 instance를 시작할 때 받은 입력 글이다.
+- `inputs: Readonly<Record<string, unknown>>` — `workflow.yaml`에 선언한 `inputs`로 받은 구조화 입력이다(선언이 없거나 값이 없으면 `{}`). 시작 시 core가 검증·기본값 적용·redaction을 끝낸 읽기 전용(frozen) 객체다.
 - `instance: string` — instance id다.
 - `agent({ agent, prompt, input?, schema? })` — agent 한 명에게 일을 시키고 답을
@@ -70,8 +71,9 @@
 
 ```ts
-import { agent, input, report, tool } from "@lophn/flow";
+import { agent, input, inputs, report, tool } from "@lophn/flow";
 
+const target = typeof inputs.target === "string" ? inputs.target : "notes";
 const draft = await agent<{ title: string }>({
-  agent: { agent: "lophn", workspace: { app: "notes" } },
+  agent: { agent: "lophn", workspace: { app: target } },
   prompt: "Write a title for this note.",
   input,
@@ -81,5 +83,5 @@
   await report({ step: "draft", text: draft.message, next: "end" });
 } else {
-  await tool({ app: "notes", tool: "notes.add", input: draft.result });
+  await tool({ app: target, tool: "notes.add", input: draft.result });
   await report({ step: "draft", text: draft.result.title, next: "end" });
 }

# write-workflow SKILL.md
@@ -62,7 +62,33 @@
   - `next`: the candidate next steps, step names or `end`. `end` cannot be a
     step name.
+- `inputs`: optional map from input key (1-63 chars) to a start-time form field:
+  `{ type, label?, description?, required?, default?, placeholder?, when?, options?, min?, max?, kind? }`.
+  - `type`: `string`, `text`, `number` (`min?`, `max?`), `boolean`, `select`
+    (`options`: non-empty list of strings or `{ value, label? }`), `multiselect`
+    (`options`), `agent` (callable agents on the workspace), or `path`
+    (`kind?: file | dir | any`).
+  - `when`: show and validate the field only when a condition holds:
+    `{ field, equals }`, `{ field, in: [...] }`, `{ field, truthy: true | false }`,
+    or an array of conditions (all must hold, AND). Hidden fields are not
+    required and are omitted from the validated values. Unknown targets,
+    self-references, and cycles fail validation (`invalid_inputs`).
+- `outputs`: optional map from output key to
+  `{ type?: string | number | boolean | json | path | refs, description?, required? }`.
 
 ```yaml
 kind: agent
+inputs:
+  mode:
+    type: select
+    label: Mode
+    options: [quick, full]
+    default: quick
+  budget:
+    type: number
+    min: 1
+    max: 100
+    when: { field: mode, equals: full }
+outputs:
+  report_path: { type: path, description: "Generated report.md" }
 participants:
   me: { kind: human }
@@ -103,14 +129,16 @@
-lophn reads `kind: flow`, `agent` and `steps` from `workflow.yaml`. The keys of
-`steps` are the step names that the screens and `report` use. The other fields
-(`by`, `prompt`, `participants`) are not read by lophn; use them as notes only.
+lophn reads `kind: flow`, `agent`, `inputs`, `outputs` and `steps` from
+`workflow.yaml`. The keys of `steps` are the step names that the screens and
+`report` use. The other fields (`by`, `prompt`, `participants`) are not read by
+lophn; use them as notes only.
 `flow.ts` may import other files of the same folder by a relative path.
 
 ```ts
-import { agent, input, report, tool } from "@lophn/flow";
+import { agent, input, inputs, report, tool } from "@lophn/flow";
 
+const target = typeof inputs.target === "string" ? inputs.target : "notes";
 const draft = await agent<{ title: string }>({
-  agent: { agent: "lophn", workspace: { app: "notes" } },
+  agent: { agent: "lophn", workspace: { app: target } },
   prompt: "Write a title for this note.",
   input,
@@ -120,12 +148,14 @@
   await report({ step: "draft", text: draft.message, next: "end" });
 } else {
-  await tool({ app: "notes", tool: "notes.add", input: draft.result });
+  await tool({ app: target, tool: "notes.add", input: draft.result });
   await report({ step: "draft", text: draft.result.title, next: "end" });
 }
 ```
 
-The SDK `@lophn/flow` gives five things:
+The SDK `@lophn/flow` gives six things:
 
 - `input`: the text the instance was started with.
+- `inputs`: read-only (`Readonly<Record<string, unknown>>`) object of validated,
+  default-filled values from the declared `inputs` (or `{}` when none).
 - `instance`: the instance id.
 - `agent({ agent, prompt, input?, schema? })`: calls one agent as a run, waits
@@ -170,6 +200,8 @@
-Starting: a person (the screen, the CLI) or a job starts it. You and other
-agents cannot. The start text arrives as `input`.
+Starting: a person (the screen, the CLI with optional `--inputs <json>`) or a
+job (`workflow_start` with optional `inputs`) starts it. You and other agents
+cannot. The start text arrives as `input` and the validated structured inputs
+arrive as `inputs`.
 
 ## A step message is all a participant gets
@@ -178,6 +210,8 @@
-`Next candidates:`. It does not know `workflow.md`, the other steps or the whole
-workflow.
+`Next candidates:`. When a `kind: agent` workflow starts with declared `inputs`,
+lophn also injects an `Inputs:` section (one `key: value` line per validated
+input) into the first step's message alongside `Received:`. It does not know
+`workflow.md`, the other steps or the whole workflow.
@@ -188,8 +222,10 @@
 Run `lophn workflow list`. A wrong declaration drops only that workflow, and its
-`problem` says why. A flow whose declaration is wrong or whose `flow.ts` is
-missing shows a `problem` too (`no_flow_file`). The names that `by`, `with` and
-`next` point to are not checked when the file is read: a wrong one shows up when
-a step is handed, as a step that could not be handed.
+`problem` says why (for example `invalid_inputs` for a malformed `inputs` block
+such as missing `options`, invalid `default`/`min`/`max`, or unknown/cyclic
+`when`). A flow whose declaration is wrong or whose `flow.ts` is missing shows a
+`problem` too (`no_flow_file`). The names that `by`, `with` and `next` point to
+are not checked when the file is read: a wrong one shows up when a step is
+handed, as a step that could not be handed.
```
