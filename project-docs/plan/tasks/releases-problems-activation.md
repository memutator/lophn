# releases-problems-activation

activation을 S7대로 새로 짠다. `TicketVerified`가 계기이고, 선언이 넓어지거나 data 손실 migration이 있을 때만 사람에게 묻고, 앱마다 줄에 세워 하나씩 진행하고, 실패하면 복구본으로 되돌려 이전 release를 남긴다. ledger 쪽(`release` 표, command, read, 비교)과 data 쪽(`core/apps/data`: attempt, 복구본, migration의 loss 읽기, PRIMARY KEY 검사)과 진행 쪽(handler, 줄, 순서)을 한 task가 한다. 크므로 "할 일"의 A(ledger와 data)를 끝내 commit한 뒤 B(진행)를 같은 branch에서 잇는다.

- 단위: releases-problems (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/activation/` (전부)
  - `packages/core/apps/releases/commands.ts`, `compare.ts`, `facts.ts`, `reads.ts`, `schema.ts`, `sdk-permissions.ts`, `store.ts`
  - `packages/core/apps/data/` (전부)
  - `packages/core/main/worker/main.ts` (data worker 입구가 바뀔 때만)
  - `packages/core/main/app-supervisor/data-runner.ts` (확인. data worker를 띄우는 file이고 job 입력 이름이 바뀐다. ownership.md에 없는 file이다. 보고의 "소유 바꾸기")
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.7#12`
  - spec: S7 4~11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - spec: S2 5~6장(intent `activation`, 보류 request, `ApprovalDecided`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S1 5·10장(Reactor, 줄은 메모리) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S5 6·7장(changeset 삭제, drain) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#1`, `I1.7#2`, `I1.7#4`, `I2.1#2`(자기 path의 `from events` 읽기만), `I2.5#25`(activation·compare·facts 몫), `I2.7#1`, `I2.7#2`, `I2.7#3`, `I2.7#4`, `I2.7#5`, `I2.7#7`, `I2.7#8`, `I2.7#10`, `I2.7#13`, `I2.7#14`, `I2.7#15`, `I2.7#17`(commands.ts의 대조), `I3.7#1`, `I3.7#2`, `I3.7#3`, `I3.7#4`, `I3.7#5`, `I3.7#6`, `I3.7#14`
    - 같이 읽되 다른 단위 몫인 줄: `I2.7#6`, `I2.7#9`, `I2.7#11`, `I2.7#12`(approvals, app-calls, platform 배정. 이 task는 호출하는 쪽)
  - 결정: `../README.md` 3장 #17(`AppViewChanged`), #75(손실 선언 위치). `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md`의 #76(여럿이면 가장 새로 준비된 release), #77(줄은 메모리), #84(카드 내용)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `testing.md`
  - 지금 코드: 위 소유 path 전부. 특히 `activation/{orchestrator,steps,recovery,assembly,state,desired}.ts`, `commands.ts`, `compare.ts`
- 계약:
  - 쓰는 것(이름은 contract task가 고정한 것을 따른다):
    - `protocol/apps/activation/`(contract-releases-problems-releases): `activationAttemptIdSchema`, `activationRunSchema`, `releaseRecordSchema`, `activationFailureSchema`, `activationComparisonSchema`, `activationQueueEntrySchema`, `activationDataResultSchema`, route `activation.start`·`activation.record_backup`·`activation.record_data_change`·`activation.record_data_restore`·`activation.complete`·`activation.fail`·`activation.activate_previous`, read `activations.queue`·`activations.compare`·`releases.list_records`·`releases.get_record`, 데이터 job(`encodeActivationDataJobInput` 등), `lossOfStepSql`, `tablesWithoutPrimaryKey`, `MIGRATION_PRIMARY_KEY_REQUIRED`
    - domain event `TicketVerified`, `ApprovalDecided`, `ReleaseActivationFailed`(payload `{ app, ticket, failure: { code, summary } }`)와 남지 않는 event `AppViewChanged{ reason: "activation" }` — contract-events가 `protocol/events`에 둔다. Reactor 등록과 Bus는 `core/events/ports.ts`다.
    - 보류 request 만들기·취소와 Gate 입력(intent `kind: activation`) — contract-approvals가 `protocol/approvals`와 `core/approvals/ports.ts`에 둔다.
    - 앱 호출 drain·붙잡기, 이전 release의 changeset 삭제 — contract-app-calls가 `core/apps/ports.ts`에 둔다. 앱 grant를 새 선언과의 교집합으로 맞추는 일은 contract-approvals의 port다.
    - 위 port의 정확한 함수 이름은 이 brief를 쓴 시점에 file이 없다. 작업 위치의 그 file을 읽고 쓴다. 없거나 모자라면 고치지 말고 "계약 바꾸기 요청"에 적는다.
  - 내놓는 것:
    - `core/apps/releases/compare.ts`의 `compareForActivation`, `asksFor` (아래 A4)
    - `core/apps/releases/store.ts`의 `findReleaseForTicket(sql, ticket)`와 `releaseLookupOf(sql)`(`{ get(id), activeOf(app), previousOf(id) }`가 `{ id, app, number, code_commit, activated_at, resources }`를 내는 읽기. `resources`는 release의 선언에서 `permissionLabel`로 만든 바깥 자원 이름. `core/problems/ports.ts`의 `ReleaseLookup`을 구조로 맞춘다. module끼리 import하지 않으므로 그 file은 import하지 않고, 조립 wiring이 끼운다)
    - `core/apps/data/mod.ts`의 `discardBackups`
    - 지금 밖에서 쓰는 export의 이름과 호출 꼴은 바꾸지 않는다(`releases/mod.ts`가 다시 내보내는 `runActivation`, `rollback`, `recoverActivation`, `observeReleaseActivations`, `loadMigrationHistory`, `attemptOf`, `bundleFlags`, `createCopyPreviewBundles`, `dataChangesOf`, `dataSchemaOf`, `desiredFromBundle`, `readBundleCopy`, `compareReleases`, `loadRelease`·`loadReleases`·`loadActiveRelease`·`loadStoredBlueprint`·`insertRelease`·`releaseDeclarations`·`releaseWording`, `activationAttemptGate`, `createReleaseCommands`, `createReleaseReads`와 `core/apps/register.ts`·`main/daemon/core.ts`가 import하는 것). 쓰던 곳이 남는 옛 함수는 지우지 않고, 새 이름을 옆에 더한다. 안 쓰게 되면 보고한다. `releases/mod.ts`는 `releases-problems-bundle`이 정리한다.

## 할 일

### A. ledger와 data

A1. `schema.ts` (I2.7#14, I2.7#2): `releases` 표를 새 `ReleaseRecord` 꼴로 고친다. 개발 data는 지운다(schema step을 그대로 고친다. migration step을 더하지 않는다).
  - `activated_at TEXT`를 더한다. `status`가 `active`·`superseded`이면 NOT NULL인 CHECK.
  - `ticket_source`를 NOT NULL로 한다(호환 장치였던 null 허용을 뺀다). `releases_immutable` trigger는 그대로 둔다.
  - `activation` json은 `activationRunSchema` 꼴이다. `releases_one_activating` index는 둔다(앱마다 시도는 하나. 줄은 메모리).
  - 복구 요청 표 `activation_requests(release TEXT PRIMARY KEY, requested_at TEXT NOT NULL)`를 더한다. `activate_previous`가 같은 tx에 쓰고 B의 driver가 읽어 줄에 세운다(commit 뒤 hook이 없다. 정한 것으로 보고).

A2. `store.ts` (I2.7#2, I2.7#15): `releaseFromRow`가 `ReleaseRecord`를 낸다(`activated_at`, 새 `activation`, `failure`). 옛 `Release`를 돌려주던 `loadRelease`·`loadReleases`·`loadActiveRelease`의 이름과 호출 꼴은 유지하고 반환 type을 `ReleaseRecord`로 바꾼다(다른 task의 file이 `Release`로 받아도 깨지지 않는지 `deno task check`로 본다. 깨지면 새 이름 `loadReleaseRecord`·`loadReleaseRecords`를 더하고 옛 이름은 옛 type을 그대로 둔다).
  - `findReleaseForTicket(sql, ticket): Result<ReleaseRecord | null>`를 더한다. `ticket_source.ticket`이 같은 release 가운데 `number`가 가장 큰 것을 돌려준다(결정 #76). 있는 index는 `releases_ticket_source`다.
  - `releaseLookupOf(sql)`을 더한다(위 "내놓는 것").
  - `releaseWording`, `releaseDeclarations`는 problems의 옛 register가 import한다. 지우지 않는다.

A3. `commands.ts` (I1.7#1, I1.7#2, I2.7#1, I2.7#8, I2.7#14, I2.7#17, I3.7#6): 옛 `startActivation`·`completeActivation`·`failActivation` 세 handler를 새 route `activation.start`·`activation.complete`·`activation.fail`의 handler로 바꾼다. 옛 route 정의(`release.start_activation` 등)는 protocol에 남아 있지만 이 module은 더 등록하지 않는다. `createReleaseCommands`의 반환 꼴은 `core/apps/register.ts`가 쓰므로 키 이름을 `startActivation`, `completeActivation`, `failActivation`으로 유지한다.
  - `activation.start`: 입력 `{release, key}`. release가 `prepared`(또는 `activate_previous` 경로의 `superseded`)가 아니면 `conflict`. 이미 `activating`인 release가 앱에 있으면 `conflict`. approval 검사, `previous_release`·`expected_grants_seq`·`expected_schema` 비교(CAS)를 모두 뺀다(req-0828 rejected). 새 `attempt`(`idSchema("act")`, `IdSource`로 만든다)를 정하고 `activation = { attempt, previous_release: 지금 active의 id | null, backup_hash: null, data_change_invocation: null, started_at }`, `status = activating`으로 쓴다. 출력 `{ attempt, previous_release }`. dispatch 전용이 아니다(driver가 machine 자격으로 부른다).
  - `activation.complete`: 입력의 `attempt`가 `activation.attempt`와 같고 `result.integrity_ok`이고 `result.data_schema`가 release의 `data_schema`와 같을 때만. 지금 `completeActivation`의 준비 확인(`attestation`)과 앱 기록 갱신을 그대로 쓴다. release를 `active`로, `activated_at`을 지금으로, 이전 active를 `superseded`로 한다. domain event를 내지 않는다(S1 5장: activation 성공은 event가 아니다).
  - `activation.fail`: 입력의 `attempt`가 같을 때만. `status = failed`, `failure = { code, summary, restored }`. 같은 tx에서 domain event `ReleaseActivationFailed{ app, ticket: release.ticket_source.ticket, failure: { code, summary } }`를 쓴다(같은 tx 규칙, S1 3장).
  - `activation.activate_previous`: actor는 user뿐이다(S7 11장 3). 대상은 `superseded`이고 `data_schema`가 지금 active와 같은 release만(아니면 `invalid_input`). 같은 tx에 `activation_requests` 행을 쓰고 `{ phase: "queued" }`를 돌려준다. approval이 없다.
  - `prepare` 쪽 두 곳(I2.7#14, I2.7#17): `ticket_source`가 없는 준비와 `actor.kind !== "coding_agent"` 분기를 뺀다(언제나 맡은 ticket의 지금 claim 아래, req-1353). blueprint가 선언한 의존과 `manifest.dependencies`를 대조해 다르면 `invalid_input`(사용자 package와 npm·jsr도 같은 선언에 든다, req-0811). `checkDataChanges`는 `loss` 칸을 보존하고 `to > from` 연속 경로 검사는 그대로 둔다.
  - `release.prepare`가 내던 domain event `ReleasePrepared`는 내지 않는다(S1 5장).
  - `activationAttemptGate`(data command가 쓰는 시도 확인)를 `attempt` 기준으로 바꾼다.

A4. `compare.ts`, `facts.ts` (I1.7#4, I2.7#4, I2.7#5, I2.7#6의 파일 몫, I2.5#25):
  - `compareForActivation(input: { previous: { id, blueprint, data_schema } | null, next: { blueprint, data_schema, data_changes } }): ActivationComparison`를 더한다. `added_resources`는 `permissionLabel`로 이름을 만들어 새로 선언한 것(이전에 없던 것). `added_app_apis`는 `app_connections`에서 이전에 없던 `{app, command}`. `loss_steps`는 `next.data_changes` 가운데 `from >= (previous?.data_schema ?? 0)`이고 `loss`가 비지 않은 것. `first = previous === null`.
  - `asksFor(c: ActivationComparison): boolean`: `first`이거나 `added_resources`, `added_app_apis`, `loss_steps` 가운데 하나라도 비어 있지 않으면 true. app-api가 더해지는 것(이 앱 자신의 app-api)은 묻지 않는다(S7 6장).
  - DB 사본에 migration을 돌려 손실을 재는 코드는 만들지 않는다(S7 11장 2). 선언을 믿는다.
  - 옛 `compareReleases`와 `ComparedRelease`는 `releases/mod.ts`가 내보내므로 지우지 않는다. `ReleaseComparison`의 automation·problem code·`confirm`·`revert`·`review_required` 계산은 새 함수가 쓰지 않는다.
  - `facts.ts`의 `declarationsOfBlueprint`에서 automation, problem code, 문서 선언을 걷어낸다(읽는 곳이 없어졌을 때만. 타입 오류가 나면 남기고 보고).

A5. `reads.ts` (I3.7#14, I2.7#5): 새 read 정의를 더한다: `activations.queue`(B의 driver가 주는 메모리 줄 + 대기 중인 activation 보류 request. port로 받는다), `activations.compare`(지금 active와 견준 `ActivationComparison`), `releases.list_records`, `releases.get_record`. 옛 list·get·compare는 `createReleaseReads`에 남겨 둔다. `get_record`는 실패 근거(`failure`)를 싣는다(S7 7장 7).

A6. `activation/desired.ts` (I2.7#7, I3.7#4): `dataChangesOf`가 단계 파일에서 `lossOfStepSql`로 `loss`를 읽어 `DataChange.loss`에 넣는다. 읽기 실패(`-- loss:` 줄이 틀림)는 `invalid_input`이고 release 준비가 거절된다.

A7. `core/apps/data/` (I2.7#2, I2.7#10, I3.7#3, I3.7#4):
  - `app_data_records`의 `activation_seq`를 `attempt`로 바꾼다(`schema.ts`, `store.ts`, `commands.ts`, `reads.ts`, `blobs.ts`의 `backupBlobOwnerKey(release, attempt)`, `worker/job.ts`·`run.ts`·`backup.ts`·`restore.ts`·`migrate.ts`). record 세 command를 새 route `activation.record_backup`·`activation.record_data_change`·`activation.record_data_restore`의 handler로 바꾼다.
  - data worker 입력은 `encodeActivationDataJobInput`·`decodeActivationDataJobOutput`를 쓴다(`worker/job.ts`, `data-runner.ts`).
  - 복구본 수명(S7 7장 6): 앱마다 가장 최근 하나만 둔다. 새 시도의 `record_backup`이 그 앱의 이전 복구본을 대체하고, `discardBackups(sql/tx, app)`를 `core/apps/data/mod.ts`로 내놓는다(성공 단계가 부른다). 보존 규칙은 `BACKUP_BLOB_FIELD.retention`을 contract-platform이 `protocol/storage`에 둔 "owner 행이 지워지면 지우는" 종류로 바꾼다. 그런 종류가 없으면 옛 `permanent`를 두고 "계약 바꾸기 요청"에 적는다.
  - `worker/migrate.ts`: 단계마다 같은 transaction 안에서 새로 생긴 표에 PRIMARY KEY가 있는지 `tablesWithoutPrimaryKey`로 본다. 없으면 그 단계는 실패하고(`MIGRATION_PRIMARY_KEY_REQUIRED`) 기존 중간 실패 복원이 돈다(S5 6장, 결정 #52).
  - `export.ts`, `worker/export.ts`, `reads.ts`의 `ExportJob`·`createExportTarget`, `target.ts`: wave 1(remove-app-extras)이 이미 지웠으면 건너뛰고, 남았으면 지운다(`I1.7#6`). `main/daemon/core.ts`의 `appExportWorkers` 쓰는 곳은 소유 밖이라 보고만 한다.
  - data worker job의 `protocol/apps/data-job.ts`와 `main/worker/data-job.ts`를 wave 1이 지웠으면 되살리지 말고 위 `ActivationDataJob*`로 간다. `main/worker/data-job.ts`는 소유 밖이므로 지워졌다면 `data-runner.ts`가 `worker/run.ts`를 직접 부르게 한다(보고).

### B. 진행 (handler, 줄, 순서)

B1. 새 file `activation/handler.ts` (I3.7#1, I3.7#5): Reactor handler 둘.
  - `TicketVerified` handler(이름 `activation.ticket-verified`): `findReleaseForTicket`로 이은 release를 찾는다. 없거나 `prepared`가 아니면 아무것도 하지 않는다(이미 활성이면 그대로 둔다). `compareForActivation`(지금 active의 고정 blueprint와 견줌)과 `asksFor`로 묻는지 정한다. 묻지 않으면 줄에 세운다. 묻으면 contract-approvals의 보류 request를 만든다(intent `activation`, 대상 release, 입력은 정규화한 비교). 같은 `(handler 이름, event seq)`로 두 번 일해도 request가 하나여야 한다(`ReactorContext.idempotencyKey`).
  - `ApprovalDecided` handler(`kind: activation`, 이름 `activation.approval-decided`): 거절이면 아무것도 하지 않는다(release는 `prepared`로 남고 App Engineer가 사람에게 올린다). 허락이면 release가 아직 `prepared`이고 지금 active release와 비교가 같은지(intent 입력과 견줌) 다시 보고 줄에 세운다. 다르면 새로 판정한다.

B2. 새 file `activation/queue.ts` (I2.7#3, I3.7#2): 앱마다 하나씩 줄에 세운다(메모리, 결정 #77). `enqueue(app, release)`, 앱마다 한 번에 하나만 `runOne`을 돈다. 더 새 release의 activation이 시작되면 같은 앱에서 이전 release를 기다리던 보류 request를 취소한다(contract-approvals의 취소 port, req-0315). `activations.queue` read가 읽는 현재 상태(`waiting_approval`, `queued`, `running`)를 낸다. lophn이 꺼졌다 켜지면 줄은 사라지고 Reactor가 cursor 뒤의 `TicketVerified`부터 다시 반응한다. `activation_requests` 행은 driver sweep이 읽어 `enqueue`하고 지운다.

B3. `orchestrator.ts`, `steps.ts`, `recovery.ts`, `assembly.ts` (I2.7#1, I2.7#13, I2.5#25, S7 7장): 순서를 S7대로 맞춘다.
  - 한 차례: `activation.start` → 새 호출 접수를 닫고 도는 호출이 끝나기를 기다린다(contract-app-calls의 drain port, 붙잡은 호출은 새 release나 이전 release에 넘긴다) → 이전 process 종료 확인(`stopCurrent`) → 실제 DB의 schema·무결성을 `inspect`로 읽는다 → migration이 있으면 복구본을 만들고 `record_backup` 뒤에 단계를 순서대로 적용한다 → 새 process를 시작해 확인한다 → `activation.complete`.
  - 시작 schema를 시작 때 박아 두지 않는다. 종료를 확인한 뒤 `inspect`한 실제 schema를 migration의 출발점과 복구본의 기준으로 쓴다(`Attempt.expectedSchema` 대신 `startSchema`). 출발점에서 목표까지 이어지는 경로가 없으면 `schema_changed`로 실패한다(I2.7#13).
  - `Attempt.startedSeq`를 `attempt`로 바꾼다. `attemptOf`는 이름과 호출 꼴을 유지한다.
  - 성공 단계(S7 7장 6): `complete` 뒤에 앱 grant를 새 선언과의 교집합으로 맞추고(contract-approvals port), 이전 release의 changeset을 지우고(contract-app-calls port), 붙잡은 호출을 새 release에 넘기고, `discardBackups`를 부른다. 이어서 `AppViewChanged{ reason: "activation" }`를 Bus로 낸다.
  - 실패 단계(S7 7장 7): 복구본으로 되돌린 뒤 무결성과 schema를 확인하고 이전 release를 다시 시작한다. 붙잡은 호출을 이전 release에 넘긴다. `activation.fail`로 이유를 남기고(domain event `ReleaseActivationFailed`는 그 command가 쓴다) `AppViewChanged`를 낸다. 되돌리기에 실패했거나 확인하지 못하면 앱을 사용할 수 없는 상태로 둔다(`appRecordUnavailable`을 그대로 쓴다. req-0960). 옛 `ActivationPorts.report`(문제 보고)와 `ActivationProblem`은 지운다.
  - `activate_previous`는 같은 순서에서 migration과 복구본이 없는 경우다. 그래서 앱 code만 바뀌고 DB는 그대로다(S7 8장).
  - `recoverActivation`, `observeReleaseActivations`는 core가 다시 떴을 때 `activating` 행을 이어받는 길이므로 유지하고 `attempt`로 바꾼다.

B4. `activation/state.ts`: `checkStartApproval`, `ACTIVATION_APPROVAL_CONCERN`, `START_ACTIVATION_COMMAND`, `pathFrom`의 `expectedSchema` 인자 중 안 쓰게 된 것을 지운다. `permissions/store.ts`의 `activationInProgress`를 쓰던 grant 변경 거절은 approvals 몫이다(소유 밖. 호출이 사라졌다고 보고).

C. test

C1. `activation/orchestrator_test.ts`: "activation이 실패하면 복구본으로 되돌리고 이전 release가 남는다". `ActivationPorts` 대역(supervisor, data, core)으로 migration 단계가 실패하는 시도를 돌려, 복구본으로 `restore`를 부르고, 복원 뒤 무결성·schema를 확인하고, `activation.fail`을 `restored: true`로 부르고, 이전 release를 다시 시작하고(`previous: "started"`), 새 release는 `complete`되지 않음을 본다. 복원이 확인되지 않으면 이전 코드를 시작하지 않고 앱을 사용할 수 없는 상태로 둔다는 경우를 표의 둘째 줄로 더한다.
C2. `compare_test.ts`: "손실을 선언하면 묻는다". `compareForActivation`과 `asksFor`를 표로 돌린다: 손실 선언이 있는 단계를 지나면 true, 선언이 같고 손실이 없으면 false, 새 바깥 자원이 있으면 true, 이전 release가 없으면 true. migration 파일 머리 `-- loss:` 줄이 `dataChangesOf`를 거쳐 비교까지 닿는 경우를 한 줄 더한다.
1. (lead가 맞추며 더함 (`I2.7#12`)) 실패 단계

- (lead가 더함, screens-app-space-detail이 넘긴 것) 앱 상세 Version 탭이 activation 단계(새 호출 멈춤, 도는 호출 기다림, 이전 process 종료, migration, 시작 확인)와 붙잡은 호출 수를 그리지만 `activations.queue`에는 `phase`만 있어 모두 "대기"로 보인다. 단계와 붙잡은 호출 수를 읽기에 싣는다(`app-detail/core-source.ts`의 그 줄도 맞춘다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "activation이 실패하면 복구본으로 되돌리고 이전 release가 남는다", "손실을 선언하면 묻는다"
- 남지 않음:
  - `grep -rn "checkStartApproval\|expected_grants_seq\|expectedSchema\|startedSeq\|started_seq\|activation_seq" packages/core/apps/releases packages/core/apps/data`가 0줄이다.
  - `grep -rn "ActivationProblem\|ports.report" packages/core/apps/releases/activation`이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것(소유 밖이라 lead 또는 app-calls가 고친다):
  - `core/apps/register.ts`: 새 command·read 등록(`activation.*`, `activations.*`, `releases.*_record*`), `activation_requests` 포함 schema step
  - Reactor에 handler 둘 등록(`TicketVerified`, `ApprovalDecided`). 위치는 apps의 wiring file
  - `main/daemon/core.ts` 또는 wiring의 `appExportWorkers`, `data-job` 쓰는 곳
- 안 쓰게 된 export: 옛 `compareReleases`·`ComparedRelease`, `activationAttemptGate`의 옛 꼴, `Activation` 관련 옛 type을 쓰던 곳, `releaseWording`(problems 옛 register가 쓰던 것), 옛 `release.*_activation`·`release.record_*` handler 이름
- 소유 바꾸기: `packages/core/main/app-supervisor/data-runner.ts` → releases-problems(위 소유 항목). wave 1 remove-app-extras의 소유에 `packages/core/main/worker/data-job.ts`와 `packages/protocol/apps/data-job.ts`가 들어 있는데, 이 둘은 export가 아니라 migration·backup·restore worker의 입구와 job schema다. 지우면 이 task가 깨진다. lead가 확인한다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(예: `activation_requests` 표, 시작 schema를 `inspect`로 정하는 것, `findReleaseForTicket`의 상태 처리)
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(예: drain·changeset 삭제·grant 맞추기·보류 request 취소 port가 없을 때, 복구본 보존 종류가 없을 때)
