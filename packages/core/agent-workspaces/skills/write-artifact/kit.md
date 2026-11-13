# Building an artifact

How to build the page that `SKILL.md` describes: where it goes, how its data is
held, the sealed view, lophn's kit, the tab head, the theme tokens and the
screen-check commands.

## Where it goes

An artifact belongs to the project or app you work in. Its place is the
`artifacts/<name>/` folder of that project or app in lophn's data. Write
`<Folder>/<name>/index.html` with `file.write`. `<Folder>` is the absolute
`artifacts` folder, given in the Artifacts section of your workspace
information. Always use that absolute path: a relative `artifacts/...` path
lands in the person's project folder, which is wrong.

`<name>` is a lowercase slug (`spending`, `weekly-report`) used only in paths;
the person sees the page's `<title>`. Once an `index.html` exists at that spot,
it is an artifact. The same name in two workspaces is two artifacts.

An agent working in a project or app writes the artifacts of that project or
app. At home an agent writes no files.

## Folder shape

```
<Folder>/spending/
├── index.html      the entry and the template
├── collect.mjs     the collecting script, when the data refreshes
└── data/
    └── latest.json
```

- `index.html` is required. Other files (`page.js`, `page.css`, images) sit next
  to it and are loaded by relative path. A relative link to another HTML file in
  the folder works.
- `data/*.json` is the material the template reads. You usually build it by
  running a command and writing the result into `data/`.

## How the data is held

Three ways, chosen by how the template reads `data/`.

- **One-off:** put the data inside `index.html`.
- **Swap:** keep the template and rewrite only `data/latest.json`. The templates
  read this.
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

## The kit

The page is built from the same kit as lophn's own screens and apps, so it looks
like lophn. `/_lophn/kit.js` gives the whole kit (`@lophn/ui`) and React as one
global, `LophnKit`. Load it with a plain `<script>` (not a module) and its
stylesheet. The templates already do.

```html
<link rel="stylesheet" href="/_lophn/kit.css">
<script src="/_lophn/kit.js"></script>
```

- `LophnKit.ui.<category>.<Part>` is the kit. The categories are `primitives`,
  `input`, `layout`, `navigation`, `data`, `feedback`, `overlay` and `reading`,
  the same as `@lophn/ui/<category>` in an app. The parts the templates use are
  below. For any other part, run `lophn package read @lophn/ui` once: it lists
  every part, when to use it, and its props.
- Give every required prop. A missing one breaks the whole page, and
  `lophn browser logs` shows the error.
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

### Parts the templates use

| Part                                     | Props                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `layout.DashboardFrame`                  | children. Page padding, a 12-column grid, one column under 640px.                                            |
| `layout.DashboardCell`                   | `span` (1–12), children                                                                                      |
| `layout.Card`                            | children. One independent object; never a card inside a card.                                                |
| `data.StatRow`                           | children: up to four `StatTile` per line                                                                     |
| `data.StatTile`                          | `label`, `value` (number), `unit?`, `change?` (number), `changeLabel?`, `locale?`                            |
| `data.BarChart`                          | `categories`, `series`, `xLabel`, `stacked?`, `locale?`, plus the chart state below                          |
| `data.LineChart`                         | `x` (array of `Date`), `series`, `xLabel`, `locale?`, `timeZone?`, plus the chart state below                |
| `data.GraphDiagram`                      | `nodes`, `edges`, plus the chart state below (or `LophnKit.renderGraph`, see "Drawing nodes")                |
| `feedback.StatusMark`                    | `tone` (`good`, `warning`, `serious`, `critical`, `neutral`), `label`                                        |
| `feedback.EmptyState`                    | `icon` (an icon from `LophnKit.icons`), `message`, `action: { label, onSelect }`                             |
| `input.FilterBar`                        | children, `dirty?`, `onReset?`                                                                               |
| `input.SearchFilter`                     | `value`, `onChange(text)`, `label?`                                                                          |
| `input.SelectFilter`                     | `allLabel`, `options: [{ value, label }]`, `value` (null is all), `onChange(value)`                           |
| `primitives.Button`                      | `onClick`, children, `size?` (`sm`, `md`, `lg`), `variant?` (`primary`, `secondary`, `ghost`)                |
| `overlay.Tooltip`                        | `content`, one child. Use it for hover hints, never the HTML `title` attribute.                              |
| `navigation.Tabs`, `TabList`, `Tab`      | only when the tab head is not shown (see "The tab head")                                                     |

A series is `{ key, label, values }`: `values` has one number (or `null`) per
category or point. Charts and the graph need the chart state props:

```js
const reload = () => location.reload();
const chartState = { onRetry: reload, empty: { message: "Nothing to show.", action: { label: "Reload", onSelect: reload } } };
h(BarChart, { ...chartState, locale: "ko", xLabel: "분류", categories, series });
```

## The tab head

lophn draws a head row above the page: its title (from `<title>`), [Edit
source] and the ⋯ menu. Do not draw your own header, title bar or tab row. Put
the page's views, a short status and its main actions in lophn's head with
`LophnKit.useTabHead(head, handlers)`, the same hook as `useTabHead` in an app:

- `head` is `{ crumbs?, status?, tabs?: { items, selected }, actions?, menu? }`.
  An item is `{ id, label, disabled? }`; an action may add `primary`, `busy`
  and an `icon` (`refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`,
  `stop`, `download`). lophn draws them; `handlers` (`onTab`, `onAction`,
  `onMenu`) get the id when the person presses one.
- `status` carries the as-of time ("11월 11일 09:00 기준"). The templates do this.
- It returns `true` when lophn draws the head. It returns `false` when the tab
  floats outside a card or the file is opened outside lophn; only then draw the
  same views yourself, small, with `ui.navigation.Tabs`, and the as-of time as a
  line under the answer (the templates do).
- Keep the page's state in React. The head is only text and ids.

```js
const VIEWS = [{ id: "summary", label: "요약" }, { id: "all", label: "전체" }];
const [view, setView] = useState("summary");
const inHead = useTabHead({ status, tabs: { items: VIEWS, selected: view } }, { onTab: setView });
```

## Appearance

The page already has lophn's tokens as CSS variables, so it follows the
person's theme (light or dark, and their appearance settings) without any setup.
Kit parts already use them. Do not write colors, `px` sizes or font names of
your own: a hard-coded color stays the same in dark mode and looks wrong.

| Variable                                                                                     | Use                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `--color-surface-base`                                                                       | page background (same as lophn's tabs)   |
| `--color-surface-subtle`                                                                     | a quiet block (the next-actions box)     |
| `--color-border-subtle`, `--color-border-base`, `--color-border-strong`                       | rules between rows, borders              |
| `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`                        | main text, supporting text, captions     |
| `--color-link`                                                                               | links and "N more"                       |
| `--status-good-text`, `--status-warning-text`, `--status-critical-text`                       | status text; `-marker` for dots and bars |
| `--font-sans`, `--font-numeric`, `--font-mono`                                               | fonts                                    |
| `--font-weight-regular`, `--font-weight-medium`, `--font-weight-semibold`                    | weights                                  |
| `--type-title-size`, `--type-title-small-size`, `--type-body-size`, `--type-small-size`      | text sizes; each has `-line`             |
| `--space-1` … `--space-12`, `--radius-sm`, `--radius-md`                                     | spacing and corners                      |

- Lay out by the width you get. `DashboardFrame` already pads and centers the
  page and folds to one column under 640px. Prose lines may stop near `72ch`.
- Korean text breaks between words: the templates set
  `word-break: keep-all; overflow-wrap: anywhere` on `body`.
- Do not style scrollbars. lophn draws them like its own screens.

## Drawing nodes

For a node diagram, call `LophnKit.renderGraph(element, { nodes, edges })` (or
`ui.data.GraphDiagram` inside your React tree). Calling it again on the same
element updates it. The element must be a block with a width that is not 0
(not hidden, not `display: inline`).

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

## Screen-check commands

1. `lophn tab open --artifact <name>` opens it as a tab next to yours and
   returns its `tab` id. It is `not_found` until `<Folder>/<name>/index.html`
   exists. Opening it again returns the same tab.
2. `lophn browser screenshot <tab>` returns the image of what the person sees.
   `lophn browser logs <tab>` gives console errors (a script that failed, a
   `fetch` of a missing `data/` file). `lophn browser snapshot <tab>` reads the
   page as an accessibility tree with refs.
3. Use the refs with `lophn browser act <tab>` (click, fill, select, scroll) to
   try views, filters and buttons, and `lophn browser evaluate <tab>` to read a
   value from the page.
4. The tab reloads by itself when a file changes; use
   `lophn browser wait <tab> --text <text>` if you need it settled.

Leave the tab open for the person. While you drive it the tab shows
[Take control]; if the person takes it, `act` and `evaluate` are `conflict` and
you can still look. The page cannot navigate: `browser navigate` is for browser
tabs.

If a `lophn tab` or `lophn browser` command fails, do not start another browser
(Chrome, Playwright, browser-use or any other), do not serve the folder
yourself, and do not read the person's browser profile or cookies. Tell the
person the reason the error gave you.

## Changes show at once

When you change a file in the folder, a tab that has it open reloads. There are
no versions: to keep earlier data, add files to `data/` instead of overwriting.
To go back, the person uses rewind.

## When the person sends annotations

The person can mark the screen and send notes. They go to the last open session
that wrote to that artifact's folder, as a message. If there is none (those
sessions are closed or have no record), lophn at the project or app that holds
the artifact gets them. Open the screenshot with `image.read`.
