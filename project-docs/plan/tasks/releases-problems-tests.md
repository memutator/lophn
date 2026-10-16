# releases-problems-tests

앱 test runner(`core/problems/tests`)를 필수 검사 넷으로 줄인다. problem code와 보고 계열 검사 열 개, 계약 계열 여섯 개, reproduction test와 before·after 장치, 화면 검사 host를 지우고, 남는 검사(선언·구현 일치, 의존, migration, 되돌림)를 새 계약에 맞춘다. test 종류는 `app_test`와 `test_command`, side는 `single`만 받는다.

- 단위: releases-problems (wave 3)
- 선행: `releases-problems-register-split`
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/` (전부. `register.ts`는 register-split이 만든다)
  - `packages/core/main/worker/test-runner.ts`
  - `packages/core/main/daemon/wiring/problems-tests.ts` (core-wiring-split이 만든 test runner와 work·closing feed 조립 file)
- 읽을 것:
  - spec: S7 4장(필수 검사가 든다), S5 6·7장(되돌림은 core가 changeset으로 뒤집는다), S2 2장(선언은 믿는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`, `.../app-call.md`, `.../approval.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#15`, `I1.7#16`, `I1.7#17`, `I1.7#18`, `I2.1#2`(자기 path), `I2.5#23`, `I2.5#24`, `I2.7#18`, `I2.7#19`, `I2.7#20`, `I2.7#32`, `I3.7#13`, `I2.10#12`(`tests/control.ts`의 import)
  - 지금 코드: `packages/core/problems/tests/**`, `packages/core/main/worker/test-runner.ts`, `packages/protocol/problems/tests.ts`(읽기만)
- 계약:
  - 쓰는 것: `protocol/problems/tests.ts`(옛 것 그대로: `TEST_KINDS`, `TEST_SIDES`, 요청·결과 route). 이 계약은 이번 wave 2에서 줄이지 않았다. 그래서 이 task는 코드에서 `reproduction`·`before`·`after`를 거절하고, enum 정리는 cleanup이 한다. 새 계약은 `bundleManifestSchema.dependencies`(`protocol/apps/releases.ts`)만 쓴다. 의존 검사가 읽는다.
  - 내놓는 것: 필수 검사 정의 `REQUIRED_CHECKS`(아래).

## 할 일

1. 필수 검사 정의를 줄인다 (I2.7#18, I1.7#16, I1.7#17). `harness/definitions.ts`:
   - 남는 검사와 이름: `blueprint_handler_match`(선언한 app-api와 구현 일치. 지금 `read_contract`가 보던 입력 계약 검사를 이 검사 안으로 합친다), `dependencies`(지금 `fixed_sdk`가 바뀐 것: 선언한 의존과 import가 일치하고 정확한 version, I3.7#13), `migration_empty`, `migration_upgrade`(그대로. 둘을 합쳐 하나로 세지 않는다), `rewind`(지금 `revert_restore`가 바뀐 것: write app-api를 부른 뒤 core가 그 invocation의 changeset을 뒤집어 적용하면 DB 상태가 부르기 전과 같다, I2.5#23). 문서가 이름까지 정하지 않아 worker가 정한 것으로 보고한다.
   - 지운다: `declarations`, `failure_path_coverage`, `fixed_sdk`(→`dependencies`), `code_usage_static`, `code_usage_dynamic`, `sdk_receipt`, `process_exception`, `redaction`, `permission_denial`, `view_exception`, `feedback`, `read_contract`(위로 합침. 읽기가 DB를 바꾸는지 검사하지 않는다, S5 11장 4), `automation_scope`, `secret_grant`, `adapter_isolation`, `revert_conflict`, `revert_duplicate`, 그리고 `failure_path:<code>`(`FAILURE_PATH_PREFIX`, `failurePathName`, `isFailurePathName`, `failurePathDefinition`).
   - 따라 지운다: `harness/checks.ts`(681줄)의 해당 검사 구현, `harness/failure-path.ts`, `harness/source-scan.ts`(쓰는 검사가 사라졌으면), `REDACTION_CANARY`, `UNDECLARED_PROBE_CODE`, `VIEW_HOST_INCONCLUSIVE`, 검사 정의 digest·coverage 표를 다섯으로 줄인다, `app-test/generate.ts`·`judge.ts`·`frozen.ts`의 해당 단계, `work/app-driver.ts`의 `runAutomation`·옛 `revert` 호출·화면 관측, `work/app-test-run.ts`의 해당 단계, `work/broker.ts`의 "선언한 code만 보고" guard(runner의 선언 code 확인).
2. 되돌림 검사 (I2.5#23). `rewind` 검사의 test driver는 write app-api 호출에서 changeset을 받아 뒤집어 적용한 뒤 DB 상태를 견준다. changeset 뒤집기는 core의 앱 rewind와 같은 함수를 써야 하는데 domain module끼리 import할 수 없다(code-map). 공용 위치(`packages/base` 또는 `protocol`의 순수 함수)에 이미 있으면 쓰고, 없으면 이 검사 구현을 비워 두지 말고 "계약 바꾸기 요청"에 적고 검사 정의만 둔다(검사가 `inconclusive`를 내게 한다. 통과로 채우지 않는다).
3. network 없는 test (I2.7#20). 지우기 전에 `adapter_isolation`이 강제하던 보장("app test는 network 없이 test DB로 돈다", req-0193)이 runner가 앱 자식을 띄우는 Deno 권한(`work/spawn.ts`, `adapters/test-app-socket.ts`)에서 이미 지켜지는지 읽어 확인한다. 아니면 spawn 권한으로 옮겨 막는다. 어느 쪽이었는지 보고에 적는다.
4. reproduction 장치를 지운다 (I1.7#15). `tests/reproduction/`, `work/reproduction-run.ts`, `tests/commands.ts`·`lifecycle.ts`·`model.ts`·`records.ts`·`record.ts`·`build.ts`의 side 시작과 before·after 단계, `test-runner.ts`의 `--reproduction-job` 분기, `schema.ts`의 관련 열, `work/runner-service.ts`의 reproduction 경로. 요청이 `reproduction` kind나 `before`·`after` side면 `invalid_input`으로 거절한다. `frozenTest`의 `symptom`을 쓰지 않는다. `Verification`의 `problem`, `basis_seq`, `after` 연결은 채우지 않는다(null, I2.7#32). `app_test`와 `test_command`의 읽기·기록은 유지한다(`reads.ts`, `record.ts`).
5. 화면 검사 host를 지운다 (I1.7#18). `adapters/screen-host.ts`, `app-test/screens.ts`, `tests/runner.ts`의 `screenTestHost`, `register.ts`의 `screenHost`, 화면 fixture. S7에 화면 검사가 없다. shell 쪽(`shell/main/app-frame/screen-test-host.ts`, `shell/main/entry-screen-test.ts`)과 `protocol/shell/screen-test.ts`는 소유 밖이므로 보고한다.
6. `problems.work`·`problems.closing` 깨움 (I2.1#19의 tests 쪽): `work/runner-service.ts`가 `grouping/work.ts`의 `reactWork`와 closing 반응을 받던 경로를 끊는다. `test-runner.ts` 머리 주석의 설명도 맞춘다. `problem-tests.ts`(`problemTestLookup`)는 문제 상세가 더는 쓰지 않으므로 이 task의 path에서는 쓰는 곳을 끊고, 다른 task가 import하는 동안은 지우지 않는다.
7. `from events`(I2.1#2): 이 task의 path에서 `events` 표를 상태 근거로 읽는 곳을 `verifications`·`test_requests` 표 읽기로 바꾼다.
8. import (I2.10#12): `tests/control.ts`의 `DocumentsChannel` import를 lead가 옮긴 공용 위치와 새 이름으로 바꾼다.
9. 등록: `tests/register.ts`(register-split이 만든 file)에서 지운 검사·route·worker를 뺀다. `register.ts`가 같은 이름으로 내보내는 `problemsTestDefinitions`의 모양은 유지한다.

- (lead가 더함, releases-problems-intake가 넘긴 것) `tests/control.ts`가 옛 `reportProblem.name`을, `tests/harness/*`가 옛 `reportProblem(code)` 모양을 쓴다. SDK `cap-problem`은 이제 `reportProblem(name, message, details?)`다. app-calls-preview가 넘긴 것: `tests/work/app-driver.ts` 6·316행의 "문서 쓰기 대역" 주석을 지운다.

- (lead가 더함, releases-problems-problem-state·app-calls-assembly가 넘긴 것) `reporting/collector.ts`의 `collectorOperationPolicies`에 남은 옛 `getProblem.name`은 `problems.work` credential(`PROBLEMS_WORK_OPERATIONS`)이 요구한다. 그 연결(`apps/tickets/register.ts`, `wiring/problems-tests.ts`, `server/credentials.ts`, `tests/work/runner-service.ts`의 problems.work·closing import)을 끊고 같이 지운다. `problems/tests/work/{app-driver,app-test-run,reproduction-run}.ts`의 `Blueprint` type이 옛 `protocol/apps/blueprint.ts`를 가리킨다. 새 `protocol/apps/blueprint/mod.ts` 모양(`app_api`)으로 옮긴다. `tests/app-test/generate.ts`가 `problems/problem-codes/`를 import한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "reproduction\|failure_path\|REDACTION_CANARY\|UNDECLARED_PROBE_CODE\|screenTestHost\|adapter_isolation\|automation_scope\|revert_conflict\|revert_duplicate\|code_usage_" packages/core/problems/tests packages/core/main/worker/test-runner.ts`가 0줄이다(요청 거절 코드의 `reproduction` 문자열 한 곳은 예외).

## 보고

- 바꾼 file
- 등록할 것: 없음(`tests/register.ts`가 이 task의 소유다)
- 안 쓰게 된 export: `problemTestLookup`·`problem-tests.ts` 등 다른 module이 아직 import하는 것의 목록, 옛 검사 이름 상수
- 소유 바꾸기: 없음. 소유 밖 변경 요청: `shell/main/app-frame/screen-test-host.ts`, `shell/main/entry-screen-test.ts`(screens-app-space), `protocol/shell/screen-test.ts`(contract-shell), `protocol/problems/tests.ts`의 enum 정리(cleanup)
- 정한 것: 문서에 답이 없어 worker가 정한 것(필수 검사 이름, `read_contract`를 `blueprint_handler_match`에 합친 것, 화면 검사 삭제)
- 계약 바꾸기 요청(wave 3): changeset 뒤집기 공용 함수가 없을 때 그 위치. 그 밖에 고정된 계약을 바꿔야 하는 것

- (lead가 더함, coding-agent-tickets가 넘긴 것) 이 task 소유 file 가운데 `TicketClaimCheck`를 쓰는 곳(`apps/releases/commands.ts`, `problems/repairs/commands.ts`, `problems/tests/request-ports.ts`)이 아직 없어진 `ticket_problems` 표와 `kind='repair'` 열을 읽는다. 새 `tickets` 표 모양에 맞추거나 걷는다. `ProblemFixRecorded`와 `releases.ticket_source`는 옛 모양 그대로 읽힌다.
