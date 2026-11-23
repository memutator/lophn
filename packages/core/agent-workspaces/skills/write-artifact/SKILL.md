---
name: write-artifact
description: "Write a static HTML artifact in a project or app artifacts folder: pick Brief, Inbox, Explorer, or workflow graph templates with lophn's kit, choose snapshot/refresh/scheduled freshness, and verify on screen with browser screenshot."
---

# Artifact

An artifact is a static page you write so the person sees a result on screen
instead of reading it in the chat. It is a folder with an `index.html` in the
artifacts folder of the project or app you work in. There is no artifact tool:
you make one by writing files.

This file says what a good page is. How to build one (where the folder goes,
how data is held, the kit, the tab head, theme tokens, the screen-check
commands) is in the bundled file `kit.md`: read it with
`skill.read({ name: "write-artifact", path: "kit.md" })` before you write the
first file.

## 1. Look at the pages already here

Your workspace information lists the artifacts of this project or app with
their titles and descriptions. Read that list before you make a page.

- If a page already answers the same question or shows the same records, change
  that page: refresh its data, or add a view to it. Do not make a second page
  that shows the same thing.
- If your page touches what another page already shows (the same plans, the
  same open items), show one line with the count and name that page for the
  rest. Do not copy its list.
- One page answers one question. Its description says, in one sentence, what
  only this page shows.

## 2. Decide what the page says

Before any code, write these four down for yourself (not on the page):

1. **The question** the person brings to this page, in their words: "what do I
   have to decide?", "where did the money go this month?".
2. **The answer**, in one or two sentences. It goes at the top of the page.
3. **The next actions**, if any: at most three, each "who → what → what it
   unblocks".
4. **The few facts** that back the answer. Everything else is detail.

If you cannot write the answer, the analysis is not done. Finish it; do not put
the raw material on screen instead. Write the page for the person as a report to
a manager, not as a dump of what you read. You decide what it shows and how; do
not ask them to choose a layout.

## 3. Pick a shape and start from its template

Every page starts from one of these templates. Read the template with
`skill.read({ name: "write-artifact", path: "<file>" })`, copy its `index.html`,
and write your data in the same shape as its sample `data/latest.json`. Keep its
layout, its sections and its CSS. Change the labels in its `TEXT` to the
person's language. Do not design a new layout.

| Shape    | The person asks                             | For example                                                    | File                   |
| -------- | ------------------------------------------- | -------------------------------------------------------------- | ---------------------- |
| Brief    | "Where does this stand, and what needs me?" | status of a project, a health check, a review of a period, a comparison | `template-brief.md`    |
| Inbox    | "What do I have to decide?"                 | decisions waiting, items to approve, problems to triage        | `template-inbox.md`    |
| Explorer | "Find the one I mean among many."           | a log of past decisions, a catalog, a list of records          | `template-explorer.md` |

- Most pages are briefs. Pick an explorer only when the person will search or
  filter. A long list is not a reason: sum it up in a brief instead.
- An explorer still opens with the answer and a few numbers before the search.
- A page that needs two shapes uses views in the tab head, the brief first
  (`kit.md`, "The tab head").
- When the person asks for something none of these fit (a diagram of steps, a
  single chart to look at), keep the parts that do fit: the answer on top, the
  as-of time, the tokens, the kit parts.

## 4. The first screen

What the person sees before scrolling decides whether the page works.

- **Top: the answer** from step 2. Add a status mark when there is one overall
  state ("over budget", "on track").
- **Then the next actions**, when there are any. When there are none, say so in
  one line; "nothing to do" is an answer.
- **Then at most four numbers.** A number earns a tile only when the person
  would act on it or compare it. Give the change since the last collection when
  you have it.
- No title (lophn shows it in the tab head), no subtitle that restates it, no
  text that explains the page, no decoration.

## 5. Budgets

- A section shows at most seven rows. The rest goes behind "N more", or into an
  explorer view.
- A page has at most six sections. A brief that needs more is two questions.
- An item reads in one line first: the thing, its state, why it matters. Its
  options, evidence and sources are folded under it.
- Keep a brief or an inbox under 200 KiB of data. If you are writing more than
  that, you are copying, not summing up.

## 6. Words

- Write in the person's language and their domain's words, in the same voice you
  use with them in the conversation.
- Leave out the machinery: no file paths, file names, IDs, commands, slugs,
  version numbers or JSON keys in titles, rows or labels. Name a thing the way
  the person knows it ("the plan's done-check", not `plan/README.md`). If they
  must find the file, put its path in a folded detail line.
- A state is a word with a mark (`StatusMark`), never a color alone.
- Say what you inferred. A number you estimated, or a grouping you made by
  matching words, does not go in a tile or the answer. Put it in its section
  with its basis in one line ("guessed from …"). When you cannot stand behind a
  number, leave it out.

## 7. Show numbers

Pick by what the person compares. The kit draws every chart in the theme's
colors; do not set colors. Props are in `kit.md`.

| The person compares                           | Use                       |
| --------------------------------------------- | ------------------------- |
| One value that matters on its own             | `StatTile`                |
| Parts or a ranking across up to 12 categories | `BarChart`, largest first |
| Change over time, four or more points         | `LineChart`               |
| Steps, flow or dependencies                   | `GraphDiagram`            |
| Exact values looked up across several columns | `Table` / `DataTable`     |
| A single count in a sentence ("68 open")      | plain text                |

No chart for one or two values, no pie, no chart that only repeats a table next
to it.

## 8. Keeping it current

The page shows what is in `data/` until someone writes there again. Opening the
tab does not refresh it. Before you write the page, pick one of these, and tell
the person your choice in one sentence.

1. **Snapshot.** The answer to one question at one moment: a review, a
   comparison, a plan. Write the data once.
2. **Refresh on request.** The data comes from something that keeps changing
   and the person looks now and then. This is the default for changing data.
   Put the collecting step in the folder as a script (`collect.mjs`,
   `collect.py`) that writes `data/`, record the collection time in the data
   (the templates show it in the tab head), and tell the person "ask me to
   refresh it". When they do, run the script, then compare with the last data
   and tell them only what changed.
3. **Scheduled.** The person expects it current at a known rhythm (every
   morning, every Monday). Do everything in 2, then propose a job with
   `lophn job create` (see `--help`) that asks an agent in this project to run
   the script; give the script's absolute path in the job's message. Every run
   is a model call: not more often than daily unless they ask. When history
   matters, write each run as a new file in `data/` instead of overwriting.
4. **Live.** It must be current the moment it is opened, refresh in seconds, or
   let the person change things. That is an app, not an artifact. Tell the
   person, and suggest building it as an app in that app's conversation.

Do not let the page look fresher than it is: no "today", "now" or clock time
computed in the page for data that was collected earlier.

## 9. Title and description

Always write `<title>` and `<meta name="description" content="...">`. The title
is the name the person sees in the tab, the head row and the Artifacts list.

- Write the title as the person would name the page, in their language: what it
  shows, in a few words ("이번 달 지출", "Decisions waiting").
- Not a slug, ID, file name or path, not code-style casing, not a date stamp
  unless the date is the point. Do not start with the project or app name.
- The description is one sentence on what the person learns from this page and
  no other.

## 10. Check it on screen

You must see the page before you tell the person it is done.

1. Open it with `lophn tab open --artifact <name>` and take a screenshot with
   `lophn browser screenshot <tab>`. Look at the image. Read
   `lophn browser logs <tab>` for errors.
2. Check: the answer is on the first screen; nothing is cut off, overlapping or
   wider than the tab; the numbers match the data; no section is empty; views,
   filters and "N more" work (try them with `lophn browser act`).
3. Fix the files and look again. The tab reloads by itself when a file changes.

Logs with no errors, text read with `evaluate`, or rendering the script with a
stub only prove the script ran. They are not seeing the page.

If the screenshot fails (for example no window shows this workspace), do not
work around it: no other browser, no local server, no copy of the page
elsewhere. Finish the files and tell the person plainly that you have not seen
the page yet and why, and ask them to open the project or app in lophn so you
can look. Never write that a page shows correctly when you have not seen a
screenshot of it. Details of the commands are in `kit.md`.

## 11. Tell the person

In your answer:
- the answer from the top of the page, in one to three sentences;
- how it stays current, in one sentence (section 8);
- anything you could not check;
- the page's path, which becomes a link that opens it.

Do not list again what the page shows.

## What you do not do

- Do not make a page that runs commands or reads live app data. A screen like
  that is an app, built in a conversation at that app.
