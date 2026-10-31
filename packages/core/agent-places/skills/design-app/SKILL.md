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
6. Tools: from the model and the screens: name, effect, input, output, rules.
7. Failure branches: refusals, failed outside calls, silent fallbacks. Name each
   cause differently and call `reportProblem` with it in the code.

## Find what exists

Look before you design, and write what you found under Reuse.

- `package.read` lists the installed SDK packages and the packages other apps
  published. `package.read` with a name gives a package's guide.
- The guide of `@lophn/ui` is the screen kit: its parts by category, a line on
  when to use each, and their props. Read it before you write Screens.
- `app.tools` lists other apps' tools. Declare the ones you use in
  `app_connections`.

Build screens from the kit. Write a part of your own only when nothing in the
kit does the job, and style it with the token variables.

## Screens without clutter

- Start from how well-known apps of the same kind lay out the same screen.
- lophn already shows the app's name: in the app bar of the app window, and as
  the tab title when a screen is opened as a panel. Do not repeat it.
- One header row per screen. What changes the whole view, such as the period,
  the view mode or the main action, goes in that row. Do not stack bars.
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
