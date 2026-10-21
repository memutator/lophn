# pr-log-sdk

SDK `reportProblem`을 남기고, core 보고 길 대신 앱 log에 error 한 줄(이름, 내용)을 쓰는 함수로 바꾼다. 앱 진입점은 reporter transport와 broker `problems/report` 호출을 더 쓰지 않는다. 예외 관측(`createExceptionObserver`)은 그대로 둔다.

- 단위: log (wave 2)
- 선행: pr-log-contract. 줄 꼴(`error <name>[: <message>][ <details JSON>]`)을 거기서 고정한다.
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/template/app/main.ts.tmpl`
  - `packages/core/apps/runtime/entrypoint/crash.ts`
  - `packages/sdk/cap-problem`
  - `packages/protocol/problems/sdk-problem.ts`
  - `packages/protocol/problems/sdk-report.ts`
  - `packages/core/apps/runtime/entrypoint/main.ts`
  - `packages/core/apps/runtime/entrypoint/limits.ts`
  - `packages/core/apps/packages/vendor.ts`
  - `packages/core/apps/packages/install_test.ts`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(SDK `reportProblem`은 남기고 앱 log에 error 한 줄을 쓴다)과 "뼈대 검토에서 정한 것"(console을 감싸지 않는다, SDK가 쓰는 줄에만 invocation을 싣는다, `reportProblem(name, message?, details?)`이고 돌려주는 것이 없다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표(보고 길 줄)와 "정한 것"(보고 길을 log로 합친다)
  - 계약 task: `project-docs/plan/problem-remove/tasks/pr-log-contract.md`(줄 꼴, 머리 표시 `[inv=<id>] `), `project-docs/plan/problem-remove/tasks/pr-log-writer.md`(stderr 줄의 머리 표시를 떼어 `invocation`에 두고, 줄마다 redaction한 뒤 300자로 자른다)
  - architecture: `project-docs/architecture/app-call.md`(앱 process와 supervisor), `project-docs/architecture/ui-kit.md`의 "설치 사본과 앱 template" 단락(cap-problem 사본의 `vendor/` 규칙), `project-docs/architecture/coding-agent.md`의 "보고할 실패 분기는 ticket이 정한다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `sdk`, `sdk-api`, `app-runtime`; `project-docs/module-catalog.yaml`의 `packages/sdk`, `packages/protocol`, `packages/core/apps`
  - skill: `.claude/skills/write-test/SKILL.md`
  - 코드: `packages/sdk/cap-problem/`(전부), `packages/core/apps/runtime/entrypoint/main.ts`, `packages/core/apps/runtime/entrypoint/tool-port.ts`(`Symbol.for("lophn.cap-tool")` port와 `current()`), `packages/sdk/cap-tool/context.ts`(`APP_TOOL_PORT`), `packages/core/apps/runtime/observations/log-buffer.ts`(`INVOCATION_MARK` = `/^\[inv=(inv_[0-9a-z]{26})\] ?/`), `packages/core/apps/packages/vendor.ts`의 `CAP_PROBLEM`
- 계약:
  - 쓰는 것: `pr-log-contract`의 줄 꼴 `error <name>: <message>`와 머리 표시 `[inv=<id>] `
  - 내놓는 것:
    - `@lophn/cap-problem`의 `reportProblem(name: string, message?: string, details?: SafeReportDetails): void`. 앱 stderr에 `error <name>[: <message>][ <details JSON>]` 한 줄을 쓰고, invocation 안이면 머리에 `[inv=<id>] `를 붙인다. 던지지 않는다. `ProblemReportCall`(`sdk-problem.ts`)이 이 모양이 된다.
    - 지운다: `createProblemReporter`, `ProblemReporterDeps`, 보고 queue·재시도(`deliver.ts`의 보고 몫), 진입점의 `problemTransport`·`reportProblemToBroker`, `BROKER_PATHS.problemsReport`
    - 그대로: `createExceptionObserver`와 진입점의 예외 transport(`BROKER_PATHS.problemsObserve`). broker 쪽 처리는 `pr-log-exception`이 바꾼다.
    - `cap-problem/guide.md`와 앱 template의 coding agent 지침(`AGENTS.md.tmpl`)은 "이름으로 한 문제로 묶인다", "문제 닫힘"을 빼고 "앱 log에 error 한 줄"로 쓴다.

## 할 일

근거는 README "정한 것"의 SDK `reportProblem` 줄과 "뼈대 검토에서 정한 것"이다. planner가 살 단계 뒤 README와 계약을 `reportProblem(name, message?, details?)`로 고쳤다. 지금 앱과 재료의 `reportProblem(name, message, {...})` 호출이 그대로 맞는다. 아래 할 일에 details만 받는 모양이 남아 있으면 이 모양으로 읽는다.

1. `reportProblem`을 `(name: string, message?: string, details?: SafeReportDetails) => void`로 바꾼다(`packages/sdk/cap-problem/report-port.ts`).
   - 줄은 `error <name>`이고, `details`가 있으면 `: <details 글>`을 붙인다. details 글은 string이면 그대로, 아니면 `JSON.stringify(details)`다. stringify가 던지면 `String(details)`다.
   - name과 details 글의 줄바꿈(`\r`, `\n`)은 공백으로 바꾼다. stderr 한 줄이 log 한 줄이 되기 때문이다.
   - invocation 안이면 머리에 `[inv=<id>] `를 붙인다. invocation은 `globalThis[Symbol.for("lophn.cap-tool")]`의 `current()?.invocation`으로 읽는다(정한 것 2). port가 없거나(단위 test, 로컬 실행) 호출 밖이면 머리 없이 쓴다.
   - `console.error`로 stderr에 한 줄 쓴다. 통째로 try/catch로 감싸 던지지 않는다.
   - 이름 검사(1~120자, 제어 문자), 실패 값, 돌려주는 값(`report_id`, `completion`)을 없앤다.
   - redaction과 300자 자르기는 supervisor의 log file writer가 줄마다 한다(`pr-log-writer`). SDK는 하지 않는다.
2. `packages/sdk/cap-problem`에서 보고 길을 지운다.
   - `reporter.ts`(`createProblemReporter`, `ProblemReporterDeps`, 보고 queue·재시도·`retransmit`·`status`)를 지운다.
   - `report-port.ts`의 `installProblemReporter`, `REPORTER_PORT`, 설치된 reporter 찾기를 지운다. 진입점이 더 설치하지 않는다(5).
   - `mod.ts`는 `reportProblem`, `createExceptionObserver`, type `ExceptionObserver`·`ExceptionObserverDeps`만 낸다.
   - `deliver.ts`는 그대로다. 남은 함수(`deliver`, `freezeDeep`, `queueRejection`, `utf8Length`)를 모두 `exception-observer.ts`가 쓴다. 계약 줄의 "`deliver.ts`의 보고 몫"은 따로 지울 것이 없다.
   - `deno.json`의 판 `1.0.0`은 그대로 둔다(정한 것 3).
3. `packages/protocol/problems/sdk-problem.ts`: `ProblemReportCall`을 `(name: string, details?: SafeReportDetails): void`로 바꾸고 `retransmit`와 `ProblemReportRequest`를 지운다. portable file이라는 머리 주석(zod·core를 import하지 않는다)은 그대로다.
4. `packages/protocol/problems/sdk-report.ts`: 보고만 쓰던 type을 지운다: `ReportProblemResult`, `ReportStatus`, `ReportProblem`, `ReportProblemInput`. `ReportTransport`의 기본 type 인자(`ReportProblemInput`)를 뺀다(`ExceptionObserverTransport`가 인자를 준다).
   - 나머지(`REPORTING_LIMITS`, `REPORT_RETRY_DELAYS_MS`, `isRetryableReportError`, `ReportAcceptance`, `ReportCompletion`, `ReportTransportError`, `SafeReportDetails`, observation type들)는 남긴다. `packages/core/problems/reporting`, `snapshots`, `feedback`과 `packages/protocol/problems/*`가 아직 쓰고, `pr-problems-core`와 `pr-cleanup`이 정리한다.
5. `packages/core/apps/runtime/entrypoint/main.ts`에서 reporter 설치를 지운다.
   - 지운다: `ObserverFactory`의 `createProblemReporter`·`installProblemReporter`, `MainDeps.problemTransport`, `main()`의 reporter 설치 블록, `ObservedInvocation`, `boot()`의 `problemTransport`, `reportProblemToBroker`, `problemReportBody`, `ReportAcceptance`, `acceptanceOf`, `REPORT_ERROR_CODES`, 쓰는 곳이 없어진 `ensureAppToolPort` import. tool port는 `invoke.ts`·`startup.ts`·`control.ts`가 계속 import해 설치된다.
   - 그대로: `createExceptionObserver` 설치, `reportTransport`(`reportException`, `BROKER_PATHS.problemsObserve`), `reportCaught`, `installCrashExit`.
   - 주석의 "보고"를 맞춘다. 예: `reportTransport` 주석은 "예외 관측은 이 transport 한 곳이다".
6. `packages/core/apps/runtime/entrypoint/limits.ts`: `BROKER_PATHS.problemsReport`를 지운다.
7. `packages/sdk/cap-problem/guide.md`를 다시 쓴다(계약 마지막 줄).
   - 목적: 앱이 실패 분기를 이름과 내용으로 앱 log에 error 한 줄로 남긴다. permission은 없다.
   - 줄 꼴(`error <name>: <details>`), invocation 안이면 붙는 `[inv=<id>] `, redaction 뒤 300자로 잘린다는 것을 적는다. App Engineer와 coding agent가 앱 log에서 이 줄을 찾는다.
   - 이름은 원인을 말하고 안정적이다. id나 시각처럼 바뀌는 값은 `details`에 둔다. "한 문제로 묶인다"와 "problem을 닫는 API는 없다"를 지운다.
   - 쓸 곳(거절로 끝나는 업무 분기, 외부 호출 실패, 조용히 넘어가는 fallback)과 쓰지 않을 곳은 그대로다. 잡히지 않은 예외와 handler가 던진 `Error`는 진입점이 앱 log에 쓴다.
   - 공개 API: `reportProblem(name, message?, details?)`(돌려주는 것 없음, 던지지 않음), `createExceptionObserver(deps)`(진입점이 설치하고 앱 code는 부르지 않는다), type. `installProblemReporter`, `createProblemReporter`, `ProblemReporterDeps`를 뺀다.
   - 예제는 `reportProblem("sync_server_unreachable", { command: "sync", attempt: 3 })` 꼴이고 `completion`을 기다리지 않는다.
8. `packages/core/apps/packages/template/app/AGENTS.md.tmpl`(앱 coding agent 지침)을 고친다.
   - "SDK 확인과 문제 보고" 절: 실패 분기는 `@lophn/cap-problem`의 `reportProblem(name, message?, details?)`로 앱 log에 error 한 줄을 쓴다(`guide.md`). 처리하지 못한 예외는 lophn 진입점이 앱 log에 쓴다. 절 이름에서 "문제 보고"를 뺀다.
   - "테스트·preview·결과 반환" 절의 "문제 닫힘"을 뺀다.
   - "파일" 절의 `main.ts` 줄: "예외 수집과 문제 보고 통로는 lophn 진입점이 설치한다"를 "잡히지 않은 예외는 lophn 진입점이 앱 log에 쓴다"로 바꾼다.
   - "통로와 필요한 배포 skill" 절: `lophn-repair`를 빼고 `lophn-build-app` 하나만 적는다(정한 것 4).
   - ticket, claim, `lophn app test`, examples 줄은 그대로 둔다(`ae-builds`의 몫).
9. `packages/core/apps/packages/vendor.ts`: `CAP_PROBLEM` 규칙은 그대로다. `exception-observer.ts`·`deliver.ts`가 `sdk-report.ts`를, `report-port.ts`가 `sdk-problem.ts`의 type을 아직 import한다. 규칙 위 주석만 "예외 관측 계약과 `reportProblem` type"으로 맞춘다. `install_test.ts`의 "깐 blueprint·cap-store·cap-problem 사본이 repo 없이 import된다"가 그대로 통과하면 고치지 않는다.
10. 소유 줄에 없는 file. lead가 소유에 더하지 않았으면 주석 한 줄씩만 고치고 보고의 "넘길 줄"에 적는다.
    - `packages/core/apps/packages/template/app/main.ts.tmpl` 2번 줄: "처리되지 않은 예외 수집과 문제 보고 통로는 진입점이 … 설치한다"를 "잡히지 않은 예외는 진입점이 앱 log에 쓴다"로.
    - `packages/core/apps/runtime/entrypoint/crash.ts` 3번 줄: "오류 이름·message·stack이 문제에 남지 않으므로"를 "앱 log에 남지 않으므로"로.
11. 지운 이름과 옛 말(`reportProblem(name, message`, `problems/report`, `installProblemReporter`, "한 문제로 묶인다")을 주석과 오류 메시지에서도 grep한다. 남의 file은 고치지 않는다: `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`(`pr-cli-problem`), `packages/core/agent-roles/roles/app-engineer/prompt.md`(`pr-role-prompts`), `packages/core/apps/permissions/broker/`(`pr-log-exception`).

세 인자로 부르던 곳(`reportProblem(name, message, { ... })`)은 이 task가 고치지 않는다. `tests/support/app`과 `tests/eval/materials`의 앱 source가 그렇고, 사람이 e2e와 eval은 이 개편 동안 고치지 않기로 했다. 그 앱들은 runtime에서 셋째 인자가 버려지고(type 오류는 앱 source의 `deno task check`에서만 난다), `.completion`을 읽는 곳(`tests/support/app/patch-report.ts`)은 던진다. 보고의 "알려진 미완 동작"에 적는다.

정한 것:
1. README의 `reportProblem(name, message?, details?)`를 따른다. 이유: 계약 줄(`(name, message)`)은 뼈대 검토 전 모양이고 README "뼈대 검토에서 정한 것"이 뒤에 정했다. 두 인자로 부르던 곳은 둘째 인자가 string `details`가 되어 계약의 줄(`error <name>: <message>`)이 그대로 나온다.
2. invocation은 cap-tool port(`Symbol.for("lophn.cap-tool")`)의 `current()`에서 읽는다. 이유: 진입점이 reporter를 설치하는 통로(`installProblemReporter`, `REPORTER_PORT`)가 필요 없어 가장 단순하다. 진입점(`tool-port.ts`)과 cap-tool이 이미 같은 symbol의 port를 놓고, cap-store·cap-net도 runtime이 놓은 global symbol(`lophn.cap-host`)을 읽는다.
3. SDK 판(`1.0.0`)을 올리지 않는다. 이유: README가 "MVP 이전이라 SDK 판 정책보다 단순함이 먼저다"로 정했다. 앱 template(`deno.json.tmpl`, `blueprint.ts.tmpl`)이 `1.0.0`을 고정한다.
4. `AGENTS.md.tmpl`의 `lophn-repair`를 이 task가 지운다. 이유: README가 `lophn-repair`를 지우고 고치는 ticket에도 `lophn-build-app`을 쓰게 했고(skill은 `pr-cli-problem`이 지운다), 이 file은 이 task 소유다.

추가(planner): 진입점의 `reportException`은 broker의 날 응답 body를 SDK에 넘겨, 200 응답에서 `deliver`가 TypeError를 던질 수 있다. 이 길을 고치는 김에 `{ok, value | error}` 결과로 바꿔 넘긴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 줄 하나를 stderr에 쓰는 일은 write-test의 위험 기준(data 잃기, 권한·secret·sandbox 경계, 결정적 판정)에 들지 않는다. stderr 줄의 redaction은 `pr-log-writer`의 `log-file_test.ts`가 본다.
- 남지 않음:
  - `grep -rn "createProblemReporter\|ProblemReporterDeps\|installProblemReporter\|REPORTER_PORT\|problemTransport\|reportProblemToBroker\|problemsReport\|retransmit\|ReportProblemResult\|ReportProblemInput\|ProblemReportRequest\|ReportStatus" packages/sdk packages/core/apps/runtime packages/protocol/problems/sdk-problem.ts packages/protocol/problems/sdk-report.ts`가 0줄이다.
  - `grep -rn "reportProblem(name, message\|한 문제로 묶\|문제 닫힘\|문제 보고\|lophn-repair" packages/sdk/cap-problem packages/core/apps/packages/template`가 0줄이다(할 일 10의 `main.ts.tmpl` 포함).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(할 일 10)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 세 인자로 부르던 앱 source와 `.completion`을 읽는 `tests/support/app/patch-report.ts`
