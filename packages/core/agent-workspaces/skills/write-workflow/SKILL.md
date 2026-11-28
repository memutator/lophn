---
name: write-workflow
description: "Write, run one-off, override per-instance, save, or update project workflows: YAML shorthand or durable programmatic flow.ts (@lophn/flow 2.0 step(key, fn), human(), sub-workflow workflow(), onEvent(), tool(), withFallback()), declarative inputs/outputs, flow_sdk stamped by workflow check, workflow run/override-code/save/rename/delete, and cross-computer steps."
---

# Workflow

A workflow is how people, agents, app tools and app events compose a job from
step to step. You can either write a permanent workflow as files, run a one-off
workflow on the fly, or run an existing workflow with per-instance overrides.
A person, a job, a parent workflow (same project), or an attended agent turn
after explicit person approval (`lophn workflow run`) starts an instance.

lophn only records what participants say, checkpoints durable execution and
passes work on. It does not check a result, judge whether a step passed or
force an order.

## What a workflow is

A workflow is one folder, `<Workflows folder>/<name>/`:

```
<Workflows folder>/eval-loop/
├── workflow.yaml     the declaration, read by lophn
├── flow.ts           optional; presence selects programmatic flow mode
├── workflow.md       the declaration in plain words, read by people and you
└── artifacts/        optional
    ├── static/index.html     the steps drawn as nodes
    └── instance/index.html   the state of one instance
```

`<Workflows folder>` is the absolute path on the `Workflows folder:` line of
your workspace information. Always write with that absolute path and `file.write`: a
relative path lands in the person's project folder, which is wrong. `<name>` is
a lowercase slug (`eval-loop`).

Execution mode is chosen solely by whether `flow.ts` exists in the folder. Do
not write `kind: agent` or `kind: flow` (legacy `kind` is ignored).

## The declaration

lophn reads only these fields. Any other field is the workflow's own and lophn
does not read it or call it wrong.

- `agent`: for a folder with `flow.ts`, the agent whose received app skills
  decide which apps `tool` calls reach. It is an agent handle; when left out it
  is `lophn`.
- `participants`: a map from a key you choose to `{ agent, workspace?, on?, open? }`
  or `{ kind: human }`.
  - `agent` is the agent's handle. `workspace` is `{project: <name>}` or
    `{app: <slug>}`; when left out it is this instance's project, not home.
  - `open`: optional `"tab"` or `"background"` default for this participant's
    sessions in this workflow.
  - `on: <computer>` hands that participant's steps to the agent on another
    computer of the person (a name or id from `lophn machine computers`). The
    project must exist there under the same cross-computer id; `workspace`
    names it as on this computer. If that computer is off, the step waits and
    goes when it comes back; a step that arrives late waits for the person
    there. A `human` participant has no `on`, and a private project does not
    hand steps to another computer.
- `steps`: a map from a step name to `{ by, with?, prompt, in?, out?, next?, open? }`.
  Required (non-empty) when there is no `flow.ts` (YAML shorthand); optional
  when `flow.ts` is present (for display and `report` step names).
  - `by`: the participant key that does the step.
  - `with`: for a step `by` a `human` participant, the agent that talks with the
    person and reports the result.
  - `prompt`: what that participant is told.
  - `in`, `out`: what it receives and what it produces, in words.
  - `next`: the candidate next steps, step names or `end`. `end` cannot be a
    step name.
  - `open`: optional `"tab"` or `"background"` for this step (overrides
    participant and agent defaults). Human steps (`by` a `human` participant)
    default to `"tab"`.
- `inputs`: optional map from input key (1-63 chars) to a start-time form field:
  `{ type, label?, description?, required?, default?, placeholder?, when?, options?, min?, max?, kind?, steps? }`.
  - `type`: `string`, `text`, `number` (`min?`, `max?`), `boolean`, `select`
    (`options`: non-empty list of strings or `{ value, label? }`), `multiselect`
    (`options`), `agent` (callable agents on the workspace), or `path`
    (`kind?: file | dir | any`).
  - `when`: show and validate the field only when a condition holds:
    `{ field, equals }`, `{ field, in: [...] }`, `{ field, truthy: true | false }`,
    or an array of conditions (all must hold, AND). Hidden fields are not
    required and are omitted from the validated values. Unknown targets,
    self-references, and cycles fail validation (`invalid_inputs`).
  - `steps`: optional list of step names that use this input. The start screen
    shows the field under that step's settings instead of the general run
    settings. It only places the field; the value is passed the same way.
- `outputs`: optional map from output key to
  `{ type?: string | number | boolean | json | path | refs, description?, required? }`.

```yaml
inputs:
  mode:
    type: select
    label: Mode
    options: [quick, full]
    default: quick
  budget:
    type: number
    min: 1
    max: 100
    when: { field: mode, equals: full }
outputs:
  report_path: { type: path, description: "Generated report.md" }
participants:
  me: { kind: human }
  experimenter: { agent: experimenter }
  runner: { agent: eval-runner }
steps:
  spec:
    by: me
    with: experimenter
    prompt: "Talk with the person about the next experiment, write the spec and commit it."
    out: "path of the committed spec"
    next: [run]
  run:
    by: runner
    prompt: "Run the eval for the spec and write only facts to run.md."
    in: "spec path"
    out: "run.md path"
    next: [report]
  report:
    by: experimenter
    prompt: "Read the verdict and write report.md and a draft of the next spec."
    in: "run.md path"
    out: "report.md path"
    next: [spec, end]
```

## Flow workflows (`flow.ts`)

When `flow.ts` exists in the folder, lophn snapshots the workflow folder's
source files at start and runs `flow.ts` in a durable Node process.
`flow.ts` may import sibling files of the same folder by relative path (`.ts`
extension) and `node:` built-ins.

```ts
import {
  agent,
  human,
  input,
  inputs,
  report,
  step,
  tool,
  withFallback,
} from "@lophn/flow";

const target = typeof inputs.target === "string" ? inputs.target : "notes";
const draft = await step("draft", async () => {
  const first = await agent({
    agent: { agent: "lophn", workspace: { app: target } },
    prompt: "Write a short note summary.",
    input,
  });
  return withFallback(first, {
    fallbackAgent: { agent: "lophn" },
    context: { target },
    retry: () =>
      agent({
        agent: { agent: "lophn", workspace: { app: target } },
        prompt: "Retry writing a concise note summary.",
        input,
      }),
  });
});

if (!draft.ok) {
  await report({ step: "draft", text: draft.message, next: "end" });
} else {
  const confirmed = await step("confirm", () =>
    human({
      with: { agent: "lophn" },
      prompt: `Review and confirm: ${draft.result.summary}`,
    }),
  );
  if (confirmed.ok) {
    await step("save", () =>
      tool({ app: target, tool: "notes.add", input: { body: confirmed.result.summary } }),
    );
    await report({
      step: "save",
      text: confirmed.result.summary,
      refs: confirmed.result.refs,
      next: "end",
    });
  }
}
```

`@lophn/flow` (v2.3.0) exports:

- `input: string`: the start text.
- `inputs: Readonly<Record<string, unknown>>`: frozen validated values from
  `inputs:` in `workflow.yaml` (or `{}`).
- `instance: string`: the instance id.
- `step(key, fn)`: durable checkpoint block. `key` is **mandatory** and must be
  unique. Completed steps return their saved output on replay without re-running
  `fn`. Sequential primitives inside `step` get deterministic sub-keys
  (`${key}/${kind}#${n}`, isolated across `Promise.all` via `AsyncLocalStorage`).
  Wrap each `Promise.all` branch in its own `step(key, ...)` or pass an explicit `key`.
- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, open?, step?, on?, signal? })`:
  calls an agent and returns `Outcome<SoftOutput>`. `mode` is `"turn"` (default;
  waits for turn completion and open outgoing `agent_calls` to settle, returning
  `stalled` if calls settle with no follow-up turn) or `"report"` (waits for
  `workflow.report`). `session` is `"new"`, `"same"`, or a session id. `open`
  is `"tab"` (open a visible interactive tab in the workflow desk — GUI terminal
  tab for project harness agents, Agent tab for `lophn`/`custom`) or
  `"background"` (run quietly without opening a tab). `signal` cancels the
  running turn.
- `human({ with, prompt, input?, step?, key?, session?, open?, signal? })`:
  starts a human-agent conversation (`human_turn`) and waits for `workflow.report`.
  Defaults `open` to `"tab"`. Excluded from stall detection; process stays alive
  while waiting.
- `workflow({ workflow, input?, inputs?, key?, signal? })`:
  calls another workflow in the same project as a sub-workflow (cross-project is
  `forbidden`, cycle or nesting depth > 5 is `conflict`).
- `tool({ app, tool, input?, key?, signal? })`:
  calls a public app command with 2-phase checkpointing.
- `onEvent({ source, event, workspace? }, handler)`:
  non-persistent subscription to app events (`source: "<app>"`) or lophn session
  events (`source: "lophn"`). Returns an unsubscribe disposer. Events missed
  while stopped are not replayed; query current state with `tool()` after restart.
- `report({ step, text, refs?, data?, next? })`:
  records progress, explicit artifact paths (`refs`), optional structured `data`.
  `next: "end"` closes the instance as `ended`.
- `escalate({ step, reason })`:
  records an escalation so the instance shows `needs_you`.
- `withFallback(outcome, { fallbackAgent, context?, retry?, step?, key?, signal? })`:
  SDK helper outside core; if `outcome` failed, asks `fallbackAgent` to choose
  `retry | substitute | throw | escalate` and executes it.

All primitives return `Outcome<T>`:
`{ ok: true, result: T }` or `{ ok: false, reason, message, session? }`, where
`SoftOutput = { summary: string, refs?: string[], data?: unknown }`. Calling
`agent`, `human`, `workflow`, or `tool` outside `step(key, fn)` without an
explicit `key` throws immediately.

Durable replay & recovery:
- On restart, lophn never auto-reruns an in-flight `agent` or `tool`. Both
  settle to `{ ok: false, reason: "interrupted", message, session? }`. Idle
  `human()` waits re-attach without re-sending the prompt.
- If a flow throws or exits non-zero, the instance stays `running` with derived
  status `blocked` so the person can `[Retry]` (continue in the same session) or
  `[Resume]` (replay from snapshot, or `use_latest_code: true` after fixing code).

The process: lophn runs a flow as one Node process (512 MiB V8 heap limit, no
sandbox, env limited to `HOME`, `PATH`, `XDG_CACHE_HOME`). Send outside effects
through `tool` and `agent` so lophn checkpoints and records them. `console.log`
goes to stderr. Avoid non-erasable TypeScript syntax (`enum`, `namespace`).

Allotment: `tool()` reaches an app only when a skill of that app reaches the
agent in `workflow.yaml`'s `agent:` field (`lophn` when omitted) in the
flow's workspace, through any layer (every agent, that workspace, that agent),
and is not switched off. A flow has no person to ask, so a call to any other
app is refused. Deploy the skill first (read `deploy-skill`; the person is
asked when you may not deploy it yourself).

After writing or changing `flow.ts`, run `lophn workflow check <project>/<name>`
to verify TypeScript types and erasable syntax and stamp `flow_sdk` in
`workflow.yaml`. To rename or remove a workflow cleanly (keeping `workflow_start`
jobs and desk layout in sync), use `lophn workflow rename` and
`lophn workflow delete`.

Starting: a person (screen, `lophn workflow start --inputs <json>`), a job
(`workflow_start`), or a parent `workflow()` starts it.

## Tab vs background (`open`)

Choose `open: tab` or `open: background` intentionally on `steps`, `participants`,
or `agent()` / `human()` calls based on whether the person should watch or
interact with the session:

- **Use `open: tab`** when the person is expected to monitor live progress,
  approve tool/permission prompts, steer mid-run, inspect diffs/output live, or
  converse directly (for example: interactive design/planning, coding or
  implementation steps the person watches, human-in-the-loop checkpoints).
  For project harness agents (both built-in and custom harness definitions),
  `open: tab` opens a GUI terminal tab in the workflow desk using that agent's
  own `harness_config` (model/options). For `lophn`/`custom` agents, it opens
  an Agent tab in the workflow desk. `human` steps default to `tab`.
- **Use `open: background`** when the step is autonomous, quiet, or fanned out
  in parallel and the person only cares about the final report (for example:
  automated code review, lint/verification checks, background synthesis,
  parallel research workers, unattended scheduled jobs).
- **Omit `open`** to inherit the agent definition's own `open` setting (configured
  in Agents › Runs on; built-in coding agents default to `tab`, custom harness
  agents and non-human `lophn` steps default to `background`). The person can
  also override tab vs background per run in the workflow Start box or via
  `lophn workflow start --open tab|background`.

## Sub-agents inside a step vs. dynamic workflow steps

Keep **internal helper work** and **workflow steps** distinct:

- **Internal helper work (`lophn team spawn`)**: When a step delegates helper
  sub-tasks inside its own turn (e.g., searching files or reading logs), spawn
  workers with `lophn team spawn <handle> --body <text>` rather than
  harness-native sub-agent tools. They inherit `workflow_origin`, appear under
  that step's `sessions` tree and workflow desk, and keep stall detection aware
  of open outgoing `agent_calls`.
- **Dynamic follow-up workflow steps (`--insert-steps` / `workflow edit`)**:
  When a step discovers follow-up work that belongs in the workflow itself (for
  example, a reviewer spawning one or more fix steps before re-review or land),
  insert them as real workflow steps when reporting:
  `lophn workflow report <instance> <step> "<summary>" --insert-steps '<json array>' --then-step <next-step> [--join all|any]`.
  When 2+ steps are inserted, they run in parallel and join into `--then-step`
  (`all` waits for every branch and merges their reports; `any` hands off on the
  first completion and cancels the remaining siblings).

## Parallel steps and joins (`parallel`, `needs`, `join`)

YAML shorthand steps can also declare parallel fan-out and join:

- Set `parallel: true` on a step with multiple `next` entries (or pass
  `--next step_a,step_b` / `--next-steps` when reporting) to run multiple next
  steps concurrently.
- On the downstream join step, optionally set `needs: [step_a, step_b]` and
  `join: all | any` (default `all`). Even without `needs`, active siblings
  targeting the same step join automatically. With `join: all`, lophn combines
  all upstream reports; with `join: any`, lophn hands off on the first report
  and cancels the remaining active siblings.

## A step message is all a participant gets

In YAML shorthand workflows, a participant receives its step's `prompt`, `in`,
previous report text (`Received:`), `out`, `Next candidates:`, and for the first
step an `Inputs:` section when `inputs:` are declared. Participants can report
explicit file paths and JSON via `lophn workflow report --refs <paths> --data <json>`.
Write each `prompt` to stand alone with any absolute paths it needs.

## After you write it

Run `lophn workflow list`. A wrong declaration drops only that workflow, and its
`problem` says why (`no_declaration`, `invalid_yaml`, `invalid_declaration`,
`invalid_inputs`, `broken_flow`). Participant and step references are resolved
when handed.

The declaration and (for flow workflows) a code snapshot are fixed at start.
YAML instances can edit steps via `lophn workflow edit`; blocked flow instances
can resume with updated code via `[Resume with updated code]`.

## Artifacts are optional: you decide

Make a static or instance artifact only when it helps the person follow work.
Static artifacts (`artifacts/static/index.html`) inline their steps directly.
Instance artifacts (`artifacts/instance/index.html`) fetch `"data/_instance.json"`,
which returns `{ instance, derived_status, last_reports, lines, checkpoints, sessions, refs, children }`
(or `{"error": ...}` if over 4 MiB). The page reloads on every instance change.

Follow "Drawing nodes" in the `write-artifact` file `kit.md` for `LophnKit.renderGraph`.

```html
<!doctype html>
<title>Workflow instance</title>
<meta name="description" content="Current workflow run state.">
<link rel="stylesheet" href="/_lophn/kit.css">
<div id="graph" style="display:block;width:100%"></div>
<p id="error"></p>
<script src="/_lophn/kit.js"></script>
<script>
(async () => {
  const data = await (await fetch("data/_instance.json")).json();
  if (!data.instance) {
    document.getElementById("error").textContent = data.error ?? "Cannot read the instance.";
    return;
  }
  const { instance, last_reports } = data;
  const nodes = instance.steps.map((s) => {
    const report = last_reports[s.name];
    const now = instance.state === "running" && instance.current?.step === s.name;
    return {
      id: s.name,
      label: s.name,
      status: now
        ? { label: "running", tone: "warning" }
        : report
        ? { label: "reported", tone: "good" }
        : undefined,
      note: report?.text.slice(0, 60),
    };
  });
  const edges = instance.steps.flatMap((s) =>
    s.next.filter((n) => n !== "end" && n !== s.name).map((to) => ({ from: s.name, to }))
  );
  LophnKit.renderGraph(document.getElementById("graph"), { nodes, edges });
})();
</script>
```

## One-off workflows and per-instance overrides

You do not need to create a permanent workflow folder for a one-time job or a
single-run tweak:

1. **One-off workflow (`lophn workflow run`)**:
   - Omit `--workflow`. Pass `--text` plus either:
     - YAML shorthand: `--participants '<json>'` and `--steps '<json array>'`
     - Programmatic flow: `--files '{"flow.ts": "..."}'` (plus optional helper
       files, `--agent`, `--steps` display list)
   - Optional `--name <slug>` (default `one-off`), `--title`, `--open tab|background`,
     `--inputs '<json>'`. In a project workspace you may omit `--project`.
   - Core type-checks inline `flow.ts` files first, then shows the person an
     approval card summarizing the workflow; once approved, the instance starts
     immediately without adding a permanent folder to the project's Workflows list.
   - Blocked in `unattended` turns, `team_child` sessions, and `read_only` mode.

2. **Per-instance override at start (`lophn workflow run --workflow <project>/<name> --override '<json>'`)**:
   - Leaves the base workflow folder on disk completely unchanged and applies the
     override only to this instance.
   - `override` fields (all optional):
     - `participants`: `{ "<key>": { agent, ... } | { kind: "human" } | null }`
       (add, replace, or remove with `null`)
     - `patch_steps`: `{ "<step>": { by?, with?, prompt?, in?, out?, next?, open? } }`
     - `add_steps`: `[{ step: { name, by, prompt, ... }, after? }]`
     - `remove_steps`: `["<step>", ...]`
     - `steps`: full replacement step array (cannot combine with patch/add/remove)
     - `files`: `{ "flow.ts": "...", "helper.ts": "...", "old.ts": null }`
       (merged onto the base workflow folder's files and type-checked before approval)
     - `agent`: override the flow's app-tool creator agent handle

3. **Live instance overrides (without changing the base workflow)**:
   - YAML instance: `lophn workflow edit <instance> --op add_step|insert_steps|update_step|remove_step|set_participant|remove_participant|hand_now|end ...`
   - Flow instance (running/blocked, no in-flight `agent`/`tool` step):
     `lophn workflow override-code <instance> --files '{"flow.ts": "..."}' [--agent <handle>] [--resume true|false]`
     Patches only that instance's `code_snapshot` (type-checked and approved by the
     person first) and resumes from saved checkpoints.

4. **Promote a one-off or overridden instance to a permanent workflow (`lophn workflow save`)**:
   - When the person asks to keep a one-off or overridden run as a reusable
     workflow, run `lophn workflow save <instance> <name> [--overwrite]`.
   - Materializes the instance's definition (and `code_snapshot` for flows) into
     `<Workflows folder>/<name>/` without copying per-run permission modes.

## What you do not do

- Do not put domain pass/fail policy in `workflow.yaml`. Put rules in step
  `prompt`s or in `flow.ts`.
- Do not try to start or override workflows from unattended runs or team child
  sessions (person approval is required from an attended session).
