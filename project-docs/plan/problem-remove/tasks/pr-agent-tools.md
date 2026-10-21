# pr-agent-tools

모든 role의 `problem.list`, `problem.get`, `problem.body`와 App Engineer의 `problem.set_state`를 지우고, lophn과 App Engineer에게 앱 상태·log·invocation 읽기 tool 셋(`app.status`, `app.logs`, `app.invocations`)을 연다. tool은 coding agent CLI가 쓰는 core route를 그대로 부른다.

- 단위: agent-tools (wave 5)
- 선행: pr-log-read, pr-problem-refs. `app.logs`가 새 모양이 된 뒤이고, `packages/core/apps/agent-tools/ticket.ts`를 앞 task가 고친 뒤다.
- 소유(이 task만 고친다):
  - `packages/core/problems/agent-tools.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/agent-roles/tools/kind.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/apps/agent-tools/mod.ts`
  - `packages/core/apps/agent-tools/runtime.ts` (새 file)
  - `tools/check-deps.ts`
  - `packages/core/apps/blueprint/reads_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정하고", "모든 앱의 tool 목록을 읽는 tool(`app.tools`)은 lophn과 App Engineer 목록에만"), `project-docs/architecture/layers.md`(feature module tool의 자리와 import 규칙), `project-docs/architecture/app-call.md`("성공한 read는 남기지 않고, 실패한 read와 막힌 호출은 남긴다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `app-runtime`, `problems`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`(notes), `packages/core/apps`, `packages/core/main`
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것 > agent"의 "problem tool ... 지운다", "App Engineer에게 앱 log, invocation, 앱 상태 읽기 tool을 연다", "lophn에게도 읽기 tool을 준다"
  - 계약: `project-docs/plan/problem-remove/tasks/pr-log-contract.md`의 "읽기 모양"과 "App Engineer와 lophn의 새 읽기 tool 이름", `project-docs/plan/problem-remove/tasks/pr-log-read.md`의 `appLogs` actors
  - 본보기(코드): `packages/core/apps/agent-tools/app.ts`(`app.list`, `app.tools`), `packages/core/lophn-agent/tools/fit-result.ts`(`fitted`, `readBody`, `countSummary`. 목록 tool 입력에는 cursor가 없다), `packages/protocol/coding-agent/cli-commands.ts` 184-192(CLI `app status`·`app invocations`·`app logs`가 부르는 route), `packages/core/main/agent-tools_test.ts`(목록의 이름마다 정의가 있고 모든 입력이 JSON Schema가 된다), `packages/core/agent-roles/credentials.ts`의 `roleOperations`
- 계약:
  - 쓰는 것: `appRuntime`(`packages/protocol/apps/runtime.ts`, `apps/runtime`), `appLogs`(`packages/protocol/apps/runtime.ts`, `apps/logs`. 입력 모양은 `packages/protocol/apps/app-log.ts`의 `appLogsReadInputSchema`), `appInvocations`(`packages/protocol/apps/calls/invocation.ts`, `apps/invocations`), `defineTool`·`readOf`(`packages/core/lophn-agent/tools/spi.ts`)
  - 내놓는 것:
    - tool `app.status`(input `{ app }`, route `app.runtime`), `app.logs`(input = `appLogsReadInputSchema`, route `app.logs`), `app.invocations`(input은 `appInvocationsInputSchema`에서 `app`이 필수인 좁은 몫, route `app.invocations`). 셋 다 effect `read`이고 `TOOL_ORDER`에 들며, `builtinToolNames`의 lophn과 App Engineer 목록에만 있다.
    - 지운다: `PROBLEMS_AGENT_TOOLS`와 `packages/core/problems/agent-tools.ts`, `READ_TOOLS`의 `problem.list`·`problem.get`·`problem.body`, App Engineer 쓰기의 `problem.set_state`, `app.get`의 열린 문제 수(`problemList` 호출), `tools/check-deps.ts`의 `FEATURE_TOOL_PLACES` 중 problems 줄
    - role operation 상한은 tool route에서 계산되므로(`roleOperations`) 따로 고치지 않는다.
    - `packages/core/apps/blueprint/reads_test.ts`가 범위 밖 operation의 예로 쓰는 `problem.get`을 남는 이름으로 바꾼다.

## 할 일

1. problem tool을 지운다.
   - `packages/core/problems/agent-tools.ts`를 file째 지운다.
   - `packages/core/main/agent-tools.ts`에서 `PROBLEMS_AGENT_TOOLS` import(5)와 spread(29)를 지운다.
   - `packages/core/agent-roles/tool-lists.ts`: `READ_TOOLS`의 `problem.list`·`problem.get`·`problem.body`(29-31), App Engineer 쓰기의 `problem.set_state`(61), `TOOL_ORDER`의 네 줄(113-116)을 지운다.
   - `packages/core/agent-roles/tools/kind.ts` 21줄 주석("같은 규칙이 problems/agent-tools.ts에도 있다")을 지운다.
   - `tools/check-deps.ts`의 `FEATURE_TOOL_PLACES`에서 `"packages/core/problems/agent-tools.ts"`(162)를 지운다.
2. `app.get`(`packages/core/apps/agent-tools/app.ts` 62-87): routes를 `[appGet]`로 줄이고 `problemList` 호출과 `open_problems`·`open_problems_capped` 칸(73-85)을 지운다. 결과에는 `app`만 싣고 요약은 지금처럼 앱 이름이다. 설명은 "Read an app: name, description, status, active release and source folder."로 바꾼다. `problemList` import(12)를 지운다.
3. 새 file `packages/core/apps/agent-tools/runtime.ts`가 `RUNTIME_TOOLS: readonly ToolDefinition[]`를 export한다. 셋 다 effect `read`이고 route 하나를 `readOf(ctx.core, route, input)`로 부른 뒤 `readBody`로 읽기 공통 칸을 걷는다. import는 protocol과 `packages/core/lophn-agent/tools/spi.ts`만 쓴다(`tools/check-deps.ts`의 `toolFileViolation`).
   - `app.status`: input `z.strictObject({ app: appIdSchema })`, routes `[appRuntime]`. summary는 `` `app ${app} is ${state.state}` ``. 설명 예: "Read whether an app is running: its state (and the reason when it is unavailable) and the latest supervisor observation."
   - `app.logs`: input `appLogsReadInputSchema`(`packages/protocol/apps/app-log.ts`), routes `[appLogs]`. `fitted(summary, body, ["lines"])`이고 summary는 줄 수, `truncated`이면 "older lines exist; narrow with since, until or invocation"을 붙인다. 설명 예: "Read an app's log, newest lines last: its own output, `error <name>: <message> <details>` lines from reportProblem, uncaught exceptions as `exception <name>: <message>` with source frames, screen errors as `view_error` lines, and abnormal process ends as `process_exit <reason>: <message>`. Narrow it with invocation, since (inclusive), until (exclusive) and limit." 줄 꼴은 `pr-log-contract`의 `text` 꼴을 따른다.
   - `app.invocations`: input `appInvocationsInputSchema.omit({ cursor: true }).extend({ app: appIdSchema })`(아래 정한 것), routes `[appInvocations]`. `fitted(countSummary("invocations", n, more), body, ["invocations"])`. 설명 예: "List an app's tool calls with their caller, effect, status and times, newest first. Successful reads are not recorded; failed reads, writes and denied calls are. Filter by status, effect, release, mode, session or turn."
   - `appIdSchema`는 route 입력과 같은 것(`packages/protocol/projects/values.ts`)을 쓴다.
4. `packages/core/apps/agent-tools/mod.ts`의 `APPS_AGENT_TOOLS`에 `...RUNTIME_TOOLS`를 더한다.
5. role 목록(`packages/core/agent-roles/tool-lists.ts`)
   - `APP_TOOL_NAMES`(52)를 `["app.tools", "app.status", "app.logs", "app.invocations"]`로 넓히고 51줄 주석에 이유를 더한다(앱 상태·log·invocation 읽기는 앱을 진단하는 lophn과 App Engineer만 갖는다). `builtinToolNames`는 그대로 이 목록을 lophn과 App Engineer에게만 준다.
   - `TOOL_ORDER`에서 `"app.tools"`(119) 바로 뒤에 `"app.status"`, `"app.logs"`, `"app.invocations"`를 둔다.
6. test
   - `packages/core/agent-roles/tool-lists_test.ts`의 둘째 test(20-29)를 `app.tools`와 세 이름 모두로 넓힌다. 이름은 "app.tools and the app status, log and invocation reads are only in the lophn and App Engineer lists"로 바꾼다.
   - `packages/core/apps/blueprint/reads_test.ts`: 범위 밖 operation의 예 `"problem.get"`(52, 71)을 `"app.logs"`로 바꾸고, 13-14줄 주석과 test 이름(15)의 "problem·ticket"을 "log·ticket"으로 바꾼다. 판정(다른 앱이면 `not_found`)은 그대로다.

## 정한 것

- `app.invocations`의 입력은 route 입력에서 `cursor`를 빼고 `app`을 필수로 바꾼 것이다. 나머지 거르기(session, turn, effect, status, reverted, mode, release, limit)는 CLI `app invocations`와 같게 둔다. 이유: 목록 tool 입력에는 cursor가 없다(`fit-result.ts`의 `countSummary`가 "narrow the filter"로 알린다). 그 밖에 줄일 근거가 문서에 없다.
- 세 tool은 `app.tools`와 같은 목록(`APP_TOOL_NAMES`)에 둔다. 이유: 받는 role이 같고(lophn, App Engineer), 목록을 하나 더 만들 까닭이 없다.
- `app.get`의 열린 문제 수는 대신할 칸 없이 뺀다. 이유: 앱이 도는지는 `app.status`가 준다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "app.tools and the app status, log and invocation reads are only in the lophn and App Engineer lists" — `packages/core/agent-roles/tool-lists_test.ts`(있는 test를 넓힌다)
  - "Project Manager 자격은 다른 앱의 tool 목록을 읽지만 다른 앱의 log·ticket은 여전히 not_found다" — `packages/core/apps/blueprint/reads_test.ts`(operation 이름만 바꾼다)
  - 정의와 목록 대조, JSON Schema 변환은 `packages/core/main/agent-tools_test.ts`가 이미 본다. 새 test를 더하지 않는다.
- 남지 않음: `grep -rn -E "\"problem\.(list|get|body|set_state)\"|PROBLEMS_AGENT_TOOLS|problems/agent-tools|open_problems" packages/core tools --include=*.ts`가 0줄이고, `packages/core/problems/agent-tools.ts`가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): protocol의 problem route(`problemList` 등)는 `pr-cleanup`이 지운다. 그 밖에 생기면 적는다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
