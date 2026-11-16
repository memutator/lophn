# folder-runtime

**opus high.** 컴퓨터의 앱 process와 호출 길이 폴더에서 온 data를 받게 한다. `sync_to`가 있는 앱도 컴퓨터에서 sync 앱이 되고(clock 표, sync log), 앱 process가 변경 여럿을 한 transaction으로 적용하는 길(제약에 걸린 변경만 SAVEPOINT로 건너뜀)과 다른 기계의 snapshot을 합치는 길을 내며, core의 calls가 그것을 `FolderApply` port로 감싸 invocation과 sync log 줄을 남긴다. core가 정한 clock 아래의 tombstone을 정리하는 control과, 정리된 흔적과 안전하게 합칠 수 없는 변경을 버리지 않고 held 줄로 남기고 사람이나 앱의 agent가 그것을 다시 적용하거나 버리는 길을 낸다.

- 단위: sync (wave 2)
- 선행: folder-contract, folder-engine, folder-log, folder-decl. 넷 다 wave 1이다
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/entrypoint/sync.ts`와 `sync_test.ts`
  - `packages/core/apps/runtime/entrypoint/main.ts`(sync store를 여는 조건만)
  - `packages/core/apps/runtime/entrypoint/control-server.ts`
  - `packages/core/apps/runtime/entrypoint/limits.ts`
  - `packages/core/apps/runtime/control-protocol.ts`
  - `packages/core/apps/runtime/supervisor-link.ts`
  - `packages/core/apps/runtime/supervisor/relay.ts`
  - `packages/protocol/apps/calls/process-wire.ts`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/calls/service.ts`와 `packages/core/apps/calls/calls_test.ts`
  - `packages/core/apps/sync/routes.ts`, `packages/core/apps/sync/service.ts`, `packages/core/apps/sync/snapshots.ts`
- 공유 줄 허락(보고의 "넘길 줄"에): `packages/core/main/daemon/wiring/apps.ts`에서 sync 판정 두 함수(아래)를 넘기는 줄
- 읽을 것:
  - 지금 길: `entrypoint/sync.ts`(`runsOnPhone`, `openSyncStore`, `forgetMovedColumns`, `applyPhoneChange`, `writeSnapshot`, `constraintError`), `entrypoint/main.ts` ~l.125(sync store를 여는 조건), `entrypoint/control-server.ts`(control 처리), `process-wire.ts`(`PROCESS_PATHS.sync_apply`, `snapshot`, 요청·응답 schema), `runtime/supervisor-link.ts`·`supervisor/relay.ts`·`control-protocol.ts`(core → supervisor → 앱 process), `ports.ts`의 `AppProcessLink.syncApply`·`snapshot`
  - `calls/service.ts`의 `applyPhone`(intake, `queue.acquire(app)` write 줄, active release 검사, invocation begin → link → finish, sync log, `exclusive`)
  - `sync/routes.ts`의 `syncAppOf`, `sync/service.ts`의 push 검사("the app does not run on the phone"), `sync/snapshots.ts`의 `isSync`
  - sync core(`folder-engine`이 더한 것): `mergeSnapshot`, `dropTombstones`, `hlcAtMs`, `maxHlc`, `unsafePastHorizon`, `ApplyStats.held`, `applyRemote`
  - port(`folder-contract`): `packages/core/folder/ports.ts`의 `FolderApply`. recorder(`folder-log`): `duplicateFrom`, `machine`, `rebaseline`, `held`, `heldList`, `resolve`, caller의 `machine`
  - 선언(`folder-decl`): `AppDeclaration.sync_to`
  - architecture: `project-docs/architecture/app-sync.md`(호출 하나는 transaction 하나, 제약에 걸린 변경 하나는 건너뛴다, 원래 changeset과 clock을 보낸다), `app-call.md`(모든 호출은 core가 기록한다)
  - 계획 `README.md` "정한 것"(받은 변경 하나가 invocation 하나, file 하나가 transaction 하나, snapshot 합치기는 invocation 하나, horizon과 '다시 snapshot')
- 계약:
  - 쓰는 것: 위 셋
  - 내놓는 것:
    - `syncsData(declaration)`(`runs_on`에 phone이 있거나 `sync_to`가 있다)와 `runsOnPhone`(그대로). 컴퓨터의 sync store, sync log의 `isSync`는 `syncsData`. 폰 route(`app_sync/push`, `snapshot`)의 "폰에서 도는 앱" 검사는 `runsOnPhone`(새 dep `runsOnPhone(app, release)`)
    - control `sync_apply`: 요청 `{changes: [{hlc, changeset}]}`(1~1,000개, 합 16 MiB), 응답 `{status: "applied", results: [{status: "applied", effective: base64 | null} | {status: "skipped", message} | {status: "held"}]} | {status: "not_sync"}`. 한 transaction이고 변경마다 SAVEPOINT다. 제약 오류는 그 변경만 `skipped`, 정리된 흔적과 안전하게 합칠 수 없는 변경은 적용하지 않고 `held`, 표·칸이 맞지 않으면 `conflict`이고 아무것도 남지 않는다. 폰 길은 한 개짜리로 부르고, `held`면 log에 held 줄을 남기고 폰에는 `skipped`로 답한다(폰 code는 그대로)
    - 새 control `snapshot_merge`(`PROCESS_PATHS.snapshot_merge`): 요청 `{path}`(core가 data root 아래에 풀어 둔 SQLite file), 요청에 `absent_deletes?: {below: hlc, keep: [{table, pk: base64}]}`(README 계약 10 (a). keep은 이 기계의 held 줄이 건드리는 row), 응답 `{status: "merged", effective: base64 | null, deleted: int} | {status: "not_sync"}`. 한 transaction, 모양이 다르면 `conflict`이고 아무것도 남지 않는다. `AppProcessLink.snapshotMerge`
    - `createAppCalls`의 결과에 `folder: FolderApply`:
      - `applyChanges`: intake와 write 줄을 한 번 잡고, 활성 release가 입력과 다르면 `conflict`(`details.active_release`), 변경마다 `duplicateFrom(origin, id)`이면 건너뛰고(`duplicate`로 셈), 남은 것마다 invocation을 연다(caller `{kind: "person", view_session: id, machine: origin}`, operation은 받은 이름(없으면 `lophn.sync`), effect `write`, 시작 시각은 받은 값). `sync_apply` 한 번, invocation마다 effective changeset으로 닫고, 적용된 변경마다 `sync.machine(...)`, `held`인 변경마다 `sync.held(..., "past_horizon")`. 앱 process가 없으면 `unavailable`이고 연 invocation은 기존 규칙대로 닫는다
      - `mergeSnapshot`(입력에 `absentDeletes?`. `FolderApply`의 port type에 더한다): 같은 줄에서 invocation 하나(operation `lophn.snapshot_merge`, caller의 `view_session`은 `snapshot:<n>` 꼴로 부르는 쪽이 준다), `snapshot_merge`, 닫고, 바뀐 것이 있으면 `sync.rebaseline`(폰은 새 snapshot을 받는다: 합친 변경들의 clock이 하나가 아니라 log 줄 하나로 보낼 수 없다)
    - 새 control `sync_cleanup`: 요청 `{before: hlc}`, 응답 `{dropped, horizon: hlc | null, max_hlc: hlc}`. `before`는 core(`folder-surface`)가 README 계약 10의 식으로 정한다. 이 task는 넘겨받은 값으로만 지운다. `AppProcessLink.syncCleanup`
    - held 풀기: `calls`의 `syncHeld: { list(app), apply(app, seq), discard(app, seq) }`. `apply`는 그 held 줄의 changeset을 지금 clock의 이 기계 write로 다시 적용한다(새 control `sync_reapply {changeset}`: `stampLocal`과 함께 한 transaction. invocation 하나, caller는 부른 사람이나 agent, operation `lophn.sync_held_apply`, 보통 write처럼 sync log에 남아 내보내진다) 뒤 `resolve`. `discard`는 `resolve`만 한다(bytes는 기록에 남는다)

## 할 일

1. `entrypoint/sync.ts`: `syncsData`, `applyFolderChanges`(=`applyPhoneChange`를 여럿으로. 폰 길은 이것을 한 개로 부른다), `mergeSnapshotFile`(read-only로 연 snapshot을 `mergeSnapshot`에 준다. ATTACH는 쓰지 않는다), `sync_cleanup`, `sync_reapply`. `main.ts`는 sync store를 여는 조건만 `syncsData`로.
2. process-wire, control-protocol, control-server, supervisor-link, relay, `ports.ts`: 위 control 넷. 크기 한도는 `limits.ts`에.
3. `calls/service.ts`: `folder`, `syncHeld`. `applyPhone`은 바뀐 `syncApply` 모양에 맞춘다(동작 같음).
4. `sync/routes.ts`·`service.ts`·`snapshots.ts`: 판정 둘로 나누기. wiring 한 줄(공유 줄).
5. test: 아래 위험 test, 그리고 `runs_on ["computer"]` + `sync_to` 앱이 컴퓨터 write를 sync log에 남기는 것.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "폴더 file을 적용해도 사람의 data를 잃거나 망가뜨리지 않는다": 같은 변경 묶음을 두 번 적용하면 두 번째는 data도 clock도 그대로이고 invocation과 log 줄이 늘지 않는다(duplicate). 묶음 가운데 하나가 제약에 걸리면 그것만 빠지고 나머지는 적용된다. 표가 맞지 않는 변경이 하나라도 있으면 묶음 전체가 아무것도 바꾸지 않는다(DB dump가 같다). 적용 도중 앱 process가 죽으면 DB는 묶음 앞과 같다
  - "snapshot 합치기는 받는 쪽만 고친 칸을 지우지 않고, 폰에는 '다시 snapshot' 줄이 남는다"
  - "정리된 흔적과 부딪는 변경은 버려지지 않는다": horizon 이하 clock으로 지워진 row를 되살리려는 폴더 변경과 폰 변경은 DB를 바꾸지 않고 bytes 그대로 held 줄이 되고, `apply`하면 이 기계의 새 write로 들어가 내보내지고, `discard`해도 bytes가 log에 남는다
  - (기존) 폰 push·pull·snapshot test와 `calls_test.ts`가 그대로 통과한다
- 남지 않음: `grep -rn "runsOnPhone" packages/core/apps/sync packages/core/apps/runtime/entrypoint/main.ts`가 폰 route 검사 말고 0줄이다.
- flows catalog: 이 task가 더하거나 바꾸는 control 요청(`sync_apply`, `snapshot_merge`, `sync_cleanup`, `sync_reapply`)과 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: control 둘의 최종 모양, `FolderApply` 구현의 오류 갈래, 1,000개 묶음 적용 시간, snapshot 10k row 합치기 시간, 폰 길이 그대로인 근거(test 이름).
