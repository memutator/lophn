# contract-calls-places-calls

call 봉투, call 상태와 실패 이유, `agent_calls` 행, call route, 사람 메시지 보내기(다음 turn, steer)와 받는 session 기록의 봉투 칸을 protocol에 새 모양으로 더하고, Router의 port(`core/router/ports.ts`)를 고정한다. 옛 `handoffs.ts`, `runs.ts`의 `acceptRun`, `messages.ts`는 지우지 않고 옆에 새것을 더한다.

- 단위: contract-calls-places (wave 2)
- 선행: contract-calls-places-places (`AgentRef`, `Role`, `Place`를 import한다). `protocol/base/ids.ts`에 접두사 `cal`(Call)이 먼저 들어 있어야 한다. lead가 이 task를 띄우기 전에 더해 둔다. 없으면 고치지 말고 멈춰서 보고한다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/calls.ts` (새로)
  - `packages/protocol/lophn-agent/inputs.ts` (새로)
  - `packages/core/router/ports.ts` (새로. 폴더도 새로)
  - `packages/core/lophn-agent/ports.ts` (선행 task가 만든 file에 `CallRouting` port 한 덩어리만 더한다)
- 읽을 것:
  - spec: S3 2·3·4·5·6·8·11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S1 3·4·6·9장(Router, 봉투, `MessageReceived`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S4 3장(call, reply, cancel의 입력)·6장(입력 꼴) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S6 5장(맡기기, 앱 줄) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - spec: S9 7장(annotation 보내기) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - inventory: `I2.3#1`, `I2.3#3`, `I3.3#12`
  - 결정: `../README.md` 3장 #1(Router는 core), #4(입력함은 메모리), #18·23·57(steer, turn), #74(coding 실행 옵션은 봉투의 `options`)
  - 지금 코드: `packages/protocol/lophn-agent/{handoffs,runs,messages,message-content}.ts`, `packages/protocol/coding-agent/harnesses.ts`(`harnessIdSchema`)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/places.ts`의 `AgentRef`·`Role`·`Place`(선행 task), `message-content.ts`의 `userMessageContentInputSchema`, `protocol/base/{ids,route,envelope,values}`. event 이름과 payload(`MessageReceived` 등)는 contract-events가 `protocol/events`에 둔다. 이 task는 정의하지 않고 S1을 따른다.
  - 내놓는 것: 아래 "모양". contract-agent-tools(tool 입력), contract-coding(CLI 메시지, 맡기기), wave 3 router·agent-tools·coding-agent가 import한다.

## 모양

### `calls.ts` (S3 3·5장)

- ID 접두사: `cal`(`protocol/base/ids.ts`, lead가 미리 더한다).
- `CALL_REPLIES = ["none", "result", "conversation"] as const`, `callReplySchema`.
- `callFromSchema`: `z.discriminatedUnion("kind", [`
  - `{kind:"human"}`
  - `{kind:"program", event_seq: seqSchema}` (근거 domain event seq)
  - `{kind:"agent", session: ses}`
  - `{kind:"coding_agent", session: ses}` (coding agent의 CLI 메시지. 그 harness session)
  - `])`
- `callAgentSchema`: 받을 agent. `AgentRef`에 `{role:"coding_agent", app: app}` 가지를 더한 union.
- `namedAgentSchema`: agent가 tool에 쓰는 받는 이름(S4 3장 `call`의 `to`). `{role: Role | "coding_agent", place?: {project: string} | {app: string}, name?: string}`. lophn은 place가 없고 Operator는 `name`을 준다. 짐작하지 않고 정확히 맞는 것만 푼다.
- `callToInputSchema`: 보내는 쪽이 쓰는 받는 곳 셋(S4 3장 그대로, 이름 기준). `z.union([{session: ses}, namedAgent, {session: ses, ...namedAgent, fallback: "new"}])`. Router가 `directory.resolveAgent`로 이름을 푼다.
- `callToSchema`: 풀린 뒤 `agent_calls` 행에 남는 받는 곳 셋(id 기준). `z.discriminatedUnion("kind", [`
  - `{kind:"new_session", agent: callAgentSchema}`
  - `{kind:"open_session", session: ses}`
  - `{kind:"open_session_or_new", session: ses, agent: callAgentSchema}`
  - `])`
- `callRefSchema`: 근거 링크. `{kind:"ticket", ticket: tkt}`, `{kind:"problem", problem: prb}`, `{kind:"file", path: string}`, `{kind:"session", session: ses}`, `{kind:"annotation", annotation: string}`. annotation ID 접두사는 contract-app-calls가 정하므로 지금은 `z.string().min(1)`로 두고 보고에 적는다.
- `codingOptionsSchema`: `{harness?: harnessIdSchema, model?: string}`. coding agent가 받는 곳일 때만 둔다(#74). `harnessIdSchema`는 `protocol/coding-agent`에서 import한다. contract-coding이 실행 옵션 type을 따로 정하면 그쪽을 쓰고 보고에 적는다.
- `callEnvelopeSchema`: Router 안에서 쓰는 풀린 봉투. 칸 `call: cal`, `from`, `to`(위 `callToSchema`), `reply`, `body: string(min 1)`, `refs: callRef[]`, `reply_to: cal | null`, `dedup: string | null`, `options: codingOptions | null`. refine: `options`는 `to`가 coding agent일 때만 non-null이다. `dedup`은 `from.kind === "agent"`일 때만 non-null이다(보낸 쪽 tool call ID, S3 11장 3).
- `CALL_STATES = ["accepted", "done", "failed", "cancelled"] as const`, `callStateSchema`. `sent`와 `declined`는 없다(S3 11장 1·4).
- `CALL_FAIL_REASONS = ["not_found", "not_allowed", "closed", "receiver_ended", "lophn_restarted"] as const`, `callFailReasonSchema`. 앞 넷은 S3 5장, 끝은 S3 4장(앱 줄에 서 있던 call이 재시작으로 돌아갈 때).
- `callCanMove(from: CallState, to: CallState): boolean`: 순수 함수. `accepted -> done|failed|cancelled`만 true이고 끝난 call은 다시 열지 않는다. 배달 실패(`not_found`, `not_allowed`, `closed`)는 행이 `accepted`를 거치지 않고 바로 `failed`로 생긴다. 이 경우 `receiver_session`은 null일 수 있다.
- `agentCallRecordSchema`(output), `type AgentCallRecord`: `agent_calls` 행의 모양. 칸은 S3 5장 그대로 — `call`, `from`, `to`(위 `callToSchema`), `receiver_session: ses | null`(줄에 서서 기다리는 coding 맡기기와 배달 실패는 null), `reply`, `state`, `fail_reason | null`, `dedup | null`, `created_at`, `state_at`. 내용(`body`, `refs`)은 받는 session 기록에 있으므로 이 행에 두지 않는다. refine: `state === "failed"` 일 때만 `fail_reason`이 있다.
- route(최종 이름. 옛 `handoffs.ts`와 이름이 겹치지 않는다):
  - `callSend`: command `calls.send` (`SendCall`), actors `["agent"]`. input `callSendInputSchema` = `{to: callToInput, reply, body, refs, options?, dedup}`. `from`은 core가 호출자 identity로 채우고 `call`은 Router가 만든다. contract-agent-tools가 tool `call`의 입력으로 이 schema를 그대로 쓴다. output `{call: cal, state, fail_reason | null}`(call ID를 바로 돌려준다, S3 8장). compare `{}`.
  - `callReply`: command `calls.reply` (`ReplyCall`), actors `["agent"]`. input `{call: cal, body, refs}`. output `{delivered: boolean, closed: boolean}` — 닫힌 call에 늦게 온 답은 `closed: true`로 돌려준다(S3 5장). `conflict` 오류로 두지 않는다.
  - `callCancel`: command `calls.cancel` (`CancelCall`), actors `["agent", "user"]`. input `{call: cal, reason?: string}`. agent는 자기가 보낸 것만, 사람은 모두(req-1503). 권한 판정은 core handler 몫이다.
  - `callSendable`: read `calls.sendable` (`ListSendableSessions`), actors `["agent"]`. input `{}`. output `{sessions: [{session: ses, role, place: Place | null, name: string, state: "running" | "waiting" | "idle" | "unknown"}], queued_coding: [{call: cal, app: app}]}`. agent grant가 deny인 상대는 뺀다(session 목록 tool, S4 3장).
  - `callRead`: read `calls.read` (`ReadCall`), actors `["user", "agent", "machine"]`. input `{call: cal}`. output `{call: agentCallRecord}`(상태 구독은 없다. 누를 때 읽는다, req-1506).
  - `CALL_ROUTES`로 묶는다. `registry.ts`에는 올리지 않는다.

### `inputs.ts` (S3 4장, S4 6장, S9 7장)

- `INPUT_DELIVERIES = ["next_turn", "steer"] as const`, `inputDeliverySchema`. 사람의 보내기만 `steer`를 고를 수 있다(req-1509). call·reply·reaction·notice는 항상 `next_turn`이고 값 자체가 없다. 옛 `mode: request|correction`은 옮기지 않는다.
- `attachedChipSchema`: 사람이 composer에 붙인 것. `{kind:"context", context: ctx, name}`, `{kind:"file", path}`, `{kind:"violation", context: ctx, path, rule}`. 이름과 한 줄만 싣는다(S4 6장 `<lophn-attached>`).
- `sendMessageInputSchema`: 사람 메시지 보내기. `{id: msg, session: ses, content: userMessageContentInputSchema, delivery: inputDeliverySchema, attached: attachedChip[], refs: callRef[]}`. annotation 묶음은 같은 입력이고 `refs`에 `{kind:"annotation"}`가 든다. 묶음이 만든 본문(메모, screenshot)은 `content`에 담긴다(`I3.3#17`: 봉투 칸과 첨부 방식이 문서에 없어 이렇게 정했다). `delivery`가 `steer`인데 session이 돌고 있지 않으면 `next_turn`과 같다는 것은 core handler 몫이다.
- `sendMessage`: command `messages.send` (`SendMessage`), actors `["user"]`. compare `{}`. output `{message: msg, state_seq}`. 옛 `receiveMessage`와 이름이 겹치지 않는다.
- `receivedEnvelopeSchema`: 받는 session 기록의 메시지에 붙는 봉투 칸(`I3.3#12`). `{from: callFrom, call: cal | null, reply_to: cal | null, refs: callRef[]}`. 사람 메시지는 `call`·`reply_to`가 null이다. 옛 `messageSchema.actor`(`user|machine|agent:…`)를 대신하는 쪽이다. `messageSchema` 자체는 이 task가 고치지 않는다(받는 session의 record 저장 모양은 places-sessions가 정한다). 이 schema를 export해 두기만 한다.
- `routedInputKindSchema`: `z.enum(["message", "call", "reply", "reaction", "notice"])`. S4 6장 입력 꼴의 종류. 받는 쪽이 본문의 tag를 고르는 기준이다. (`coding_agent` 메시지는 `call` 종류로 들어온다.)

### `packages/core/router/ports.ts` (S3 4·6·7장, README 3장 #1)

Router는 `core/router/` module이다. domain module(lophn-agent, apps)을 import하면 code-map의 "domain module끼리 직접 import하지 않는다"에 걸린다. 그래서 Router는 아래 port만 알고, 구현은 `main/daemon/wiring/router.ts`가 끼운다. type-only, 구현 없음. 새 protocol 이름은 lead가 `mod.ts`에 올리기 전이므로 `calls.ts`처럼 file 경로로 직접 import한다(wave 3이 `mod.ts`로 바꾼다).

```ts
import type { Result } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type {
  AgentCallRecord, CallAgent, CallFrom, CallRef, CodingOptions, NamedAgent,
} from "../../protocol/lophn-agent/calls.ts";

// 받는 session 하나. Router가 배달 길을 고르는 데 쓴다.
export type TargetSession = {
  session: string;
  transport: "lophn" | "harness";   // lophn session은 run-loop 입력함, harness는 coding agent PTY
  agent: CallAgent;
  accepting: boolean;               // archive, 지움, place 보관이면 false(새 입력을 받지 않는다)
};

// 한 번 배달할 입력. 종류마다 tag를 고르는 것은 받는 쪽이 한다.
export type RoutedInput = {
  kind: "message" | "call" | "reply" | "reaction" | "notice";
  from: CallFrom;
  call: string | null;
  reply_to: string | null;
  body: string;
  refs: readonly CallRef[];
  delivery: "next_turn" | "steer";  // 사람 메시지만 steer가 될 수 있다
};

export interface SessionDirectory {
  find(session: string): TargetSession | null;
  // 이름(role, place의 project·앱 이름, Operator 이름)으로 받을 agent 하나를 고른다. 이름을 짐작하지 않는다. 없으면 not_found.
  resolveAgent(named: NamedAgent): Result<CallAgent>;
  openOf(agent: CallAgent): TargetSession | null;   // 열린 session. 없으면 null
  open(tx: Tx, agent: CallAgent, opener: CallFrom): Result<TargetSession>;
  // session 목록 tool이 쓴다. grant가 deny인 상대는 Router가 CallGate로 거른다.
  listOpen(): readonly (TargetSession & { name: string })[];
}

export interface InputTransport {
  // lophn session이면 입력함에 넣고, harness session이면 PTY에 넣거나 그 앱의 줄에 세운다.
  // 'queued'는 받는 쪽이 돌고 있거나 줄에 서 있어 아직 turn이 안 시작됐다는 뜻이다.
  deliver(
    tx: Tx, target: TargetSession, input: RoutedInput, options: CodingOptions | null,
  ): Result<"delivered" | "queued">;
  // 취소 입력(notice)을 넣고, 줄에 서 있던 coding 맡기기는 줄에서 뺀다.
  cancel(tx: Tx, target: TargetSession | null, call: string): Result<void>;
  // 앱 줄에 서서 기다리는 coding 맡기기. session 목록 tool이 함께 보인다(S4 3장).
  queued(): readonly { call: string; app: string }[];
}

// 보낸 쪽이 agent일 때만 부른다. Gate의 agent grant 판정이다. 묻는 grant면 이 호출이 돌아오기 전에
// 보낸 쪽 turn이 허락을 기다린다. 거절이면 not_allowed.
export interface CallGate {
  authorize(sender: CallFrom, target: CallAgent): Result<void>;
  // 묻지 않고 보이기만 판정한다. deny가 아니면 true(묻는 grant도 보인다). session 목록 tool이 쓴다.
  visible(sender: CallFrom, target: CallAgent): boolean;
}

export interface CallStore {
  insert(tx: Tx, record: AgentCallRecord): Result<void>;
  byDedup(tx: Tx, sender: string, dedup: string): AgentCallRecord | null;
  read(tx: Tx, call: string): AgentCallRecord | null;
  move(tx: Tx, call: string, to: "done" | "failed" | "cancelled", reason: string | null): Result<AgentCallRecord>;
  // 받는 session의 turn이 이 입력을 가져갔음을 적는다. 재시작 때 잃어버린 call을 가리는 근거다.
  markConsumed(tx: Tx, call: string): Result<void>;
  // 끝나지 않았고 아직 가져가지 않은 call. lophn을 켤 때 입력함과 앱 줄이 메모리라 잃어버린 것이다.
  lost(tx: Tx): readonly AgentCallRecord[];
  // 이 session이 받은 끝나지 않은 call. archive나 지움에서 receiver_ended로 닫는다.
  openReceivedBy(tx: Tx, session: string): readonly AgentCallRecord[];
}
```

- `CallStore`는 Router module 안의 `agent_calls` 구현이 채운다(wave 3 router-calls). port로 둔 이유: test가 바꿔 끼우고 Reactor handler(coding-agent)가 `move`만 쓰게 하려는 것이다.
- Router 자신의 함수(`send`, `reply`, `cancel`, `close`)는 router-calls가 정하고 `core/router/mod.ts`로 내놓는다. 다른 module이 Router를 부를 때는 자기 port를 선언해 wiring이 끼운다.
- 이름을 다르게 써도 되지만, 바꾸면 보고 "정한 것"에 적는다. 단 wave 3이 이 port를 바로 구현하므로 칸 이름과 반환 type을 흔들지 않는다.

### `packages/core/lophn-agent/ports.ts`에 더하는 `CallRouting` (agent tool이 Router를 부르는 길)

agent tool(`call`, `reply`, `cancel`, `session.list`)은 agent runtime에서 core를 부른다. 그 길을 route 모양의 async 함수 하나로 선언한다. 구현은 core의 `calls.*` route를 부르는 `CoreCall`이다. agent-tools의 `ToolContext.router`가 이것이다.

```ts
export interface CallRouting {
  send(input: Input<typeof callSend>): Promise<Result<Output<typeof callSend>>>;
  reply(input: Input<typeof callReply>): Promise<Result<Output<typeof callReply>>>;
  cancel(input: Input<typeof callCancel>): Promise<Result<Output<typeof callCancel>>>;
  sendable(): Promise<Result<Output<typeof callSendable>>>;
}
```

- `Input`·`Output`은 `protocol/server/mod.ts`의 type이다. route 정의는 `protocol/lophn-agent/calls.ts`에서 file 경로로 직접 import한다.

## 할 일

1. `calls.ts`를 만든다. 위 이름 그대로. 옛 `handoffs.ts`는 건드리지 않는다.
2. `inputs.ts`를 만든다. `userMessageContentInputSchema`는 `message-content.ts`에서 import한다.
3. `packages/core/router/ports.ts`를 만들고, `packages/core/lophn-agent/ports.ts`에 `CallRouting`을 더한다.
4. `protocol/lophn-agent/mod.ts`의 `export *` 줄과 `registry.ts`는 lead 몫이다. 고치지 않고 보고에 적는다.
5. `I2.3#1`: 새 입구가 옛 `AcceptRun`(`runs.ts`)을 대신한다는 것을 보고에 적는다. `acceptRun`은 router의 run-loop task가 안 쓰게 만들고 cleanup이 지운다.
6. `I2.3#3`: `request`/`correction`을 `next_turn`/`steer`로 바꾼 것이 `inputs.ts`다. `messages.ts`의 옛 `messageModeSchema`는 남긴다.
7. `I3.3#12`: `receivedEnvelopeSchema`가 그 봉투 칸이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(type과 schema만이다).
- 남지 않음: 없음(옛 계약은 wave 3과 cleanup이 지운다). 새 file에서 `grep -n "handoff\|Handoff\|correction\|assignment\|sent\|declined" packages/protocol/lophn-agent/{calls,inputs}.ts packages/core/router/ports.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/registry.ts`의 `ROUTES`에 `CALL_ROUTES`와 `sendMessage`를 올린다(옛 `HANDOFF_ROUTES`는 router가 merge될 때 뺀다). `protocol/base/ids.ts`의 `cal`.
- 안 쓰게 된 export: `handoffs.ts` 전체, `acceptRun`·`runSourceSchema`의 `handoff` 가지(`runs.ts`, `run-values.ts`), `receiveMessage`·`messageModeSchema`(`messages.ts`), `HANDOFF_DIRECTIONS`·`handoffAllowed`·`handoffContentSchema`(`decision-values.ts`)
- 정한 것: `callFromSchema`에 `coding_agent` 가지, `callAgentSchema`에 coding agent 가지, `refs`의 annotation 값, annotation 첨부 방식(`content`에 담고 `refs`로 가리킴), `reply` tool 결과의 `closed` 모양, port 이름
- 계약 바꾸기 요청: 없음(wave 2)
