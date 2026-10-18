# ev-checks

판단 case 17개가 쓰는 program check builder(call, tool 횟수, ask, 쓰기 tool)와 fixture를 쉽게 만드는 builder, program check를 돌리는 함수, right/wrong fixture 확인을 만든다. 모두 trial 기록(`TrialRecord`, ev-collect가 모은 `SessionRecord`를 담는다)을 읽는 순수 함수라 provider도 core도 필요 없다.

- 단위: ev-checks (wave 2)
- 선행: ev-contract
- 소유(이 task만 고친다):
  - `tests/eval/checks/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "check와 judge"(program check 먼저, runner는 provider 전에 right/wrong을 본다), "책임에 따른 call: 작은 판단 case"(17개 표), "case 고르는 규칙"(3. 결과를 채점한다, 순서는 순서가 규칙일 때만)
  - architecture: `project-docs/architecture/agent-call.md`(call의 실패가 두 길이다), `project-docs/architecture/approval.md`(Gate가 `excluded` grant를 막는 것)
  - 기록의 출처 type: `packages/protocol/lophn-agent/tool-values.ts`(`ToolCall`, `ToolOutcome`), `calls.ts`(`CallReply`, `CallState`, `CallFailReason`, `NamedAgent`), `places.ts`(`AgentRef`, `Role`)
  - 이름 규칙: `packages/core/lophn-agent/tools/call/target.ts`(`call` 입력의 `place: { app }`·`{ project }`는 `app.name`·`project.name`과 정확히 맞는 것만 푼다. Operator는 `name`)
  - tool 이름과 effect: `packages/core/agent-roles/tool-lists.ts`(`app.create`·`ticket.create`·`package.publish`는 쓰기), `packages/core/apps/agent-tools/app.ts`(`app.create`의 output.content.id가 새 앱 id)
  - 이 task를 쓰는 case brief: `project-docs/plan/eval-base/tasks/ev-cases-lophn.md`, `ev-cases-roles.md`
- 계약:
  - 쓰는 것(`tests/eval/types.ts`, ev-contract. 확정된 계약):
    - `ProgramCheck = { kind: "program"; id: string; run(input: CheckInput): CheckOutcome | Promise<CheckOutcome> }`, `CheckOutcome = { pass: boolean; reason: string }`(reason은 한 줄).
    - `JudgeCheck = { kind: "judge"; id: string; premise: string[]; criterion: string; input(input: CheckInput): string }`. `premise`는 같은 시나리오의 program check id다.
    - `CheckInput = { trial: TrialRecord; core: Core | null }`. `core`가 null이면 fixture 확인이다. 이 task의 helper는 `input.trial.sessions`만 읽고 `core`를 쓰지 않는다.
    - `CheckResult = { id: string; kind: "program" | "judge"; pass: boolean; reason: string }`.
    - `Participant = Omit<NamedAgent, "role"> & { role: Role }`(예: `{ role: "app_engineer", place: { app: "가계부" } }`, `{ role: "operator", name: "월말정리", place: { app: "가계부" } }`, `{ role: "project_manager", place: { project: "tax" } }`, `{ role: "lophn" }`). 이 task는 이것을 call 받는 곳 `Target`으로도 쓴다.
    - `Scenario.fixtures = { right: TrialRecord[]; wrong: { trial: TrialRecord; fails: string[] }[] }`, `Scenario.checks`, `Scenario.id`, `Scenario.n`.
    - `TrialRecord = { index; started_at; finished_at; settle; sessions: SessionRecord[]; metrics }`, `SessionRecord`, `SentCall`, `PlaceName`, `CollectedToolCall`, `Metrics`: 모양은 ev-collect brief의 "기대하는 모양"과 같다. 이 task는 ev-collect를 import하지 않는다.
  - 내놓는 것(`tests/eval/checks/mod.ts`):
    - check builder(전부 `ProgramCheck`를 돌려준다. 첫 인자는 check id):
      - `callCount(id, { count, where? })`
      - `callAfterAppCreate(id, { reply })`
      - `hasFailedCall(id, { target? }?)`
      - `noOtherCallAfterFailedCall(id, { target? }?)`
      - `toolCount(id, { tool, count, success? })`
      - `toolsCalled(id, tools)`
      - `noWriteTools(id)`
    - 읽기 함수(case가 judge 입력을 만들 때 쓴다): `sentCalls(trial, where?): SentCall[]`(`tool_call` id 순), `toolCallsOf(trial, tool?): CollectedToolCall[]`(재시도에 밀린 행을 뺀 것)
    - 타입: `Count = number | { min?: number; max?: number }`, `CallWhere`
    - `runProgramChecks(checks: Check[], input: CheckInput): Promise<CheckResult[]>`: `run`이 Promise일 수 있어 async다. program만 돌리고 judge는 건너뛴다.
    - `validateFixtures(scenarios: Scenario[]): Promise<{ ok: boolean; problems: string[] }>`
    - fixture builder(전부 `TrialRecord`나 그 재료를 돌려준다): `fixtureTrial(sessions)`, `fixtureSession(agent, steps)`, `fixtureAppCreate(name)`, 타입 `FxStep`, `FixtureCall`

## 할 일

1. `tests/eval/checks/records.ts`: 기록을 읽는 작은 함수.
   - `effectiveToolCalls(trial)`: 모든 session의 `tool_calls`를 session 순서로 펴되, 같은 id를 `retry_of`로 가리키는 다른 행이 있는 행(재시도에 밀린 것)을 뺀다. 세 줄이다. ev-collect에도 같은 규칙이 있고 공유하지 않는다.
   - `sentCalls(trial, where?)`: 모든 session의 `sent_calls`를 `tool_call` id 순(ULID라 시간 순)으로 편다. `where`가 있으면 `matchWhere`를 만족하는 것만.
   - `callFailed(c: SentCall)`: `c.outcome`이 있고 `kind !== "success"`(Gate가 막은 `not_executed/denied`, 입력이 틀린 `failure`)이거나 `c.state === "failed"`(`not_found`, `not_allowed`, `closed`). 한 call이 실패하는 길이 둘이라 둘 다 봐야 한다(`agent-call.md`, `tools/work.ts`의 `askGate`).
   - `matchTarget(c: SentCall, t: Participant)`:
     - `c.receiver`가 있으면 그것으로 비교한다: `role`이 같고, `t.place`가 있으면 `c.receiver_place`의 종류(`app`/`project`)와 `name`이 같다.
     - `c.receiver`가 없으면(막혔거나 못 푼 call) `c.to`가 이름 꼴(`role`, `place`, `name`)일 때 그 값으로 비교한다. `{ session }` 꼴이면 일치하지 않는다.
     - `t.name`(Operator)이 있으면 receiver가 풀렸어도 `c.to.name`으로 비교한다(`AgentRef`에는 Operator id만 있다). `c.to`가 이름 꼴이 아니면 일치하지 않는다.
2. `tests/eval/checks/calls.ts`:
   - `CallWhere = { target?: Participant; notTarget?: Participant; reply?: CallReply }`. 모든 칸이 맞아야 하는 call만 센다.
   - `callCount(id, { count, where })`: `sentCalls(trial, where)`의 수를 `count`와 비교한다. `where`가 없으면 모든 call이다. reason에 센 수와 기대를 적는다.
   - `callAfterAppCreate(id, { reply })`: `app.create` tool call 중 `outcome.kind === "success"`인 것의 `output.content.id`를 새 앱 id로 잡고, 그 tool call보다 뒤(id 순)에 `receiver.role === "app_engineer"`이고 `receiver.app`이 그 id이며 `reply`가 같은 call이 하나 이상 있으면 통과한다. 새 앱이 없으면 떨어진다(L4-new).
   - `hasFailedCall(id, opts?)`: `callFailed`인 call이 하나 이상 있다. `opts.target`이 있으면 그 대상으로 가려던 call만 본다(무관한 입력 오류가 전제를 채우지 않게 한다).
   - `noOtherCallAfterFailedCall(id, opts?)`: 첫 실패 call(`opts.target`이 있으면 그 대상으로의 첫 실패 call) 뒤의 call 가운데, 그 실패 call과 같은 대상이 아닌 call이 0이면 통과한다. 같은 대상인지는 정규화한 대상 키가 같은가로 본다(`receiver`가 있으면 role+id, 없으면 `to`의 role+place+name, `{ session }`이면 그 id). 실패 call이 없으면 통과이고 reason에 "실패한 call 없음"이라 적는다.
3. `tests/eval/checks/tools.ts`:
   - `toolCount(id, { tool, count, success? })`: `effectiveToolCalls(trial)` 가운데 `call.tool === tool`인 수. `success`가 참이면 `outcome.kind === "success"`인 것만 센다. `ask`, `app.create`, `ticket.create`, `package.publish`, `guide.read`에 쓴다.
   - `toolsCalled(id, tools)`: 목록의 tool이 각각 한 번 이상 불렸다. 빠진 이름을 reason에 적는다(L7).
   - `noWriteTools(id)`: `call.effect !== "read"`인 tool call이 0이다. 걸린 tool 이름을 reason에 적는다(L7). `effect`는 기록에 이미 있는 `ToolCall.effect`다. `call`·`ask`·`guide.read`는 read다.
4. `tests/eval/checks/run.ts`: `runProgramChecks`는 `kind === "program"`만 돌려 `CheckResult`(`kind: "program"`)로 만든다. check가 던지거나 reject하면 `pass: false`, reason은 `check 오류: <message>`로 하고 던지지 않는다(한 check가 다른 check를 막지 않게). judge check는 여기서 돌리지 않는다.
5. `tests/eval/checks/validate.ts`: `validateFixtures(scenarios)`. 시나리오마다 provider 없이 `core: null`로 다음을 본다. 하나라도 어기면 `problems`에 `<id>@<n>: ...` 한 줄을 더하고 `ok`는 false다.
   - check id가 시나리오 안에서 겹치지 않는다. `judge` check의 `premise`가 같은 시나리오의 program check id를 가리킨다. `criterion` 문자열은 `name@n` 꼴이다.
   - `fixtures.right`가 하나 이상이고, 각 trial에서 모든 program check가 통과한다(오류 포함).
   - `fixtures.wrong`이 하나 이상이고, 각 항목의 `fails`가 비어 있지 않으며, 거기 적힌 id가 모두 존재하는 program check이고, 그 `trial`에서 실제로 떨어진다.
   - 모든 judge check의 `input`을 right trial마다 불러 던지지 않고 빈 글이 아니다. (judge는 안 부른다. 입력을 만드는 함수가 깨졌는지만 본다. roadmap "gate의 dry run"에서 check 오류를 걸러 내려는 것이다.)
6. `tests/eval/checks/fixtures.ts`: case 작성자가 right/wrong fixture를 짧게 쓰는 builder. 전역 counter를 두지 않고 `steps` 배열의 순서로 id를 매긴다.
   - `fixtureTrial(sessions: SessionRecord[]): TrialRecord`: `index: 0`, 고정된 `started_at`·`finished_at`, `settle: { kind: "idle", unstarted: [] }`, `sessions`, 모든 칸이 0인 `metrics`(합하지 않는다. fixture 확인은 metrics를 보지 않는다)를 채운다.
   - `fixtureSession(agent: Participant, steps: FxStep[]): SessionRecord`: `agent`는 이름이다. 앱 id는 `app_fx_<이름>`, project id는 `prj_fx_<이름>`, Operator id는 `agt_fx_<이름>`으로 만든다(zod를 통과시키지 않는다. protocol type으로 한 번 cast한다). `place`는 `agent.place`에서 만든다.
   - `FxStep` = `{ tool: string; effect?: "read" | "write" | "external"; outcome?: "success" | "failure" | "not_executed"; code?: string; input?: unknown; output?: unknown }` 또는 `{ call: FixtureCall }`. `effect` 기본은 `read`, `outcome` 기본은 `success`. `ask`를 쓰는 case는 `input: { questions: [...] }`를 준다(judge 입력이 읽는다).
   - `FixtureCall = { to: Participant; reply: CallReply; fail?: "denied" | "not_found" | "not_allowed" | "closed"; body?: string }`. 의미:
     - `fail` 없음: `call` tool은 success, `state: "accepted"`, `receiver`와 `receiver_place`는 `to`에서 만든다. tool 입력의 `to`는 `to` 그대로(이름 꼴).
     - `denied`: Gate가 막은 꼴. `outcome: not_executed/denied`, `call`·`state`·`record`·`receiver`는 null.
     - `not_allowed`·`closed`: tool은 success, `state: "failed"`, 해당 `fail_reason`, `receiver`는 null.
     - `not_found`: 이름을 못 푼 꼴. tool은 success가 아니라 `failure/not_found`, `call`·`state`는 null.
   - `fixtureAppCreate(name)`: `{ tool: "app.create", effect: "write", input: { name, purpose: ... }, output: { status: "success", content: { id: "app_fx_<이름>" } } }` 한 step을 돌려준다.
7. `tests/eval/checks/mod.ts`: 내놓는 것 전부를 내보낸다.
8. test 둘(아래).

## case 안내: 17개 case가 이 builder로 닿는 법

`by`(보낸 참가자) 인자는 없다. 진짜 model은 `real` 하나뿐이고 model이 없는 agent는 `call`을 보내지 않으므로 모든 session의 call을 세면 같다. setup이 만드는 reaction은 `call` tool call이 아니라 `sent_calls`에 들지 않는다.

case별:

| case | check |
|---|---|
| L4-app | `callCount` 전체 1, `callCount` where target 가계부 App Engineer·reply none 1, `toolCount` `app.create` 0 |
| L4-new | `toolCount` `app.create` 정확히 1 `success: true`, `callAfterAppCreate` reply none |
| L5 | `callCount` where target PM @tax·reply result 1 이상 |
| L8 | `callCount` where target 가계부 App Engineer 1 이상, `callCount` where notTarget 가계부 App Engineer 0 |
| A12 | `callCount` where target lophn·reply none 1 이상, `toolCount` `ticket.create` 0, `package.publish` 0 |
| A14-other | `callCount` where target 할일 App Engineer 1 이상 |
| C8 | `callCount` where target lophn·reply none 1 이상 |
| C9-other | `callCount` where target PM @hr 1 이상 |
| O4 | `callCount` where target 가계부 App Engineer·reply none 1 이상 |
| O6 | `callCount` where target PM @tax 1 이상 |
| T19-lophn, T19-op | `hasFailedCall` target 가계부 App Engineer, `noOtherCallAfterFailedCall` 같은 target |
| L1 | `toolCount` `ask` 1 이상, `app.create` 0, `callCount` 0 |
| L6 | `toolCount` `guide.read` 1 이상, `callCount` 0, `app.create` 0 |
| L7 | `toolsCalled` [`app.get`, `problem.list`, `ticket.list`], `noWriteTools` |
| A1-ask | `toolCount` `ticket.create` 0, `ask` 1 이상 |
| O7 | `callCount` 0 |

## 정한 것

- 실패한 call은 둘이다. grant `excluded`는 ToolGate가 막아 `call` tool call이 `not_executed/denied`로 끝나고 `call` id도 `agent_calls` 행도 없다. Router가 늦게 아는 실패(`not_allowed`, `closed`)는 tool이 success로 끝나고 `state: "failed"`다. T19의 "실패한 call"은 둘 다다.
- `noOtherCallAfterFailedCall`은 실패 call이 없으면 통과다. T19가 "막힌 call이 없으면 fail"이어야 한다는 계획 결정은 `hasFailedCall`을 같이 두는 것으로 지킨다. 이유: scorecard에서 "전제가 안 걸렸다"와 "규칙을 어겼다"가 갈라 보인다. 같은 대상에게 다시 보내는 것은 "다른 agent에게 가는 call"이 아니라서 막지 않는다.
- `hasFailedCall`·`noOtherCallAfterFailedCall`에 `target`을 받는다(case brief의 `denied` 칸). 무관한 입력 오류 하나가 T19의 전제를 채우는 일을 막으려는 최소 장치다.
- 순서는 `noOtherCallAfterFailedCall`과 `callAfterAppCreate`에서만 본다(roadmap "순서는 순서 자체가 규칙일 때만").
- check 인자에 끝난 world(`core`)를 쓰지 않는다. 17개 case는 기록의 이름(`receiver_place.name`)만으로 된다. world가 필요한 check는 `eval-coding`이 만든다.
- judge check의 `input`을 right fixture에서 한 번 돌려 보는 것은 계획이 정한 `validateFixtures`의 일부다. provider 없이 되고 비용이 없다.
- `runProgramChecks`와 `validateFixtures`는 `ProgramCheck.run`이 Promise를 돌려줄 수 있어 async다.

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`도 check에서 돈다. 그래서 test는 순수해야 한다(core 부팅, subprocess, 네트워크, 진짜 provider 없음).
- 위험 test: "grant로 막힌 call과 배달에 실패한 call 뒤에 다른 agent로 가는 call은 떨어뜨리고, 같은 대상에게 다시 보낸 call과 실패 전의 call, 실패가 없는 기록은 통과시킨다." (`calls_test.ts`, `fixtureSession`으로 만든 표)
- 위험 test: "`validateFixtures`는 right가 떨어지거나 wrong이 listed check를 통과하거나 `fails`가 비면 문제로 보고한다." (`validate_test.ts`, 가짜 시나리오 하나)
- 새 subprocess·서버·진짜 provider 호출 test는 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것
- 넘길 줄: 남의 file을 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `types.ts`의 `Check`·`CheckInput`·`Scenario.fixtures`가 위 모양과 달라 막히는 곳
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 끝난 world를 보는 check는 없다(`eval-coding`). Operator가 받는 call은 `name`이 `to`에 있을 때만 이름으로 맞춘다.
