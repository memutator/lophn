---
name: guide-workflows
description: Write a workflow: a folder in the project's Workflows folder with a declaration (workflow.yaml), a readable description (workflow.md) and optional artifacts that draw its steps as nodes. What lophn reads, what each participant receives, and how to draw nodes with the kit.
---

# Workflow

A workflow is how people and agents pass a job from step to step. You write its
definition as files. A person or a job starts it. There is no tool that starts
an instance, so an agent cannot start one.

lophn only records what the participants say and passes it on to the next step.
It does not check a result, does not judge whether a step passed and does not
force an order.

## What a workflow is

A workflow is one folder, `<Workflows folder>/<name>/`:

```
<Workflows folder>/eval-loop/
├── workflow.yaml     the declaration, read by lophn
├── workflow.md       the declaration in plain words, read by people and you
└── artifacts/        optional
    ├── static/index.html     the steps drawn as nodes
    └── instance/index.html   the state of one instance
```

`<Workflows folder>` is the absolute path on the `Workflows folder:` line of
your place information. Always write with that absolute path and `file.write`: a
relative path lands in the person's project folder, which is wrong. `<name>` is
a lowercase slug (`eval-loop`).

## The declaration

lophn reads only these fields. Any other field is the workflow's own and lophn
does not read it or call it wrong.

- `kind`: `agent`, or `flow`. With `flow`, a program (`flow.ts`) runs the steps;
  see Flow workflows below.
- `participants`: a map from a key you choose to `{ role, place?, name? }`.
  - `role` is one of `lophn`, `project_manager`, `app_engineer`, `operator`,
    `human`, `harness`.
  - `project_manager` and `operator` without `place` mean this project.
    `app_engineer` needs `place: {app: <app name>}`. `operator` needs `name`.
  - `harness` can be declared but a step cannot be handed to it yet.
- `steps`: a map from a step name to `{ by, with?, prompt, in?, out?, next? }`.
  The first key is the first step.
  - `by`: the participant key that does the step.
  - `with`: for a step `by` a `human` participant, the agent that talks with the
    person and reports the result.
  - `prompt`: what that participant is told.
  - `in`, `out`: what it receives and what it produces, in words.
  - `next`: the candidate next steps, step names or `end`. `end` cannot be a
    step name.

```yaml
kind: agent
participants:
  me: { role: human }
  experimenter: { role: operator, name: experimenter }
  runner: { role: operator, name: eval-runner }
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

## Flow workflows

With `kind: flow`, a program runs the steps instead of agents passing a message
along. The folder is:

```
<Workflows folder>/nightly/
├── workflow.yaml     kind: flow and steps
├── flow.ts           the code
├── workflow.md       the same in plain words
└── artifacts/        optional
```

lophn reads only `kind: flow` and `steps` from `workflow.yaml`. The keys of
`steps` are the step names that the screens and `report` use. The other fields
(`by`, `prompt`, `participants`) are not read by lophn; use them as notes only.
`flow.ts` may import other files of the same folder by a relative path.

```ts
import { agent, input, report, tool } from "@lophn/flow";

const draft = await agent<{ title: string }>({
  agent: { role: "app_engineer", place: { app: "notes" } },
  prompt: "Write a title for this note.",
  input,
  schema: { type: "object", required: ["title"] },
});
if (!draft.ok) {
  await report({ step: "draft", text: draft.message, next: "end" });
} else {
  await tool({ app: "notes", tool: "notes.add", input: draft.result });
  await report({ step: "draft", text: draft.result.title, next: "end" });
}
```

The SDK `@lophn/flow` gives five things:

- `input`: the text the instance was started with.
- `instance`: the instance id.
- `agent({ agent, prompt, input?, schema? })`: calls one agent as a run, waits
  until it ends and gives its answer. `agent` is `{ role, place?, name? }`.
- `tool({ app, tool, input? })`: calls one tool of an app.
- `report({ step, text, next? })`: the same as `workflow.report`. `next: "end"`
  ends the instance.

`agent`, `tool` and `report` never throw. They give `{ ok: true, result }` or
`{ ok: false, reason, message }`.

Failure and trying again are the code's job. lophn does not retry and does not
judge whether a call succeeded. So the code looks at `ok: false` and decides:
call again, tell with `report`, or throw to end. When it throws or finishes, the
instance becomes `ended`, with the exit code and the last stderr line kept. If
lophn is turned off and on, a running flow is not started again; its instance is
closed as `ended`.

The process: lophn runs a flow as one Node process. There is no sandbox and no
permission limit, so it can read and write files, use the network and start
programs. lophn records only what goes through an app tool (`tool`) or an agent
(`agent`); send outside effects that way so lophn records them.
`console.log` and `process.stdout.write` go to stderr and show in the last line
of the instance when it ends. Node runs the code itself, stripping type syntax,
so import `@lophn/flow`, files of the same folder (write the `.ts` extension)
and Node's built-in modules. Syntax that needs a transform, such as `enum` or
`namespace`, fails at run; `workflow.check` reports it.

Allotment: an app tool that a flow calls works only within your current
allotment as the PM of this project and the domains you hold. Before you write
the flow, ask the person with `ask` to allot that app to you. Without the
allotment, `tool` comes back with `ok: false`. An agent that a flow calls can be
anyone, but the agent works only within its own allotment.

After you write or change `flow.ts`, run `workflow.check` with
`<project>/<name>` and read the type errors. It does not run the flow, so it
does not show that the flow works. No errors means it passes.

Starting: a person (the screen, the CLI) or a job starts it. You and other
agents cannot. The start text arrives as `input`.

## A step message is all a participant gets

A participant receives its own step's `prompt`, what it receives (`in` and the
text of the report before it), what it produces (`out`) and the next candidates
(`next`). The message labels are `Receives:`, `Received:`, `Produces:` and
`Next candidates:`. It does not know `workflow.md`, the other steps or the whole
workflow.

So write each `prompt` so that it works when read alone: the absolute paths it
needs, where it leaves its result, and in what words it reports when done. If a
participant has to read `workflow.md`, that step's `prompt` says so.

## After you write it

Run `workflow.list`. A wrong declaration drops only that workflow, and its
`problem` says why. A flow whose declaration is wrong or whose `flow.ts` is
missing shows a `problem` too (`no_flow_file`). The names that `by`, `with` and
`next` point to are not checked when the file is read: a wrong one shows up when
a step is handed, as a step that could not be handed.

The declaration is copied when an instance starts. Changing the file does not
change a running instance. The participants of that instance change its steps
with `workflow.edit`.

## Artifacts are optional: ask

A workflow does not need a picture. Before you make any, ask the person with
`ask` which they want: a static artifact (the steps as nodes), an instance
artifact (the state of one instance), both, or none. None is a good answer. Do
not make one without asking.

## Drawing nodes with the kit

Follow "Drawing nodes with the kit" in `guide-artifact`: how to load the kit,
the `renderGraph` call, the shape of nodes and edges and the rules. A workflow
artifact adds only the following.

The static artifact (`artifacts/static/index.html`) writes its steps straight in
the HTML: it cannot read `workflow.yaml`, which is outside its folder.

The instance artifact (`artifacts/instance/index.html`) reads
`fetch("data/_instance.json")`, which gives `{ instance, last_reports, lines }`:
`instance.steps` (name, `by`, `next`, ...), `instance.current`,
`instance.state`, the last report of each step in `last_reports[step]`, and the
history in `lines`. For a very large instance the response is an error body
(`{"error": ...}`) with no `instance`: show that as text.

The whole page reloads each time the instance changes, so nothing inside the
page (open sections, scroll) is kept. Do not try to keep it.

```html
<!doctype html>
<title>Eval loop instance</title>
<meta name="description" content="Where one eval loop run is.">
<link rel="stylesheet" href="/_lophn/kit.css">
<div id="graph" style="display:block;width:100%"></div>
<p id="error"></p>
<script src="/_lophn/kit.js"></script>
<script>
(async () => {
  const data = await (await fetch("data/_instance.json")).json();
  if (!data.instance) {
    document.getElementById("error").textContent = data.error ??
      "Cannot read the instance.";
    return;
  }
  const { instance, last_reports } = data;
  const nodes = instance.steps.map((s) => {
    const report = last_reports[s.name];
    const now = instance.state === "running" &&
      instance.current?.step === s.name;
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
    s.next.filter((n) => n !== "end" && n !== s.name).map((to) => ({
      from: s.name,
      to,
    }))
  );
  LophnKit.renderGraph(document.getElementById("graph"), { nodes, edges });
})();
</script>
```

## What you do not do

- Do not put policy in the declaration (forcing an order, passing or failing a
  result). lophn does not judge; it passes on what was said. If such a rule is
  needed, write it in that step's `prompt`, or let the workflow's own program
  hold it.
- Do not start a workflow instance. A person (or a job) starts it.
