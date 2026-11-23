# workspace-reader-and-followups

작업 공간 정본 reader(`declared`/`mentioned` 정적 영향 조회, `app.usage` 정적+호출 통합), 공통 `follow_up_items` store 및 `follow_up.list`/`report`, `release.prepare`의 `command`/`skill`/`event` 계약 변경 감지를 구현한다.

- 단위: `workspace-reader` (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/follow-ups/mod.ts`
  - `packages/core/follow-ups/store.ts`
  - `packages/core/follow-ups/store_test.ts`
  - `packages/core/apps/sdk-status/review-store.ts`
  - `packages/core/apps/sdk-status/status.ts`
  - `packages/core/apps/sdk-status/commands.ts`
  - `packages/core/apps/sdk-status/commands_test.ts`
  - `packages/core/apps/sdk-status/status_test.ts`
  - `packages/core/apps/sdk-status/mod.ts`
  - `packages/core/apps/registration/delete_test.ts`
  - `packages/core/apps/releases/public-tools.ts`
  - `packages/core/apps/releases/public-tools_test.ts`
  - `packages/core/apps/releases/commands.ts`
  - `packages/core/apps/releases/commands_test.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/apps/usage/ports.ts`
  - `packages/core/apps/usage/users.ts`
  - `packages/core/apps/usage/reads.ts`
  - `packages/core/apps/usage/users_test.ts`
  - `packages/core/main/daemon/wiring/apps-usage.ts`
  - `packages/core/main/daemon/wiring/workspace-reader.ts`
  - `packages/core/main/daemon/wiring/follow-ups.ts`
  - `project-docs/flows/tests/core-apps.yaml`
- 읽을 것:
  - `project-docs/products/roadmap/{platform-update,cascade}.md`
  - `project-docs/architecture/app-call.md`
- 계약:
  - 쓰는 것: `packages/protocol/base/follow-ups.ts`, `packages/protocol/lophn-agent/follow-ups.ts`, `packages/protocol/apps/{releases,usage,sdk-status}.ts`
  - 내놓는 것: `packages/core/follow-ups/` store & command/read defs, `workspace-reader.ts` (`readWorkspaceSnapshot`, `scanImpact`, `scanReleaseContractUsers`) for Wave 2 (`update-engine` & `cascade-handoff`), `contract_changes` in `release.prepare`

## 할 일

1. **Common `follow_up_items`, `flow_sdk_reviews`, `platform_reviews` store (`packages/core/follow-ups/store.ts`)**:
   - Implement insert/list/report/erase for `follow_up_items`, upsert/load for `flow_sdk_reviews`, get/set for `platform_reviews`.
   - Implement `follow_up.list` & `follow_up.report` handlers enforcing `P12`: `user` and Home `agent` (`workspace === null`) can list/report any item; `project`/`app` agent can only list/report items for its own workspace (returning `not_found` for items outside its workspace).
   - Migrate `packages/core/apps/sdk-status/{review-store.ts,status.ts,commands.ts,commands_test.ts}` and `packages/core/apps/registration/delete_test.ts` from `sdk_features` to `follow_up_items` (keeping `apps/sdk-status/commands_test.ts` and `delete_test.ts` passing both against `follow_up_items` and testing the `sdk_features` -> `follow_up_items` SQL migration in `store_test.ts`!).
2. **Canonical Workspace Reader (`packages/core/main/daemon/wiring/workspace-reader.ts`)**:
   - Read live canonical state directly on demand (skipping archived apps & archived projects): active apps + active release declarations, `jobs`, active project `workflows/*/{workflow.yaml,flow.ts}`, project/app `skills/*/SKILL.md`, agent definitions (`agents/*.md`), providers, paired machines.
   - Implement `scanImpact(target)` distinguishing `declared` (other active apps' `app_connections` & non-remote `subscriptions`, active `jobs` `action`/`trigger`, active `workflow.yaml` `participants`/creator `agent`/`inputs` agent refs, agent `apps` assignments) vs `mentioned` (active `flow.ts` `agent("...")`, `tool("...")`, `workflow("...")`, `onEvent(...)` literals and skill markdown mentions). Do NOT scan `memory.md` or `LOPHN.md`.
   - Wire `impact.read` memory handler (only `user` or Home `agent` allowed per `P12`).
   - Enhance `app.usage` (`apps-usage.ts` + `usage/users.ts`) via `UsagePorts` so `appToolUsers` combines both static `declared` users (`app_connections`, `jobs` `tool_run`, etc.) and historical `invocations`, sorted deterministically (`order`, `workspaceKey`).
3. **Release Contract Change Diff (`packages/core/apps/releases/public-tools.ts`, `commands.ts`, `control.ts`)**:
   - Compare previous active release vs prepared release for public `commands`, public `skills`, and declared `events` (`removed` or normalized definition `changed`, comparing canonical JSON). Keep `removed_public_tools` & `removed_public_skills` populated alongside `contract_changes` until Wave 2/3 drops the legacy fields.
   - Populate `external_user_count` for each changed/removed command, skill, and event using canonical usage (`usagePorts`), NEVER leaking external workspace names into `release.prepare` (`P12`).
4. Update `project-docs/flows/tests/core-apps.yaml` for added/modified tests (`store_test.ts`, etc.).

## 끝남

- `npx tsc --noEmit -p tsconfig.node.json` passes
- `node tools/electron-node.ts --test packages/core/follow-ups/*_test.ts packages/core/apps/sdk-status/*_test.ts packages/core/apps/registration/delete_test.ts packages/core/apps/releases/*_test.ts packages/core/apps/usage/*_test.ts` passes
- `node tools/check-deps.ts && node tools/flows.ts check` passes

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것 (note `followUpWiring` / `workspaceReaderWiring` for `assembly.ts`!)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
