---
name: write-artifact
description: "Write an artifact: a static HTML page in the artifacts folder of a project or app that shows the person a result on screen. Where it goes, its folder and data, the sealed view, building it with lophn's kit, the tab head and theme tokens."
---

# Artifact

An artifact is a static page you write so the person can see a result on screen
instead of reading it in the chat. It is a folder with an `index.html`. There is
no artifact tool: you make one by writing files.

## What a page shows

Write it for the person as a report to a manager, not as a dump of what you
read. You decide what it shows and how; do not ask them to choose a layout.

- Lead with what they need to judge or act on: the outcome, what changed, what
  needs their decision. Put it in their domain's words.
- Sum up. Show the few numbers and items that matter, not every row you
  fetched. Detail goes below or behind a click, and only when someone would
  look at it.
- Leave out the machinery: logs, IDs, command names, file paths, versions,
  JSON. They belong in your answers when the person asks.

## Where it goes

An artifact belongs to the project or app you work in. Its place is the
`artifacts/<name>/` folder of that project or app in lophn's data. Write
`<Folder>/<name>/index.html` with `file.write`. `<Folder>` is the absolute
`artifacts` folder, given in the Artifacts section of your workspace information. Always use that absolute path: a relative
`artifacts/...` path lands in the person's project folder, which is wrong.
`<name>` is a lowercase slug (`spending`, `weekly-report`) used only in paths;
the person sees the page's title (see "Title and description"). Once an `index.html`
exists at that spot, it is an artifact. Tell the person its path in your answer;
the path becomes a link that opens it. The same name in two workspaces is two
artifacts.

## Who writes

An agent working in a project or app writes the artifacts of that project or
app. At home an agent writes no files.

## Folder shape

```
<Folder>/spending/
├── index.html      the entry and the template
├── chart.js        any file in the same folder, read by relative path
└── data/
    ├── 2026-01.json
    └── 2026-02.json
```

- `index.html` is required. Other files (`chart.js`, `style.css`, images) sit
  next to it and are loaded by relative path. A relative link to another HTML
  file in the folder works.
- `data/*.json` is the material the template reads. You usually build it by
  running a command and writing the result into `data/`.

## How the data is held

Three ways, chosen by how the template reads `data/`.

- **One-off:** put the data inside `index.html`.
- **Swap:** keep the template and rewrite only `data/latest.json`.
- **Series:** keep adding files to `data/`, and let the template read
  `data/_entries.json`.

`data/_entries.json` is a virtual file the view makes. Do not write it to disk.
It is a JSON array of `{ "name", "size", "modified" }`, sorted by name, files
directly in `data/` only (no subfolders). `modified` is an ISO time.

```js
const entries = await (await fetch("data/_entries.json")).json();
const months = await Promise.all(
  entries.map((e) => fetch(`data/${e.name}`).then((r) => r.json())),
);
```

## Keeping it current

The page cannot fetch anything new by itself. It shows what is in `data/` until
someone writes there again. Opening the tab does not refresh it. Before you
write the page, decide how its data gets old and pick one of these. Write the
choice in your answer to the person, in one sentence.

1. **Snapshot.** The answer to one question at one moment: a review, a
   comparison, a plan. Write the data once. No refresh.
2. **Refresh on request.** The data comes from something that keeps changing
   (a repository, a folder, an app's records), and the person looks at it now
   and then. This is the default for changing data.
   - Put the collecting step in the folder as a script (`collect.py`,
     `collect.mjs`) that writes `data/`. Refreshing is then running that one
     script again, the same way every time, not redoing the work by hand.
   - Record when the data was collected in the data, and show it in the tab
     head `status` (for example "As of Nov 6, 14:00"), so the person sees how
     old it is.
   - Tell the person: "Ask me to refresh it." When they do, run the script.
3. **Scheduled.** The person expects it current whenever they look, at a known
   rhythm: every morning, every Monday.
   - Do everything in 2, then propose a job with `lophn job create` (see
     `--help`) that asks an agent in this project to run the script. Give the
     script's absolute path in the job's message. The person approves the job
     once before it runs.
   - Every run is a model call. Match the rhythm to how often the person looks;
     not more often than daily unless they ask.
   - When the history matters (trends, "since last week"), write each run as a
     new file in `data/` (series) instead of overwriting.
4. **Live.** It must be current at the moment it is opened, refresh in seconds,
   or let the person change things. That is an app, not an artifact. Tell the
   person, and suggest building it as an app in that app's conversation.

Do not let the page look fresher than it is: no "today", "now" or clock time
computed in the page for data that was collected earlier.

## Title and description

Always write `<title>` and `<meta name="description" content="...">` in
`index.html`. The title is what the person sees: the tab name, the head row and
the Artifacts list. Without a `<title>` the folder name is used. The folder
name is for paths; the title is for the person.

- Write the title as the person would name the page, in the language they
  speak to you: what it shows, in a few words ("Git 활동", "이번 달 지출",
  "Project docs status").
- Not a slug, ID, file name or path (`lophn project-docs`, `git-activity`,
  `report_v2`), not code-style casing, not a date stamp unless the date is the
  point.
- Do not start with the project or app name; lophn already shows where the
  artifact lives.
- The description is one sentence on what the person learns from the page, in
  the same language.

## The view is sealed

- There is no network. `fetch` reaches only files in the artifact's own folder;
  any outside server is blocked.
- No external library and no CDN. The one library is lophn's kit (below). Other
  scripts and styles are inline or files in the same folder. Do not copy a
  bundle, a framework or fonts into the folder.
- One file can be at most 4 MiB.
- Files outside the folder, other artifacts and the person's documents cannot be
  read.
- The page cannot run commands or read app data. It shows what is already in
  the folder. Its only link to lophn is the tab head (below).

## Build the page with the kit

The page is built from the same kit as lophn's own screens and apps, so it looks
like lophn. `/_lophn/kit.js` gives the whole kit (`@lophn/ui`) and React as one
global, `LophnKit`. Load it with a plain `<script>` (not a module) and its
stylesheet:

```html
<link rel="stylesheet" href="/_lophn/kit.css">
<script src="/_lophn/kit.js"></script>
```

- `LophnKit.ui.<category>.<Part>` is the kit. The categories are `primitives`,
  `input`, `layout`, `navigation`, `data`, `feedback`, `overlay` and `reading`,
  the same as `@lophn/ui/<category>` in an app. Run `lophn package read
  @lophn/ui` once before you write the page: it lists every part, when to use
  it, and its props. Give every required prop: a missing one breaks the whole
  page, and `lophn browser logs` shows the error.
- There is no build step, so there is no JSX. Write `h(Part, props, ...children)`
  with `LophnKit.h` (React's `createElement`). `LophnKit.React` is React, and
  the common hooks are on `LophnKit` too (`useState`, `useEffect`, `useMemo`,
  `useRef`, `useCallback`).
- `LophnKit.render(element, node)` draws into an element; calling it again
  updates it.
- `LophnKit.icons.<Name>` is a lucide icon (PascalCase, such as `Folder`), for
  the `icon` props of the kit.
- Write a part of your own only when nothing in the kit does the job, and style
  it with the token variables (below).

```html
<div id="root"></div>
<script>
  const { h, render, useState, useTabHead, ui } = LophnKit;
  const { StatTile } = ui.data;
  const { Tabs, TabList, Tab } = ui.navigation;
  const VIEWS = [{ id: "summary", label: "Summary" }, { id: "months", label: "Months" }];

  function Page({ months }) {
    const [view, setView] = useState("summary");
    const inHead = useTabHead({ tabs: { items: VIEWS, selected: view } }, { onTab: setView });
    return h("main", { className: "page" },
      inHead ? null : h(Tabs, { value: view, onValueChange: setView },
        h(TabList, null, VIEWS.map((v) => h(Tab, { key: v.id, value: v.id, size: "sm" }, v.label)))),
      view === "summary"
        ? h("div", { className: "tiles" }, months.map((m) =>
            h(StatTile, { key: m.name, label: m.name, value: m.total, unit: "KRW" })))
        : h("ul", null, months.map((m) => h("li", { key: m.name }, m.name))));
  }
  fetch("data/latest.json").then((r) => r.json())
    .then((d) => render(document.getElementById("root"), h(Page, d)));
</script>
```

## The tab head

lophn draws a head row above the page: its title (from `<title>`), [Edit
source] and the ⋯ menu. Do not draw your own header, title bar or tab row. Put
the page's view tabs, a short status and its main actions in lophn's head with
`LophnKit.useTabHead(head, handlers)`, the same hook as `useTabHead` in an app:

- `head` is `{ crumbs?, status?, tabs?: { items, selected }, actions?, menu? }`.
  An item is `{ id, label, disabled? }`; an action may add `primary`, `busy`
  and an `icon` (`refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`,
  `stop`, `download`). lophn draws them; `handlers` (`onTab`, `onAction`,
  `onMenu`) get the id when the person presses one.
- It returns `true` when lophn draws the head. It returns `false` when the tab
  floats outside a card or the file is opened outside lophn; only then draw the
  same tabs yourself, small, with `ui.navigation.Tabs`.
- Keep the page's state in React. The head is only text and ids.

## Screens without clutter

- lophn already shows the title. Do not repeat it in the page, and do not add a
  subtitle that restates it.
- Show what the person needs to judge or act on. No text that explains the
  page, no decoration.
- Lay out by the width you get, not by a fixed `max-width`; a tab can be narrow
  or a whole window.
- A hover hint is `ui.overlay.Tooltip`, never the HTML `title` attribute.
- Spacing, type size, corners and color come from the token variables. Do not
  write `px` values or colors of your own.
- Do not style scrollbars. lophn draws them like its own screens.

## Appearance

Use lophn's tokens as CSS variables. The page already has them, so it follows
the person's theme (light or dark, and their appearance settings) without any
setup. Kit parts already use them. Do not hard-code colors as hex; a hard-coded
color stays the same in dark mode and looks wrong.

| Variable                                                                | Use                                      |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| `--color-surface-base`                                                  | page background (same as lophn's tabs)   |
| `--color-surface-subtle`                                                | cards, panels, table stripes             |
| `--color-border-base`                                                   | borders and rules                        |
| `--color-text-primary`                                                  | main text                                |
| `--color-text-secondary`                                                | secondary text                           |
| `--color-text-muted`                                                    | captions and axis labels                 |
| `--color-link`                                                          | links                                    |
| `--status-good-text`, `--status-warning-text`, `--status-critical-text` | status text; `-marker` for dots and bars |
| `--chart-series-0` to `--chart-series-7`                                | chart series colors, in order            |
| `--font-sans`, `--font-mono`                                            | fonts                                    |
| `--type-body-size`, `--type-title-size`                                 | text sizes (also `--type-*-line`)        |
| `--space-*`, `--radius-sm`, `--radius-md`                               | spacing and corners                      |

Example:

```css
body {
  background: var(--color-surface-base);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}
```

## Drawing nodes

For a node diagram, call `LophnKit.renderGraph(element, { nodes, edges })` (or
`ui.data.GraphDiagram` inside your React tree). Calling it again on the same
element updates it. The element must be a block with a width that is
  not 0 (not hidden, not `display: inline`).
- A node is `{ id, label, status?: { label, tone }, note? }`. `tone` must be one
  of `good`, `warning`, `serious`, `critical`, `neutral`. `note` is a short
  text. An edge is `{ from, to, label? }`.
- If the data breaks a rule, the whole diagram is drawn as unreadable (error),
  not just the bad part. The rules: every `id` is non-empty and unique; the
  `from` and `to` of every edge are ids of existing nodes; an edge from a node
  to itself is not allowed (leave it out); `tone` is one of the five values. A
  cycle (A to B and back to A) is fine.
- What a status value means is yours to decide (for example `running` for the
  current step and `reported` when a report exists).

## Check it on screen

Look at the page before you tell the person it is done, the way an app is
checked in its preview.

1. `lophn tab open --artifact <name>` opens it as a tab next to yours and
   returns its `tab` id. It is `not_found` until `<Folder>/<name>/index.html`
   exists. Opening it again returns the same tab.
2. `lophn browser screenshot <tab>` shows what the person sees.
   `lophn browser logs <tab>` gives console errors (a script that failed, a
   `fetch` of a missing `data/` file). `lophn browser snapshot <tab>` reads the
   page as an accessibility tree with refs.
3. Use the refs with `lophn browser act <tab>` (click, fill, select, scroll) to
   try filters, tabs and buttons the page has, and `lophn browser evaluate <tab>`
   to read a value from the page.
4. Fix the files and look again. The tab reloads by itself when a file changes;
   use `lophn browser wait <tab> --text <text>` if you need it settled.

Leave the tab open for the person. While you drive it the tab shows
[Take control]; if the person takes it, `act` and `evaluate` are `conflict` and
you can still look. The page cannot navigate: `browser navigate` is for browser
tabs.

If a `lophn tab` or `lophn browser` command fails, do not start another browser
(Chrome, Playwright, browser-use or any other) and do not read the person's
browser profile or cookies. Tell the person the reason the error gave you.

## Changes show at once

When you change a file in the folder, a tab that has it open reloads. There are
no versions: to keep earlier data, add files to `data/` instead of overwriting.
To go back, the person uses rewind.

## When the person sends annotations

The person can mark the screen and send notes. They go to the last open session
that wrote to that artifact's folder, as a message. If there is none (those
sessions are closed or have no record), lophn at the project or app that holds
the artifact gets them. Open the screenshot with `image.read`.

## What you do not do

- Do not make a page that runs commands or reads live app data. A screen like that
  is an app, which is built in a conversation at that app.
