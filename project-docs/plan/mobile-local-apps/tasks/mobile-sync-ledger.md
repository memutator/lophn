# mobile-sync-ledger

**opus high.** 컴퓨터를 sync 앱의 hub로 만든다: ledger에 앱마다 순서 있는 sync log(`app_sync_log`)를 두고, 컴퓨터에서 한 write·rewind와 폰에서 온 변경을 거기에 순서대로 남긴다. 폰이 부르는 route 넷(`app_sync/push`, `pull`, `snapshot`, `snapshot_file`)과 event `AppSyncChanged`를 짓는다. 폰에서 온 변경은 그 앱의 write 줄을 잡고 invocation 하나가 되어(Activity와 rewind에 든다) app process의 `apps.sync_apply`로 적용되고, invocation의 changeset은 effective changeset이다. 폰 allowlist에 여는 것은 `mobile-local-gate`(land 뒤)다.

- 단위: sync (wave 3)
- 선행: mobile-sync-runtime, mobile-sync-core. 다른 계획의 land를 기다리지 않는다
- 소유(이 task만 고친다):
  - `packages/core/apps/sync`(새 폴더: `schema.ts`(schema step), `log.ts`, `service.ts`(push·pull·snapshot), `snapshots.ts`(임시 file과 만료), `routes.ts`, test)
  - `packages/protocol/apps/app-sync.ts`(새 file: route 넷)
  - `packages/protocol/apps/calls/caller.ts`(person caller의 `device?`)
  - `packages/core/apps/calls/service.ts`와 `packages/core/apps/calls/calls_test.ts`
  - `packages/core/apps/rewind/run.ts`와 `packages/core/apps/rewind/rewind_test.ts`
  - `packages/core/main/daemon/wiring/app-calls.ts`
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에 적는다): `packages/protocol/apps/{mod,registry}.ts`(export와 route 넷), `packages/protocol/events/transient.ts`(`AppSyncChanged` 정의와 union 줄), `packages/core/apps/register.ts`(route 넷), `packages/core/main/daemon/wiring/apps.ts`(service를 조립하고 handler를 붙이는 줄), `packages/core/apps/releases/activation/assembly.ts`(activation 때 정리 한 줄, `pruneChangesets` 옆), `packages/core/main/daemon/wiring/apps-delete.ts`(앱 삭제 때 정리 한 줄), schema step 등록: WIRINGS 맨 뒤 wiring(지금 `packages/core/main/daemon/wiring/remote.ts`의 `remoteWiring`)의 `schemaStepsAfterTeams` 끝 한 줄과 `packages/core/storage/migration/schema-steps.lock.json` 끝 `{id, sha256}` 한 항목(AGENTS.md "호환성")
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(c)의 "Topology", "Phone changes on the computer", "Transport", "First install and snapshots", "What is stored where, and pruning", "Rewind", 4의 "Routes"·"Event"·"Ledger", 6의 위험 test 3·4
  - 계획 `README.md` "정한 것"(폰 변경의 invocation 꼴, core가 죽을 때의 빈틈)
  - runtime 쪽: `packages/core/apps/ports.ts`의 `AppProcessLink.syncApply`·`snapshot`, `packages/protocol/apps/calls/process-wire.ts`의 call·apply 응답의 `hlc`·`effective`(`mobile-sync-runtime`), `packages/core/apps/runtime/entrypoint/sync.ts`의 `runsOnPhone`
  - 지금 호출 길: `packages/core/apps/calls/service.ts`(`createAppCalls`, `queue.acquire(app)`이 앱마다의 write 줄, `deps.ledger.begin/finish`, `execute`), `calls/record.ts`(`decodeChangeset`), `packages/core/apps/invocations/{ledger.ts,changesets.ts,schema.ts}`(changeset blob, 크기 상한, `pruneChangesets`, caller JSON과 `caller_kind`), `packages/core/apps/rewind/{run.ts,plan.ts}`, `packages/core/apps/write-link.ts`(main thread의 ledger 연결), `wiring/app-calls.ts`와 `wiring/apps.ts`(조립), route 본보기 `packages/protocol/apps/calls/{rewind.ts,screen.ts}`(`defineMemory`, `defineFile`), event 본보기 `packages/protocol/events/transient.ts`의 `AppViewChanged`
  - schema step 규칙: `AGENTS.md` "호환성", 본보기 `packages/core/main/daemon/wiring/remote.ts`의 `DEVICES_SCHEMA_STEPS`
  - architecture: `project-docs/architecture/app-call.md`(모든 호출은 core가 기록한다, rewind), `activation.md`(changeset 정리)
- 계약:
  - 쓰는 것: 위 runtime 계약과 sync core(HLC 문자열을 비교하지 않는다. core는 순서를 `seq`로만 다룬다)
  - 내놓는 것(`packages/protocol/apps/app-sync.ts`, actor `["user"]`. 폰 기기 자격도 actor user다):
    - `app_sync/push`(`defineMemory`, name `app_sync.push`): 입력 `{app, release, changes: [{id: string(폰이 만든 ULID), operation: string, started_at: ISO 시각, hlc: string, changeset: base64}]}`(1~256개, 풀어서 10 MiB 이하). 출력 `{results: [{id, status: "applied" | "duplicate", seq}], seq}`. 오류 `invalid_input`, `not_found`, `forbidden`(기기 자격이 아니다), `conflict`(release가 활성이 아니다. `details.active_release`), `unavailable`(앱 process가 없다)
    - `app_sync/pull`(`defineRead`, name `app_sync.pull`): 입력 `{app, release, after: integer ≥ 0, max_bytes?: integer}`. 출력 `{changes: [{seq, origin: "computer" | "device" | "rewind", hlc, changeset: base64}], next: integer, more: boolean, snapshot_needed: boolean}`. 부른 기기 자신이 보낸 줄은 빼되 `next`는 넘긴다. `after`가 그 release의 첫 seq보다 앞이거나 release가 활성이 아니면 `snapshot_needed: true`. 오류 `invalid_input`, `not_found`, `forbidden`
    - `app_sync/snapshot`(`defineMemory`, name `app_sync.snapshot`): 입력 `{app}`. 출력 `{snapshot: string(불투명 id), release, seq, size, sha256, expires_at}`. 오류 `not_found`, `forbidden`, `unavailable`
    - `app_sync/snapshot_file`(`defineFile`, name `app_sync.snapshot_file`): 입력 `{snapshot, offset: integer ≥ 0, length: 1..8 MiB}`. 오류 `invalid_input`, `not_found`(없거나 만료)
    - transient event `AppSyncChanged {app, release, seq}`: log에 줄이 생길 때마다(user session이 받는다. 기기에 여는 것은 `mobile-local-gate`)
    - person caller: `{kind: "person", view_session, device?: Id<"dev">}`. 폰에서 온 변경의 invocation은 `{kind: "person", view_session: <변경 id>, device: <기기 id>}`, effect `write`, operation `{kind: "operation", name: <폰이 준 이름>}`, `started_at`은 폰의 값
    - ledger 표 `app_sync_log`(새 schema step `apps.sync-log`): 앱마다 순서(`seq`), release, origin, 기기(origin이 device일 때), 폰 변경 id(기기마다 하나. 같은 id면 `duplicate`), hlc 문자열, changeset blob hash와 크기, invocation id. changeset bytes는 invocation이 이미 쥔 blob과 같은 것을 가리킨다(새로 담지 않는다)

## 할 일

1. schema step과 log store(`packages/core/apps/sync/{schema,log}.ts`): 위 표. step은 맨 뒤 wiring의 `schemaStepsAfterTeams` 끝과 lock 끝에 붙인다(AGENTS.md). 기존 표를 고치지 않는다.
2. 컴퓨터의 write(`calls/service.ts`의 `execute`): live 호출의 응답에 `hlc`가 있으면 `ledger.finish` 뒤에 그 invocation과 changeset으로 log 줄(`origin: "computer"`)을 쓰고 `AppSyncChanged`를 낸다. 같은 write 줄(queue) 안에서 하므로 seq 순서가 DB에 적용된 순서와 같다.
3. push(`sync/service.ts`, `calls/service.ts`가 내놓는 새 함수 하나로 write 줄·intake·ledger를 같이 쓴다): 부른 자격이 기기 principal(`device:<id>`)이 아니면 `forbidden`. 앱의 활성 release가 입력 release와 다르면 `conflict`. 활성 release의 선언이 `runsOnPhone`이 아니면 `invalid_input`. 변경마다 차례로: 같은 (기기, id)가 log에 있으면 `duplicate`와 그 seq. 아니면 write 줄을 잡고 → invocation begin(위 caller와 effect) → `link.syncApply` → finish(changeset은 `effective`, 없으면 null, status `succeeded`) → effective가 있으면 log 줄(`origin: "device"`, 받은 hlc) → event. app process가 없으면 그 변경과 남은 것을 멈추고 `unavailable`(이미 된 것은 결과에 있다). intake가 닫혀 있으면(rewind·activation 중) 지금 호출처럼 기다린다.
4. pull(`sync/service.ts`): `after` 뒤의 줄을 seq 순서로, changeset blob을 읽어 base64로, `max_bytes`(기본 8 MiB) 안에서 싣는다. 부른 기기의 줄은 빼고 `next`는 넘긴다.
5. snapshot(`sync/snapshots.ts`): write 줄을 잡고 그 앱 log의 마지막 seq를 읽고, core 소유의 임시 폴더(data root 아래 앱마다, 이름은 snapshot id)에 `link.snapshot`으로 쓰게 하고, 줄을 놓는다. 크기·sha256과 만료(10분)를 메모리에 쥔다. `snapshot_file`은 그 file의 구간을 읽는다(core는 DB를 열지 않고 bytes만 준다). 만료되거나 다 읽힌 file은 지운다. core가 다시 뜨면 남은 임시 file을 지운다.
6. rewind(`rewind/run.ts`): sync 앱이면 `link.apply` 응답의 `effective`와 `hlc`로 log 줄(`origin: "rewind"`)을 쓰고 event를 낸다. rewind 범위에는 폰에서 온 invocation도 다른 live write처럼 든다(바꿀 것 없음을 test로 본다).
7. 정리: activation이 옛 release의 changeset을 지울 때(`pruneChangesets` 옆) 그 앱의 옛 release log 줄을 지운다. 앱을 지울 때 그 앱의 log 줄과 임시 snapshot을 지운다.
8. route 등록(`register.ts`, `registry.ts`, `wiring/apps.ts`)과 event(`transient.ts`). `wiring/app-calls.ts`에서 service를 조립한다.
9. 빈틈 보고: 앱이 write를 commit한 뒤 core가 log 줄을 쓰기 전에 죽으면 그 변경은 폰에 가지 않는다. 막지 않고 보고의 "알려진 미완 동작"에 적는다(lead가 이슈로 올린다).

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다(새 step이 개발 ledger에 걸린다).
- 위험 test:
  - "같은 변경 id를 두 번 push하면 invocation 하나와 log 줄 하나만 생기고 둘째는 `duplicate`와 같은 seq를 받는다. invocation의 changeset은 effective changeset이다"
  - "폰 변경을 덮는 rewind는 sync 전의 row로 돌리고 `rewind` log 줄을 남기며, 그 줄은 다른 폰의 pull에서 이긴다"(sync core로 두 사본을 만들어 확인)
  - "snapshot은 그 seq와 맞는다: seq N의 snapshot에 N 뒤의 pull을 적용하면 컴퓨터 DB와 같다"(snapshot을 뜨는 동안 들어온 write가 N 앞이나 뒤 어느 한쪽에만 든다)
  - "schema step이 기존 ledger에 걸려도 다른 표의 행이 그대로다"(새 표만 더한다)
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 route 넷, event, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: route 넷의 최종 모양, `app_sync_log`의 SQL과 lock 항목, push 하나에 걸리는 시간(변경 1, 256개), 폰이 알아야 할 오류 갈래(`conflict`일 때 폰이 할 일), core가 죽을 때의 빈틈.

## lead가 더함 (2026-11-15)

- core가 앱의 commit과 sync log 줄 사이에서 죽으면 그 변경이 폰에 가지 않는 빈틈을 이슈로만 남기지 않는다. 사람의 data가 두 기기에서 갈라지는 길이라 이 task에서 닫는다: core가 뜰 때(와 sync 앱이 활성화될 때) 활성 release의 live invocation 가운데 changeset이 있고 log 줄이 없는 것을 찾아 invocation 순서대로 log 줄을 채운다. 위험 test 하나(log 줄 없이 끝난 write가 다시 뜬 뒤 pull에 나온다). 이것이 순서나 hlc 때문에 안 되면 왜 안 되는지와 남는 경우를 보고한다.
