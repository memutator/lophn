---
name: design-app
description: Design an app or a change before you build it. Write DESIGN.md (Purpose, Reuse, Model, Journeys, Screens, Tools, Failure branches), find what lophn and other apps already give, and lay out screens without clutter.
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
- lophn already shows the app's name and state above your screen. Do not repeat
  them.
- One header row per screen. What changes the whole view, such as the period,
  the view mode or the main action, goes in that row. Do not stack bars.
- Show what the journeys need. No heading that restates another, no text that
  explains the screen, no decoration.
- The same thing sits in the same place on every screen.
- Spacing, type size and color come from the token variables. Do not invent
  values.
- A panel or a card shows less, not the same screen squeezed.
