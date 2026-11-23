---
name: update
description: Review apps (@lophn/* SDKs), project workflows (flow_sdk), platform capability notes, and open follow-ups after a lophn update; decide per workspace what to migrate, adopt, or leave; record decisions with lophn update decide; and hand chosen work to each workspace.
---

# Update workspace (the forest view)

The person called this with `/update`, usually from the Inbox notice about
workspace updates, with no argument. An optional argument may narrow it to one
app, project, or workflow. After a lophn update, apps may pin older `@lophn/*`
SDKs, project workflows may stamp an older `flow_sdk`, or new platform
capabilities may open up across apps, workflows, and agents.

You are the one who sees the whole forest. The person cannot judge what an SDK
or platform change broke or made possible; that judgement is yours. Do not hand
the person a list of version bumps. Required migrations (`required` apps or
workflows, or `Breaking: yes` affecting existing assets) are software upkeep:
decide them without asking and hand them off right away. Ask the person only
about new capabilities that bring concrete value to assets they already have.
You do not edit app or project source directly: judge from what each asset is
for (`lophn app read`, `lophn workflow list`) and the notes, and leave
code-level detail to lophn in that workspace.

lophn keeps update progress, not you: reviewed versions, platform note
checkpoints, and open follow-up items live in `lophn update status` and
`lophn follow-up list`. Do not mirror update decisions or follow-up progress in
Memory.

## 1. Read unified status

Run `lophn update status`. It returns:

- `apps`: active apps with pinned/current SDK versions, `level` (`required`,
  `available`, `current`), `notes`, `unreviewed`, and last `review`. Archived
  apps are excluded; skip them.
- `workflows`: active project workflows with `project`, `project_name`,
  `workflow`, `flow_sdk`, `current`, `supported_from`, `level`, `note`, and last
  review. Archived projects are excluded; skip them.
- `platform`: `through` (last reviewed note id or `null`), `latest`, and
  `unreviewed` platform notes (`{ id, breaking, areas, title, note_path }`).
- `open_follow_ups`: unfinished `fup_...` items across workspaces.
- `workspace_summary`: counts of existing assets (`active_apps`,
  `active_projects`, `workflows`, `custom_agents`, `harness_agents`,
  `providers`, `machines`).

If the person named a specific app, project, or workflow, narrow your review to
that target.

## 2. Read only relevant notes

- For apps with `unreviewed` notes (or a `required` SDK, where you read all
  `notes`): call `lophn app read <app ID>` to know the app's purpose and public
  commands, and read each listed note with
  `skill.read {name: "migrate-sdk", path: "<note file>"}`.
- For workflows with `level: "required"` or an unreviewed `available` `note`:
  read the flow note with `skill.read {name: "migrate-sdk", path: "<note>"}`.
- For each entry in `platform.unreviewed`: read it with
  `skill.read {name: "update", path: "notes/<id>.md"}` (or `note_path`).

## 3. Classify every item

1. **Required maintenance (no question)**:
   - Any app with a `required` SDK, any workflow with `level: "required"`, or any
     `Breaking: yes` platform note affecting an existing asset.
   - Decide `update` immediately without asking the person.
2. **Optional proposals (`ask`) — strictly asset-matched**:
   - Check `workspace_summary` before proposing anything. ONLY ask about
     capabilities that deliver immediate value to assets that actually exist:
     - If `active_apps === 0`, skip app, phone native, app file, widget, and
       app-sync questions.
     - If `workflows === 0`, skip workflow upgrade questions.
     - If `custom_agents === 0`, skip custom-agent instruction questions.
     - If `harness_agents === 0`, skip coding-agent `harness_config` profile
       questions unless the person already configured harness definitions.
   - Write concrete proposals in plain words tied to a real app, workflow, or
     agent, with your recommendation and why. "Nothing fits" is a good answer.
   - **Unmatched new platform capabilities**: NEVER ask about capabilities that
     have no matching asset in `workspace_summary`. Instead, mention them in a
     single concise one-line note at the very end of your report (for example,
     "Also available now in lophn: ...").
3. **Leave as is**:
   - A running app or workflow that is only `available` and has no chosen
     proposal stays `leave`. Never bump versions with no functional benefit.
4. **Open follow-ups (`open_follow_ups`)**:
   - Note unfinished follow-up items clearly (for example, what was handed off
     earlier and still has state `open`) and ask whether to re-send if helpful.

## 4. Ownership-split cleanup and `runtime: custom` agents

When a note's `## Instruction diff` shows that an older platform limitation or
workaround is now obsolete:

- **Agent-owned files (`memory.md` via `agent.memory`, agent-generated skills)**:
  edit them directly and report clearly what you removed or updated.
- **Person-owned `LOPHN.md` (global, home, or project)**: NEVER edit it
  directly. Propose the exact lines to remove or update so the person can decide.
- **`runtime: custom` agents**:
  - Global custom agents: Home updates their instructions, tools, and skills
    directly with `agent.update` and reports what changed.
  - Project- or app-scoped custom agents: include the instruction update in the
    handoff to that project's or app's lophn (which calls `agent.update`).

## 5. Present the plan and ask

Give the person a short plain-words plan (no package names, version numbers, or
internal IDs unless asked):

- One line for required upkeep you are handling right away (no question).
- Concrete asset-matched proposals with your recommendation.
- Any unfinished `open_follow_ups` worth re-sending.
- Any proposed `LOPHN.md` edits (for their approval only).

Then call `ask` ONLY for the asset-matched proposals (and re-sending open
follow-ups if applicable). Omit everything else.

## 6. Record decisions and hand off (`lophn update decide`)

Use `lophn update decide` to record decisions and dispatch handoffs in one
action (do not send separate `lophn call send` handoffs yourself):

- App decision:
  `{ "kind": "app_sdk", "app": "<app ID>", "decision": "leave" | "update", "items": [{ "title": "...", "proposal": "...", "source_ref": "<note>" }] }`
  (`leave` is not allowed when any SDK is `required`.)
- Workflow decision:
  `{ "kind": "flow_sdk", "project": "<prj ID>", "workflow": "<slug>", "decision": "leave" | "update", "items": [{ "title": "...", "proposal": "...", "source_ref": "<note>" }] }`
- Platform checkpoint & optional handoffs:
  `{ "kind": "platform", "through": "<platform.latest>", "handoffs": [{ "workspace": { "kind": "project" | "app", "id": "<id>" } | null, "items": [{ "title": "...", "proposal": "...", "source_ref": "<note id>" }] }] }`
  Always record `through: platform.latest` once you have reviewed
  `platform.unreviewed`, even when `handoffs` is empty.

Hand off required migrations right away; record optional proposals after the
person answers. If a command is refused because a workspace's lophn cannot be
reached, nothing was recorded for that entry: tell the person to open that
workspace and follow `migrate-sdk`, or run `/update` again once reachable.

## 7. Report

Tell the person in plain words:

- Which apps, workflows, or agents are being updated and where each continues
  (its own workspace conversation). Target workspaces report each follow-up item
  with `lophn follow-up report <id> --state done|changed|skipped --outcome "<one line>"`
  (report any Home-targeted follow-up items yourself the same way).
- What you directly cleaned up in `memory.md`, generated skills, or global
  custom agents (if any), and any proposed `LOPHN.md` edits left for them.
- If a workflow migration affects a running instance that is `blocked` (Phase 4
  instances keep their start-time `code_snapshot`), note that they can continue
  it with `[Resume with updated code]`.
- End with the concise one-line summary of any unmatched new platform
  capabilities (when applicable).

If this session stops halfway, already-recorded decisions stay saved and the
next `/update` continues with whatever remains unreviewed.
