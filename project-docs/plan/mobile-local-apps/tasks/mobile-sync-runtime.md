# mobile-sync-runtime

**opus high.** 컴퓨터의 앱 process(app runtime)가 sync 앱(`runs_on`에 `phone`이 있는 앱)의 DB를 맞출 수 있게 한다: 컴퓨터에서 한 write는 data, changeset, clock 찍기를 한 transaction으로 commit하고 HLC를 돌려준다. 폰에서 온 변경을 last-write-wins로 적용하고 실제로 적용된 effective changeset을 돌려주는 `apps.sync_apply`, 폰이 처음 받을 DB를 뜨는 `apps.snapshot`을 더하고, rewind 적용도 sync 앱이면 effective changeset과 clock을 남긴다. core 쪽(sync log, route, 기록)은 `mobile-sync-ledger`가 이 위에 짓는다.

- 단위: sync (wave 2)
- 선행: mobile-sync-core, mobile-local-sdk. 다른 계획의 land를 기다리지 않는다
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime`(entrypoint, `control-protocol.ts`, `supervisor-link.ts`, `supervisor/relay.ts`와 test. 새 file `entrypoint/sync.ts`)
  - `packages/protocol/apps/calls/process-wire.ts`
  - `packages/core/apps/ports.ts`(`AppProcessLink`에 method 둘)
  - `packages/core/main/app-supervisor/assembly.ts`(새 op 둘의 중계 항목만)
- 읽을 것:
  - 계획 `README.md` "정한 것"(컴퓨터 쪽 한 transaction, SAVEPOINT)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(c)의 "Phone changes on the computer", "First install and snapshots", "Rewind", 4의 "Runtime control messages"
  - sync core: `packages/protocol/apps/sync/mod.ts`(`mobile-sync-core`: `SyncDb` Node adapter, `ensureSyncTables`, `Clock`, `stampLocal`, `applyRemote`)
  - SDK: `packages/sdk/cap-store/{host.ts,connection.ts}`(`mobile-local-sdk`: `STORE_HOOKS.database()`, SAVEPOINT `applyChangesets`, `lophn_sync_*`를 빼는 session)
  - 지금 길: `entrypoint/invoke.ts`(`run`: `state.store.begin/end`, write·external은 `state.exclusive`), `entrypoint/apply.ts`(rewind 적용), `entrypoint/cap-host.ts`(`createStoreAccess`), `entrypoint/{control-server.ts,control.ts,wire.ts,state.ts,main.ts}`(선언은 bundle의 `declaration.json`에서 읽는다), `control-protocol.ts`(`SUPERVISOR_OPS.call`·`apply`와 그 schema), `supervisor-link.ts`(`apply`), `supervisor/relay.ts`, `packages/core/main/app-supervisor/assembly.ts`(`[SUPERVISOR_OPS.apply]` 항목), `packages/protocol/apps/calls/process-wire.ts`(`PROCESS_PATHS`, `processCallResponseSchema`, `processApplyResponseSchema`), `packages/core/apps/ports.ts`(`AppProcessLink`)
- 계약:
  - 쓰는 것: 위 sync core와 SDK hook. 선언의 `runs_on`은 아직 type에 없다(`mobile-local-decl`이 더한다). 그래서 `entrypoint/sync.ts`의 `runsOnPhone(declaration)`이 날 JSON의 `runs_on` 배열에 `"phone"`이 있는지만 본다. `mobile-sync-ledger`와 `mobile-local-prepare`도 이 함수를 쓴다
  - 내놓는 것(HLC는 JSON에서 십진 문자열이다. 정수가 JS number로 안전하지 않을 수 있다):
    - process wire(`process-wire.ts`): `PROCESS_PATHS`에 `sync_apply`, `snapshot`. call 응답(`status: "ok"`과 `"error"` 둘 다)에 `hlc?: string`(sync 앱의 live write·external이 changeset을 냈을 때만). apply 응답 `applied`에 `effective?: base64 | null`, `hlc?: string`(sync 앱일 때만)
    - `processSyncApplyRequestSchema` `{change: {hlc: string, changeset: base64}}` → `processSyncApplyResponseSchema` `{status: "applied", effective: base64 | null, hlc: string} | {status: "not_sync"}`
    - `processSnapshotRequestSchema` `{path: string}` → `processSnapshotResponseSchema` `{status: "written", size: integer, sha256} | {status: "not_sync"}`
    - control op(`control-protocol.ts`): `SUPERVISOR_OPS.syncApply = "apps.sync_apply"` 입력 `{app}`(본문은 bytes stream, apply와 같다), `SUPERVISOR_OPS.snapshot = "apps.snapshot"` 입력 `{app, path}`
    - `AppProcessLink.syncApply(app, request): Promise<Result<ProcessSyncApplyResponse>>`, `AppProcessLink.snapshot(app, request): Promise<Result<ProcessSnapshotResponse>>`. 앱 process가 없거나 준비 전이면 `unavailable`

## 할 일

1. `entrypoint/sync.ts`: `runsOnPhone(declaration)`, live이고 sync 앱이면 시작 때 `ensureSyncTables`를 cap-store의 연결(`STORE_HOOKS.database()`, 아직 열리지 않았으면 여는 길을 `createStoreAccess`에 더한다)에 건다. 컴퓨터의 node와 HLC state는 sync core의 규칙대로 `lophn_sync_state`에 둔다. DB를 쓰지 않는 앱(cap-store를 싣지 않았거나 migration이 없는 앱)은 sync 일을 하지 않는다.
2. sync 앱의 write·external 호출(`invoke.ts`의 `record`): 지금의 `state.exclusive` 안에서 연결에 `begin immediate` → session 시작 → handler → session 끝 → changeset이 있으면 `Clock.next`로 HLC 하나를 내고 `stampLocal` → `commit`. handler가 던져도 지금처럼 바뀐 것과 그 clock을 commit한다(컴퓨터의 기존 규칙: 실패해도 changeset을 싣는다). commit이 실패하면 rollback하고 `internal`, changeset null이다. 응답에 `hlc`를 싣는다. sync가 아닌 앱과 read, preview는 지금 동작 그대로다(감싸지 않는다).
3. `apps.sync_apply`(control server와 `entrypoint/`의 새 handler): live sync 앱이 아니면 `not_sync`. `state.exclusive` 안에서 `begin immediate` → session 시작 → sync core `applyRemote`(그 변경 하나, 받은 hlc 그대로. `Clock.observe`) → session 끝(effective changeset) → `commit`. 응답 `{effective, hlc}`(hlc는 받은 값). 들어온 변경의 table이나 column이 이 DB와 맞지 않으면(다른 release의 변경) rollback하고 `conflict` 오류로 답한다.
4. `apps.snapshot`: live sync 앱이면 `state.exclusive` 안에서 연결로 `VACUUM INTO <path>`를 하고 크기와 sha256을 돌려준다. path는 core가 준 절대 path이고 이미 file이 있으면 실패한다. core가 write 줄(write slot)을 쥔 채 부르므로 snapshot은 sync log의 그 seq와 맞는다(그것은 core의 일).
5. rewind 적용(`apply.ts`): sync 앱이면 바깥 transaction 하나 안에서 session을 켜고 `applyChangesets`(SAVEPOINT) → effective → 새 HLC로 `stampLocal` → commit. 응답에 `effective`와 `hlc`. 충돌이면 지금처럼 하나도 적용하지 않는다.
6. 중계: `control-protocol.ts`에 op 둘과 schema, `supervisor-link.ts`에 `syncApply`·`snapshot`(apply처럼 본문을 bytes로), `packages/core/main/app-supervisor/assembly.ts`에 두 op 항목(`[SUPERVISOR_OPS.apply]` 옆), `supervisor/relay.ts`가 process의 control socket으로 넘긴다. `ports.ts`의 `AppProcessLink`에 두 method.
7. test: entrypoint의 순수 부분은 지금 test 꼴(`invoke_test.ts`, `control_test.ts`)로. 위험 test 둘(아래).

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다(core와 supervisor가 새 op로 뜬다).
- 위험 test:
  - "sync 앱의 write는 data와 그 clock이 늘 같이 commit된다: handler가 던진 호출도 바뀐 것과 clock이 같이 남고, commit 전에 끊긴 호출은 data도 clock도 남지 않는다"
  - "`apps.sync_apply`의 effective changeset은 실제로 바뀐 column만 담는다: 컴퓨터가 더 새 clock으로 쓴 column은 폰의 값으로 덮이지 않고 effective에도 없다"
- 남지 않음: 없음(더하기. sync가 아닌 앱의 호출과 rewind 동작은 바뀌지 않는다. 기존 `invoke_test.ts`, `control_test.ts`, `rewind_test.ts`가 그대로 통과한다).
- flows catalog: 이 task가 더하는 control op와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: process wire와 control op의 최종 모양, `runsOnPhone`이 날 선언을 읽는 자리(`mobile-local-decl`이 type으로 바꿀 한 줄), 바깥 transaction 안에서 같은 연결로 도는 read 호출이 보이는 것(아직 commit 전의 write)과 그것이 지금 autocommit 동작과 다른지.
