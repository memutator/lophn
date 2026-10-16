# app-calls-invocations

invocation 기록을 새 모양으로 다시 짓는다: 표와 trigger, core 호출 경로가 직접 남기는 `InvocationLedger`, changeset 보관과 지우기, 읽기(project·session·turn·효과·되돌림 필터), core 재시작 점검. 옛 confirm 접수, 후행 전달 목록, `recordingMode`를 지운다.

- 단위: app-calls (wave 3)
- 선행: app-calls-process (`context.ts`와 앱 process가 `invocations/mod.ts`의 옛 export를 그치게 한 뒤여야 지울 수 있다), app-calls-supervisor (`core/main/app-supervisor/main.ts`가 `delivery/sender.ts`를 import한다)
- 소유(이 task만 고친다):
  - `packages/core/apps/invocations/` (단 `context.ts`는 app-calls-process 소유다. 이 task는 읽기만 한다)
- 읽을 것:
  - spec: S5 5·6장, 7장 6~7(되돌림 표시), 8장(session·turn별 write 목록) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I2.5#2`, `I2.5#3`, `I2.5#4`, `I2.5#6`, `I3.5#8`, `I3.5#15`, `I1.5#6`(`invocations/confirm.ts`와 `accepted` 쪽), `I1.5#15`(`delivery/`, `recording.ts` 쪽), `I2.5#18`(이름)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #51(changeset은 blob store에 두고 release마다 크기 한도를 둔다. 수치는 이 task가 정한다), #18
  - 지금 코드: `packages/core/apps/invocations/*`, 본보기 `packages/core/apps/tickets/blobs.ts`(blob purpose·field 선언), `packages/core/storage/blobs/mod.ts`(쓰는 법만 본다. platform 소유라 고치지 않는다)
- 계약:
  - 쓰는 것: `core/apps/ports.ts`의 `InvocationLedger`(구현해서 내놓는다), `protocol/apps/calls`의 `AppInvocation`·`appInvocations`·`appInvocation`·`changesetRefSchema`·`invocationEffectSchema`, `protocol/storage`의 `defineBlobField`·`defineBlobPurpose`. ledger에 쓰는 transaction 입구는 지금 `commands.ts`·`store.ts`가 쓰는 `Tx`·`Sql`(`protocol/server`)을 따른다.
  - 내놓는 것: `createInvocationLedger(deps): InvocationLedger`, 읽기 handler 등록 함수(`app.invocations`, `app.invocation`), schema step, blob 선언 목록(`INVOCATION_BLOB_FIELDS`, `INVOCATION_BLOB_PURPOSES`). app-calls-assembly가 잇고, app-calls-path·app-calls-rewind는 port로 쓴다.

## 할 일

1. `schema.ts` — 표를 새 모양으로 바꾼다 (`I2.5#1` 모양, `I2.5#2`)
   - 칸: `id`, `app`, `release`, `mode`, `operation`(JSON), `caller`(JSON, null 허용), `caller_kind`·`session`·`turn`(caller에서 뽑은 찾기용 칸), `project`, `effect`, `status`(`running|succeeded|failed|denied|unknown`), `started_at`, `finished_at`, `input_hash`, `summary`, `detail_hash`, `changeset_hash`·`changeset_size`, `reverted_by`. `actor`, `trigger`, `approval`, `accepted` 상태, `approval` unique index를 뺀다 (`I1.5#16`).
   - 색인: `(app, release, mode, id)`, `(app, project, id)`, `(session, turn, id)`, `(status, id)`.
   - trigger: 종료한 행은 `reverted_by`와 `changeset_hash`·`changeset_size`(activation이 지움)만 바꿀 수 있다. `invocations_no_delete`는 남긴다.
   - 개발 data는 schema가 바뀌면 지우고 새로 만든다(AGENTS.md). migration step을 따로 만들지 않고 `apps.invocations.tables` step의 sql을 그대로 고친다.
2. `model.ts`, `rows.ts`, `store.ts` — 새 `AppInvocation`에 맞게 다시 쓴다. `model.ts`는 순수 판정이다: 전이(`running` → 종료 상태, 종료 상태는 못 바꿈), 요약 크기 한도, "시작을 미리 남길 효과"(write·external·앱 시작) 판정 함수 `recordsAtStart(effect, operation)`. `recordingMode`의 automation·confirm 분기는 없어진다 (`I2.5#4`).
3. `ledger.ts` — `InvocationLedger` 구현 (`I2.5#3`, S5 5장)
   - `begin`, `finish`, `recordOnce`, `get`, `list`, `changesetOf`, `markReverted`, `pruneChangesets`, `unfinished`를 port 그대로 구현한다. 앱 process의 machine 통보(`record_started/finished/denied` command와 `requireMachine`)는 이 구현으로 대신하므로 `commands.ts`의 그 command들을 지운다.
   - `finish`는 changeset bytes를 blob으로 저장하고 같은 transaction에서 참조(`changeset_hash`, `changeset_size`)를 남긴다. blob 준비 → 영구 참조 등록 순서와 purpose·field 선언은 `tickets/blobs.ts`와 `storage/blobs`를 보고 같은 방식으로 한다. 선언은 `changesets.ts`에 둔다: purpose `app_changeset`, field `invocation.changeset`(permanent, general_read false).
   - changeset 크기 한도를 정한다(release마다 한 changeset의 상한과 한 release 전체 합의 상한). 수치는 이 task가 정하고 보고에 쓴다. 넘으면 `finish`가 `unknown`으로 닫지 말고 호출 결과는 살리되 `changeset`이 없는 채로 닫는다(그 invocation은 rewind에서 "되돌릴 수 없음"이 된다).
   - `pruneChangesets(app, keepRelease)`: 그 앱에서 `keepRelease`가 아닌 release의 changeset 참조를 지우고 blob 참조를 푼다(`eraseBlobRefs`). invocation 행은 남긴다 (`I3.5#8`).
   - `markReverted(ids, rewind)`: 되돌림 표시 칸만 채운다.
4. `reads.ts` — `app.invocations`, `app.invocation` handler (`I3.5#15`, `I2.5#5`): project·session·turn·효과·status·되돌림 여부·mode·release 필터를 붙인다. 열람 범위(`authorizeAppId`)는 지금대로 둔다. session·turn 필터는 S8이 쓰는 "session·turn별 write 목록"이다.
5. `restart.ts` — core 재시작 점검 (`I2.5#6`): `accepted` 분기를 뺀다. `running`으로 남은 invocation은 결과를 본 근거가 없으므로 `unknown`으로 닫고 근거를 남긴다. 닫는 길은 `InvocationLedger.unfinished()`와 `finish`다. `INVOCATION_RECOVERY_PRINCIPAL`·`INVOCATION_RECOVERY_CONTEXT`는 `core/server/credentials.ts`와 `core/main/daemon/`이 import하므로 이름과 모양을 바꾸지 않는다(operations 목록이 지운 route 이름을 가리키면 새 이름으로만 고친다).
6. 지운다: `confirm.ts`(`accept_confirm`, `I1.5#6`), `delivery/`(후행 전달 목록, `I1.5#15`), `recording.ts`의 `StartFact`·`FinishFact`·`DenyFact`·`SubmittedFact`·`deliveryKey`. `mod.ts`는 새 내보내기로 바꾸되 `context.ts`의 내보내기 블록은 app-calls-process가 바꾼 이름을 따라 맞춘다.
7. 지우기 규칙: 지우거나 이름을 바꾸는 export는 `grep -rn`으로 소유 밖 import를 먼저 본다. 있으면 지우지 않고 보고한다.
8. 위험 test 한 file `ledger_test.ts` (in-memory SQLite와 가짜 blob 저장)
   - 두 개면 충분하다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/invocations/ledger_test.ts`):
  - "끝난 invocation은 되돌림 표시와 changeset 지우기 말고는 바뀌지 않고 지워지지도 않는다"
  - "activation 뒤 changeset 지우기는 이전 release의 changeset만 지우고 invocation 기록은 남긴다"
- 남지 않음: `grep -rniE "approval|accepted|automation|delivery" packages/core/apps/invocations`가 0줄이다(소유 밖이 import해 남긴 이름은 제외하고 보고).

## 보고

- 바꾼 file
- 등록할 것: core 조립에서 schema step, 읽기 handler, `INVOCATION_BLOB_FIELDS`·`INVOCATION_BLOB_PURPOSES`를 잇는 곳(app-calls-assembly). 지운 `invocation.record_*` command를 가리키던 operation 정책과 `core/server/credentials.ts`의 목록
- 안 쓰게 된 export: 소유 밖이 아직 import하는 옛 이름
- 정한 것: changeset 크기 한도 수치, 한도를 넘으면 changeset 없이 닫는 것, 찾기용 칸(`session`·`turn`)
- 계약 바꾸기 요청(wave 3): ledger 쓰기 입구가 `InvocationLedger`에 모자란 곳(route 없는 내부 command 정의가 막히면 여기에 적는다)
