# prompts-skills-and-sdk-note

평소 turn 인지를 위한 내장 prompt·skill `description` 정렬, 통합 `/update` skill과 `platform-notes.json` 기준선 메모 3편, `A21` 사후 인계 지침 전환, 그리고 `@lophn/agent` `1.18.0` 판 올림과 `agent-1.18.0.md` SDK 메모를 작성한다.

- 단위: `prompts-skills` (wave 2)
- 선행: `tooling-checks, workspace-reader-and-followups`
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/prompts/home.md`
  - `packages/core/agent-workspaces/prompts/project.md`
  - `packages/core/agent-workspaces/prompts/app.md`
  - `packages/core/agent-workspaces/skills/update-apps/SKILL.md`
  - `packages/core/agent-workspaces/skills/update/SKILL.md`
  - `packages/core/agent-workspaces/skills/update/platform-notes.json`
  - `packages/core/agent-workspaces/skills/update/notes/durable-workflows-and-flow-2.md`
  - `packages/core/agent-workspaces/skills/update/notes/phone-native-and-app-files.md`
  - `packages/core/agent-workspaces/skills/update/notes/coding-agent-harness-profiles.md`
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`
  - `packages/core/agent-workspaces/skills/write-workflow/SKILL.md`
  - `packages/core/agent-workspaces/skills/connect-computers/SKILL.md`
  - `packages/core/agent-workspaces/skills/new-app/SKILL.md`
  - `packages/core/agent-workspaces/skills/repair-app/SKILL.md`
  - `packages/core/agent-workspaces/skills/write-artifact/SKILL.md`
  - `packages/core/agent-workspaces/skills/publish-package/SKILL.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/SKILL.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/agent-1.18.0.md`
  - `packages/sdk/agent/package.json`
  - `packages/sdk/agent/guide.md`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`
  - `packages/core/apps/packages/template/app/package.json.tmpl`
  - `tests/support/app/sample/lophn.ts.tmpl`
  - `packages/protocol/lophn-agent/skill-settings.ts`
  - `project-docs/flows/areas/agents.yaml`
  - `package-lock.json`
- 읽을 것:
  - `project-docs/products/roadmap/{platform-update,cascade}.md`
  - `.claude/skills/sdk-note/SKILL.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/agent-1.10.0.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/flow-2.0.0.md`
- 계약:
  - 쓰는 것: `update.status`, `update.decide`, `follow-up list|report`, `impact read`, `release.prepare` `contract_changes`
  - 내놓는 것: built-in skill `update` (replacing `update-apps`), `platform-notes.json` + 3 baseline notes, `@lophn/agent` `1.18.0` + `agent-1.18.0.md`

## 할 일

1. Update `prompts/{home,project,app}.md`:
   - Static capability alignment (keep prompt cache clean — no dynamic version numbers/diffs): mention phone native capabilities + app files + table `sync` + `across_machines` events; `@lophn/flow` 2.0 durable primitives (`step(key, fn)`, `human()`, sub-workflow `workflow()`, `onEvent()`, declarative `inputs`, `flow_sdk` stamped by `workflow check`); coding agent `harness_config` profiles & custom agent instructions maintenance.
   - Replace `A21` pre-activation multi-workspace wait-for-consent instructions in `app.md` & `home.md` with post-activation cascade: check `contract_changes` counts on `release prepare` to catch accidental deletions; intentional changes activate immediately, and core automatically records follow-up items & routes handoffs upon activation.
   - Replace `/update-apps` with `/update` and `app sdk-feature` with `follow-up list|report`, including ownership split (`memory.md` & generated skills edited + reported; `LOPHN.md` proposed only) and `blocked` Phase 4 workflow `[Resume with updated code]` reporting.
2. Align frontmatter `description` lines in built-in skills (`design-app`, `write-workflow`, `connect-computers`, `new-app`, `repair-app`, `write-artifact`, `publish-package`, `migrate-sdk`) to respect size limits (`node tools/check-skills.ts`) and surface phone native/files, flow 2.0/inputs/onEvent/sub-workflows, and multi-machine sync clearly.
3. Delete `skills/update-apps/SKILL.md`, create `skills/update/SKILL.md` (`name: update`, `update-apps` → `update` in `skill-settings.ts` and `project-docs/flows/areas/agents.yaml` `skill-update` flow), `platform-notes.json`, and the 3 baseline notes (`durable-workflows-and-flow-2`, `phone-native-and-app-files`, `coding-agent-harness-profiles`). Ensure `SKILL.md` encodes asset-matched `ask` (only ask when `workspace_summary` shows existing matching assets; list unmatched new capabilities in a 1-line summary at the end) and ownership-split cleanup (`memory.md`/generated skills vs `LOPHN.md` vs `runtime: custom` global/local agents).
4. Bump `@lophn/agent` from `1.17.0` to `1.18.0`, update `packages/sdk/agent/guide.md`, update `@lophn/agent` pins in `template/app/*` and `tests/support/app/sample/lophn.ts.tmpl`, run `npm install --package-lock-only` in this worktree, and write `skills/migrate-sdk/agent-1.18.0.md` (`Breaking: no`, `## Instruction diff`).

## 끝남

- `node tools/check-skills.ts && node tools/check-sdk-notes.ts && node tools/flows.ts check` passes
- `npx tsc --noEmit -p tsconfig.node.json` passes
- `git grep "update-apps" packages/core/agent-workspaces/ packages/protocol/lophn-agent/skill-settings.ts` returns 0 matches (excluding historical `migrate-sdk/agent-1.10.0.md`..`1.17.0.md`)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
