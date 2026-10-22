---
name: guide-workflows
description: Write a workflow: a folder in the project's Workflows folder with a declaration (workflow.yaml), a readable description (workflow.md) and optional artifacts that draw its steps as nodes. What lophn reads, what each participant receives, and how to draw nodes with the kit.
---

# Workflow

A workflow is how people and agents pass a job from step to step. You write its
definition as files. A person starts an instance of it (a job may start one
later). There is no tool that starts an instance, so an agent cannot start one.

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

- `kind`: `agent`. `flow` is declared but cannot be started yet.
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
`problem` says why. The names that `by`, `with` and `next` point to are not
checked when the file is read: a wrong one shows up when a step is handed, as a
step that could not be handed.

The declaration is copied when an instance starts. Changing the file does not
change a running instance. The participants of that instance change its steps
with `workflow.edit`.

## Artifacts are optional: ask

A workflow does not need a picture. Before you make any, ask the person with
`ask` which they want: a static artifact (the steps as nodes), an instance
artifact (the state of one instance), both, or none. None is a good answer. Do
not make one without asking.

## Drawing nodes with the kit

An artifact is a sealed view, so follow `guide-artifact` (no network, no
external library, theme tokens). One thing is added: the kit, which draws a node
diagram. It works in a workflow artifact and in a domain artifact.

- Load it with a plain `<script>` (not a module) and a stylesheet:
  `<link rel="stylesheet" href="/_lophn/kit.css">` and
  `<script src="/_lophn/kit.js"></script>`.
- Call `LophnKit.renderGraph(element, { nodes, edges })`. Calling it again on
  the same element updates it. The element must be a block with a width that is
  not 0 (not hidden, not `display: inline`).
- A node is `{ id, label, status?: { label, tone }, note? }`. `tone` must be one
  of `good`, `warning`, `serious`, `critical`, `neutral`; any other value draws
  the diagram as unreadable (error). `note` is a short text. An edge is
  `{ from, to, label? }`.
- What a status value means is yours to decide (for example `running` for the
  current step and `reported` when a report exists).

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
    s.next.filter((n) => n !== "end").map((to) => ({ from: s.name, to }))
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
