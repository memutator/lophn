---
name: write-skill
description: "Create, fix, or clean up skills (skill creator): decide if it should be a skill, write it, check it."
---

# Write Skill

Create, repair, or audit lophn skills. A skill is a folder containing `SKILL.md` (and optional flat `<topic>.md` companions) that gives agents a repeatable procedure or checklist using existing tools and app commands.

Read the companion guides when needed:
- Read `design.md` with `skill.read({ name: "write-skill", path: "design.md" })` before drafting a new skill, splitting companions, writing an app public skill, or running an Audit.
- Read `evaluation.md` with `skill.read({ name: "write-skill", path: "evaluation.md" })` when diagnosing failures, repairing a skill without sediment, or running blind scenario tests.

## 1. Pick the mode

- **Create**: build a new skill from a request or a procedure that repeated in conversation.
- **Repair / Update**: fix a skill that missed triggers, fired wrongly, broke validation, or gave stale steps.
- **Audit**: inspect existing skills in this workspace, report a Keep / Improve / Merge / Retire table, and edit only what the person approves.

## 2. Should this be a skill?

Classify the request before writing any file.

| What is needed | Right place in lophn | Make a skill? |
|---|---|---|
| Repeatable procedure, decision guide, or checklist using existing tools/commands | **Skill** (`SKILL.md` + flat `.md`) | Yes (extend an existing skill first) |
| Deterministic executable code, parser, or API wrapper | **Local Tool** (`tools/<name>.ts`) | No (optional skill only for how to use it) |
| Persistent data, screens (GUI), permissions, or secrets | **App** (plan at Home, build in app workspace) | No (a public skill ships with the app) |
| Long-running multi-step work across people, agents, or apps | **Workflow** (`write-workflow`) | No |
| One-off or refreshable report page for the person to review | **Artifact** (`write-artifact`) | No |
| Always-on rules for every session in a workspace | **`LOPHN.md` / `AGENTS.md`** (propose edits to the person; never auto-edit) | No |
| Person's decisions, preferences, or workspace pointers | **Memory** (`agent.memory`, <= 8 KiB) | No |
| One-time task | Just do the task | No |

Hard rules:
- Never create a router/hub skill that only lists or redirects to other skills.
- If an existing skill already owns the same outcome, update it instead of creating a duplicate.
- Do not copy rules already in system instructions, tool schemas, `LOPHN.md`, or general model knowledge.

## 3. Choose where to save it

Always use the absolute folder path from your workspace information with `file.write` / `file.edit` (every write records a rewind pre-image automatically).

| Scope | Path | Rule |
|---|---|---|
| Current project or app (default, personal, uncommitted) | `<Skills folder>/<name>/SKILL.md` | Use `Skills folder:` from workspace info (works for folderless projects too). |
| Project skill shared via git with a team | `<project folder>/.lophn/skills/<name>/SKILL.md` | Only when the person asks for or agrees to repo sharing. Never write to the person's repo unasked. |
| App public skill for agents outside the app | `<app source>/.lophn/skills/<name>/SKILL.md` | Folder name == `name`. Declare in `lophn.ts` (`skills: [{ name, public: true, commands }]`), check `.gitignore`, commit, release (`lophn declaration check`, `lophn release prepare`, `lophn release activate`). Then read `deploy-skill`. See `design.md`. |
| Home-only skill | `<Skills folder>/<name>/SKILL.md` (`<data>/home/skills/`) | Visible only in Home sessions. |
| Global personal skill (all workspaces) | `<Global skills folder>/<name>/SKILL.md` (`<LOPHN_HOME>/skills/`) | Written **only from Home** (`Global skills folder:` in Home workspace info). From a project or app session, hand off to Home `lophn` via `lophn call send`. |

Protection invariants:
1. Never use the name of a built-in skill (`source: "builtin"`, `can_disable: false`); runtime discovery rejects overrides.
2. Never write skills belonging to another workspace directly; delegate with `lophn call send`.
3. Never create symlinks for skill folders or files; runtime discovery rejects them.
4. When editing an existing skill, keep its `name` and location unless the person asks to move or rename it.

## 4. Procedures

### A. Create
1. **Reconstruct from evidence**: extract the repeatable goal, triggers, boundaries, inputs, side effects, and done criteria from the conversation, successful tool calls, and the person's corrections. Use `ask` only for domain gaps that change the outcome—decide file names and internal layout yourself.
2. **Check existing skills**: run `lophn skill list` to check active skills and `skipped` bundles. If an existing skill owns the same outcome, switch to **Repair / Update**.
3. **Read `design.md`**: follow frontmatter, 24 KiB cap, flat `.md` layout, and body rules.
4. **Pick location & write**: choose the path from section 3, write `description` first (<= 120 chars, no procedure summary), then write `SKILL.md` and any conditional flat `<topic>.md` files with `file.write`.
5. **Validate**: run `lophn skill check <skill-dir>`. Fix **all errors** (`ok: true`) and resolve warnings or note why a warning is intentional.
6. **Evaluate (when warranted)**: if triggers overlap other skills, routing has multiple branches, or mistakes carry high side-effect cost, read `evaluation.md` and run blind forward-tests.
7. **Tighten**: remove filler, duplicated rules, and unused sentences, then re-run `lophn skill check <skill-dir>`.
8. **Report**: explain in domain terms what the skill does and when it applies, and note that it takes effect on the **next turn**.

### B. Repair / Update
1. **Read `evaluation.md` and classify the fault first**: assign the root cause to one layer (`Selection`, `Instruction`, `Resource`, `Integration`, `Harness`, or `Capability`) and edit **only the owning layer**.
2. **No sediment**: replace or delete stale wording instead of appending exceptions or patch notes. Preserve existing safety, approval, and recovery boundaries.
3. **Validate & compare**: run `lophn skill check <skill-dir>`. For evaluated skills, re-run the same before/after scenarios to confirm no regression.

### C. Audit
1. **Inventory**: run `lophn skill list` to gather all visible skills, their sources (`builtin`, `shared`, `global`, `project`/`app`, `workspace-data`), and `skipped` folders.
2. **Inspect editable skills**: read `design.md` (8-item checklist), run `lophn skill check <path>` on each editable skill, and read its files. Never edit `builtin` or `shared` skills in place.
3. **Classify**: assign each editable skill one verdict—**Keep**, **Improve** (list defect), **Merge** (name target), or **Retire** (name replacement).
4. **Present a single table**: `Skill | Source | Verdict | Evidence | Proposed change`, and wait for the person's approval.
5. **Apply approved changes only**: edit, merge, or retire only approved items, then re-run `lophn skill check` on every modified skill.

## 5. Proactive suggestions

- When the same procedure repeats two or more times in a conversation, or the person repeats the same correction, offer in one line at the end to turn it into a skill.
- Create the skill **only after the person agrees**. Never create or merge skills silently.
- During unattended turns (`<lophn-run>`, `<lophn-step>`), never ask and never create a skill; at most leave a one-line suggestion at the end of your result.
