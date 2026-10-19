# Artifact

An artifact is a static page you write so the person can see a result on screen
instead of reading it in the chat. It is a folder with an `index.html`. There is
no artifact tool: you make one by writing files.

## Where it goes

Write `<Folder>/<name>/index.html` with `file.write`. `<Folder>` is the absolute
path on the `Folder:` line of the Artifacts section of your place information.
Always use that absolute path: a relative `artifacts/...` path lands in the
person's project folder, which is wrong. `<name>` is a lowercase slug
(`spending`, `weekly-report`). Once an `index.html` exists at that spot, it is
an artifact. Tell the person its path in your answer; the path becomes a link
that opens it.

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

## Changes show at once

When you change a file in the folder, a tab that has it open reloads. There are
no versions: to keep earlier data, add files to `data/` instead of overwriting.
To go back, the person uses rewind.

## When the person sends annotations

The person can mark the screen and send notes. They go to the last open Project
Manager or Operator session that wrote to that folder, as a message. If there is
none (those sessions are closed or have no record), the Project Manager gets
them. Open the screenshot with `image.read`.

## What you do not do

- Do not make a page that calls tools or reads live app data. That is a live
  view, which is coding agent work. The Project Manager writes a ticket for it.
- Do not write app code.
