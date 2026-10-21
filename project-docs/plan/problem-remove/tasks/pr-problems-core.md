# pr-problems-core

core의 problem 모델과 보고 길을 지운다: 상태 machine과 묶음(reporting, grouping), collector worker와 그 감독 등록, snapshot, 보고 표, `problem.more`(repairs), 사람 feedback, 저장하는 kind 위반(`domain_problems`, `problem.sync_domain`), 상세 수집 설정. 옛 표·route·schema step은 migration 없이 지운다. app test runner(`packages/core/problems/tests`)는 남는다.

- 단위: problems-core (wave 4)
- 선행: pr-reactions, pr-test-runner-reports, pr-cli-problem, pr-log-exception, pr-kinds-toast, pr-problem-refs, pr-issues-ui-main. 이 길들을 부르던 쪽(reaction, test runner, CLI, supervisor, kinds, ticket 근거, shell feedback)이 먼저 끊긴다.
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/facts.ts`
  - `packages/core/problems/register.ts`
  - `packages/core/problems/ports.ts`
  - `packages/core/problems/reporting`
  - `packages/core/problems/grouping`
  - `packages/core/problems/snapshots`
  - `packages/core/problems/repairs`
  - `packages/core/problems/feedback`
  - `packages/core/problems/domain`
  - `packages/core/problems/tests/runner.ts`
  - `packages/core/main/daemon/assembly.ts`
  - `packages/core/main/daemon/registration.ts`
  - `packages/core/main/daemon/wiring/problems.ts`
  - `packages/core/main/daemon/wiring/setting-declarations.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/worker/main.ts`
  - `packages/core/storage/ledger/writer-assembly.ts`
  - `packages/core/storage/ledger/team-module.ts`
  - `packages/core/apps/register.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/apps/releases/store.ts`
  - `packages/core/apps/releases/mod.ts`
  - `packages/shell/renderer/desktop/settings/testdata/fake-settings.ts`
  - `packages/design/wording` (key만)
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것", roadmap `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것"
  - architecture: `project-docs/architecture/layers.md`(composition root, "실행 때 import가 뜻하는 것", problems → apps), `project-docs/architecture/kinds.md`(저장하는 위반. 지금 동작이고 문서는 계획 끝에 lead가 고친다), `project-docs/architecture/annotation.md`(사람 feedback 대신 annotation)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `app-releases`, `storage`, `config`, `child-supervision-protocol`, `project-docs/module-catalog.yaml`의 `packages/core/problems`, `packages/core/main`, `packages/core/apps`, `packages/core/storage`
  - 앞 task(brief는 `project-docs/plan/problem-remove/tasks/`): `pr-log-exception.md`(source map 풀이를 `packages/core/apps/runtime/observations/stack-frames.ts`로 옮겼다), `pr-test-runner-reports.md`, `pr-kinds-toast.md`, `pr-problem-refs.md`, `pr-issues-ui-main.md`, `pr-cli-problem.md`
  - skill: `.claude/skills/wording/SKILL.md`(key를 지우고 생성물을 다시 만든다)
  - 코드: `packages/core/problems/tests/register.ts`(`satisfies ProblemsPart`. 남는 칸), `packages/core/main/daemon/wiring/problems-tests.ts`(남는 wiring), `packages/core/storage/migration/migrations.ts`(`checkHistory`: 지운 schema step이 적용된 옛 data root는 `history_mismatch`로 뜨지 않는다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `packages/core/problems/register.ts`는 test runner 몫만 낸다: `problemsTestDefinitions`, `createReaderRegistration`(tests 몫). `problemsReportDefinitions`, `createLedgerRegistration`, `detailCollectionSetting`, `ReleaseLookupPort`, `ProblemsPart`의 report 몫이 없어진다. `worker-root.ts`는 tests가 써서 남는다.
    - 없어지는 것: worker kind `problems/report-collector`(`COLLECTOR_KIND`, `reportCollectorSpec`, collector worker 진입), worker route `problems/report`·`observe-exception`·`observe-view-error`·`submit_feedback`, `problems/report_body` read, `problem.*` command·read handler, 설정 `problems.detail_collection`, ledger의 problems report 등록 칸(`problemsReportDefinitions`), apps의 `ProblemWordingPort` 등록, `releaseLookupOf`·`releaseWording`, 앱 자식 credential의 `problem.report`·`ObserveException`, machine의 `app.logs` 정책(collector 몫)
    - protocol `packages/protocol/problems/*`의 죽은 file은 이 task 뒤 `pr-cleanup`이 지운다. 이 task는 core에서 그것을 쓰는 곳만 없앤다.

## 할 일

1. `packages/core/problems/register.ts`를 test runner 몫만 남게 줄인다.
   - 지운다: `reportParts`, `problemsReportDefinitions`, `createLedgerRegistration`, `ProblemsLedgerEnvironment`, `detailCollectionSetting`·`ReleaseLookupPort` 다시 내보내기, part import 여섯(reporting, reporting/worker, snapshots, grouping, domain, repairs)과 `SnapshotLogsEnvironment` import.
   - 남긴다: `problemsTestDefinitions = testsPart`, `createReaderRegistration`(tests part 하나. port는 빈 Map), `ProblemsPart` type.
   - `ProblemsPart`에서 tests part가 쓰지 않는 칸(`apiReads`, `workerRoutes`, `uploadRoutes`, `readerPorts`, `ledgerApiReads`)을 뺀다. 정한 것: 쓰는 part가 없어진 칸이라 지운다. `packages/core/problems/tests/register.ts`의 `satisfies ProblemsPart`가 통과하는 칸은 남긴다.
2. 폴더와 file을 지운다: `packages/core/problems/reporting`, `grouping`, `snapshots`, `repairs`, `feedback`, `domain`, `packages/core/problems/ports.ts`. 안의 `*_test.ts`도 같이 지운다. 표 `problems`, `reports`, `snapshots`, `domain_problems`와 schema step `problems.problems`, `problems.reports`, `problems.snapshots`, `problems.domain_problems`가 같이 없어진다. migration은 만들지 않는다(AGENTS.md "호환성").
3. `packages/core/problems/tests/runner.ts`: `COLLECTOR_KIND`, `reportCollectorSpec`을 지우고, `testRunnerSpec` 주석의 "보고를 낸다"를 고친다(runner의 core loopback은 요청별 machine credential의 command뿐이다).
4. daemon 조립:
   - `packages/core/main/daemon/assembly.ts`: import의 `createLedgerRegistration as createProblemsRegistration`·`problemsReportDefinitions`, `TEAMS`의 `{ problemsReportDefinitions }`·`{ createLedgerRegistration: createProblemsRegistration }`, `WIRINGS`의 `problemsWiring`과 그 import를 지운다. `TEAM_MODULES`의 `problems/register.ts`는 남긴다(reader Worker가 tests read를 붙인다).
   - `packages/core/main/daemon/registration.ts`: `fromProblemsReport`를 지운다.
   - `packages/core/storage/ledger/team-module.ts`: `TeamModule.problemsReportDefinitions`를 지운다.
   - `packages/core/storage/ledger/writer-assembly.ts`: problems 갈래는 `problemsTestDefinitions`만 모은다. "tests와 reporting 두 등록" 주석을 고친다.
   - `packages/core/main/daemon/wiring/problems.ts`를 지운다(collector 기동과 credential, collector blob 정책, `problems/report_body` handler, `GetSnapshotLogs` 통로 environment).
   - `packages/core/main/daemon/wiring/setting-declarations.ts`: `detailCollectionSetting`과 그 import를 지운다.
   - `packages/core/main/daemon/wiring/apps.ts`: 앱 자식 credential을 ledger에 기록하는 곳의 "collector는 요청 credential을 ledger 행으로 다시 읽는다" 주석을 고친다. 기록은 남긴다. 앱 자식의 `app.call_tool`이 writer를 지나고, writer는 기록 없는 자격의 command를 거절한다.
   - `packages/core/main/worker/main.ts`: `WORKER_ENTRIES`의 `[COLLECTOR_KIND]`와 collector import를 지운다.
5. apps:
   - `packages/core/apps/control.ts`: `APP_CHILD_OPERATIONS`는 `appCallTool.name` 하나가 된다. `appsOperationPolicies`에서 `problemReport`·`observeException`의 app 정책과 machine의 `appLogs` 정책(collector 몫)을 지운다. import에서 `problemReport`, `observeException`을 뺀다(`requestTest`와 `appLogs`는 다른 곳이 쓴다). `APP_CHILD_OPERATIONS` 위 주석("문제 보고, process 관측")을 고친다.
   - `packages/core/apps/register.ts`: writer ports의 `{ key: ProblemWordingPort, create: () => releaseWording }`, reader ports의 `[ProblemWordingPort, releaseWording]`, 그 주석 둘과 import(`ProblemWordingPort`, `releaseWording`)를 지운다.
   - `packages/core/apps/releases/store.ts`: `releaseLookupOf`, `ReleaseFactRow`, `releaseWording`, import의 `ProblemWordingFact`와 `permissionLabel`을 지운다.
   - `packages/core/apps/releases/mod.ts`: `releaseLookupOf`, `releaseWording` 다시 내보내기를 지운다.
6. 설정 `problems.detail_collection`:
   - `packages/shell/renderer/desktop/settings/testdata/fake-settings.ts`의 `declared("problems.detail_collection", ...)`를 지운다.
   - `packages/design/wording/catalog/workspace-settings.ts`의 `settings.problems-detail_collection.help`, `settings.problems-detail_collection.name`을 지우고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 생성물을 다시 만든다. placeholders는 손으로 고치지 않는다.
7. 지운 이름을 grep해 소유 file의 주석과 오류 메시지에 남은 것을 고친다. route는 method 문자열로도 grep한다: `list_problems`, `get_problem`, `get_occurrence`, `more_problem`, `set_state`, `report_problem`, `record_problem_report`, `submit_feedback`, `observe-view-error`, `sync_domain`, `list_domain`, `report_body`, `get-snapshot-logs`. 소유 밖에 남은 것은 고치지 않고 보고한다(`packages/core/problems/agent-tools.ts`와 role tool 목록은 `pr-agent-tools`, shell의 화면 오류 전송은 `pr-log-view-error`, `packages/protocol/problems/`는 `pr-cleanup`).
8. 이 worktree의 `.dev-data/`에 옛 data root가 있으면 지운다. 지운 schema step이 적용된 root는 `history_mismatch`로 뜨지 않는다(AGENTS.md "호환성"). `boot.sh`는 새 data root를 쓴다.

추가(planner): `facts.ts`의 `permissionLabel`은 `releaseLookupOf`만 썼다. 같이 지운다.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `cd <worktree>; project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 두 번 찍는다.
- 위험 test: 없음. 같이 지우는 test(`reporting/model_test.ts`의 다시 열기와 닫기 gate, `domain/*_test.ts`, `snapshots/work_test.ts`)는 지우는 규칙을 보던 것이다. 권한 경계 test가 아니다.
- 남지 않음:
  - `git grep -nE "problemsReportDefinitions|createProblemsRegistration|problemsWiring|ReleaseLookupPort|releaseLookupOf|releaseWording|ProblemWordingPort|detailCollectionSetting|detail_collection|COLLECTOR_KIND|reportCollectorSpec|report-collector|runCollectorWorker|ProblemsLedgerEnvironment" -- packages tools ':!packages/protocol/problems'`가 0줄이다.
  - `git grep -nE "problems/(reporting|grouping|snapshots|repairs|feedback|domain)/|problems/ports\.ts" -- packages tools`가 0줄이다. 소유 밖 주석에 남았으면 고치지 않고 보고한다.
  - `git grep -nE '"problems\.(problems|reports|snapshots|domain_problems)"' -- packages`가 0줄이다.
  - `git grep -nwE "problemReport|observeException" -- packages/core`가 0줄이다.
  - `git ls-files packages/core/problems`에 `agent-tools.ts`(`pr-agent-tools`가 지운다), `register.ts`, `worker-root.ts`, `tests/` 아래 file만 있다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task는 `assembly.ts`를 소유하므로 그 목록은 직접 고치고 여기에 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 적어도 `packages/core/apps/releases/facts.ts`의 `permissionLabel`(쓰던 곳이 `releaseLookupOf`뿐이다. `releases/mod.ts`가 다시 내보낸다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도: wave 5가 merge될 때까지 shell main의 화면 오류 전송(`problems/observe-view-error`), agent의 `problem.*` tool, `app.get`의 열린 문제 수가 없어진 route를 부른다(README: wave 4와 5는 같이 land한다)
