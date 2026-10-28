---
name: guide-artifact
description: Write an artifact: a static HTML page in a domain's artifacts folder that shows the person a result on screen. Where it goes, its folder and data, the sealed view and theme tokens.
---

# Artifact

An artifact is a static page you write so the person can see a result on screen
instead of reading it in the chat. It is a folder with an `index.html`. There is
no artifact tool: you make one by writing files.

## Where it goes

An artifact belongs to a domain. Its place is `domains/<dom>/artifacts/<name>/`
in lophn's data, and a domain is one of the domains listed in your place
information. Write `<Folder>/<name>/index.html` with `file.write`. `<Folder>` is
the absolute `artifacts` folder of that domain, given in the Artifacts section
of your place information. Always use that absolute path: a relative
`artifacts/...` path lands in the person's project folder, which is wrong.
`<name>` is a lowercase slug (`spending`, `weekly-report`). Once an `index.html`
exists at that spot, it is an artifact. Tell the person its path in your answer;
the path becomes a link that opens it. The same name in two domains is two
artifacts.

## Who writes

The Project Manager of a project and the App Engineer of an app write the
artifacts of their own domains. An Operator writes only the artifacts of the
domains it was given, and nothing else of a domain: `DOMAIN.md`, the kinds file
and the skills are not its to write. lophn does not write artifacts.

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
  calling a tool (for example an aggregate from `list`) and writing the result
  into `data/`.

## How the data is held

Three ways, chosen by how the template reads `data/`. They are not kinds.

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

## Title and description

Always write `<title>` and `<meta name="description" content="...">` in
`index.html`. The artifact list and the prompt show these two. Without a
`<title>` the folder name is used. Keep the title short and the description to
one sentence.

## The view is sealed

- There is no network. `fetch` reaches only files in the artifact's own folder;
  any outside server is blocked.
- No external library and no CDN. Scripts, styles and fonts are inline or files
  in the same folder. If you need a chart, draw it with inline SVG, canvas, or a
  small script you write into the folder.
- One file can be at most 4 MiB.
- Files outside the folder, other artifacts and the person's documents cannot be
  read.
- The page has no lophn bridge. It cannot call tools or read app data. It shows
  what is already in the folder.

## Appearance

Use lophn's tokens as CSS variables. The page already has them, so it follows
the person's theme (light or dark, and their appearance settings) without any
setup. Do not hard-code colors as hex; a hard-coded color stays the same in dark
mode and looks wrong.

| Variable                                                                | Use                                      |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| `--color-surface-floor`                                                 | page background                          |
| `--color-surface-base`                                                  | cards and panels                         |
| `--color-surface-subtle`                                                | table stripes, quiet areas               |
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
  background: var(--color-surface-floor);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}
```

## Drawing nodes with the kit

The kit draws a node diagram. It is the one library the sealed view gives you,
and it works in a workflow artifact and in a domain artifact.

- Load it with a plain `<script>` (not a module) and a stylesheet:
  `<link rel="stylesheet" href="/_lophn/kit.css">` and
  `<script src="/_lophn/kit.js"></script>`.
- Call `LophnKit.renderGraph(element, { nodes, edges })`. Calling it again on
  the same element updates it. The element must be a block with a width that is
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

## Drawing a domain

A domain artifact can draw the domain as nodes. It is optional: before you make
one, ask the person with `ask` whether they want a picture. None is a good
answer. Do not make one without asking.

Two things are worth drawing:

- **Kind map:** each kind is a node and each `ref` field is an edge from the
  kind that has the field to the kind in `to`, with the field name as the edge
  `label`. A `ref` to its own kind would be an edge from a node to itself: leave
  it out and, if it matters, say it in the node's `note`. For the number of
  items, call `kind.list` with `aggregate: [{ op: "count", as: "n" }]` for each
  kind and put it in the `note`.
- **State flow:** if a kind has an `enum` field that means a state (`status`,
  `stage`), each value is a node. Call `kind.list` with the same `aggregate` and
  `group_by` set to that field, and put the number of items of each value in the
  `note`. The order between values (the edges) is the domain's meaning: take it
  from `DOMAIN.md` or from what the person says. If you do not know it, draw the
  values with no edges.

The artifact cannot read `kinds.yaml` or call a tool, so you write the diagram
data into `data/*.json` yourself (for example `data/map.json` with `nodes` and
`edges`) and the page reads it. When the kinds change, change the data too.

```html
<!doctype html>
<title>Kind map</title>
<meta name="description"
  content="The kinds of this domain and how they point at each other.">
<link rel="stylesheet" href="/_lophn/kit.css">
<div id="graph" style="display:block;width:100%"></div>
<script src="/_lophn/kit.js"></script>
<script>
fetch("data/map.json")
  .then((r) => r.json())
  .then((map) => LophnKit.renderGraph(document.getElementById("graph"), map));
</script>
```

with, for example, `data/map.json`:

```json
{
  "nodes": [
    { "id": "receipt", "label": "receipt", "note": "42 items" },
    { "id": "vendor", "label": "vendor", "note": "7 items" }
  ],
  "edges": [{ "from": "receipt", "to": "vendor", "label": "vendor" }]
}
```

An Operator does not write kind files, but it can draw the same diagram in an
artifact of a domain it was given.

## Changes show at once

When you change a file in the folder, a tab that has it open reloads. There are
no versions: to keep earlier data, add files to `data/` instead of overwriting.
To go back, the person uses rewind.

## When the person sends annotations

The person can mark the screen and send notes. They go to the last open session
that wrote to that artifact's folder (a Project Manager, App Engineer or
Operator), as a message. If there is none (those sessions are closed or have no
record), the Project Manager of the project or the App Engineer of the app that
holds the domain gets them. Open the screenshot with `image.read`.

## What you do not do

- Do not make a page that calls tools or reads live app data. A screen like that
  is an app, which the App Engineer of an app builds.
