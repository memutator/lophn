# folder-log

**opus high.** 컴퓨터의 sync log가 다른 기계에서 온 변경을 담게 한다. 지금 `app_sync_log`의 CHECK는 출처를 컴퓨터·기기·rewind로만 받는다. 표를 다시 만들어(`seq`와 다음 번호를 그대로) origin `machine`과 칸 `machine`을 더하고, 기계에서 온 변경을 남기는 recorder, 기계마다의 중복 판정, invocation caller의 `machine`, `app_sync/pull`의 origin `machine`을 더한다. 기계에서 온 줄은 폰이 pull로 받는다(이미 `device`가 다른 줄은 보낸다).

- 단위: sync (wave 1)
- 선행: 없음. `machine-identity` 계획이 main에 land된 뒤 띄운다(`Id<"mch">`, 그 계획의 schema step `remote.devices.kind`가 lock에 먼저 있다)
- 소유(이 task만 고친다):
  - `packages/core/apps/sync/schema.ts`
  - `packages/core/apps/sync/log.ts`
  - `packages/core/apps/sync/service.ts`
  - `packages/core/apps/sync/sync_test.ts`와 새 test file(예: `packages/core/apps/sync/schema_test.ts`)
  - `packages/protocol/apps/app-sync.ts`
  - `packages/protocol/apps/calls/caller.ts`
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/core/main/daemon/wiring/remote.ts`의 `schemaStepsAfterTeams` 끝 한 줄(새 step 목록), `packages/core/storage/migration/schema-steps.lock.json` 끝 `{id, sha256}` 한 항목(같은 wave의 `folder-contract`의 `folder.tables`보다 앞. lead가 merge 순서로 맞춘다)
- 읽을 것:
  - 지금 표: `packages/core/apps/sync/schema.ts`(`apps.sync-log`, AUTOINCREMENT, CHECK 다섯, index 셋), blob 참조는 `owner_key = String(seq)`(`log.ts` `append`의 `registerBlobRef`, `eraseSyncLog`). 그래서 seq를 바꾸면 changeset bytes를 잃는다
  - `log.ts`의 `SyncRecorder`(`duplicate`, `phone`, `written`, `unknown`, `rewound`), `SyncLog`(`page`, `snapshotNeeded`, `prune`, `backfill`), `service.ts`의 `pull`(부른 기기 자신의 줄만 뺀다), `deviceOf`
  - 표 다시 만들기 본보기: `machine-identity`의 `remote.devices.kind`(main의 `packages/core/main/daemon/wiring/remote.ts`나 `packages/core/remote/`), schema step 규칙 `AGENTS.md` "호환성"(이미 낸 step의 SQL은 고치지 않는다. 새 id를 더한다)
  - caller: `caller.ts`의 `person`(`device?`가 더해진 꼴이 본보기. caller는 invocation 표에 JSON이라 schema step이 없다), `packages/core/apps/calls/service.ts`의 `applyPhone`(caller를 만드는 곳)
  - architecture: `project-docs/architecture/app-sync.md` "hub와 sync log", 결정 "다른 기기에 보내는 것은 원래 changeset과 clock"
  - 계획 `README.md` 계약 8, 9, "정한 것"(폴더로 온 변경은 log에 남기고 다시 내보내지 않는다)
- 계약:
  - 쓰는 것: `Id<"mch">`
  - 내놓는 것:
    - schema step `apps.sync-log.machine`: `app_sync_log`을 다시 만든다. 칸은 지금 것 + `machine TEXT`. `origin IN ('computer','device','rewind','machine')`, `(origin = 'device') = (device IS NOT NULL)`, `(origin = 'machine') = (machine IS NOT NULL)`, `(device IS NULL AND machine IS NULL) = (change_id IS NULL)`, `kind IN ('change','skipped','snapshot','held')`(held는 changeset blob을 쥔다: `(kind IN ('change','held')) = (changeset_hash IS NOT NULL)`), 새 칸 `resolved_at TEXT`(held에만), 나머지 CHECK 그대로. index 셋을 다시 만들고 `UNIQUE (machine, change_id) WHERE machine IS NOT NULL`을 더한다. 모든 행의 `seq`와 값이 그대로이고, `sqlite_sequence`의 값이 옛 값보다 작아지지 않는다(지운 번호를 다시 쓰지 않는다)
    - `SyncOrigin`에 `"machine"`, `SyncLogRow`에 `machine: string | null`과 `invocation: string | null`(내보내는 쪽이 operation을 찾는다)
    - `SyncRecorder`에 `duplicateFrom(machine, id) → Result<number | null>`, `machine(inv, change: {machine: Id<"mch">, id: string, hlc: string, changeset: Uint8Array}, status: "applied" | "skipped") → Promise<Result<number>>`(폰의 `phone`과 같은 꼴: 원래 changeset과 hlc를 남긴다), `rebaseline(app, release) → Promise<Result<number>>`(invocation 없는 '다시 snapshot' 줄. 폴더 snapshot을 합친 뒤 `folder-runtime`이 부른다), `held(app, release, change: {origin: SyncOrigin, device?, machine?, id?, hlc, changeset}, reason: "past_horizon") → Promise<Result<number>>`(README 계약 10: 정리된 흔적과 안전하게 합칠 수 없어 적용하지도 내보내지도 않는 변경. bytes를 blob으로 쥔다), `heldList(app) → SyncLogRow[]`(풀리지 않은 것), `resolve(seq, at) → Result<void>`(`resolved_at`을 적는다. bytes는 지우지 않는다)
    - person caller: `{kind: "person", view_session, device?: Id<"dev">, machine?: Id<"mch">}`(둘이 같이 있으면 거절)
    - `pull`은 지금처럼 `change` 줄만 싣는다(held는 폰에 가지 않는다).
    - `app_sync/pull` 출력 `changes[].origin`에 `"machine"`. 폰 code는 이 값을 읽지 않는다(`packages/mobile/src/apps/local/sync.ts`). 바꿀 것 없음을 typecheck로 본다

## 할 일

1. `schema.ts`: 새 step `apps.sync-log.machine`을 `SYNC_LOG_SCHEMA_STEPS` 옆의 새 목록으로(옛 step은 그대로). 새 표에 옮기고, 옛 표를 지우고, 이름을 바꾸고, `sqlite_sequence`를 옛 값 이상으로 둔다. 한 step 안에서 끝난다.
2. 등록(공유 줄)과 lock.
3. `log.ts`: 위 계약. `insertRow`에 `machine`. `rowOf`에 `machine`, `invocation`. `duplicate`(기기)와 `duplicateFrom`(기계)은 각자의 칸으로만 찾는다.
4. `service.ts`: `pull`은 origin `machine` 줄도 싣는다(지금 조건이 그대로 맞는지 test로 본다).
5. `app-sync.ts`의 origin enum, `caller.ts`의 `machine?`.
6. test: 아래 위험 test와 `pull`이 기계 줄을 폰에 주는 것.

## 끝남

- `npm run check`가 통과한다. `npm run check:full`의 schema step lock 검사와 `project-docs/plan/tools/lead/boot.sh`가 통과한다(새 step이 개발 ledger에 걸린다). `cd packages/mobile && npm run typecheck`가 통과한다.
- 위험 test:
  - "표를 다시 만들어도 모든 행과 seq와 changeset이 그대로다": 앱 둘에 change·skipped·snapshot 줄과 computer·device·rewind 줄, blob 참조가 있는 ledger에서 맨 뒤 몇 줄을 지운 뒤(`sqlite_sequence`가 max(seq)보다 크다) step을 걸면, 모든 줄의 칸 값과 seq가 같고 `readChangeset`이 같은 bytes를 돌려주고, 다음에 넣는 줄의 seq가 옛 `sqlite_sequence`보다 크다
  - "held 줄의 bytes는 풀어도 지워지지 않고 폰 pull에 나오지 않는다"
  - "같은 기계의 같은 변경 id는 한 줄이다": `machine` 줄을 두 번 남기면 둘째는 `duplicateFrom`으로 알아보고 unique index가 막는다. 기기의 같은 id와 섞이지 않는다
- 남지 않음: 없음(더하기와 표 다시 만들기).
- flows catalog: 이 task가 바꾸는 `app_sync/pull` 출력과 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: step SQL 전문과 lock 항목, `sqlite_sequence`를 맞춘 방법, 1만 줄 ledger에서 step이 걸리는 시간.
