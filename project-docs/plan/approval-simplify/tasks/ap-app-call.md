# ap-app-call

core의 앱 호출 경로에서 사람에게 묻는 `askGate`를 지우고 Approvals에 기대지 않게 한다. agent의 앱 tool 호출은 할당으로(`judge`), 앱의 다른 앱 tool 호출은 active 앱 grant의 `app.call`로 판정해 막기만 한다. 묻는 자리는 run-loop tool gate 하나다.

- 단위: app-call (wave 2)
- 선행: ap-activation
- 소유(이 task만 고친다):
  - `packages/core/apps/calls/{gate.ts,service.ts,calls_test.ts}`
  - `packages/core/apps/ports.ts`
  - `packages/protocol/apps/calls/call.ts`
  - `packages/shell/main/app-frame/app-call.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
- 읽을 것:
  - 제품 결정: `project-docs/plan/approval-simplify/README.md` "정한 것"과 "사람이 정할 것" 1(추천대로 할당한 tool의 바깥 효과를 묻지 않는다. brief는 추천대로 썼다). roadmap `project-docs/products/roadmap/approval.md`의 "앱 쪽"(앱이 다른 앱 tool을 부를 때는 grant `app.call`이 있나만 본다. 없으면 막고 묻지 않는다)과 "지우는 것"의 "앱 호출의 `askGate`"(core의 앱 호출 경로는 할당과 grant를 확인해 막기만 한다)
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-gate.md`의 "내놓는 것"(`judge`와 앱 tool 판정), `project-docs/plan/approval-simplify/tasks/ap-assign-store.md`의 "내놓는 것"(`loadAssignment`), `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `gate-call.ts`·`assignment.ts`·`mode.ts`·`shell-rules.ts`(`GateCall`, `Judgment`, `AgentAssignment`, `TurnMode`, `ShellRuleLayers`)
  - architecture: `project-docs/architecture/app-call.md`의 "흐름"(2 Gate)과 "지키는 것"(부른 쪽 확인, "Gate의 사람 대기는 write 줄에 서기 전에 끝낸다. 허락은 줄을 얻은 뒤 실행 직전에 consume한다", 막힌 호출은 denied로 남긴다). Gate의 사람 대기 줄은 이 task로 틀린다. 문서는 고치지 않는다(계획 끝에 lead).
  - architecture: `project-docs/architecture/approval.md`의 "판정"(앱 grant는 묻지 않는다. 덮으면 실행, 아니면 막음)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `app-runtime`, `approvals`, `core-api`, `sdk-api`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/protocol`
  - problem-remove 뒤 `packages/core/main/daemon/wiring/apps.ts`에는 memory route `app.log_view_error`와 `AppRestartHalted`를 내는 `withAfterCommit` writer가 더 있다(`project-docs/products/change-log/0.6.0.md` 끝 항목). `createAppCalls` 조립은 그대로다.
  - 코드
    - `packages/core/apps/calls/gate.ts`(`appToolIntent`, `askGate`, `GateCheck`), `packages/core/apps/calls/service.ts`(`AppCallsDeps`, `DENIAL_MESSAGES`, `run`의 `work`·`execute`·`consume`), `packages/core/apps/calls/caller.ts`(`VerifiedCaller`)
    - `packages/core/apps/ports.ts`(`AppToolCallPath` 주석의 Gate 순서)
    - 옮길 판정: `packages/core/approvals/gate/gate.ts`의 `appScopeVerdict`와 `covers`의 `app.call` 갈래(ap-ask-turn이 이 file을 지운다)
    - 옮길 읽기: `packages/core/main/daemon/wiring/approvals.ts`의 `appGrantsOf`(`appGrantsList`를 `APPS_CONTROL_CONTEXT`로 읽는다)
    - `packages/core/main/daemon/wiring/apps.ts`의 `createAppCalls` 조립(`link.sql`을 이미 `appStatesOf`·`createCallerDirectory`에 쓴다)
    - `packages/protocol/apps/calls/call.ts`(`TOOL_DENIAL_CODES`), `packages/protocol/apps/grants.ts`(`appGrantsList`, `GRANT_LIST_MAX_COUNT`), `packages/shell/main/app-frame/app-call.ts`(`DENIAL_CODES`)
    - `packages/core/apps/calls/calls_test.ts`(`setup`의 가짜 deps, `status`)
- 계약:
  - 쓰는 것: `judge`(ap-gate), `loadAssignment`(ap-assign-store), 앱 grant 읽기(`appGrantsList`, `packages/protocol/apps/grants.ts`)
  - 내놓는 것: `createAppCalls` deps에 `approvals`가 없고 할당과 앱 grant 읽기를 받는다. 앱 호출 경로는 `openTurnRequest`·`waitTurnDecision`·`consumeTurnAllow`를 부르지 않는다. `ToolDenial` code에 `rejected`, `cancelled`가 없다(`gate_blocked`는 남는다). judge가 `ask`를 내면 run-loop에서 이미 물은 것이므로 실행한다.

## 할 일

추가(planner, 살 단계 뒤, `ap-contract`의 최종 계약): 할당 줄은 `{app, removed_tools}`뿐이고 `kind`와 `assignmentEntryKey`가 없다. MCP server 줄은 없다. `GetAgentAssignment`는 `{assignment, revision}`을 돌려주고, `SetAgentAssignment`는 compare `{revision}`을 받아 어긋나면 `conflict`다(화면은 다시 읽는다). 아래에 `kind`, `mcp_server`, `assignmentEntryKey`가 남아 있으면 이 모양으로 읽는다.

근거: roadmap "앱 쪽"과 "지우는 것", 계약의 "내놓는 것". 사람 화면(`person`)과 preview 호출은 지금처럼 판정을 거치지 않는다(`project-docs/architecture/app-call.md`).

1. `packages/core/apps/calls/gate.ts`를 다시 쓴다. `appToolIntent`, `askGate`, `GateCheck`와 `Intent`·`Approvals` import를 지우고 판정 함수 하나를 둔다(이름은 worker가 정한다. 예: `callAllowed(caller, target, deps): Promise<Result<boolean>>`).
   - agent: `judge({kind: "app_tool", app, tool, effect}, <deps의 할당>, NO_SHELL_RULES, "attended")`(`judge`는 `packages/core/approvals/gate/mod.ts`, type은 `packages/protocol/approvals/`의 ap-contract file에서 가져온다). `deny`면 막고, `run`과 `ask`는 지나간다(계약: `ask`는 run-loop tool gate가 이미 물었다).
     - 정한 것: shell 규칙 층은 빈 값(`{floor: [], layers: []}`)을 넘기고 mode는 `"attended"`다. 이유: 앱 tool 판정은 shell 규칙을 보지 않고, 이 자리는 `ask`도 실행하므로 mode가 결과를 바꾸지 않는다.
   - app: 부른 앱의 active grant 가운데 `scope.kind === "app.call"`, `scope.app === <부르는 대상 앱>`, `scope.app_tools`에 그 tool이 든 것이 있으면 지나가고, 없으면 막는다. 옛 Gate의 `appScopeVerdict`·`covers`(`app.call` 갈래)와 같은 규칙이다. 묻지 않는다.
2. `packages/core/apps/calls/service.ts`
   - `AppCallsDeps`에서 `approvals`를 지우고 둘을 더한다: `assignmentOf(agent: AgentRef): Result<AgentAssignment>`, `appGrantsOf(app: Id<"app">): Promise<Result<readonly AppGrant[]>>`.
   - `run`의 `work`: 지금 `askGate` 자리에서 1의 판정을 부른다. `abandoned`면 null, 오류면 그 오류, 막히면 `recordDenied(base, "gate_blocked")`다. 판정 자리는 지금처럼 도는 호출 안, write 줄 앞이다.
   - `consume` 변수, `execute`의 consume 갈래, "사람을 기다리는 Gate는 줄을 얻기 전에 끝내고..." 주석을 지운다.
   - `DENIAL_MESSAGES`에서 `rejected`, `cancelled`를 지운다.
3. `packages/protocol/apps/calls/call.ts`: `TOOL_DENIAL_CODES`에서 `rejected`, `cancelled`를 지우고 위 주석("Gate 막음, 사람 거절, ...")을 맞춘다.
4. `packages/shell/main/app-frame/app-call.ts`: `DENIAL_CODES`의 `rejected`·`cancelled` 줄을 지우고 머리 주석의 "허락과 사람 결정은 core가 정한다"를 맞춘다.
5. `packages/core/apps/ports.ts`: `AppToolCallPath` 주석의 Gate 순서 문단(`Approvals` 직접 사용, `ask`면 `openTurnRequest` → `waitTurnDecision`, `consumeTurnAllow`)을 새 판정으로 바꾼다: agent는 할당(`judge`), 앱은 active grant `app.call`, 막히면 `denied(gate_blocked)`, 묻지 않는다.
6. `packages/core/main/daemon/wiring/apps.ts`의 `createAppCalls` 조립
   - `approvals: ctx.approvals`를 지우고 `assignmentOf: (agent) => loadAssignment(link.sql, agent)`(`packages/core/approvals/assignment/mod.ts`)를 넘긴다.
   - `appGrantsOf`: `ctx.runtime.readers.read(appGrantsList, APPS_CONTROL_CONTEXT, { app, status: "active", limit: GRANT_LIST_MAX_COUNT })`의 `grants`다. `packages/core/main/daemon/wiring/approvals.ts`의 `appGrantsOf`와 같은 읽기다. 그쪽은 ap-ask-turn이 정리하므로 지우지 않는다.
7. `packages/core/apps/calls/calls_test.ts`
   - `setup`의 `approvals` 가짜를 새 deps 가짜로 바꾼다. 지금 test가 그대로 지나가도록 기본은 모두 덮는다(지금의 `judge: run`과 같은 뜻): 가짜 할당은 부르는 앱을 할당한 것으로 답하고(예: `state.assigned`에 test가 앱을 더하거나 setup이 만든 앱을 모두 넣는다), 가짜 앱 grant는 부르는 앱 쌍마다 `app.call`을 준다. 위험 test는 `state`로 덮는 범위를 줄인다.
   - 아래 "끝남"의 위험 test 둘을 더한다.
8. 지운 이름과 문자열을 grep해 주석과 오류 메시지에 남은 것도 고친다: `askGate`, `appToolIntent`, `consumeTurnAllow`, `openTurnRequest`, `waitTurnDecision`, `"rejected"`, `"cancelled"`, "the person rejected the call", "the request was cancelled".

## 끝남

- `deno task check`가 통과한다.
- core 확인: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 위험 test(`packages/core/apps/calls/calls_test.ts`, `setup` 하나를 쓴다. 판정은 결과의 denial code와 앱 process에 간 요청(`sent`)으로 한다)
  - "앱이 다른 앱 tool을 부를 때 active grant `app.call`이 그 tool을 덮지 않으면 handler에 가지 않고 막힌다": 표로 grant 없음, 다른 tool만 덮는 grant, 다른 대상 앱의 grant, `revoked` grant는 `gate_blocked`이고 `sent`가 늘지 않는다. 그 tool을 덮는 active grant면 handler에 닿는다. 이 경계는 지금 `packages/core/approvals/gate/gate_test.ts`의 app.call 경우가 보는데 ap-ask-turn이 그 file을 지우므로 여기로 옮기는 것이다(`.claude/skills/write-test/SKILL.md`: 지우는 test가 지키던 권한 경계 검사를 같이 없애지 않는다).
  - "agent는 할당하지 않은 앱의 tool과 할당에서 뺀 tool을 부르지 못한다": 할당 줄이 없는 앱, `removed_tools`에 든 tool은 `gate_blocked`이고 `sent`가 늘지 않는다. 할당했고 빼지 않은 tool은 handler에 닿는다. `judge` 자체의 경우는 ap-gate의 `judge_test.ts`가 보므로 여기서는 호출 경로가 할당을 읽어 막는지만 본다.
- 남지 않음
  - `grep -rn "askGate\|appToolIntent\|consumeTurnAllow\|openTurnRequest\|waitTurnDecision\|Approvals" packages/core/apps`가 0줄이다(activation 쪽 주석은 ap-activation이 이미 지웠다).
  - `grep -n "ctx\.approvals" packages/core/main/daemon/wiring/apps.ts`가 0줄이다(ap-activation이 attach 몫을 이미 지웠다).
  - `grep -rn "\"rejected\"\|\"cancelled\"\|rejected:\|cancelled:" packages/protocol/apps/calls/call.ts packages/shell/main/app-frame/app-call.ts packages/core/apps/calls`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없음이면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: `Approvals`의 `openTurnRequest`·`waitTurnDecision`·`consumeTurnAllow`를 이제 run-loop만 부르는지. 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
