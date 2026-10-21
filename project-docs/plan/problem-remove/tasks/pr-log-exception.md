# pr-log-exception

잡히지 않은 예외를 core problems로 보내지 않고 앱 log 줄로 쓴다. 예외 stack은 봉인된 bundle의 source map으로 원래 source 줄로 풀어 쓴다(`packages/core/problems/snapshots/`의 풀이를 apps 쪽으로 옮긴다). broker의 `problems/report` 길과 crash 관측 보고를 지운다.

- 단위: log (wave 3)
- 선행: pr-log-writer, pr-log-sdk, pr-test-runner-reports. writer의 `append`를 쓰고, SDK가 `problems/report`를 더 부르지 않고, test runner가 `createProblemReportService`를 더 쓰지 않아야 broker service를 바꿀 수 있다.
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/observations/stack-frames.ts` (새 file)
  - `packages/core/apps/runtime/observations/crash.ts`
  - `packages/core/apps/permissions/mod.ts`
  - `packages/core/apps/permissions/broker/problems.ts`
  - `packages/core/apps/permissions/broker/server.ts`
  - `packages/core/apps/preview/adapters/mod.ts`
  - `packages/core/apps/runtime/supervisor/supervisor.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/core/main/app-supervisor/broker.ts`
  - `packages/core/main/app-supervisor/preview-broker.ts`
  - `packages/protocol/apps/broker.ts`
  - `packages/protocol/apps/calls/broker.ts`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(잡히지 않은 예외와 화면 오류는 log 줄이 된다, 예외 stack은 봉인된 bundle의 source map으로 푼다)과 "뼈대 검토에서 정한 것"(앱 process가 비정상으로 끝나면 log에 한 줄 쓴다, preview와 test mode의 오류는 이번에 log에 쓰지 않는다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "새로 더하는 것"(잡히지 않은 예외의 stack을 원래 source 줄로 풀어 log에 쓴다. 봉인된 bundle은 agent의 file 범위 밖이다)과 "정한 것"(보고 길을 log로 합친다)
  - 계약 task: `project-docs/plan/problem-remove/tasks/pr-log-contract.md`(줄 꼴), `project-docs/plan/problem-remove/tasks/pr-log-writer.md`(`logFileOf(app)`, `AppLogFile.append`, 쓰기 실패는 supervisor를 멈추지 않는다)
  - architecture: `project-docs/architecture/app-call.md`(supervisor와 broker, live 자식만 바깥에 닿는다), `project-docs/architecture/annotation.md`의 "왜 이 모양인가" 첫 줄(화면마다의 source map은 앱 오류 stack 풀이에 남는다), `project-docs/architecture/layers.md`(feature module은 problems → apps 한 방향. 풀이가 apps로 오면 apps가 problems를 import하지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-capability`, `child-supervision-protocol`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/protocol`
  - skill: `.claude/skills/write-test/SKILL.md`
  - 옮겨 올 코드: `packages/core/problems/snapshots/work.ts`(`resolveStackFrames`부터 `decodeField`까지), `packages/core/problems/snapshots/source-map.ts`, 본보기 test `packages/core/problems/snapshots/work_test.ts`
  - 보내는 쪽(읽기만): `packages/core/apps/runtime/entrypoint/main.ts`(`reportException`, `reportCaught`), `packages/core/apps/runtime/entrypoint/crash.ts`, `packages/sdk/cap-problem/exception-observer.ts`
- 계약:
  - 쓰는 것: `pr-log-writer`의 `logFileOf(app)`·`AppLogFile.append`; `pr-log-contract`의 줄 꼴(`exception <name>: <message>`, frame마다 `  at <path>:<line>:<column>`); `exceptionObservationInputSchema`(`packages/protocol/problems/exception-observation.ts`); `appBundleCopy`(`packages/protocol/apps/app-storage.ts`)
  - 내놓는 것:
    - `stack-frames.ts`: `packages/core/problems/snapshots/source-map.ts`와 `snapshots/work.ts`의 frame 풀이(`resolveStackFrames`와 그것이 부르는 함수)를 옮긴 것. snapshots 쪽 사본은 `pr-problems-core`가 지운다.
    - broker의 예외 관측(`/_lophn/broker/problems/observe-exception`)은 받은 관측(이름, 내용, stack, invocation)을 redaction과 frame 풀이를 거쳐 그 앱 log에 쓴다. core `problems/observe-exception`을 부르지 않는다.
    - 지운다: broker `problems/report` 길(`APP_BROKER_PATHS.problemsReport`, `brokerReportProblemInputSchema`, `brokerProblemReportOutputSchema`), `ProblemReportService`·`ProblemsReport`의 report 몫, crash 관측 보고(`createCrashObserver`와 supervisor의 `observeEvent` 보고 몫)
    - `protocol/apps/broker.ts`와 `protocol/apps/calls/broker.ts`는 `problems/reports.ts`·`problems/problem-report.ts`를 더 import하지 않는다(그 file은 `pr-cleanup`이 지운다).

## 할 일

근거는 README "정한 것"의 "잡히지 않은 예외와 화면 오류는 log 줄이 된다"와 "뼈대 검토에서 정한 것"의 두 줄(비정상 종료 한 줄, preview·test 오류는 쓰지 않는다)이다. 앱 process의 예외는 broker(supervisor 안)에 오므로 core를 거치지 않고 supervisor가 바로 그 앱 log file에 쓴다. 쓰는 쪽은 supervisor 하나다(`pr-log-contract`).

1. `packages/core/apps/runtime/observations/stack-frames.ts`를 만든다. frame 풀이를 옮기고 동작은 바꾸지 않는다.
   - 옮길 것: `snapshots/work.ts`의 `bundleCopyPath`, `resolveStackFrames`, `SCREEN_FILE`, `frameFromScreenMap`, `OUTSIDE_SOURCE`, `StackSite`, `stackSites`, `filePathOf`, `framesInsideBundle`, `bundledSource`, `relativeToFolder`, `walkAllMappings`, `decodeSegment`, `decodeField`과 쓰는 상한 둘(`snapshot_frames` 32, `stack_bytes` 16,384); `snapshots/source-map.ts`의 `SCREEN_KEY`, `SourceMapFailure`, `readIfInside`, `readSourceMap`, `readBundleManifest`. 쓰는 곳 없는 `B64`·`B64_VALUES`는 옮기지 않는다.
   - 내놓는 것: `type StackFrame = { path: string; function: string | null; line: number; column: number }`, `resolveStackFrames(input: { dataRoot: string; app: string; bundleHash: string | null; stack: string | null }): Promise<StackFrame[]>`. frame type은 여기 둔다. protocol `SourceFrame`(`packages/protocol/problems/`)은 `pr-cleanup`이 지우므로 import하지 않는다.
   - 지킬 것(옛 코드 그대로): 봉인 사본(`appBundleCopy(dataRoot, app, bundleHash)`) 밖 path, symlink, `..`은 읽지 않는다. 화면 JS(`/screens/<key>/main.js`)를 가리킨 stack은 그 화면 map(`screens/<key>/main.js.map`)으로 풀고, 아니면 사본 안 TS frame을 사본 기준 상대 path로 쓴다. frame은 32개까지다. 풀 수 없으면 빈 목록이다.
   - 주석의 "problems는 apps를 import하지 않으므로"를 고친다. `SCREEN_KEY`는 `packages/core/apps/releases/ui-build/app-build.ts`가 export하지 않으므로 반복해 두고 "같은 규칙"이라고만 적는다.
   - snapshots 쪽 원본은 그대로 둔다(`pr-problems-core`가 지운다).
2. broker의 예외 service를 log 쓰기로 바꾼다(`packages/core/apps/permissions/broker/problems.ts`).
   - 지운다: `ProblemReportRequest`, `ProblemsReport`, `ProblemReportService`, `createProblemReportService`, `brokerProblemReportOutputSchema`·`brokerReportProblemInputSchema` import, 머리 주석의 `/_lophn/broker/problems/report`.
   - 새로 둔다(정한 것 1): `type ExceptionLog = { frames(child: BrokerChild, stack: string | null): Promise<StackFrame[]>; append(app: string, entry: { invocation: string | null; text: string }): void }`, `type ExceptionLogService = { observe(child: BrokerChild, body: unknown): Promise<Result<{ written: true }>> }`, `createExceptionLogService(deps: { log: ExceptionLog }): ExceptionLogService`.
   - `observe`: 본문을 `brokerProblemObserveInputSchema`로 읽는다(틀리면 `invalid_input`). frame을 먼저 다 풀고, 그 뒤 줄을 사이에 await 없이 이어 `append`한다(정한 것 4).
     - 첫 줄: `exception <name>: <message>`. `name`은 `error.name`이고 `error`가 null이면 관측 종류(`observation`)다. message가 null이거나 `error`가 null이면 `exception <name>`이다.
     - 그 뒤 `frames(child, error?.stack ?? null)`가 낸 frame마다 `  at <path>:<line>:<column>`.
     - 모든 줄의 `invocation`은 `observation.invocation?.id ?? null`이다. handler가 던진 오류(`reportCaught`)는 invocation이 있고, 전역 `error`·`unhandledrejection`은 null이다.
     - 답은 `ok({ written: true })`다(정한 것 2).
   - redaction과 300자 자르기는 `append`(`AppLogFile`)가 줄마다 한다. service는 원문을 따로 남기지 않는다.
3. `packages/core/apps/permissions/broker/server.ts`: `BROKER_ROUTES.problemsReport`를 지운다. `BrokerServices.problems`를 `exceptions?: ExceptionLogService`로 바꾸고, `routes()`는 `exceptions`가 있으면 `problemsObserve` 경로 하나만 단다. 경로 문자열 `/_lophn/broker/problems/observe-exception`은 SDK 진입점(`BROKER_PATHS.problemsObserve`)이 쓰므로 그대로다. `APP_BROKER_PATHS` import는 `appsCall`이 계속 쓴다.
4. `packages/core/apps/permissions/mod.ts`: export를 `createExceptionLogService`, type `ExceptionLog`, `ExceptionLogService`로 바꾼다.
5. `packages/core/apps/preview/adapters/mod.ts`: `PreviewBrokerOptions.problems`, `ProblemReportService` import, 머리 주석의 보고(problems) 서비스 줄을 지운다. preview와 test 자식에는 예외 경로가 없다(README "preview와 test mode의 오류는 이번에 log에 쓰지 않는다"). test runner(`packages/core/problems/tests/work/app-driver.ts`)는 `pr-test-runner-reports`가 `problems`를 넘기지 않게 바꾼 뒤다.
6. `packages/core/main/app-supervisor/broker.ts`: `BrokerAdapters.problems`를 `exceptions: ExceptionLog`로 바꾸고, `servicesFor`가 `exceptions: createExceptionLogService({ log: adapters.exceptions })`를 단다.
7. `packages/core/main/app-supervisor/preview-broker.ts`: `closedProblems`와 그 주석, problems service를 지운다. `previewServicesFor`는 `createPreviewBrokerServices({ scope })`에 ready만 더한다. preview 자식이 observe-exception을 부르면 server.ts의 "모르는 경로"(`not_found`)다.
8. `packages/core/apps/runtime/observations/crash.ts`를 log 한 줄 만들기로 바꾼다(README "뼈대 검토에서 정한 것": exit code, 시작 실패, crash loop).
   - 지운다: `createCrashObserver`, `CrashDeps`, `CrashOutcome`, `CrashObserver`, `ObservedExceptionInput`·`exceptionObservationInputSchema` import, `IdSource` import.
   - 남긴다: `CrashEvent`, 근거 구별(`CRASH_EVIDENCE`, `V8_OOM`, `classifyExit`, `evidenceOf`), `messageOf`.
   - 낸다: `crashLogText(event: CrashEvent): string | undefined`. 의도된 정지면 `undefined`, 아니면 `process_exit <근거>: <message>`다(정한 것 3). 근거는 `unexpected_exit`, `v8_oom`, `start_failed`, `ready_timeout`, `crash_loop`다.
   - 머리 주석을 "앱 log 한 줄"로 고친다. `stderrTail`은 계속 V8 OOM 근거를 찾는 데만 쓰고 줄에 싣지 않는다.
9. `packages/core/main/app-supervisor/assembly.ts`를 고친다.
   - 지운다: `problemsFor`, `problemReport`·`reportAcceptanceSchema` import(`protocol/problems/mod.ts`), `ProblemsReport` import, `brokerAdapters.problems`, `createCrashObserver` import, `lastCredential`(crash 보고만 썼다).
   - `brokerAdapters.exceptions`를 단다.
     - `frames(child, stack)`: `resolveStackFrames({ dataRoot, app: child.app, bundleHash, stack })`. `dataRoot`는 `pr-log-writer`가 log file을 열려고 조립에 들인 data root다. `bundleHash`는 `requestCredential`이 `request.desired.bundleHash`를 nonce에 묶어 둔 값이고(정한 것 5), 모르면 null이다.
     - `append(app, entry)`: `logFileOf(app).append(entry)`.
   - `observeEvent`: crash 관측 보고(`createCrashObserver`, `bearer`, `io.post("problems/observe-exception", …)`)를 지운다. `crashLogText`가 글을 내면 `logFileOf(event.app).append({ invocation: null, text })`로 쓴다. memory 정리(`setChild(null)`)와 종료 뒤 nonce map 정리(`credentials`, `tails`, 5의 bundle hash)는 그대로 한다.
   - `SupervisorIo.ids`는 이제 쓰는 곳이 없지만 `main.ts`(이 task 소유가 아니다)가 넘기므로 남긴다. 보고의 "안 쓰게 된 export"에 적는다.
   - 주석(`observeEvent` 위 "실패의 근거를 구별해 problems로 보낸다", `tee`의 "보고에 싣지 않는다")을 맞춘다.
10. `packages/core/apps/runtime/supervisor/supervisor.ts`: `SupervisorEvent` 주석("조립이 problems 관측(crash)으로 바꾼다")과 `onEvent` 주석을 "조립이 앱 log 한 줄로 쓴다"로 고친다. 동작은 그대로다.
11. `packages/protocol/apps/broker.ts`: `brokerProblemReportOutputSchema`와 그 위 주석, `reportAcceptanceSchema` import(`../problems/reports.ts`)를 지운다. `brokerProblemObserveInputSchema`는 남는다(`exception-observation.ts`는 `pr-cleanup`이 남긴다).
12. `packages/protocol/apps/calls/broker.ts`: `APP_BROKER_PATHS.problemsReport`, `brokerReportProblemInputSchema`, `problemReportInputSchema` import(`../../problems/problem-report.ts`)를 지운다.
13. 지운 이름(`problemsReport`, `ProblemsReport`, `createCrashObserver`, `problems/observe-exception`의 core 호출)을 주석과 오류 메시지에서도 grep한다. broker 경로 문자열과 SDK 진입점(`packages/core/apps/runtime/entrypoint/`)은 그대로다.

정한 것:
1. broker service 이름에서 problem을 뺀다(`createExceptionLogService`, `BrokerServices.exceptions`). 이유: 계획의 목표가 lophn이 "problem"을 모르게 하는 것이고, report 몫을 지우면 남는 일은 예외를 log에 쓰는 것뿐이다. 소유 path인 `broker/problems.ts`와 SDK가 쓰는 broker 경로 문자열은 그대로 둔다.
2. broker 예외 관측의 답은 `{ written: true }`다. 이유: 옛 답(`ReportAcceptance`)은 problem·snapshot id라 남길 수 없고, 받는 쪽(진입점 `reportException`, SDK 예외 observer)은 답 내용을 쓰지 않는다. 쓰기 실패는 writer가 삼킨다(`pr-log-writer`).
3. 비정상 종료 줄의 꼴은 `process_exit <근거>: <message>`다. 이유: `pr-log-contract`가 이 줄의 꼴을 정하지 않았다. 다른 줄(`error`, `exception`, `view_error`)처럼 앞 낱말이 종류이고, `process_exit`는 지금 관측 종류 이름(`ExceptionObservationKind`)이다.
4. 첫 줄과 frame 줄은 `append`를 줄마다 이어 부른다. 이유: writer 계약(`append({ invocation, text })`)에 시각 칸이 없어 계약의 "같은 `at`"은 writer의 시계가 정한다. 사이에 await가 없으면 대개 같은 ms다.
5. bundle hash는 nonce별로 credential 요청 때 쥔다. 이유: broker 자식 신원(`BrokerChild`)에 bundle hash가 없고, 조립은 이미 같은 수명의 nonce별 map(`credentials`, `tails`)을 쥔다.

## 끝남

- `deno task check`가 통과한다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(supervisor 조립을 바꿨다).
- 위험 test: 없음. 예외 줄과 비정상 종료 줄은 `append`를 지나고, 줄마다의 redaction은 `pr-log-writer`의 `log-file_test.ts`가 본다. frame 풀이는 write-test의 위험 기준(data 잃기, 권한·secret·sandbox 경계, 결정적 판정)에 들지 않는다. snapshots의 `work_test.ts`는 `pr-problems-core`가 snapshots와 같이 지운다.
- 남지 않음:
  - `grep -rn "createCrashObserver\|createProblemReportService\|ProblemReportService\|ProblemsReport\b\|problemsFor\|closedProblems\|lastCredential" packages/core/apps packages/core/main/app-supervisor`가 0줄이다.
  - `grep -rn "problemsReport\|brokerReportProblemInputSchema\|brokerProblemReportOutputSchema\|reportAcceptanceSchema\|\"problems/observe-exception\"" packages/core/apps packages/core/main/app-supervisor packages/protocol/apps`가 0줄이다.
  - `grep -rn "protocol/problems" packages/core/apps/runtime/observations packages/core/apps/permissions/broker packages/core/main/app-supervisor`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 적어도 `SupervisorIo.ids`
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
