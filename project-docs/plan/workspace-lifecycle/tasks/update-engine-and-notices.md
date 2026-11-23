# update-engine-and-notices

통합 `update.status`·`update.decide`, `workspace_update_needed` Inbox 알림(필수 `required` 건수 강조, all-zero 해소), `fresh: true` 시 `platform_reviews` 시드, `sdk-decide_test.ts` 갱신을 구현한다.

- 단위: update-engine (wave 2)
- 선행: `workspace-reader-and-followups, cascade-deterministic-core`
- 소유(이 task만 고친다):
  - `packages/core/apps/notices/commands.ts`
  - `packages/core/apps/notices/program-text.ts`
  - `packages/core/apps/notices/notices_test.ts`
  - `packages/core/apps/sdk-status/decide.ts`
  - `packages/core/apps/sdk-status/detect.ts`
  - `packages/core/attention/message_test.ts`
  - `packages/core/main/daemon/wiring/notices.ts`
  - `packages/core/main/daemon/wiring/updates.ts`
  - `tests/e2e/sdk-decide_test.ts`
- 읽을 것:
  - `project-docs/architecture/{app-notice,ui-kit}.md`
  - `project-docs/products/roadmap/platform-update.md`
- 계약:
  - 쓰는 것: `packages/protocol/apps/{notice,sdk-status,updates}.ts`, `packages/core/follow-ups/store.ts`, `packages/core/main/daemon/wiring/workspace-reader.ts`
  - 내놓는 것: `updatesWiring` (wiring handlers for `update.status`, `update.decide`, `update.record`)

## 할 일

1. In `wiring/notices.ts` & `apps/notices/commands.ts`: read `packages/core/agent-workspaces/skills/update/platform-notes.json` (graceful `[]` fallback if missing in isolated tests), pass `platform_notes` to `notices.observe_version`, track `platform_notes_changed` in `core_meta`, and seed `platform_reviews` to the last note ID ONLY when `fresh: true` (`productRow === undefined`).
2. In `apps/sdk-status/detect.ts` & `apps/notices/program-text.ts`: compute all 5 counts (`required_apps`, `required_workflows`, `unreviewed_apps`, `unreviewed_workflows`, `unreviewed_notes`) across active workspaces and emit a single `workspace_update_needed` notice (`action: { kind: "open_home_skill", skill: "update", args: "" }`) with human-readable body highlighting `required` (`required_apps + required_workflows`) counts; mark it read/closed automatically when all counts hit 0.
3. In `packages/core/main/daemon/wiring/updates.ts` (and `apps/sdk-status/decide.ts`): implement `update.status`, `update.decide`, and `update.record` (for `app_sdk`, `flow_sdk`, and `platform` decisions — advancing `sdk_reviews` / `flow_sdk_reviews` / `platform_reviews`, creating `follow_up_items`, sending handoff calls/messages with `lophn follow-up report` instructions to `app`, `project`, or `home` `lophn`, and refreshing `workspace_update_needed`). Ensure custom-agent instructions on `platform` decisions route to Home or target workspace cleanly.
4. Update `packages/core/attention/message_test.ts`, `packages/core/apps/notices/notices_test.ts`, and `tests/e2e/sdk-decide_test.ts` to test unified `workspace_update_needed`, `fresh: true` seeding, `update.status`/`update.decide`, and `follow_up.report`.

## 끝남

- `npx tsc --noEmit -p tsconfig.node.json` passes
- `node tools/electron-node.ts --test packages/core/apps/notices/*_test.ts packages/core/apps/sdk-status/*_test.ts packages/core/attention/*_test.ts` passes
- `node tools/check-deps.ts && node tools/flows.ts check` passes

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것 (`updatesWiring` for `assembly.ts`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
