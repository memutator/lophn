---
name: design-app
description: Design an app or a change before you build it. Read this skill and write DESIGN.md as it says.
---

# Design an app

Write the design before the code. A new app or feature gets its design in
`DESIGN.md` at the root of the app's source folder. For a change, first edit the
sections that change, then the code.

## Who does what

Give each part of the app to the one that does it best, and write the choice in
DESIGN.md.

- The program (the app's code) does what can be computed: checks, totals,
  sorting, rules that always hold. Do not give an agent work that code can do
  the same way every time.
- An agent does what needs meaning: reading free text, judging, explaining,
  drafting.
- The person decides what they want and knows what they changed. When a thing
  only changes because the person changed it (they replaced a file, edited a
  list), do the follow-up work when they ask. Do not build watchers, hashes or
  scheduled checks to notice it.
- Build for this person only. Do not add settings, options, extension points
  or general models they did not ask for; add them when a real need comes.

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
5. Run `lophn app share --agent <handle>... [--coding-agents] --reason <text>`
   for the agents that should get it, before or after `release activate`. It only
   opens a request; nothing is given until the person approves. If the
   activation is waiting for consent, the request is shown on that consent and
   approved with it, so do not ask the person to approve sharing separately.
   Otherwise it waits in the waiting list; tell the person.

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
- Do not draw a header row of your own (title bar, refresh button row).
  lophn draws a head row wherever it frames a screen: tab, panel (dock, float),
  sidebar, tray and chat card. Put the screen's view tabs, status and main
  action in it with `useTabHead` from `@lophn/app-ui`, and draw the minimum
  yourself only where it returns false (the dedicated app window).
- Show what the journeys need. No heading that restates another, no text that
  explains the screen, no decoration.
- The same thing sits in the same place on every screen.
- A hover hint is `Tooltip` from `@lophn/ui/overlay`. Never the HTML `title`
  attribute: the browser draws its own tooltip, and release prepare rejects it
  (`<iframe title>` is the one exception).
- Spacing, type size and color come from the token variables. Do not invent
  values.
- A panel or a card shows less, not the same screen squeezed.

## Where screens open

Each screen declares `places`. They decide where people can open it:

- `tab`: the app workspace and the app window, with the app's own navigation.
  The first `tab` screen is the entry of the app.
- `panel`: a tab in a project window (docked in a pane or floating) and the
  global float, next to the person's work. People pick "App · Screen" from a
  list (the screen's `label` is the second half), and can pin it to the
  project's activity bar to open it with one click.
- `card`: inside an agent conversation, when an agent shows the screen.
- `sidebar`: the right sidebar. Shown there as soon as the app declares it; the
  person can turn it off in Settings.
- `tray`: the taskbar tray popup. Shown as soon as the app declares it; the
  person can turn it off in Settings. A `tray` screen is a glanceable status,
  so keep the screen itself compact. lophn's popup head shows only the
  `useTabHead` actions, as icon buttons (no status, crumbs, tabs or menu): give
  the one or two actions that matter at a glance, such as refresh, an `icon`
  and put them first. The popup is 360 x 480 px by default. Set its size on
  the screen with `tray: { width, height }` in px (width 240-720, height
  160-720, either may be left out). Each side is a number (fixed) or
  `{ min?, max? }`, which fits the screen's content inside that range. Prefer
  a range for content that grows, such as a list: `height: { max: 480 }`
  keeps a short list short. For the height to fit, do not give html, body or
  the root element `height: 100%`. lophn shrinks the popup to fit a small
  window.
- `phone`: the lophn phone app. It stands alone: a screen with `phone` has no
  other place. It is written in React Native, not as a desktop screen; see
  "Phone screens".

`params` is the schema of the input a screen receives (root type object; none
means the screen takes no input). To use a part of one screen on its own, make
it its own screen instead of splitting by `params`.

Panels are where an app is used most often, so design them on purpose:

- When one task is worth keeping beside the work (look up one session, add one
  entry, watch one number), make it its own screen with `places: ["panel"]` or
  `["panel", "tab"]` instead of asking people to open the whole app. Give it a
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
- An app may declare `icon`: a lucide icon name such as `"lucide:folder-kanban"`
  (pick one that fits the app; no file needed, and it follows the theme color),
  or an image in the source such as `"/assets/icon.svg"` (see the
  `@lophn/declaration` guide). Prefer the lucide name; do not hand-write an SVG
  for a plain glyph. lophn shows it on tabs, the activity bar and app lists. A
  person can also upload one in App details; theirs wins.

## Phone screens

A phone screen is a screen of the lophn phone app, written in React Native
with the phone kit `@lophn/ui-native`. Make one only when the person asks to
use the app on their phone. One app has desktop screens and phone screens
together. They are different files (`src/screens/<key>/phone.tsx` and
`main.tsx`) and share the operations and the data. Do not make one screen
responsive for both.

1. Read the person's reference phone: `lophn app phone-target` gives `device`
   (name, OS, `width` and `height` in CSS px, `dpr`). `width` and `height` are
   the whole phone screen; lophn's top line takes part of the height. If
   `device` is null, tell the person to pair their phone and stop; do not draw
   for a guessed size. Draw for that width and build no responsive layout. When
   the person pairs another phone it becomes the reference: draw again the
   screens you drew for the old size.
2. Declare the screen in `lophn.ts`, alone in `places`:
   `{ key: "orders", label: "Orders", path: "/screens/orders/index.html",
   places: ["phone"] }`. The source is `src/screens/orders/phone.tsx`, which
   default-exports the component. Do not put `main.tsx` or `index.html` in that
   folder: a screen folder has one or the other, and release prepare builds the
   phone screen itself (`npm run build` skips it). A desktop twin is a second
   screen with another key.
3. Add the packages after reading the guides of `@lophn/ui-native` and
   `@lophn/app-ui-native` (`lophn package read <name>`). Put both in
   `package.json` `devDependencies` (`file:.lophn/sdk/<name>/<version>`) and in
   `lophn.ts` `sdk_dependencies`, with the same exact version. Put the kit's
   peers (`react-native`, `react-native-svg`, `react-native-safe-area-context`,
   `react-native-keyboard-controller`, `expo-clipboard`, `lucide-react-native`)
   and `react-native-web` in `devDependencies` too, at the versions the
   `@lophn/ui-native` guide lists; skip one the app already has. Then run
   `npm install`. Never use `dependencies` for them: the phone app already
   carries the kit, so release prepare drops `devDependencies` from the bundle
   and refuses a kit that sits in `dependencies`.
4. Write the screen by the rules below, then run `npm run check`, which type
   checks it.
5. Check it as described after the rules.

Rules:

- The root is `Screen`, with no `top`: lophn draws the head row (the app's
  name and menu), so draw no `TopBar` or title row. View tabs go at the top of
  the body, the main action in `footer`.
- `Sheet`, `Menu` and `Drawer` open inside the screen. Do not use React Native's
  `Modal`: it covers lophn and the phone tab cannot read it.
- A touch target is 44 or more (`Row`, `IconButton`, `Button` already are;
  `size="lg"` is 54, for the main action). Give your own `Pressable`
  `minHeight: 44`. Nothing depends on hover.
- Text sits in `Text` (its `variant` and `tone`; no `fontSize`: the person's
  text scale applies). Colors come from `useTheme()`, fonts from the kit.
- Native modules come only from this list, imported by package name (no
  sub-path like `react-native/...`): `react`, `react/jsx-runtime`,
  `react-native`, `react-native-svg`, `react-native-safe-area-context`,
  `lucide-react-native`, `@lophn/ui-native`, `@lophn/app-ui-native`. Plain JS
  packages of the app are bundled in. `@lophn/ui`, `@lophn/app-ui`, `react-dom`,
  other `react-native-*` and `expo-*` packages and Node built-ins make release
  prepare fail with a `file:line:column: reason` line that says what to use
  instead.
- There is no network: no `fetch`, no WebSocket. Data comes only through
  operations (`useOperation`, `OperationButton`) and events (`useEvent`), and
  the declaration must list them. Images are the kit's `Icon`, `data:` URIs
  and app files (`useAppFile`). Phone features and files:
  `phone-features.md`.

An example, `src/screens/orders/phone.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Group, Row, Screen } from "@lophn/ui-native";
import { OperationButton, useOperation } from "@lophn/app-ui-native";

const list = { name: "list-orders", title: "List orders" };
const archive = { name: "archive-shipped", title: "Archive shipped" };

export default function Orders() {
  const [orders, setOrders] = useState<{ id: string; status: string }[]>([]);
  const load = useOperation(list);
  const reload = async () => {
    const result = await load.run({});
    if (result?.ok) setOrders(result.value as typeof orders);
  };
  useEffect(() => void reload(), []);
  const main = <OperationButton operation={archive} size="lg" onDone={() => void reload()} />;
  return (
    <Screen scroll tone="floor" footer={main}>
      <Group>{orders.map((o) => <Row key={o.id} title={`Order ${o.id}`} sub={o.status} />)}</Group>
    </Screen>
  );
}
```

Check it on the desktop:

1. Commit, run `lophn release prepare`, then `lophn preview start`. The tab
   that opens by itself is the first `tab` screen, so a phone-only app gets
   none; the preview still runs.
2. `lophn tab open --preview <app> --screen <key>` opens the screen in a frame
   of the reference phone's size. With no registered phone it is `conflict`:
   pair a phone, or pass `--device <name>`.
3. Look and press with `lophn browser snapshot|screenshot|act <tab>`. Run an
   operation with `lophn preview call`.

The preview draws with react-native-web, so the phone can differ: text input,
the soft keyboard, scrolling, fonts, the safe area. When you report, say what
you saw on the desktop, on the phone, and what you could not check. If the
phone app is older than the kit the screen was built with, the phone shows
"update the lophn app"; tell the person.

First read the bundled `phone-check.md` to check those on the person's
phone (`lophn tab open --phone`); `phone-features.md` for home screen widgets
and phone features (`phone.use`); `phone-apps.md` when the app's backend and
data also run on the phone (`runs_on`); `folder-sync.md` when its data must
reach the person's other computers (`sync`, `"computers"` first; changes
from there arrive as `data.changed`). Use
`skill.read({ name: "design-app", path: "<file>" })`.

## Talking to an agent from a screen

When a screen needs an agent to do something (review what the person wrote,
explain a result, fill a form), use `@lophn/agent`. Do not build your own
transport, and do not add an operation or command only to reach an agent.

- `useAgentSession({agent: "<handle>", title})` gives the ACP state of a session
  in this app's workspace. `agent` is the handle of an agent you create first
  (see "An agent inside the app"), not an id. The session opens on the first
  `send`, not when the screen opens, so `session` and `state` are `null` until
  then; do not send just to warm it up. The session also shows in lophn's
  sidebar and chat tab, so the person can follow it there. Approvals are decided
  there too.
- Send what the screen shows with `contextBlock({name, mimeType, text})`, one
  block per piece (the code, the picked item, the filter).
- When the screen needs a value back, pass `{reply: schema}` to `send` and wait
  on `reply`. The schema uses `type`, `properties`, `required`, `items` and
  `enum` only. An answer that does not fit the schema arrives as an error, never
  as a value, so show a "try again" state for it.
- Read the `@lophn/agent` guide (`lophn package read @lophn/agent`) for the
  coding-coach example. Apps made from the current template already declare the
  package. An app made before needs it added to both `lophn.ts` and
  `package.json`, with the same exact version.

## An agent inside the app

Use this when the app needs an agent of its own: an opponent in a game, a
coach, a reviewer, a helper that is asked one thing at a time. The person does
not know how agents or the SDK work; you decide all of it and never ask them
about it.

1. Create the agent before the screen, in this app's workspace, with
   `lophn agent create <handle>`. It is scoped to this app automatically and
   shows only here. The handle is short, lowercase and fixed for good, such as
   `omok-opponent`. Do not use the built-in `lophn` agent for this: it carries
   the whole product's rules and tools on every turn, which is slow and costly
   and lets it touch files and the shell.
2. Make it custom (`runtime: custom`) with `tools: []` and text modality. A custom
   agent gets only the instructions you write and the `lophn` tool (see step 3);
   it has no file, shell or web tools unless you pick them. Write the
   instructions as a role, not a chat: who it is, what the app sends it (name
   each context block), the exact reply shape (the JSON fields and their
   meaning), and that it answers directly without calling any `lophn` command
   unless step 3 applies. Add a one-line `description`.
3. Prefer "the app assembles the context, the agent answers JSON". The screen
   sends the board, the draft or the history as context blocks and asks for a
   reply schema. A custom agent always has the `lophn` tool with every lophn
   command of this app's workspace and this app's own commands (it may call
   them without anyone assigning them). `tools` cannot name commands: it takes
   only built-in tool names, `mcp__<server>__<tool>` and `ext__<id>__<tool>`.
   When the agent must act on app data, say in the instructions when to call
   which command.
4. `model` takes a provider and model pair. Set it only when you know one that
   suits the call frequency (a small fast model for a move per click, a stronger
   one for a review). If you do not know, leave it unset: the person's default
   model is used. Say in the handoff that the calls are frequent.
5. In the screen: one session per unit of work (a game, a review, an attempt).
   Pass `title` (such as "Game 3", not left to the first prompt). Store the
   session id from the hook in the app's data, and pass it as `session` after a
   reload so the same unit continues. For the next unit call `reset()` and give
   the new `title`.
6. The app draws the result. A session the app opened sends no turn-end
   notification to the person, and the page stays alive while it waits for the
   turn even if the person goes to another workspace; you do nothing for either.
   An approval or a question still reaches the person.
7. Check what comes back in app code (a legal move, a field in range). When it
   is wrong, send again with the reason in the message; give up after a few
   tries and show the state to the person.

You cannot see the screen when you test in preview. Keep the logic that talks to
the agent in plain functions (build the context, parse and check the reply,
choose what to do on a bad reply) and test those; keep the component thin.


## Watching agent sessions and their processes

Use this when the app reacts to the agent sessions lophn runs: stop Claude Code
when a usage limit is near, kill a runaway process before it exhausts memory. lophn
gives you only what lophn alone knows: which sessions exist and their state
(`sessions.list`, the `session.*` events, `sessions.stop`; read the
`@lophn/agent` guide, section "session lifecycle"). Everything about processes you do
yourself. lophn gives no process list, no git information and no process kill.

- A session you may see has `cwd`, `folders` and, for a coding agent in a terminal
  tab, `terminal.shell_pid` (the PTY shell, not the CLI itself).
- Join a process to its session by the environment first. These all have
  `LOPHN_SESSION_ID=<session id>`: a command a lophn agent runs with `shell.run`,
  a headless harness CLI (Claude Code, Codex, OpenCode) with every process it
  starts, and, in a terminal tab, the tab's shell with everything started in it
  (the value is the row's `session`, `term:<tab>`). The CLI that `claude gui` or
  `codex gui` starts for a tab carries the same tag, but it is a child of lophn's
  shell process, not of the tab's shell, so `shell_pid` cannot find it. An agent
  that clears the environment before it starts a process hides it from the tag.
- Use `terminal.shell_pid` as the fallback: for a tab opened before the tag
  existed, or a process that dropped the variable, start from `shell_pid` and walk
  the children.

Linux only (`/proc`); on macOS and Windows use `ps` or the platform's tools and
expect only the shell pid to be reliable. Keep it small and run it from the app
process (a handler), never from a screen.

```ts
import { readdirSync, readFileSync } from "node:fs";

// pid -> parent pid for every process.
function parents(): Map<number, number> {
  const out = new Map<number, number>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      // "pid (comm) S ppid ..." — comm may contain spaces, so split after the last ")".
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      out.set(Number(name), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
    } catch {
      // the process ended meanwhile
    }
  }
  return out;
}

// every descendant of root, deepest first (kill children before parents).
export function treeOf(root: number): number[] {
  const parent = parents();
  const found: number[] = [];
  const walk = (pid: number) => {
    for (const [child, p] of parent) if (p === pid) walk(child);
    found.push(pid);
  };
  walk(root);
  return found;
}

// pids whose environment has LOPHN_SESSION_ID=<session>: core sessions (ses_...) and terminal tabs (term:...).
export function processesOf(session: string): number[] {
  const want = `LOPHN_SESSION_ID=${session}`;
  return [...parents().keys()].filter((pid) => {
    try {
      return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(want);
    } catch {
      return false; // not yours, or gone
    }
  });
}

export function kill(pids: number[], signal: NodeJS.Signals = "SIGTERM"): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}
```

Ending the turn is `sessions.stop`; killing a process is yours, and a stopped
turn leaves no harm the person cannot see: lophn records that an app stopped it.
