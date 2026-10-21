# ap-call-judge

agent call 판정(call tool의 Gate, `gate_allowed`, Router의 `CallGate`, "Agents you can call"과 `session.list`의 grant 거름)을 지워 agent call을 묻지도 막지도 않게 한다.

- 단위: call-judge (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/call.ts`
  - `packages/core/lophn-agent/tools/call/target.ts`
  - `packages/core/lophn-agent/tools/call/sessions.ts`(주석 한 줄)
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/core/router/{ports.ts,router.ts,commands.ts,model.ts,reads.ts,router_test.ts}`
  - `packages/core/main/daemon/wiring/router-registration.ts`
  - `packages/core/main/daemon/wiring/router-registration_test.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/credentials.ts`
  - `tools/check-deps.ts`(`HARNESS_LEFTOVERS`의 두 줄만)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`("Gate는 두 곳이다", "받은 메시지는 허락이 아니다", "왜 이 모양인가"의 "주소는 session ID다"에서 grant로 거르는 줄), `project-docs/architecture/approval.md`("agent call은 call tool이 turn 안에서 먼저 묻고"), `project-docs/architecture/agent-definition.md`("agent credential의 operation 상한" 줄의 `PLACE_READS`와 `GetAgentGrant`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `agent-tools`, `agent-roles`, `approvals`, `project-docs/module-catalog.yaml`의 `packages/core/router`, `packages/core/agent-roles`, `packages/core/lophn-agent`
  - 제품 결정: `project-docs/products/roadmap/approval.md`의 "묻지 않는 것"(agent call)과 "정한 것 (agent)"의 "agent call은 묻지도 막지도 않는다", `project-docs/plan/approval-simplify/README.md`의 "정한 것"
  - 본보기(코드): `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`(위반이 없어진 줄은 검사가 "빼라"로 실패한다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `callSendInputSchema`에 `gate_allowed`가 없다. Router port에 `CallGate`가 없고 Router deps에 `gate`가 없다. "Agents you can call"과 `session.list`는 grant로 거르지 않는다(자기 자신만 뺀다). agent 자격 상한(`PLACE_READS`)에 `GetAgentGrant`가 없다. 옛 Gate의 `agent_call` 줄과 grant의 `agent` 줄은 남는다(ap-ask-turn과 ap-cleanup이 지운다).

## 할 일

줄 번호는 main `8c243da91` 기준이다.

1. call tool(`packages/core/lophn-agent/tools/bundles/call.ts`)
   - `call` 정의의 `gate`(41-52)를 지운다. handler에서 `wanted`와 `callAgentOf`로 `asked`를 다시 구하는 줄(54-56)과 `gate_allowed`를 싣는 줄(60)을 지우고 `ctx.router.send({ ...input, dedup: ctx.tool_call })`만 남긴다.
   - `callToolInput`(19-22)은 `callSendInputSchema.omit({ dedup: true })`가 된다. 18줄 주석에서 `gate_allowed` 이야기를 지운다.
   - `routes`(30)는 `[callSend]`다. `agentDefinitionList`, `projectList`, `appList`는 gate가 받는 agent를 풀 때만 불렀다. 같은 route는 `PLACE_READS`(`credentials.ts`)에 있어 상한이 줄지 않는다. import의 `agentDefinitionList`(3), `appList`(9), `projectList`(10), `callAgentOf`(12)를 지운다.
   - 24-25줄 주석("판정은 Router가 … Gate에 묻는다")을 "Router가 받는 곳을 풀어 넣는다. 부르는 것 자체에는 묻지 않는다"로 바꾼다.
   - 설명(39)의 실패 이유 목록 "(not_found, not_allowed, closed)"를 "(not_found, closed)"로 바꾼다. 이 task 뒤 `not_allowed`를 내는 곳이 없다.
2. `packages/core/lophn-agent/tools/call/target.ts`를 지운다. 쓰는 곳은 call tool의 gate뿐이다.
3. `packages/core/lophn-agent/tools/call/sessions.ts` 6줄 주석 "grant가 deny인 상대는 Router가 이미 뺐다"를 "자기 session과 새 입력을 받지 않는 session은 Router가 이미 뺐다"로 바꾼다.
4. protocol(`packages/protocol/lophn-agent/calls.ts`): `callSendInputSchema`의 `gate_allowed`와 그 주석(182-183)을 지운다. `CALL_FAIL_REASONS`의 `not_allowed`는 남긴다(정한 것 1).
5. Router
   - `packages/core/router/ports.ts`: `CallGate` interface와 주석(90-101)을 지운다. `listOpen` 주석(67)을 "session 목록 tool이 쓴다"로 줄인다.
   - `packages/core/router/router.ts`: `RouterDeps.gate`(40)와 구조 분해의 `gate`(99)를 지운다. `authorize`(101-116)를 지우고 `open`, `existing`, `resolve`에서 `gateAllowed` 인자와 `not_allowed` 갈래를 걷는다. `existing`이 `ok({ ok: true, to, target })` 한 줄이 되면 부르는 곳에 펼친다. import의 `CallGate`, `CallAgent`(쓰는 곳이 남는지 본다)를 정리한다.
   - `packages/core/router/model.ts`: `RouteInput.gate_allowed`와 주석(33-34)을 지운다. `failureCode`와 `FAILURE_TEXTS`의 `not_allowed` 줄은 `CallFailReason`이 남으므로 둔다.
   - `packages/core/router/commands.ts`: `sendCallCommand`의 `gate_allowed:` 줄(82)을 지운다.
   - `packages/core/router/reads.ts` `sendableRead`: deps에서 `gate`를 꺼내지 않고(62) `gate.visible` 거름(70)을 지운다. 자기 session과 `accepting`이 아닌 session만 뺀다. 49줄 주석의 "grant가 deny인 상대는 뺀다"를 지운다.
   - `packages/core/router/router_test.ts`: `setup`의 `createRouter`에서 `gate:` 줄(72)을 지운다. 세 test는 그대로 돈다.
6. wiring(`packages/core/main/daemon/wiring/router-registration.ts`)
   - `agentRefOf`, `ASK_IN_TX`, `callGate`(46-97)와 deps의 `gate: callGate(...)`(198-201)를 지운다.
   - 이것만 쓰던 import(`AgentRef`, `CallAgent`, `CallFrom`, `Intent`, `gate`, `loadAgentGrant`, `CallGate`)를 지운다. 2줄 주석의 "Gate"를 뺀다.
   - `router-registration_test.ts`를 지운다. 그 file의 test 하나는 `callGate`만 본다.
7. "Agents you can call"(`packages/core/agent-roles/place/place-data.ts`)
   - 381줄 주석을 "부를 수 있는 열린 session. 자기 session은 core가 뺐다"로 바꾼다.
   - 419-430: `agentGrantsGet` 읽기, `excluded` 집합, `if (grant.ok)` 감싸기를 지운다. 후보(lophn, active project의 Project Manager, active 앱의 App Engineer, 틀린 곳 없는 Operator 정의)를 늘 싣고 자기 자신만 뺀다. 417-418 주석을 "session이 아직 없는 상대도 부를 수 있다(call이 새 session을 연다). 자기 자신만 뺀다"로 바꾼다.
   - 자기 자신 비교는 `agentKey` 대신 `canonicalize(ref) === canonicalize(agent.agent)`(`packages/base/mod.ts`)로 한다. 정한 것 2.
   - import에서 `agentGrantsGet`, `agentKey`(2줄 전체)를 지운다.
8. agent 자격 상한(`packages/core/agent-roles/credentials.ts`): `PLACE_READS`의 `agentGrantsGet.name`(44)과 import(11)를 지우고, 42줄 주석을 "아직 session이 없는 상대도 부를 수 있는 목록의 후보(Operator 정의)"로 바꾼다.
9. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`에서 `packages/core/lophn-agent/tools/bundles/call.ts`와 `packages/core/lophn-agent/tools/call/target.ts` 두 줄을 지운다. 1 뒤에 `bundles/call.ts`는 projects·apps protocol을 import하지 않아 검사가 "빼라"로 실패하고, `target.ts`는 지운 file이라 그 줄이 죽는다.
10. 문서(`architecture/agent-call.md`, `approval.md`, `agent-definition.md`)는 lead가 계획 끝에 고친다(README "lead가 할 일"). 고치지 않는다.

정한 것:
1. `CALL_FAIL_REASONS`의 `not_allowed`는 지우지 않는다. 이유: 같은 값이 `messages.fail_reason` CHECK(`packages/core/lophn-agent/session/model.ts`)와 화면 `packages/shell/renderer/conversation/thread/call-block.tsx`, wording key에 있고 이 task 소유 밖이다. 보고의 "안 쓰게 된 export"에 적으면 ap-cleanup이 지운다.
2. place-data의 자기 자신 비교를 `canonicalize`로 바꾼다. 이유: `agentKey`는 지울 `packages/protocol/approvals/grants.ts`에 있다. 지금 approvals protocol import를 끊으면 ap-cleanup이 이 file을 다시 열지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 판정을 지우는 일이다. 지우는 `router-registration_test.ts`는 묻는 grant와 deny grant의 Router 판정을 보던 test이고 그 판정이 설계에서 없어진다(roadmap "agent call은 묻지도 막지도 않는다"). 받은 agent가 자기 할당으로만 일하는 경계(AGENT-ROLE T6)는 건드리지 않는다. `router_test.ts`의 세 test(닫힌 session, 늦은 답, 같은 dedup)는 gate 대역만 빼고 그대로 통과한다.
- 남지 않음:
  - `grep -rn "gate_allowed\|gateAllowed\|CallGate\|callGate\|callAgentOf\|ASK_IN_TX" packages tools`가 0줄이다.
  - `grep -rn "agentGrantsGet\|agentKey" packages/core/agent-roles`가 0줄이다.
  - `grep -n "bundles/call.ts\|call/target.ts" tools/check-deps.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). `CALL_FAIL_REASONS`의 `not_allowed`를 여기 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
