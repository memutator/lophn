# contract-releases-problems-releases

activation, 선언 비교, migration 손실 선언과 PRIMARY KEY 규칙, release 기록, 사용자 package 내기 route의 모양을 `packages/protocol/apps`에 고정한다. 옛 계약은 지우지 않고 새것을 옆에 더한다. 구현은 넣지 않는다(type, schema, 상수, route 정의, 의존 없는 순수 함수 둘만 예외).

- 단위: contract-releases-problems (wave 2)
- 선행: 없음. 단 lead가 task를 띄우기 전에 `packages/protocol/base/ids.ts`의 `ID_PREFIXES`에 `act: "ActivationAttempt"` 한 줄을 더해 둔다(`idSchema`가 이 표에 있는 접두사만 받는다).
- 소유(이 task만 고친다):
  - `packages/protocol/apps/releases.ts` (더하기만. 옛 export는 지우지 않는다)
  - `packages/protocol/apps/packages.ts`
  - `packages/protocol/apps/package-routes.ts`
  - `packages/protocol/apps/activation/` (새 폴더: `activation.ts`, `migration.ts`, `data-job.ts`, `mod.ts`)
- 읽을 것:
  - spec: S7 4~8장, 11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - spec: S2 5~6장(intent의 `activation`, 보류 request) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S5 6장(PRIMARY KEY 필수) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S4 4장(`release.list`, `release.get`, `package.list`, `package.get`, `package.publish`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: 이 task에 배정된 줄은 없다. 모양의 근거는 wave 3 줄이다: `I2.7#1`~`I2.7#5`, `I2.7#7`, `I2.7#8`, `I2.7#10`, `I2.7#14`, `I2.7#17`, `I2.7#34`~`I2.7#37`, `I1.7#20`, `I1.7#21`, `I3.7#1`~`I3.7#6`, `I3.7#10`~`I3.7#12`
  - 결정: `../README.md` 3장 #75(손실 선언), #17(앱 view를 다시 그리는 신호). `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md`의 #52, #76, #77, #84
  - 지금 코드: `packages/protocol/apps/releases.ts`, `packages.ts`, `package-routes.ts`
- 계약:
  - 쓰는 것:
    - `TicketVerified`, `ReleaseActivationFailed`, `AppViewChanged`, `ApprovalRequested`/`ApprovalDecided`의 모양은 contract-events(S1)가 `protocol/events`에 둔다. 이 task는 만들지 않고 이름만 부른다.
    - 보류 request의 intent(`kind: activation`)와 Gate 입력 type은 contract-approvals(S2)가 둔다.
    - 앱 호출 붙잡기(drain)와 changeset 삭제 port는 contract-app-calls의 `core/apps/ports.ts`다.
  - 내놓는 것: 아래 "모양". wave 3의 releases-problems-* task가 그대로 쓴다.

## 모양

모든 새 export는 옛 export와 이름이 겹치지 않아야 한다(`export *` 충돌). 이름에 `v2`, `new` 같은 판 표시를 넣지 않는다.

### `protocol/apps/activation/migration.ts` (새)

1. 손실 선언 (README 3장 #75, S7 6장, req-1520)
   - `LOSS_KINDS = ["drop_table", "drop_column", "narrow_type"]`, `lossKindSchema`
   - `lossStepSchema`: `{ kind, table: 공백 아닌 문자열, column?: 공백 아닌 문자열 }`. `drop_table`이면 `column`이 없고, 나머지 둘이면 `column`이 있다(refine). type `LossStep`.
   - `migrationSchema`: `{ from: 정수 >= 0, to: 정수 > from, sql: 문자열, loss: LossStep[] }`. type `Migration`. SDK migration API의 한 단계다(`sdk/cap-store`의 `Migration`이 이것을 쓰게 하는 것은 app-calls 몫).
   - `migrationOfSql(from, to, sql): Result<Migration>`: `lossOfStepSql(sql)`의 결과를 `loss`에 담은 `Migration`. 앱의 `migrations()`와 SDK가 단계 파일을 읽어 `Migration`을 만들 때 쓴다.
   - `stepFileName(from, to)`: `"migrations/<from>-<to>.sql"`. 지금 core의 `stepFile`, `STEP_FILE`과 같은 규칙이다.
   - `lossOfStepSql(sql): Result<LossStep[]>`: 단계 파일 머리의 선언 줄을 읽는다. 순수 함수다(의존 없음, `Result`는 `../../../base/mod.ts`의 type만).
     - 선언 줄 꼴: 파일 맨 위에서 이어지는 `--` 주석 줄 가운데 `-- loss: drop_table <table>`, `-- loss: drop_column <table>.<column>`, `-- loss: narrow_type <table>.<column>`.
     - 한 줄에 선언 하나, 여러 줄 가능. 이 꼴이 아닌 `-- loss:` 줄은 `invalid_input`이다. `loss:`로 시작하지 않는 주석은 설명이라 무시한다.
     - 이유: core는 앱 코드를 돌리지 않고 bundle의 단계 파일(`migrations/<from>-<to>.sql`)만 읽는다. SDK는 같은 함수로 `Migration.loss`를 채운다. 선언이 한 곳(sql 파일)에서만 온다.
2. PRIMARY KEY 규칙 (S5 6장, req-1521, 결정 #52)
   - `tablesWithoutPrimaryKey(tables: readonly { name: string; primary_key_columns: number }[]): string[]`: `primary_key_columns`가 0인 표 이름. 순수 함수. 호출하는 쪽(SDK `migrate()`, core의 data worker)이 `pragma table_info`로 칸 수를 센다.
   - `MIGRATION_PRIMARY_KEY_REQUIRED`: 오류 message 상수(`"migration creates a table without PRIMARY KEY"`). 오류 code는 공통 일곱 가운데 `invalid_input`이다.

### `protocol/apps/activation/activation.ts` (새)

3. 시도 id와 실패
   - `activationAttemptIdSchema = idSchema("act")`. 옛 `started_seq`(event seq)를 대신한다. `ReleaseActivationFailed` event(contract-events)는 `attempt`를 싣지 않고 `{ app, ticket, failure: { code, summary } }`를 싣는다.
   - `ACTIVATION_FAILURE_CODES = ["drain_failed", "termination_unconfirmed", "schema_changed", "backup_failed", "migration_failed", "start_failed", "commit_rejected", "restore_failed"]`
   - `activationFailureSchema`: `{ code, summary: 공백 아닌 문자열, restored: boolean | null }`. `restored`는 이전 release가 다시 도는지(없으면 null). event payload의 `failure`는 이것의 `code`, `summary`만 싣는다.
4. release 기록
   - `activationRunSchema`: `{ attempt, previous_release: ReleaseId | null, backup_hash: sha256 | null, data_change_invocation: invocation id | null, started_at }`. 옛 `activationSchema`의 `approval`, `expected_grants_seq`, `expected_schema`는 없다(시작·확정 때 CAS를 다시 하지 않는다, req-0828 rejected).
   - `releaseRecordSchema`(type `ReleaseRecord`): 옛 `releaseSchema`와 같은 칸에서 아래만 다르다.
     - `activation`은 `activationRunSchema.nullable()`
     - `activated_at: At | null`(`active`, `superseded`이면 값이 있다. 재발 판정이 쓴다, S1 5장 `ProblemReopened`)
     - `failure`는 `activationFailureSchema.nullable()`
     - `ticket_source`는 null이 아니다(S7 4장. 호환 장치였던 null 허용을 뺀다)
     - 상태 refine은 옛것과 같다: `activating`·`failed`는 `activation`이 있고, `failed`는 `failure`가 있다. 여기에 `active`·`superseded`는 `activated_at`이 있다.
5. 선언 비교 (S7 6장, 결정 #84)
   - `addedAppApiSchema`: `{ app, command }`. 이 release가 처음 쓰기로 선언한 다른 앱의 app-api 쓰기.
   - `activationComparisonSchema`(type `ActivationComparison`):
     - `previous_release: ReleaseId | null`
     - `first: boolean`: 이전 활성 release가 없다. 첫 activation은 선언 전부를 늘어난 것으로 본다.
     - `added_resources: string[]`: 새로 선언한 바깥 자원(network host, secret, 파일). 이름은 지금 `permissionLabel` 규칙(`core/apps/releases/facts.ts`)을 따른다.
     - `added_app_apis: addedAppApi[]`
     - `loss_steps: { from, to, loss: LossStep[] }[]`: 이번 activation이 지나는 migration 단계 가운데 `loss`가 비지 않은 것
   - 카드에는 이 넷만 보인다(결정 #84). 옛 `releaseComparisonSchema`의 automation, problem code, `confirm`·`revert` 변경, `review_required`, `description_only_commands`는 새 모양에 없다.
   - "묻는가"의 판정 함수는 여기에 두지 않는다(core의 `releases-problems-activation`이 만든다). 판정 규칙만 이 task의 주석 한 줄로 적는다: `first`이거나 `added_resources`, `added_app_apis`, `loss_steps` 가운데 하나라도 비어 있지 않으면 묻는다.
6. 줄과 상태 (S7 7장 1, 11장 4)
   - `ACTIVATION_PHASES = ["waiting_approval", "queued", "running"]`. 줄은 메모리다(결정 #77). `waiting_approval`은 보류 request를 기다리는 중, `queued`는 같은 앱의 앞선 activation을 기다리는 중, `running`은 7장의 순서가 도는 중이다. 끝난 것은 release의 `status`(`active`, `failed`)로 본다.
   - `activationQueueEntrySchema`: `{ app, release, phase, approval: ApprovalRequest id | null }`
   - `activationDataResultSchema`: 옛 `dataResultSchema`와 같되 `activation_seq`가 `attempt`다.
7. route (resource `activations`. 이름은 아래대로)

   | name | kind | method | actors | 입력 → 출력 |
   |---|---|---|---|---|
   | `activation.start` | command | `start` | machine | `{ release, key }` → `{ attempt, previous_release }`. activation handler가 앱의 차례가 되면 부른다. `prepared`인 release만 받고 아니면 `conflict` |
   | `activation.record_backup` | command | `record_backup` | machine | 옛 `release.record_backup` 입력에서 `activation_seq`가 `attempt` |
   | `activation.record_data_change` | command | `record_data_change` | machine | `{ result: activationDataResult }` |
   | `activation.record_data_restore` | command | `record_data_restore` | machine | `{ result: activationDataResult, backup_hash }` |
   | `activation.complete` | command | `complete` | machine | `{ release, attempt, result, attestation }` → `{ status: "active", previous_release }` |
   | `activation.fail` | command | `fail` | machine | `{ release, attempt, failure: activationFailure, invocation? }` → `{ status: "failed" }` |
   | `activation.activate_previous` | command | `activate_previous` | user | `{ release, key }` → `{ phase: "queued" \| "running" }`. 사람만 한다(S7 8장). 지금 data schema와 같은 `superseded` release만 받고 아니면 `invalid_input`. migration이 없다 |
   | `activations.queue` | read | `queue` | user, agent, coding_agent, machine | `{ app? }` → `{ entries: activationQueueEntry[] }` |
   | `activations.compare` | read | `compare` | 옛 `releasesCompare`와 같은 읽기 actor | `{ release }` → `{ comparison: ActivationComparison }`. 지금 활성 release와 견준다 |
   | `releases.list_records` | read | `list_records` | 옛 `releasesList`와 같은 읽기 actor | 옛 `releasesList` 입력 → `releaseRecord[]` |
   | `releases.get_record` | read | `get_record` | 같음 | 옛 `releasesGet` 입력 → `{ release: ReleaseRecord \| null }` |

   - 입력·출력 envelope(`withReadCommon`, `key`)와 오류 목록은 옛 `releases.ts`의 같은 route를 본보기로 한다.
   - `ACTIVATION_ROUTES`(위 route 전부)를 export한다. 옛 `RELEASE_ROUTES`는 그대로 둔다. 등록은 lead가 한다.

8. data worker job (S7 7장 4~7)
   - 옛 `protocol/apps/data-job.ts`와 같은 꼴을 `activation/data-job.ts`(새)에 둔다. 이름: `ACTIVATION_DATA_JOB_KINDS`(옛 `DATA_JOB_KINDS`와 같은 다섯), `activationDataJobInputSchema`, `activationDataJobOutputSchema`, `encodeActivationDataJobInput`, `decodeActivationDataJobInput`, `encodeActivationDataJobOutput`, `decodeActivationDataJobOutput`. 다른 점은 입력의 `activation_seq`가 `attempt`이고, `data_changes`가 `loss`를 가진 `dataChangeSchema`이고, 출력의 `result`가 `activationDataResultSchema`인 것이다. 옛 file은 import하지 않는다(옛 file은 wave 1의 소유 문제가 있다, 보고).

### `protocol/apps/releases.ts` (더하기만)

9. `dataChangeSchema`에 `loss: z.array(lossStepSchema).default([])`를 더한다. release 준비가 단계 파일에서 읽은 선언이 `release.prepare`의 `data_changes`로 들어간다.
10. `bundleManifestSchema`에 `dependencies`를 더한다: `{ name, version(정확한 SemVer), source: "sdk" | "package" | "npm" | "jsr" }[]`, `.default([])`. 옛 `sdk_dependencies`는 `.default([])`로 느슨하게 하고 지우지 않는다. S7 4장, req-0811.
11. 위 9·10을 하고 `deno task check`가 깨지는 곳이 있으면(`DataChange`를 객체 literal로 만드는 코드 등) 필드를 `.optional()`로 바꿔 깨지지 않게 하고 보고에 적는다.

### `protocol/apps/packages.ts`, `package-routes.ts` (S4 4장, req-1009, req-1000 rejected)

12. `packageSchema.kind`를 `.optional()`로 느슨하게 한다. 새 package는 종류가 없다. 옛 `PACKAGE_KINDS`는 지우지 않는다. `packageRegisterVersionInputSchema.kind`도 `.optional()`로 하고 `permissions: z.array(z.string().min(1)).default([])`를 더한다(설치용 machine route를 `package.publish`가 내부 등록에도 쓴다).
13. `packageVersionSchema`에 `permissions: z.array(z.string().min(1)).default([])`를 더한다(요구 permission 이름. `added_resources`와 같은 이름 규칙).
14. `package.publish`를 더한다. App Engineer가 자기 앱 code의 일부를 사용자 package로 낸다. 일은 commit에서 파일을 읽는 I/O라 ledger command가 아니라 memory route다(`defineMemory`: core 메모리 route라 handler가 async I/O를 한다. `protocol/base/route.ts`). core가 읽고 검사한 뒤 내부에서 machine route `package.register_version`을 부른다.
    - resource `packages`, method `publish`, kind memory, actors `["agent"]`, 오류 `forbidden`, `invalid_input`, `conflict`, `unavailable`
    - 입력(strict): `app`, `name`(`@me/…`만), `version`(정확한 SemVer), `description`(한 줄), `commit`(40자 hex), `path`(commit 안의 package 폴더, `relativePathSchema`), `guide: { purpose, api, examples }`(셋 다 공백 아닌 문자열. 빠지면 거절이 schema에서 난다), `permissions: string[]`, `tests: Verification id[]`(1개 이상), `key`(idempotency)
    - 출력: `{ package, version }`(옛 `packageRegisterVersion` 출력과 같은 꼴)
    - 낼 때 사람 승인은 없다(inventory I2.7#34).
15. 옛 `packageRegisterVersion`(machine, 설치용)은 이름과 route 그대로 둔다. `PACKAGE_ROUTES`에 `packagePublish`를 더한다.

## 할 일

1. `activation/migration.ts`를 만든다(모양 1·2). 단위 type과 순수 함수만. 외부 의존은 `zod`와 `../../../base/mod.ts`의 `Result`뿐이다.
2. `activation/activation.ts`와 `activation/data-job.ts`를 만든다(모양 3~8). 필요한 schema(`releaseIdSchema`, `appIdSchema`, `invocationIdSchema`, `approvalIdSchema`는 `../channel-values.ts`, `readyAttestationSchema`는 `../runtime.ts`, `ticketSourceSchema`와 `releaseStatusValueSchema`는 `../releases.ts`)는 import한다. route는 옛 `release.start_activation`, `releaseRecord*`, `releaseCompleteActivation`, `releaseFailActivation`, `releasesCompare`를 본보기로 `defineCommand`·`defineRead`로 정의한다.
3. `releases.ts`에 모양 9·10을 더한다. 깨지는 곳이 있으면 모양 11을 따른다.
4. `packages.ts`, `package-routes.ts`에 모양 12~15를 더한다.
5. `activation/mod.ts`에서 세 file을 내보낸다. `protocol/apps/mod.ts`와 `protocol/apps/registry.ts`는 소유 밖이라 고치지 않는다. 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(계약 단위는 type과 schema만 둔다. 순수 함수 둘의 판정은 wave 3의 releases-problems-activation이 test한다)
- 남지 않음: `grep -rn "started_seq\|activation_seq\|expected_grants_seq\|review_required" packages/protocol/apps/activation`이 0줄이다(옛 이름을 새 file로 가져오지 않았다).

## 보고

- 바꾼 file
- 등록할 것: `protocol/apps/mod.ts`에 `export * from "./activation/mod.ts"` 한 줄(lead). `protocol/apps/registry.ts`(contract-app-calls 소유)에 `ACTIVATION_ROUTES`, `packagePublish`(`PACKAGE_ROUTES`에는 이 task가 더한다). 보고에 적는다.
- 안 쓰게 된 export(지우지 않는다): `Activation`·`activationSchema`·`activationInputSchema`, `releaseSchema`, `releaseComparisonSchema`, `release.start_activation`·`release.record_*`·`release.complete_activation`·`release.fail_activation`, `ReleaseActivationStarted`·`ReleasePrepared`·`ReleaseBackupRecorded`·`ReleaseDataChanged`·`ReleaseDataRestored` event
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 계약 바꾸기 요청: 없음(wave 2는 직접 고친다)
