# cascade-handoff-and-cli

삭제 확인 창/CLI의 의미적 `clean_up`(`now`/`later`) 인계 연결, `release.activate` 확정(`A21` 전환) 사후 계약 변경 인계, 그리고 새 CLI 명령(`follow-up`, `update`, `impact`, `artifact delete`, `workflow rename|delete`)을 구현한다.

- 단위: cascade-handoff (wave 2)
- 선행: `jobs-archive-and-erase, cascade-deterministic-core, workspace-reader-and-followups`
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/activation/orchestrator.ts`
  - `packages/core/apps/releases/activation/assembly.ts`
  - `packages/core/apps/releases/activation/orchestrator_test.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/daemon/wiring/apps-delete.ts`
  - `packages/core/main/daemon/wiring/apps-delete_test.ts`
  - `packages/core/main/daemon/wiring/cascade.ts`
  - `packages/core/main/daemon/wiring/router.ts`
  - `packages/cli/commands/app.ts`
  - `packages/cli/commands/workflow.ts`
  - `packages/cli/commands/project.ts`
  - `packages/cli/commands/release.ts`
  - `packages/cli/commands/follow-up.ts`
  - `packages/cli/commands/update.ts`
  - `packages/cli/commands/impact.ts`
  - `packages/cli/commands/artifact.ts`
  - `packages/cli/commands/mod.ts`
  - `project-docs/flows/areas/cli.yaml`
- 읽을 것:
  - `project-docs/products/roadmap/cascade.md`
  - `project-docs/architecture/{app-call,activation}.md`
- 계약:
  - 쓰는 것: `packages/protocol/follow-ups`, `packages/protocol/apps/{updates,apps,releases}.ts`, `packages/core/main/daemon/wiring/workspace-reader.ts`, `packages/core/follow-ups/store.ts`
  - 내놓는 것: `cascadeWiring` (writer hook for delete-time cascade & post-activation contract cascade), CLI commands (`follow-up`, `update`, `impact`, `artifact delete`, `workflow rename|delete`)

## 할 일

1. **Delete-time cascade & handoff (`packages/core/main/daemon/wiring/cascade.ts`)**:
   - Wrap `app.delete`, `agent.delete`, `artifacts.delete`, `WorkflowDelete`: before mutating, run `scanImpact(target)`. On commit success:
     - Determine effective `clean_up`: use input `clean_up` if provided (`"none" | "now" | "later"`), or default to `"later"` when an `agent` calls delete and impacts exist (`declared.length + mentioned.length > 0`).
     - When `"now"` or `"later"`: insert `open` `follow_up_items` (`origin: "cascade"`) grouped per affected workspace (`home` if global/unscoped), embedding immediate deleted items (including erased job specs), `declared` refs, `mentioned` candidates, fixed `memory.md` cleanup + `LOPHN.md` proposal-only sentence, Phase 4 `blocked` workflow `[Resume with updated code]` note, and `lophn follow-up report` command.
     - When `"now"`: if all affected items belong to a single workspace, open/reuse a `lophn` session in that workspace and send the cleanup handoff message; if spanning >= 2 workspaces, send a coordinator handoff to `Home` `lophn`; return `handoff_session`. Attach `follow_ups` & `handoff_session` to the delete command result!
     - Also hook `productStartListeners` in `wiring/apps.ts` to trigger unified update detection (`recordWorkspaceUpdates` / delegated to `updatesWiring` in `assembly.ts`).
2. **Post-activation contract change cascade (`packages/core/apps/releases/activation/orchestrator.ts` + `wiring/apps.ts`)**:
   - Capture `previous_release` BEFORE `completeActivation` overwrites `active_release` (for both immediate `release.activate` AND `activation.consent` `[Allow]`).
   - Run post-activation hook comparing previous vs newly active release (`commands`, `skills`, `events` removed or schema changed). For each affected downstream workspace on this machine (active app connections/subscriptions, jobs, active project `flow.ts`), record `follow_up_items` (`origin: "cascade"`) and route handoff immediately (`1` downstream workspace → direct to its `lophn`; `>= 2` → Home `lophn`). Add risk unit test in `orchestrator_test.ts`.
3. **CLI commands (`packages/cli/commands/`)**:
   - Create `follow-up.ts` (`follow-up.list`, `follow-up.report`), `update.ts` (`update.status`, `update.decide`), `impact.ts` (`impact.read`), `artifact.ts` (`artifact.delete`).
   - Add `workflow.rename` and `workflow.delete` in `workflow.ts`.
   - Remove deprecated `app.sdk_decide` & `app.sdk_feature` from `app.ts` (update `app.sdk_status` summary/description cleanly). Update `release.ts` to format `contract_changes` cleanly (`commands`/`skills`/`events`).
   - Register new commands in `commands/mod.ts` and update `project-docs/flows/areas/cli.yaml`.

## 끝남

- `npx tsc --noEmit -p tsconfig.node.json` passes
- `node tools/electron-node.ts --test packages/core/apps/releases/activation/orchestrator_test.ts packages/core/main/daemon/wiring/apps-delete_test.ts packages/cli/*_test.ts` passes
- `node tools/check-deps.ts && node tools/flows.ts check` passes

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것 (`cascadeWiring` for `assembly.ts`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
