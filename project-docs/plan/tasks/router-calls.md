# router-calls

core의 Router를 새 module `packages/core/router/`로 짓는다. 모든 입력(사람 메시지, agent의 call과 답, reaction, coding agent 메시지)이 들어오는 한 입구이다. 봉투 검증, 받는 곳 셋 처리, `agent_calls` 표, 상태 전이, 실패 이유, dedup, 취소, `calls.send`·`calls.reply`·`calls.cancel`·`calls.read`·`calls.sendable` route의 core 쪽을 만든다. 옛 `tools/handoff/`는 지운다. agent tool 본체(`call`, `reply`, `cancel`, `session.list`)는 agent-tools-call이 짓고 이 route를 `CallRouting`으로 부른다.

- 단위: router (wave 3)
- 선행: 없음. 단 `adoptionOf`(`tools/handoff/model.ts`)를 `core/apps/tickets/ports.ts`가 import하는 동안은 `tools/handoff/model.ts`를 지울 수 없다. coding-agent의 tickets task가 그 import를 끊었으면 폴더를 통째로 지우고, 아니면 `model.ts`만 남기고 `adoptionOf`를 보고에 적는다.
- 소유(이 task만 고친다):
  - `packages/core/router/` (새로. `ports.ts`는 contract-calls-places-calls가 만든 것이라 고치지 않는다)
  - `packages/core/main/daemon/wiring/router.ts` (새로. core-wiring이 쪼갠 틀을 따른다)
  - `packages/core/lophn-agent/tools/handoff/` (지우기)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I3.3#16`
  - inventory(lead가 맞추며 더함): `I1.3#2`, `I1.3#12`
  - spec: S3 전체 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S1 3·5·9장(Router, call 닫음의 반응) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S4 3장(call, reply, cancel, session 목록의 입력) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S2 4·5장(agent grant 판정은 Gate) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I1.3#1`, `I1.3#8`, `I3.3#1`, `I3.3#2`, `I3.3#3`, `I3.3#4`, `I3.3#5`, `I3.3#7`, `I3.3#8`, `I3.3#9`, `I3.3#10`, `I3.3#11`, `I3.3#14`
  - 결정: `../README.md` 3장 #1(Router는 core), #3(Gate는 core 한 곳), #4(입력함은 메모리, 재시작하면 기다리던 call은 failed)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md`("core 안 module"), `dev/code.md`("모듈 모양")
  - 지금 코드: `packages/core/lophn-agent/tools/handoff/{commands,model,reads}.ts`(dedup 아이디어만 가져온다), `packages/core/approvals/registration.ts`(등록 모양 본보기), `packages/core/lophn-agent/agents/ports.ts`(port 쓰는 법)
- 계약:
  - 쓰는 것: `core/router/ports.ts`(`TargetSession`, `RoutedInput`, `SessionDirectory`, `InputTransport`, `CallGate`, `CallStore`), `protocol/lophn-agent/calls.ts`(`callEnvelopeSchema`, `agentCallRecordSchema`, `callSend`, `callReply`, `callCancel`, `callRead`, `CALL_FAIL_REASONS`, `callCanMove`), `protocol/lophn-agent/inputs.ts`. tool 이름·wire 이름·입력 schema는 contract-agent-tools의 `protocol/lophn-agent/tool-values.ts`·`tool-calls.ts`를 따른다. event 이름과 payload는 S1을 따르고 contract-events가 둔다(Router는 call 상태 때문에 domain event를 내지 않는다. S1 5장 "call의 상태"는 domain event가 아니다).
  - 내놓는 것: `core/router/mod.ts`의 `createRouter(deps)`(아래 "모양"), `createRouterRegistration()`(schema step, command, read), `calls.*` route의 command·read handler. 다른 단위는 Router를 자기 port로 받는다(run-loop-input의 사람 메시지 접수, approvals의 reaction handler). agent tool은 route를 `CallRouting`(`core/lophn-agent/ports.ts`)으로 부른다. coding-agent의 call 닫기는 `CallStore`를 직접 받는다.

## 모양

### code map에 맞는지 (확인한 것)

- Router는 domain module(projects, apps, problems, lophn-agent)도 바닥 module(server, events, storage)도 아니다. 그래서 domain module을 import하지 않는다. 필요한 것은 모두 `ports.ts`로 받고, 구현은 `wiring/router.ts`가 lophn-agent(session), coding-agent(PTY, 앱 줄), approvals(Gate)의 것으로 끼운다.
- import 허용: `protocol`, `base`, `core/storage/ledger`(표와 command 등록), `core/server`의 type. `core/lophn-agent`, `core/apps`는 import하지 않는다.
- `dev/code-map.md`의 module 표에 router 줄을 더해야 한다. `project-docs/`는 lead 소유이므로 이 task는 고치지 않고 보고에 줄 문구를 적는다: "router: agent 사이 모든 입력의 한 입구(call, agent_calls). domain module을 import하지 않고 port로 받는다".

### `core/router/` file

```
mod.ts            createRouter, createRouterRegistration, 필요한 type
model.ts          순수: 봉투 검증, 받는 곳 해석 순서, 상태 전이, 실패 이유 고르기, dedup 키
schema.ts         agent_calls 표 schema step
store.ts          CallStore의 ledger 구현
commands.ts       send, reply, cancel command handler (SendCall, ReplyCall, CancelCall)
reads.ts          ReadCall, ListSendableSessions read handler
router.ts         route(...) : 모든 입력의 입구. commands와 다른 단위의 in-process 호출이 같이 쓴다
registration.ts   createRouterRegistration()
router_test.ts    위험 test
```

### `createRouter(deps)` 의 모양

```ts
type RouterDeps = {
  directory: SessionDirectory; transport: InputTransport; gate: CallGate;
  store: CallStore; clock: Clock; ids: IdSource;
};
interface Router {
  // 모든 보낸 쪽이 쓰는 입구. 사람, program, agent, coding agent.
  route(tx, input: { from: CallFrom; to: CallToInput | CallTo; reply: CallReply; body: string;
    refs: CallRef[]; reply_to: string | null; dedup: string | null;
    options: CodingOptions | null; kind: RoutedInput["kind"]; delivery: "next_turn" | "steer" }):
    Result<{ call: string | null; state: CallState; fail_reason: CallFailReason | null; session: string | null }>;
  reply(tx, from: { session: string }, input: { call: string; body: string; refs: CallRef[] }):
    Result<{ delivered: boolean; closed: boolean }>;
  cancel(tx, by: CallFrom, input: { call: string; reason?: string }): Result<AgentCallRecord>;
  // Reactor handler(coding-agent)가 맡긴 call을 닫는다. 같은 tx 안에서 부른다.
  close(tx, call: string, to: "done" | "failed", reason: CallFailReason | null): Result<AgentCallRecord>;
  // session을 archive하거나 지울 때 그 session이 받은 열린 call을 failed(receiver_ended)로 닫는다.
  failReceivedBy(tx, session: string): Result<void>;
  // lophn을 켤 때 부른다. 입력함과 앱 줄은 메모리라 잃어버린 call을 failed(lophn_restarted)로 닫고 보낸 session에 돌려준다.
  failLostOnStart(tx): Result<number>;
  // 받는 session의 turn이 이 call의 입력을 가져갔다(run-loop가 turn을 시작할 때 부른다).
  markConsumed(tx, call: string): Result<void>;
}
```

- `agent_calls` 행은 agent가 보낸 call(`from.kind === "agent"`)에만 만든다. 사람 메시지와 program의 reaction은 봉투만 쓰고 행이 없다(S3 5장). 그래서 `route`가 돌려주는 `call`은 그 둘에서 null이다.
- 이 task가 내놓는 `Router`는 한 process 안의 함수다. agent runtime(child)이 call tool을 부르면 core의 `calls.send` command가 `route`를 부른다(#1, #3).

## 할 일

1. `model.ts`(`I3.3#1`, `I3.3#3`, `I3.3#4`): 순수 함수로 짠다.
   - 이름 풀기: 보낸 쪽이 쓴 받는 곳(`CallToInput`)의 이름(role, project·앱 이름, Operator 이름)을 `directory.resolveAgent(named)`로 `CallAgent`(id 기준)로 푼다. 이미 풀린 `CallTo`(Reactor가 event에서 project·앱 id를 알 때)는 그대로 쓴다. 짐작하지 않는다.
   - 받는 곳 해석: `new_session`은 `directory.resolveAgent`가 `not_found`면 바로 failed(`not_found`). `open_session`은 `directory.find`가 null이면 failed(`not_found`), `accepting`이 false이면 failed(`closed`)이고 새로 열지 않는다. `open_session_or_new`는 열려 있으면(`accepting`) 거기, 아니면 같은 agent의 새 session(`I3.3#14`).
   - `directory.open`이 실패하면 `conflict`는 failed(`closed`)(보관한 place), `not_found`는 failed(`not_found`)로 옮긴다.
   - 이름은 짐작하지 않는다. `resolveAgent`가 정확히 맞는 것만 돌려준다.
   - 보낸 쪽이 agent면 받는 agent에게 `gate.authorize`를 부른다. 거절이면 failed(`not_allowed`). 열린 session으로 보낼 때도 그 session의 agent로 판정한다(S3 6장). 보낸 쪽이 program과 사람이면 부르지 않는다(S3 6장).
   - 상태 전이는 `callCanMove`를 쓴다. 끝난 call은 다시 열지 않는다.
   - 배달 실패(`not_found`, `not_allowed`, `closed`)는 행이 바로 failed로 생긴다.
2. `schema.ts`(`I3.3#2`): `agent_calls` 표. 칸은 `call`(PK), `from_session`, `to`(JSON), `receiver_session`(null 가능), `reply`, `state`, `fail_reason`, `dedup`, `options`(JSON, null 가능), `created_at`, `state_at`, `consumed`(0/1). `unique (from_session, dedup) where dedup is not null`(`I3.3#5`). `state`·`fail_reason`은 CHECK로 `CALL_STATES`·`CALL_FAIL_REASONS`를 쓴다. 끝난 행은 trigger로 다시 바꾸지 못하게 한다. schema step id는 `router.agent-calls.tables`. `consumed`는 받는 session의 turn이 이 입력을 가져갔는지이다(재시작 때 잃어버린 call을 가린다). `CallStore.lost`·`markConsumed`·`openReceivedBy`가 이 칸을 쓴다.
3. `router.ts`(`I3.3#1`): `route`.
   - dedup(`I3.3#5`): 보낸 쪽이 agent일 때 (`from.session`, `dedup`)이 같은 행이 있으면 새로 만들지 않고 첫 call ID와 상태를 돌려준다. session도 더 열지 않는다. 키는 tool call ID(`toolIdempotencyKey`)이고 모델이 정하는 문자열은 없다.
   - 배달: `transport.deliver`. `delivered`이면 `reply: none`은 곧 done, 나머지는 accepted. `queued`이면 accepted로 기다린다. coding agent가 받는 곳이고 그 앱에 끝나지 않은 coding session이 있으면 transport가 앱 줄에 세우고 `queued`를 돌려준다. 이때 `receiver_session`은 null이다(S3 5장).
   - 실패는 조용히 버리지 않는다. 보낸 쪽이 agent면 이유를 붙인 `kind: "reply"` 입력(`status: failed`, `reason`)을 보낸 session에 넣는다. 그 입력은 call 행이 없는 program 입력처럼 `route`가 직접 `transport.deliver`로 보낸다. 답을 받지 않는(`reply: none`) call도 배달 실패는 돌려준다(S3 5장). 사람이 보낸 쪽이면 오류 결과로 돌려준다.
   - 사람 메시지(`from.kind === "human"`)와 reaction(`program`)은 행을 만들지 않고 `transport.deliver`만 한다. 사람 메시지는 session이 `accepting`이 아니면 `conflict`로 거절한다(archive한 session은 입력을 받지 않는다, `I3.8#7`의 Router 쪽 몫).
4. `reply`: `call` 행을 읽는다. 이미 끝난 call이면 `{delivered: false, closed: true}`를 돌려준다(늦은 답은 받은 agent에게 `closed`로, S3 5장). 호출한 session이 그 call의 `receiver_session`이 아니면 `forbidden`. 보낸 쪽 session이 `accepting`이면 `kind: "reply"` 입력을 넣는다(보낸 session이 없어졌으면 답은 받은 session에만 남는다). `reply: result`이면 call을 done으로 닫는다. `conversation`이면 accepted로 둔다(coding agent의 완료 보고나 Reactor handler가 닫는다). `none`이면 `conflict`.
5. `cancel`: 보낸 agent는 자기가 보낸 것만, 사람은 모두(`I3.3#9`). 끝난 call이면 상태 그대로 돌려준다. 끝나지 않았으면 cancelled로 닫고 `transport.cancel`로 받은 session에 취소 입력(`kind: "notice"`)을 넣거나 앱 줄에서 뺀다.
6. `close`/`failReceivedBy`/`failLostOnStart`/`markConsumed`: 위 모양 그대로. `failReceivedBy`는 `store.openReceivedBy`로 찾아 failed(`receiver_ended`)로 닫는다(S8 3장). `failLostOnStart`는 `store.lost`로 찾아 failed(`lophn_restarted`)로 닫고, agent가 보낸 것이면 보낸 session에 `kind: "reply"` 입력을 돌려준다(입력함이 메모리라 잃어버린 것이다, #4). `markConsumed`는 `store.markConsumed`를 그대로 부른다. run-loop-input이 자기 port를 통해 부른다.
7. `commands.ts`(`I3.3#7`, `I3.3#8`, `I3.3#9`: reply·cancel의 core 쪽. tool 본체는 agent-tools-call 몫): `callSend`, `callReply`, `callCancel`의 `CommandDefinition`을 만든다. 호출한 자격에서 `from`을 채운다(`parseActor`로 agent의 session을 얻는다). 본보기는 옛 `handoff/commands.ts`의 구조(actor 검사 → dedup → 쓰기)이다. 옛 방향 표 검사, "사람 요청에서 이어진 run만 보낼 수 있다" 검사(`I1.3#8`), 문서 판 근거 검사, 내용 blob 등록은 가져오지 않는다.
8. `reads.ts`(`I3.3#11`): `callRead`. 상태 구독은 없다. 누를 때 읽는다.
9. `calls.sendable` read (`I3.3#10`): `directory.listOpen()`에서 `gate.visible(sender, agent)`가 false인 상대를 빼고 ID, role, place, 이름, 상태를 돌려준다. `transport.queued()`의 앱 줄에 선 coding 맡기기도 `queued_coding`에 담는다. prompt에는 넣지 않는다. 상태(running, waiting, idle, unknown)는 session snapshot(places-sessions-session)에서 `directory`가 준다.
10. `registration.ts`: `createRouterRegistration()`이 `{schemaSteps, commands, reads}`를 돌려준다(본보기: `approvals/registration.ts`).
11. `wiring/router.ts`: `createRouter`에 lophn-agent session 구현(`SessionDirectory`), 입력 transport, `CallGate`, ledger `CallStore`를 끼운다. 그 구현이 아직 없는 port는 type만 import해 생성자에서 받게 두고, 연결은 `wiring`에서 한 줄로 한다. 조립 목록(`wiring` 조립 file)에 올리는 것은 lead 몫이므로 보고의 "등록할 것"에 적는다.
12. 지우기(`I1.3#1`, `I1.3#8`): `packages/core/lophn-agent/tools/handoff/` 전체를 지운다(`adoptionOf` 조건은 위 "선행"). 이 폴더를 가리키는 import는 `tools/bundles/agent.ts`(handoffBodyHash), `core/main/daemon/core.ts` 조립, `register.ts`에 있다. 소유 밖이므로 고치지 않고 보고의 "남은 import"에 적는다(그 줄은 agent-tools, agent-definition, lead가 합친다).
13. test(`router_test.ts`): port 대역(메모리 `CallStore`, 가짜 `SessionDirectory`·`InputTransport`·`CallGate`)으로 한 파일에 표로 돈다. 확인할 결과 셋이다.
    - "닫힌 session으로 보낸 call은 closed로 실패하고 아무것도 배달되지 않는다"
    - "끝난 call에 늦게 온 답은 delivered false, closed true로 돌아가고 보낸 session에 입력이 가지 않는다"
    - "같은 dedup으로 두 번 보내도 call과 session이 하나만 생긴다"
14. (lead가 맞추며 더함 (`I1.3#2`, `I1.3#12`)) handoff protocol route 셋(`SubmitHandoff`, `ReadHandoffStatus`, `ReadHandoffResult`)과 registry 등록 / handoff 근거로 App Engineer가 앱 밖 문서를 읽는 예외. handoff를 call로 바꾸며 함께 지운다
15. (lead가 맞추며 더함 (`I3.3#16`)) code-map 갱신. code-map 고침은 lead가 한다. 보고에 Router 위치와 import 규칙(port만 알고 wiring이 끼운다)을 적는다

- (lead가 더함, fix-turn-wiring이 넘긴 것, lead 결정) command handler는 writer Worker에서 돌고 입력함(메모리, #4)과 Bus는 main thread에 있다. 그래서 tx 안에서 `inbox.put`·`bus.publish`를 바로 부를 수 없다. lead 결정: tx 안에서는 "commit 뒤 할 일"(입력함에 넣기, agent event 내기)을 모으고, `CommandSuccess`에 실어 main thread로 돌려준다. main thread는 commit 뒤 그것을 적용한다(`storage/ledger/commit-publisher.ts`가 도는 곳). tx가 되돌아가면 아무것도 넣지 않는다. 이 길을 짓고(추가 소유, lead 승인: `storage/ledger/{writer-message,writer,commit-publisher}.ts`의 이 줄) `createLophnInputTransport({ inbox, publish })`와 `createTurnCommands({ publish })`가 그것을 쓰게 한다. 입력함은 `wiring/lophn-agent-runtime.ts`의 `createInbox()` 하나다. router wiring이 같은 것을 쓰게 wiring slot으로 나눈다(`wiring/context.ts`의 slot 한 줄은 lead가 넣으니 "등록할 것"에 적는다). 켤 때 `failLostOnStart`와 같은 tx에서 `interruptRunningTurns(tx, publish, "restarted")`를 부른다. 끝나면 session 하나에 메시지를 보내 turn이 시작되고 끝나는지 본다(provider가 없으면 `configuration_unavailable`로 끝나는 것까지).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "닫힌 session으로 보낸 call은 `closed`로 실패한다", "늦은 답은 받은 agent에게 `closed`로 돌아간다", "같은 dedup은 call과 session을 하나만 만든다"
- 남지 않음: `grep -rn "handoff\|Handoff" packages/core/router packages/core/lophn-agent/tools/handoff`가 0줄이다(`tools/handoff`는 지워졌다).

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록에 `wiring/router.ts`, `protocol/lophn-agent/registry.ts`와 `protocol/lophn-agent/mod.ts`에서 `HANDOFF_ROUTES`를 빼고 `CALL_ROUTES`를 올린다(지금 `registry.ts`가 두 곳 모두 가리키므로 lead가 바꾼다), `dev/code-map.md`의 router 줄 문구
- 안 쓰게 된 export: `protocol/lophn-agent/handoffs.ts` 전체, `HANDOFF_DIRECTIONS`·`handoffAllowed`·`handoffContentSchema`(`decision-values.ts`), `HandoffReference`(`run-values.ts`), `core/main/daemon/core.ts`와 `register.ts`의 handoff 줄. 남은 import 목록
- 정한 것: `agent_calls`의 `consumed` 칸과 `failLostOnStart` 규칙, `reply: none`인 call에 reply를 보내면 conflict, 배달 실패를 보낸 session에 돌려주는 방식
- 계약 바꾸기 요청(wave 3): `core/router/ports.ts`에 모자란 것이 있으면 여기에 적는다
