---
name: design-app
description: Design an app or a change before you build it. Read this skill and write DESIGN.md as it says.
---

# Design an app

Write the design before the code. A new app or feature gets its design in
`DESIGN.md` at the root of the app's source folder. For a change, first edit the
sections that change, then the code.

## DESIGN.md

Sections, in this order:

1. Purpose: what the person gets from the app, in their words.
2. Reuse: what you build on and what you looked at (see "Find what exists").
3. Model: what is stored and what is computed when it is shown.
4. Journeys: the main tasks on the screens, starting from the first visit with
   no data.
5. Screens: per screen, its regions and controls; how things are added, changed
   and removed; the empty, loading and error states; how it fits a full window,
   a panel and a card. Name the kit parts you use.
6. Operations and commands, kept apart (see "Operations and commands").
   - Operations: from the model and the screens: name, title, effect, and in
     the code the input, output and rules.
   - Commands: what an agent or another app will ask: name, effect, input,
     output, rules, public or not.
   - Shared skills: the skills the app gives to other agents (see "Sharing
     with other agents"): name, who it is for, the commands it calls.
7. Failure branches: refusals, failed outside calls, silent fallbacks. Name each
   cause differently and call `reportProblem` with it in the code.

## Operations and commands

An app has two layers. Give each action to the right one.

- An operation is what the app's own screens and code need: low-level
  actions that follow from the model and the screens, such as "list all
  sessions", "save this row", "load the page for this filter". Lophn knows only
  its name, title and effect. The screens call it with `OperationButton` or
  `lophnApp.callOperation`. Agents, other apps, jobs and workflows cannot call
  it. Its result may be large, so a screen can show 500 rows at once.
- A command is a meaningful unit that an agent or another app will ask for, and
  its result is small. Pick commands from the questions people ask, not from the
  screens. A command wraps a function of the app's domain code, which the
  operations use as well. Give it a `description` that says when to
  use it, and an `inputSchema`. A command that an agent can call should hold
  a promise you want to keep, so declare few of them.
- Example, an app that shows token use of coding harnesses: "all sessions" is an
  operation (a table, program work). "Token use of one session, given the
  harness and the session id" and "cache hit rate of a period" are commands.
- Other agents and coding agents see a public command as
  `lophn <app> <command> --flag`, one flag per input field, and its
  `description` is the `--help` text. Write the `description` as when to use
  it, so a reader who knows nothing else about the app picks the right command.
- Both layers go through lophn, so a write of either is recorded and can be
  rewound. Names are shared: one name is one handler.

## Sharing with other agents

When you create or change a feature, ask: is this useful to other agents, and
to which? A coding agent that could read the person's usage numbers, or an
agent that files the person's receipts, are examples. If it is:

1. Make the commands it needs public, and keep them few.
2. Write `.lophn/skills/<name>/SKILL.md`: when to use the skill, which commands
   it calls with `lophn <app> <command>`, and how to read their results.
   The description says only what the skill does. Commit the folder; release
   prepare fails when it is missing from the commit.
3. Declare it in `lophn.ts` `skills: [{name, public: true, commands}]`.
   `commands` are the public commands of this app that the skill calls.
4. Write it under "Shared skills" in DESIGN.md.
5. After the release is active, run `lophn app share --agent <name>...
   [--coding-agents] --reason <text>` for the agents that should get it. It only
   opens a request; the person approves it in the waiting list, and only then
   are the app assigned and the skill given. Tell the person it is waiting.

A change that removes a public skill or a command it calls shows in
`removed_public_skills` or `removed_public_tools` at release prepare. Keep the
skill and its commands in step.

## Find what exists

Look before you design, and write what you found under Reuse.

- `lophn package read` lists the installed SDK packages and the packages other
  apps published. `lophn package read` with a name gives a package's guide.
- The guide of `@lophn/ui` is the screen kit: its parts by category, a line on
  when to use each, and their props. Read it before you write Screens.
- `lophn app tools` lists other apps' commands. Declare the ones you use in
  `app_connections`.

Build screens from the kit. Write a part of your own only when nothing in the
kit does the job, and style it with the token variables.

## Screens without clutter

- Start from how well-known apps of the same kind lay out the same screen.
- lophn already shows the app's name: in the app bar of the app window, and as
  the tab title when a screen is opened as a panel. Do not repeat it.
- One header row per screen. What changes the whole view, such as the period,
  the view mode or the main action, goes in that row. Do not stack bars.
- A screen opened as a lophn tab already has lophn's head row above it. Put the
  screen's view tabs, status and main action in that row with `useTabHead` from
  `@lophn/app-ui`, and draw them yourself only where it returns false.
- Show what the journeys need. No heading that restates another, no text that
  explains the screen, no decoration.
- The same thing sits in the same place on every screen.
- Spacing, type size and color come from the token variables. Do not invent
  values.
- A panel or a card shows less, not the same screen squeezed.

## Where screens open

Each screen declares `sizes`. They decide where people can open it:

- `full`: the app window, with the app's own navigation.
- `panel`: a tab in a project window, next to the person's work. People pick
  "App · Screen" from a list (the screen's `label` is the second half), and can
  pin it to the project's activity bar to open it with one click, docked in a
  pane or floating.
- `card`: inside an agent conversation, when an agent shows the screen.

Panels are where an app is used most often, so design them on purpose:

- When one task is worth keeping beside the work (look up one session, add one
  entry, watch one number), make it its own screen with `sizes: ["panel"]` or
  `["panel", "full"]` instead of asking people to open the whole app. Give it a
  task-like `label` such as "Session lookup"; that label is what people pick
  and pin.
- Leave `panel` out of screens that only work wide, such as a dashboard with
  many columns. People then see that it opens only in the app window.
- A panel tab can be narrow or as wide as a pane. Lay out by
  `useContainerSpace()` from `@lophn/ui/layout` (`card` under 320px, `panel`
  under 640px, `full` above), not by the window size.
- A panel reloads when it is moved to another window. Keep its last input
  (the picked item, the typed id, the filter) in `localStorage` so it comes
  back as it was.
- An app may declare `icon` (an image in the source, see the `@lophn/declaration`
  guide). lophn shows it on tabs, the activity bar and app lists. A person can
  also upload one in App details; theirs wins.

## Talking to an agent from a screen

When a screen needs an agent to do something (review what the person wrote,
explain a result, fill a form), use `@lophn/agent`. Do not build your own
transport, and do not add an operation or command only to reach an agent.

- `useAgentSession({agent})` opens a session in this app's place and gives its
  ACP state. The session also shows in lophn's sidebar and chat tab, so the
  person can follow it there. Approvals are decided there too.
- Send what the screen shows with `contextBlock({name, mimeType, text})`, one
  block per piece (the code, the picked item, the filter).
- When the screen needs a value back, pass `{reply: schema}` to `send` and wait
  on `reply`. The schema uses `type`, `properties`, `required`, `items` and
  `enum` only. An answer that does not fit the schema arrives as an error, never
  as a value, so show a "try again" state for it.
- Read the `@lophn/agent` guide (`lophn package read @lophn/agent`) for the
  coding-coach example, then declare the package in `lophn.ts` and
  `package.json`.
