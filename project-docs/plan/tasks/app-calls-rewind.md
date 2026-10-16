# app-calls-rewind

앱 data rewind를 새로 짓는다: 고른 invocation부터 최신까지 되돌아갈 목록 계산, 접수 닫고 비우기, SQLite changeset 뒤집기, 앱 process에 적용 지휘, 되돌림 기록. 옛 `core/apps/revert`(call 단계 worker 모델)를 대신한다. 사람만 한다.

- 단위: app-calls (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/rewind/` (새 폴더)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I1.5#8`
  - spec: S5 6~8장, 10~11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S8 4장(session rewind가 앱을 고르는 쪽) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I3.5#9`, `I3.5#10`, `I3.5#11`, `I3.5#14`, `I1.5#7`(옛 revert의 대체 쪽. 옛 폴더 지우기는 app-calls-assembly가 한다)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #17(rewind가 끝나면 `AppViewChanged`)
  - 지금 코드(참고만): `packages/core/apps/revert/{app-steps,caller}.ts`, SQLite changeset format 문서(sqlite.org/sessionintro.html, `sqlite3changeset_invert`)
- 계약:
  - 쓰는 것: `core/apps/ports.ts`의 `AppRewind`(구현해서 내놓는다), `InvocationLedger`, `AppProcessLink`, `AppIntake`, `AppViewSignal`. `protocol/apps/calls`의 `RewindPlan`·`Rewind`·`appRewindPlan`·`appRewind`·`appRewinds`·`ProcessApplyRequest`. 새 table의 schema step 형식은 `core/apps/invocations/schema.ts`를 본보기로 한다.
  - 내놓는 것: `createAppRewind(deps): AppRewind`, 읽기·command handler 등록 함수(`app.rewind_plan`, `app.rewind`, `app.rewinds`), schema step, 순수 함수 `invertChangeset(bytes): Result<Uint8Array>`. app-calls-assembly가 잇는다. places-sessions의 session rewind가 `AppRewind.plan`·`run`을 쓴다.

## 할 일

모두 `packages/core/apps/rewind/` 안의 새 file이다.

1. `invert.ts` — changeset 뒤집기 (`I3.5#9`, S5 6장). 순수 함수이고 IO가 없다.
   - Deno 2.9.7의 `node:sqlite`에는 `createSession()`과 `applyChangeset()`은 있고 뒤집는 함수는 없다. SQLite changeset format(표마다 `T` 머리: 열 수, PK 표시, 표 이름 / 변경마다 연산 byte와 indirect byte와 값들 / INSERT는 새 값, DELETE는 옛 값, UPDATE는 옛 값 묶음 뒤 새 값 묶음 / 값은 undefined·integer·float·text·blob·null)를 직접 읽는다.
   - INSERT ↔ DELETE를 맞바꾸고, UPDATE는 옛 값과 새 값을 맞바꾼다. 안 바뀐 칸(undefined)과 PK 칸은 `sqlite3changeset_invert`가 하는 대로 둔다. patchset(옛 값이 없는 것)과 모르는 연산은 `invalid_input`으로 거절한다. 여러 changeset을 최신부터 뒤집어 한 목록으로 만드는 보조 함수 `invertAll(changesets: Uint8Array[]): Result<Uint8Array[]>`도 둔다.
2. `plan.ts` — 되돌아갈 목록 계산 (`I3.5#10`, S5 7장 2, 10장). 순수 함수 + `InvocationLedger.list` 한 번.
   - 고를 수 있는 것: 그 앱의 지금 활성 release의 live 모드 invocation 중 write·external·앱 시작이고 아직 되돌리지 않은 것. preview·test, 이전 release, `data_change`, 읽기, 이미 `reverted_by`가 있는 것은 `invalid_input`.
   - `from`부터 최신까지(id 순서. invocation id는 시간 순서다)의 되돌림 표시가 없는 invocation을 오래된 것부터 `RewindPlanItem`으로 만든다. 사람의 화면 조작과 다른 session의 호출도 들어간다. `external`이면 `external: true`(바깥 효과는 되돌아가지 않는다는 표시), 지금 도는 호출은 `running: true`.
   - 범위 안에 changeset 없이 닫힌 write·external·앱 시작(결과 모름)이 있으면 `blocked: {reason: "unrecoverable_write", invocation}`. 이때 `run`은 시작하지 않는다.
3. `store.ts`, `schema.ts` — rewind 기록 표 `app_rewinds` (`I3.5#14`): `id`, `app`, `release`, `from_invocation`, `requested_by`, `status`(`applying|applied|cancelled`), `reason_code`, `reason_message`, `invocations`(JSON), `started_at`, `finished_at`. 끝난 행은 바꾸지 못한다. 기록은 지우지 않는다.
4. `run.ts` — rewind 실행 (`I3.5#11`, S5 7장 4~7)
   - 순서: plan이 `blocked`면 `conflict` → `app_rewinds`에 `applying`으로 먼저 남긴다 → `AppIntake.close(app, "rewind")` → `whenIdle(app, 유예)`. 유예(기본 60초, 주입)가 지나도 도는 호출이 있으면 접수를 다시 열고 `cancelled`(reason `conflict`, "running calls did not finish")로 끝낸다 → plan을 다시 계산한다(도는 호출이 끝나며 늘어난 것까지) → `changesetOf`로 changeset을 모아 `invertAll` → `AppProcessLink.apply`.
   - 적용은 앱 process가 한 transaction으로 한다. 충돌(`conflict`)이면 하나도 적용되지 않은 것이므로 `cancelled`(reason `conflict`, 앱이 돌려준 message)로 끝내고 되돌림 표시를 남기지 않는다. `sent: false`이면 `cancelled`(reason `app_unavailable`).
   - 성공이면 `InvocationLedger.markReverted`와 `applied`를 남기고 `AppViewSignal.changed(app, "rewind")`를 부른다. 어떤 길이든 마지막에 `AppIntake.open(app)`을 부른다(finally).
   - 사람만 부를 수 있다: handler가 user actor가 아니면 `forbidden`.
   - core가 rewind 도중 죽어 `applying`으로 남은 행은 기동 때 `cancelled`(reason `core_restarted`)로 닫는 함수 `closeInterruptedRewinds()`를 둔다. 접수 닫힘은 메모리라 재시작하면 저절로 열린다.
5. `commands.ts`, `reads.ts` — handler (`app.rewind` command, `app.rewind_plan`·`app.rewinds` read). 범위 밖 앱은 없는 앱과 같은 `not_found`다(`core/apps/registration`의 `authorizeAppId`를 invocations 읽기와 같은 방식으로 쓴다).
6. `mod.ts` — 위 내보내기.
7. 위험 test 한 file `rewind_test.ts`
   - invert test는 `node:sqlite`로 DB를 만들어 session을 걸고 INSERT·UPDATE·DELETE(text·blob·null·복합 PK 포함)를 한 뒤 뽑은 changeset을 뒤집어 같은 DB에 적용했을 때 처음 상태와 같은지 본다. subprocess를 띄우지 않는다.
   - 나머지는 가짜 `InvocationLedger`·`AppProcessLink`·`AppIntake`로 돈다.
8. (lead가 맞추며 더함 (`I1.5#8`)) SDK `withRevert`와 revert 결과. 새 rewind를 지으면서 옛 `withRevert`를 지운다

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/rewind/rewind_test.ts`):
  - "뒤집은 changeset을 적용하면 DB가 처음 상태로 돌아간다"
  - "external은 되돌리지 않고 표시하고, 결과 모르는 write가 범위에 있으면 rewind를 시작하지 않는다"
  - "적용이 충돌하면 되돌림 표시를 남기지 않고 접수를 다시 연다"
- 남지 않음: 해당 없음(새 폴더). 옛 `core/apps/revert/`는 app-calls-assembly가 지운다.

## 보고

- 바꾼 file
- 등록할 것: core 조립에서 `createAppRewind`·handler·schema step·`closeInterruptedRewinds()`를 잇는 곳(app-calls-assembly). `AppViewSignal`의 실제 구현(lead가 `AppViewChanged` event 내보내기에 잇는다)
- 안 쓰게 된 export: 없음
- 정한 것: 도는 호출 유예 60초와 넘으면 취소, 사슬 안의 이미 되돌린 invocation은 건너뛰는 것, apply가 끝난 뒤 core가 죽어 되돌림 표시를 남기지 못하는 틈(적용은 됐으나 기록이 `cancelled`로 남을 수 있음)을 그대로 둔 것
- 계약 바꾸기 요청(wave 3): `AppProcessLink`·`AppIntake`·`AppViewSignal`에서 모자란 칸
