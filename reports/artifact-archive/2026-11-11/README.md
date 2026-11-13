# Artifact archive: 2026-11-11, before the template skill

The six artifacts lophn made on 2026-11-11 in the lophn project. They were made with the old `write-artifact` skill (322 lines; the end of it was cut off when read). We keep them so we can compare them with the same pages made with the new skill (0.23.48: shape templates, answer first, budgets) and the whole-skill read (0.23.50).

## How they were made

- Main session `ses_01m74tjyb2vgjrjyfsvfdwqyg4`, Opus 5.5. The person asked it to analyze how the project manages its context and to propose artifacts, then said "build them all", then "in parallel sessions".
- The main session gave each page to its own team session (six). The person's words and the six briefs are in `prompts.md`.
- Only `decisions` saw a screenshot before it was finished. The other five could not be checked: no window was showing the workspace. The main session then read only console logs and page text, and reported "all show without errors".

## Contents

| Path | What |
|---|---|
| `pages/<name>/` | Copy of `~/.lophn/projects/prj_01m664qk6c68vbvb5br15dr7dt/artifacts/<name>/` as of 2026-11-13. The data is the collection from 11-11, 17–18 KST |
| `pages/project-docs/` | Without `gallery/` (the 16 MB wireframe build). It can be rebuilt with `tools/build-wireframes.mjs` in that folder. The Wireframe view of the copy is empty |
| `screens/<name>.png` | 1280×2400 first screen. Headless Chrome with the repo's kit build and light tokens (not a lophn tab). Same method as the template check |
| `progress-in-lophn.png` | The only screenshot of the time taken in a real lophn tab (`progress`, narrow tab) |
| `prompts.md` | The person's words and the briefs given to each team session |

| Page | Title | Shape the new skill would choose |
|---|---|---|
| `decisions` | Decisions waiting | inbox |
| `context-health` | Context health | brief |
| `progress` | Progress | brief |
| `context-map` | Context map by role | brief (diagram section) |
| `decision-log` | What I decided | explorer |
| `project-docs` | Project docs | explorer (several views) |

## Making them again and comparing

1. Use lophn installed with 0.23.50 or later (check that the new `write-artifact` loads).
2. Give the same requests in a lophn project session. To compare page by page, give each `prompts.md` brief as it is, but change the name so it does not overwrite the old page (`decisions-v2` and so on).
3. Compare against the criteria of the new skill:
   - Is the answer at the top of the first screen? Are there at most three next actions and at most four numbers?
   - Are there no file paths, IDs or commands in titles and rows?
   - Is the page within seven rows per section and six sections? Is the brief or inbox data under 200 KiB? (Old: `decision-log` 668 KB, `project-docs` 879 KB.)
   - Are estimates kept out of the tiles and the answer?
   - Do the pages not overlap (did it fix an existing page instead of making a new one)?
   - Did it look at a screenshot, or say it could not?
