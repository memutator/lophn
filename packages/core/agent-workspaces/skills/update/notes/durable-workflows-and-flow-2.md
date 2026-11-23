# Durable workflows and @lophn/flow 2.0

Breaking: yes
Areas: workflow, project, home

Programmatic workflows now run on the unified `@lophn/flow` 2.0 durable
execution model, `workflow.yaml` supports declarative `inputs` (with `when`
conditions) and `outputs` without legacy `kind:` fields, and `lophn workflow check`
stamps `flow_sdk` in `workflow.yaml`.

## What changed

- **Mandatory durable checkpoints (`Breaking: yes`)**: top-level calls to
  `agent()`, `human()`, `workflow()`, or `tool()` in `flow.ts` without
  `step(key, fn)` or an explicit `key` now throw immediately. `agent()` returns
  `Outcome<SoftOutput>` (`{ summary, refs?, data? }`) instead of raw text/JSON.
- **New flow primitives**: `step(key, fn)`, `human()` (interactive human-agent
  turn), `workflow()` (same-project sub-workflow), `onEvent()` (non-persistent
  app/session event subscription), `report()` with `refs`/`data`, `escalate()`,
  and `withFallback()`.
- **Mode detection & `flow_sdk` stamp**: presence of `flow.ts` selects flow
  mode (omit legacy `kind: agent|flow`). `lophn workflow check <project>/<name>`
  validates types and erasable TypeScript syntax and stamps `flow_sdk` in
  `workflow.yaml`. Workflows missing `flow_sdk` (treated as `1.0.0`) or below
  `supported_from` are marked `required` and blocked from starting until
  migrated.
- **Lifecycle & recovery**: rename or delete workflows cleanly with
  `lophn workflow rename` and `lophn workflow delete` (which keep
  `workflow_start` jobs and desk layout aligned). Running flow instances keep
  their start-time `code_snapshot`; if a fixed workflow has a `blocked`
  instance, report that the person can continue it with
  `[Resume with updated code]`.

## How to migrate

Hand affected project workflows to that project's lophn with the `migrate-sdk`
skill (`skill.read {name: "migrate-sdk", path: "flow-2.0.0.md"}`). After editing
`flow.ts` and `workflow.yaml`, run `lophn workflow check <project>/<name>` to
verify and stamp `flow_sdk`.

## Instruction diff

Remove obsolete workflow workarounds (such as legacy `kind: agent|flow` rules,
manual checkpoint/retry scaffolding, or notes claiming workflows lack
declarative `inputs`, `human()`, sub-workflows, or `onEvent()`):

- Edit agent-owned `memory.md` (`agent.memory`) and generated project skills
  directly and report what was removed or updated.
- Update project-scoped `runtime: custom` agents with `agent.update` if their
  instructions reference old workflow formats.
- For person-owned `LOPHN.md`, propose edits only; never edit it directly.
