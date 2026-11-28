# Skill Design & Audit Guide

Use this reference when drafting a new skill, splitting companions, writing an app public skill, or auditing existing skills.

## 1. Frontmatter and trigger discipline

`SKILL.md` must begin with YAML frontmatter delimited by `---` on line 1 and a closing `---` line.

Required keys (and no custom trigger keys like `when_to_use`):
- `name`: lowercase kebab-case matching `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..64 characters, **identical to the parent folder name**.
- `description`: non-blank, hard cap 1,024 chars, **target <= 120 chars** with the core trigger intent in the first 80 chars.
  - State what the skill does and when to load it.
  - Add a short exclusion (`Not for ...`) at the end **only** when adjacent skills or general tools could cause false triggers.
  - **Never summarize steps, commands, flags, or tool arguments in `description`.** Summarizing the procedure causes models to act from the prompt index without loading `SKILL.md`.
  - Wrap values containing `:` in double quotes. Never include `<` or `>`.
- Preserve unknown standard metadata keys (such as `license` or `metadata`) when editing an existing skill.

Good vs bad descriptions:
- Good: `"Prepare weekly budget variance report from ledger exports. Not for ad-hoc single lookups."`
- Bad: `"Run file.read on exports/*.csv, sum by category, compare against budget.yaml, and write an artifact."` (leaks procedure; model skips `skill.read`).

## 2. Size limits and flat `.md` progressive disclosure

- **Hard limit**: `SKILL.md` and every companion `.md` file must **each be <= 24,576 bytes (24 KiB)**. Files over 24 KiB are silently skipped at discovery (manifest) or fail `skill.read` with `unavailable` (companion).
- **Length targets**: ~80–120 lines for simple skills, ~150–220 lines for multi-mode skills. `lophn skill check` warns above 300 lines.
- **Split by loading condition, not line count**:
  - Keep universal decisions, boundaries, core workflow, and invariants in `SKILL.md`.
  - Move branch-specific checklists, templates, reference tables, or evaluation guides into flat `<topic>.md` files in the **same folder** as `SKILL.md`.
- **No subdirectories**: `skill.read` only reads flat `.md` files directly next to `SKILL.md`. Never create `references/`, `scripts/`, or `assets/` folders inside a skill directory. Executable code belongs in a local tool (`tools/<name>.ts`) or an app command, not inside a skill.
- **1-hop pointers**: reference each companion directly from `SKILL.md` with its exact `skill.read({ name: "<skill>", path: "<topic>.md" })` call and the exact condition for loading it. Do not chain companion-to-companion references.
- **No clutter files**: never place `README.md`, `CHANGELOG.md`, `INSTALL.md`, `.env`, or evaluation logs inside a skill folder.

## 3. Body structure

Include only the sections the skill actually needs:
1. `# <Title>` + 2–3 sentences stating purpose and non-purpose.
2. **Boundaries / Mode selection** (only if multiple modes or tricky exclusions exist).
3. **Preconditions** (apps whose commands it calls, MCP servers, settings, or environment).
4. **Procedure** (numbered steps; include observable completion criteria for key steps and explicit person-confirmation points before irreversible or external actions).
5. **Pitfalls and recovery** (only failures actually observed and their concrete fix—no incident logs, dates, or generic advice).
6. **Verification** (how to prove the job succeeded).
7. **Companion files** (only if present; one line each on when to read it).

Authoring discipline:
- Do not repeat a long "When to use" section inside the body—by the time `SKILL.md` is read, the skill has already been selected.
- Use lophn's real tool and command names (`file.read`, `file.write`, `file.edit`, `lophn <group> <cmd>`, `skill.read`, `ask`).
- Changes apply on the **next turn** (the current turn keeps its start-of-turn snapshot) and immediately in newly spawned sessions.

## 4. App public skills

The original of an app's public skill lives in the app source (`<app source>/.lophn/skills/<name>/SKILL.md`) and ships with each release. Copies elsewhere are deployments (`deploy-skill`): receivers cannot edit them, and a change goes to the app's own workspace.

Write it for an agent in another workspace that knows nothing about the app:
- The description says when a stranger should read it; the body names the commands to call with `lophn <app> <command>` and how to read their results, with no reference to the app's internals or screens.
- Cover every command the app exposes for outside use. An app without a public skill cannot be deployed, and every outside call to it asks the person.

Steps:
1. Folder name must equal frontmatter `name`.
2. Declare the skill in `lophn.ts` under `skills: [{ name, public: true, commands }]` (`design-app` governs the contract); every command listed must be public.
3. Verify `.gitignore` does not exclude `.lophn/` or `.lophn/skills/`.
4. Run `lophn skill check <app source>/.lophn/skills/<name>`.
5. Commit, then `lophn declaration check`, `lophn release prepare` and `lophn release activate`.
6. Once it is released, read `deploy-skill` to choose where it goes.

## 5. Static check codes (`lophn skill check`)

Errors (`ok: false` — must fix all):
- `missing_manifest`: folder missing, not a directory, or `SKILL.md` missing/not a regular file.
- `symlink_forbidden`: skill folder, `SKILL.md`, or an entry inside is a symlink.
- `size_exceeded`: `SKILL.md` or a companion `.md` exceeds 24,576 bytes. Split conditional content into flat `.md` companions.
- `invalid_frontmatter`: runtime `parseSkillFrontmatter` rejected the header (missing/unclosed `---`, bad YAML, invalid `name`, missing/oversized `description`).
- `name_dir_mismatch`: parent folder name differs from frontmatter `name`.
- `builtin_name_collision`: `name` matches a `can_disable: false` built-in skill.
- `empty_body`: nothing but whitespace after the closing `---`.
- `angle_brackets_in_description`: `description` contains `<` or `>`.
- `unfinished_todo`: an unresolved placeholder marker remains in `description` or outside fenced code blocks.
- `unclosed_code_fence`: a backtick or tilde code fence is never closed.
- `missing_companion`: a `skill.read` `path` points into a subdirectory (`/`) or names a companion `.md` that does not exist.

Warnings (`ok: true` — fix unless justified):
- `description_long`: `description` > 120 chars.
- `body_long`: `SKILL.md` > 300 lines.
- `nested_subdirs_ignored`: subdirectory present inside the skill folder (ignored by `skill.read`).
- `auxiliary_file`: `README.md`, `CHANGELOG.md`, `INSTALL.md`, `LICENSE`, or `.env*` inside the skill folder.
- `non_md_companion`: non-`.md` file next to `SKILL.md` (not readable by `skill.read`).
- `shadows_existing`: same name already exists in a lower skill layer (check whether shadowing is intended or if you should update that skill instead).

## 6. Audit 8-item checklist

For each editable skill (`workspace-data`, `project`/`app`, `global`; never edit `builtin` or `shared`):
1. **Fields**: passes `lophn skill check` with 0 errors; folder name == `name`; frontmatter clean.
2. **Trigger**: `description` <= 120 chars, discriminative, no procedure summary, clear boundary if adjacent skills exist.
3. **Size / Flat Layout**: every `.md` well under 24 KiB; no nested subdirs, no clutter files, clean 1-hop `skill.read` pointers.
4. **Body**: concise, actionable steps with observable done criteria; no redundant "When to use" bloat or sediment.
5. **Links / Tools**: every referenced companion, tool, and `lophn` command actually exists and is spelled accurately.
6. **Safety / Scope**: irreversible/external steps confirm with the person; respects workspace boundaries and no-repo-write default.
7. **Duplication**: does not overlap another skill's outcome or duplicate `LOPHN.md` / system rules (candidate for **Merge**).
8. **Staleness / Value**: still used and accurate; if obsolete or better served by a local tool/app/workflow/memory, mark **Retire**.

Report format (one table, wait for approval before any edits):

| Skill | Source | Verdict | Evidence | Proposed change |
|---|---|---|---|---|
| `example-skill` | `workspace-data` | Improve | `description_long` (185 chars), leaks steps | Shorten description to <= 120 chars |
