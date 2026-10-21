# ab-runner-delete

test runner를 지운다: `packages/core/problems/` 전체(요청 기록과 한 번만 시작하기, 표 `test_requests`·`test_side_starts`·`verifications`·`test_evidence`, frozen test, 증거 blob, runner worker, `RecordVerification`, rewind 증명 사슬과 platform `rewind` 검사), protocol의 test route, `VerificationRecorded`(roadmap "지우는 것" 표의 test runner, rewind 증명 줄). problem-remove 뒤 `packages/core/problems/`에는 test runner만 남았으므로 module이 통째로 없어진다. 남는 data 검사는 release 준비 안에 있다(ab-release-checks, ab-release-prepare). changeset과 앱 rewind는 남는다(`packages/core/apps/rewind/`). 옛 표는 migration 없이 지운다.

정한 것(flesh):
- id prefix `tkt`도 이 task가 지운다(`vrf`와 함께). 이유: ab-ticket-delete 뒤에도 지울 `packages/protocol/problems/tests.ts`가 `idSchema("tkt")`를 써서 그 task는 `tkt`를 지우지 못한다.
- `packages/protocol/problems/`에 남는 file은 셋이다: `sdk-report.ts`(쓰는 곳: `packages/sdk/cap-problem/{deliver.ts,exception-observer.ts,report-port.ts}`, 앱 bundle vendor `packages/core/apps/packages/vendor.ts` 64-74, 같은 폴더의 `sdk-problem.ts`·`exception-observation.ts`), `sdk-problem.ts`(쓰는 곳: `packages/sdk/cap-problem/report-port.ts`, vendor), `exception-observation.ts`(쓰는 곳: `packages/protocol/apps/broker.ts` 3). `packages/protocol/deno.json` 15-17의 export 셋은 그대로다.
- `tools/check-deps.ts`의 `HARNESS_FEATURE_PROTOCOLS`에서는 `"problems"`를 빼지 않는다. 그 목록은 harness가 import하면 안 되는 protocol 폴더이고 `packages/protocol/problems/`는 남는다.
- 주석만 고칠 file 둘을 소유에 더했다(`packages/core/apps/runtime/entrypoint/main.ts` 137, `packages/protocol/apps/activation/data-job.ts` 9-10). 다른 task가 소유하지 않는다.

- 단위: runner (wave 4)
- 선행: ab-ticket-delete. 같은 wave에서 `domain.ts`, 등록 칸, test runner의 examples 조각을 고친다.
- 소유(이 task만 고친다):
  - `packages/core/problems/`(지운다)
  - `packages/protocol/problems/{tests.ts,app-test-lookup.ts,test-frames.ts,registry.ts,problem-codes.ts}`(지운다)
  - `packages/protocol/problems/mod.ts`
  - `packages/core/main/daemon/wiring/problems-tests.ts`(지운다)
  - `packages/core/main/daemon/wiring/supervision.ts`
  - `packages/core/main/worker/test-runner.ts`(지운다), `packages/core/main/worker/main.ts`
  - `packages/core/main/daemon/registration.ts`
  - `packages/core/storage/ledger/{team-module.ts,writer-assembly.ts}`
  - `packages/protocol/events/domain.ts`
  - `packages/protocol/base/ids.ts`
  - `packages/core/apps/preview/adapters/mod.ts`, `packages/core/apps/blueprint/describe.ts`(주석만)
  - `packages/core/apps/runtime/entrypoint/main.ts`, `packages/protocol/apps/activation/data-job.ts`(주석만)
  - `tools/check-deps.ts`(`problems` 항목만)
  - `packages/core/apps/connections/operations.ts`(`writesTestResult`만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "뼈대 검토에서 정한 것"(`packages/core/problems/`는 통째로 지운다, `packages/protocol/problems/`에는 SDK와 앱 log가 쓰는 file만 남는다, check-deps의 `problems` 줄), "lead가 할 일"(`packages/core/problems` catalog 줄은 이 task와 같은 merge에서 지운다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표(test runner, rewind 증명 사슬 줄), "정한 것(agent)"의 "test runner의 data 검사는 release 준비 안에서 바로 한다", "rewind 증명 사슬을 지운다"
  - architecture: `project-docs/architecture/testing.md`(test runner), `project-docs/architecture/layers.md` 8·19·31·56·59줄(problems → apps), `project-docs/architecture/coding-agent.md` 70-71줄(rewind 증명). 지금 동작이고 이 task로 틀린다. layers.md와 testing.md는 계획 끝에 lead가 고친다. coding-agent.md 71줄은 지울 file 경로를 가리켜 docs check가 떨어지므로 같은 merge에서 lead가 고친다(아래 "등록할 것").
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `child-supervision-protocol`, `storage`; `project-docs/module-catalog.yaml` 66-68줄의 `packages/core/problems`
  - 앞 task(brief는 `project-docs/plan/ae-builds/tasks/`): `ab-ticket-delete.md`(examples 요청 조각과 `apps-tickets` wiring을 지웠고, `DOMAIN_EVENTS`는 정의만 있는 `CodingSessionEnded`와 `VerificationRecorded`다), `ab-publish.md`(`package.publish`의 `tests`), `ab-release-prepare.md`(`requestTest`·`getVerification`·`AppTestVerificationLookupPort`·`findPassedAppTest`·`deriveAppTest`를 쓰던 곳), `ab-cli.md`(CLI의 `app test`), `ab-release-checks.md`(의존성과 migration 검사를 옮겼다)
  - 코드(줄은 main `dd956b49f`)
    - 지울 것: `packages/core/problems/`(54 file, 약 7.5k줄. step `test-requests`, `verifications`, `test-evidence`, blob purpose `frozen_test`·`test_execution`·`test_observations`·`test_environment`·`test_output`, worker kind `problems/test-runner`), `packages/protocol/problems/{tests.ts,app-test-lookup.ts,test-frames.ts,registry.ts,problem-codes.ts}`(`problemCodeSchema`는 `tests.ts`만 쓴다), `packages/core/main/daemon/wiring/problems-tests.ts`, `packages/core/main/worker/test-runner.ts`
    - `packages/protocol/problems/mod.ts` 1-4, 8
    - `packages/core/main/daemon/wiring/supervision.ts` 4, 26-27, 93-101(`sessionBusEnv`. test runner만 쓴다. `optionalEnv`는 52가 쓴다)
    - `packages/core/main/worker/main.ts` 7-8, 17-22
    - 등록 칸: `packages/core/storage/ledger/team-module.ts` 46, `writer-assembly.ts` 164-171·197-199, `packages/core/main/daemon/registration.ts` 111, 119
    - `packages/protocol/events/domain.ts` 8과 `DOMAIN_EVENTS`·`domainEventSchema`의 `verificationRecorded` 줄
    - `packages/protocol/base/ids.ts` 14(`vrf`), 26(`tkt`)
    - `tools/check-deps.ts` 64, 66, 67(`CORE_FEATURE_EDGES`), 70(`CORE_FEATURES`), 98-103
    - `packages/core/apps/connections/operations.ts` 2-4, 23-27, 34, 48
    - 주석: `packages/core/apps/preview/adapters/mod.ts` 1-3, `packages/core/apps/blueprint/describe.ts` 2-3, `packages/core/apps/runtime/entrypoint/main.ts` 137, `packages/protocol/apps/activation/data-job.ts` 9-10
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `packages/core/problems/`가 없다. `packages/protocol/problems/`에는 SDK와 앱 log가 쓰는 `sdk-report.ts`, `sdk-problem.ts`, `exception-observation.ts`와 그것만 내보내는 `mod.ts`가 남는다(`ROUTES`가 없다. 앱 bundle vendor 경로 `protocol/problems/sdk-*.ts`는 그대로다).
    - worker kind `TEST_RUNNER_KIND`와 그 process가 없다. team 등록 칸 `problemsTestDefinitions`가 없다. id prefix `vrf`와 `tkt`가 없다.
    - `DOMAIN_EVENTS`는 `CodingSessionEnded` 하나다(정의만 있다. ab-ticket-delete).
    - `tools/check-deps.ts`의 core feature module 목록과 허용 edge에 `problems`가 없다(feature module끼리는 서로 import하지 않는다). coding agent operation 상한(`codingAgentOperationPolicies`)에 test result 기록 막기(`writesTestResult`)가 없다. 막을 route가 없어졌다.
  - 등록할 것(lead)
    - `packages/core/main/daemon/assembly.ts`: `problemsTestDefinitions` import(9)와 `TEAMS` 줄(57), `TEAM_MODULES`의 problems URL(79), `problemsTestsWiring` import(34)와 `WIRINGS` 줄(124). 99줄 주석의 "problems는 apps 뒤"를 고친다.
    - `packages/protocol/mod.ts`: problems `ROUTES` import(18)와 `...problemsRoutes,`(27). `export * as problems`(4)는 남는다.
    - worker는 지운 것을 가리키는 위 줄만 빼서 check를 통과시키고 여기 적는다(orchestrate review의 예외). 99줄 주석은 lead가 고친다.
    - project-docs(worker는 고치지 않는다. lead가 이 task branch에서 merge 전에 고친다. 안 고치면 merge.sh의 check가 떨어진다): `project-docs/module-catalog.yaml` 66-68줄의 `packages/core/problems` 항목(`tools/check-modules.ts`가 "없는 path"로 떨어진다), `project-docs/architecture/coding-agent.md` 71줄의 `packages/core/problems/tests/unproven.ts`(`tools/check-docs.ts`가 "없는 path"로 떨어진다).

## 할 일

근거: README "뼈대 검토에서 정한 것"과 roadmap "지우는 것" 표. 지우는 이름마다 먼저 `git grep -nw <이름> -- packages tools`로 읽는 곳을 본다. 읽는 곳이 check 밖(`tests/e2e`, `tests/eval`, `tools/check.ts`의 `NOT_CHECKED`)에만 남으면 그대로 지우고 보고에 적는다.

1. 먼저 확인한다(앞 wave와 ab-ticket-delete land 뒤). 아래와 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - `git grep -n "core/problems\|problems/tests\|problems/register\|\.\./problems/\|protocol/problems/\(mod\|tests\|app-test-lookup\|test-frames\|registry\|problem-codes\)" -- packages tools ':!packages/core/problems' ':!packages/protocol/problems'`가 이 task 소유(`wiring/problems-tests.ts`, `wiring/supervision.ts`, `worker/{main.ts,test-runner.ts}`, `preview/adapters/mod.ts`, `blueprint/describe.ts`, `domain.ts`)와 `packages/core/main/daemon/assembly.ts`, 그리고 남는 `packages/protocol/apps/broker.ts` 3(`exception-observation.ts`) 안에만 있다. main `dd956b49f`에는 `packages/coding-agent/cli/main_test.ts`, `agent-tools/release.ts`, `apps/control.ts`, `packages/publish.ts`, `releases/commands.ts`, `wiring/apps.ts`, `wiring/apps-tickets.ts`, `tickets/checker/work.ts`, protocol `cli-commands.ts`가 더 걸린다. 앞 task들이 모두 뗐어야 한다.
   - `git grep -nwE "requestTest|getVerification|getTestRequest|listVerifications|recordVerification|observeTestRequest|verificationRecorded|AppTestVerificationLookup|AppTestVerificationLookupPort|findAppTestVerification|findPassedAppTest|deriveAppTest|TEST_RUNNER_KIND|writesTestResult" -- packages tools ':!packages/core/problems' ':!packages/protocol/problems'`가 이 task 소유(`connections/operations.ts`, `wiring/problems-tests.ts`, `wiring/supervision.ts`, `worker/main.ts`, `domain.ts`) 안에만 있다.
   - `git grep -n "reactor\.on(" -- packages/core`가 0줄이다(ab-ticket-delete가 `VerificationRecorded` handler를 지웠다).
   - `git grep -nE 'idSchema\("(tkt|vrf)"\)|newId\("(tkt|vrf)"\)|Id<"(tkt|vrf)">' -- packages ':!packages/core/problems' ':!packages/protocol/problems'`가 0줄이다.
   - `DOMAIN_EVENTS`(`packages/protocol/events/domain.ts`)가 `codingSessionEnded`, `verificationRecorded` 둘이다.
2. 폴더와 file을 지운다: `git rm -r packages/core/problems packages/protocol/problems/tests.ts packages/protocol/problems/app-test-lookup.ts packages/protocol/problems/test-frames.ts packages/protocol/problems/registry.ts packages/protocol/problems/problem-codes.ts packages/core/main/daemon/wiring/problems-tests.ts packages/core/main/worker/test-runner.ts`. 안의 test(`generate_test.ts`, `checks_test.ts`, `examples_test.ts`, `model_test.ts`, `runner-service_test.ts`)도 같이 없어진다. 지우는 규칙만 보던 test다. 의존성과 migration 판정은 ab-release-checks의 test가 본다. `git status`로 `packages/core/problems/`에 추적되지 않은 file이 남지 않았는지 본다(폴더가 남으면 check-modules가 거꾸로 걸린다).
3. protocol
   - `packages/protocol/problems/mod.ts`는 `export * from "./exception-observation.ts"; export * from "./sdk-report.ts"; export * from "./sdk-problem.ts";` 셋만 남는다(1-4, 8을 뺀다).
   - `packages/protocol/mod.ts`의 18, 27줄을 뺀다(위 "등록할 것").
   - `packages/protocol/events/domain.ts`: `verificationRecorded` import(8)와 `DOMAIN_EVENTS`·`domainEventSchema`의 그 줄을 지운다. `DOMAIN_EVENTS`는 `codingSessionEnded` 하나다. 비우지 않는다(ab-ticket-delete의 "정한 것").
   - `packages/protocol/base/ids.ts`: `vrf`(14), `tkt`(26)를 지운다.
4. 기동과 worker
   - `packages/core/main/daemon/wiring/supervision.ts`: `TEST_RUNNER_KIND` import(4), env의 test runner 갈래와 주석(26-27), `sessionBusEnv`와 주석(93-101)을 지운다.
   - `packages/core/main/worker/main.ts`: import(7-8)와 `WORKER_ENTRIES`의 `[TEST_RUNNER_KIND]`(17-22)를 지운다.
   - `packages/core/main/daemon/assembly.ts`: 위 "등록할 것"의 줄만 뺀다.
5. 등록 칸
   - `packages/core/storage/ledger/team-module.ts`: `TeamModule.problemsTestDefinitions`(46)를 지운다.
   - `packages/core/storage/ledger/writer-assembly.ts`: `teamRegistration`의 problems 갈래(164-171)를 지운다. 198줄 주석의 "problems·"를 뺀다.
   - `packages/core/main/daemon/registration.ts`: `fromProblems`(111, 119)를 지운다.
6. `tools/check-deps.ts`
   - `CORE_FEATURES`(70)에서 `"problems"`를 빼고 `CORE_FEATURE_EDGES`(67)를 지운다. 98-103의 조건은 `CORE_FEATURES.has(from) && CORE_FEATURES.has(to)`이고 글은 "feature module끼리는 서로 import하지 않는다"다.
   - 64·66줄 주석에서 problems와 "problems → apps만"을 뺀다.
   - `HARNESS_FEATURE_PROTOCOLS`의 `"problems"`는 남긴다(위 "정한 것").
7. `packages/core/apps/connections/operations.ts`: `writesTestResult`(23-27)와 부르는 곳(48)을 지운다. 2-4줄 주석의 "machine test result 작성"과 34줄의 "와 test result 기록"을 뺀다. `READ_ONLY_RESOURCES`와 그 밖 판정은 그대로다.
8. 주석
   - `packages/core/apps/preview/adapters/mod.ts` 1-3: preview 자식 하나의 묶음이라고만 쓴다(test 자식과 `core/problems/tests/work/app-driver.ts` 줄을 뺀다).
   - `packages/core/apps/blueprint/describe.ts` 2-3: "실제 test 통과(problems/tests)"를 뺀다(구조 검사와 다른 근거라는 뜻만 남긴다).
   - `packages/core/apps/runtime/entrypoint/main.ts` 137: "supervisor와 test runner가" → "supervisor와 preview가"처럼 지금 띄우는 쪽으로. 띄우는 쪽은 `packages/core/apps/` 안에서 확인한다.
   - `packages/protocol/apps/activation/data-job.ts` 9-10: "와 problems test runner가"를 뺀다. job kind `"test"`(16)는 고치지 않고 보고한다.
9. 이 worktree의 `.dev-data/`에 옛 data root가 있으면 지운다. 지운 step(`test-requests`, `verifications`, `test-evidence`)이 적용된 root는 `history_mismatch`로 뜨지 않는다(AGENTS.md "호환성").
10. 아래 "남지 않음"을 돌려 소유 file의 주석과 오류 글을 고친다. 소유 밖에 남은 것은 고치지 않고 보고한다.

## 끝남

- `deno task check`가 통과한다. 다만 modules와 docs 단계는 위 "등록할 것"의 project-docs 두 곳 때문에 떨어진다. 그 둘만으로 떨어지는지 확인하고, 나머지 단계(type check, lint, test)를 끝까지 보려면 그 두 곳을 worktree에서 잠시 지우고 `deno task check`를 돌린 뒤 `git checkout -- project-docs`로 되돌린다. project-docs 변경은 commit하지 않는다.
- 바꾼 곳의 test: `deno test --no-check -A packages/core/main packages/core/storage/ledger packages/core/apps/preview packages/core/events`. `deno run --allow-read tools/check-deps.ts`가 통과한다(feature module 규칙을 바꿨다).
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(새 data root라 바뀐 schema step 목록이 처음부터 돈다. worker 기동 목록이 바뀐다).
- 위험 test: 없음. 지우기만 한다. 같이 지우는 test는 test runner의 규칙(rewind 증명, examples, frozen test, runner 명령 key, test 결과 읽기 범위)을 보던 것이고 그 route와 process가 없어진다. coding agent 상한의 `writesTestResult`는 막을 route(`problems` 자원의 `record-verification`)가 없어져 지우는 것이라 대신할 test가 없다. migration 판정은 ab-release-checks의 test가 본다.
- 남지 않음
  - `git grep -nwE "VerificationRecorded|verificationRecorded|TEST_RUNNER_KIND|RecordVerification|recordVerification|RequestTest|requestTest|getVerification|getTestRequest|listVerifications|observeTestRequest|problemsTestDefinitions|problemsTestsWiring|ProblemsPart|testRunnerSpec|runRunnerService|runnerReady|writesTestResult|sessionBusEnv|CORE_FEATURE_EDGES|AppTestVerificationLookup|AppTestVerificationLookupPort|findAppTestVerification|findPassedAppTest|deriveAppTest|problemCodeSchema" -- packages tools`가 0줄이다.
  - `git grep -nE '"(tkt|vrf)"' -- packages tools`가 0줄이다.
  - `git grep -n -i "unproven\|test runner\|test-runner\|problems/tests\|core/problems" -- packages tools`가 0줄이다. `packages/core/apps/releases/bundle/seal.ts` 3줄(ab-release-prepare 소유)처럼 소유 밖에 남은 것은 file:줄로 보고한다.
  - `git ls-files packages/core/problems`가 0줄이고 `git ls-files packages/protocol/problems`가 `exception-observation.ts`, `mod.ts`, `sdk-problem.ts`, `sdk-report.ts`뿐이다.

## 보고

- 바꾼 file
- 통과한 check(modules와 docs가 project-docs 두 곳으로만 떨어졌는지 포함)
- 등록할 것: 위 계약의 "등록할 것"(assembly.ts와 `packages/protocol/mod.ts`에서 뺀 줄, lead가 고칠 project-docs 두 곳)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 적어도 아래를 `git grep -nw`로 보고 쓰는 곳이 없으면 적는다: `applyMemoryLimit`(`packages/core/supervision/security/`), `createPreviewBrokerServices`·`previewScopeOf`(`packages/core/apps/preview/`), `appArgv`·`appEnv`(`packages/core/apps/runtime/`), `unixDirectTransport`, `lookupAppRegistration`, `EventVisibilityDefinition`(`packages/protocol/server/registration.ts`), team 등록의 `workers` 칸(`TeamRegistration.workers`, `Assembled.workers`. 채우던 곳이 test runner뿐이고 읽는 곳이 없다)
- 소유 밖에 남은 것: 적어도 앱 runtime mode `"test"`(`packages/protocol/apps/channel-values.ts` 31, `packages/core/apps/runtime/entrypoint/`, `packages/sdk/cap-*/host.ts`), data job kind `"test"`(`packages/protocol/apps/activation/data-job.ts` 16), identity의 `test_runner_only`·`test_runner`(`packages/core/server/identity/{model.ts,registry.ts}`. 이미 켜는 곳이 없다), shell main이 core에 주는 `--allow-env`의 `DBUS_SESSION_BUS_ADDRESS`(`packages/shell/main/desktop/core/supervise.ts` 58. test runner의 메모리 상한이 쓰던 것)
- check 밖에 남은 것: `tests/e2e`, `tests/eval`, check 밖 `tests/support`에서 `packages/protocol/problems/mod.ts`의 지운 이름을 쓰는 file 목록
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
