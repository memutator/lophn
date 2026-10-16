# contract-events

S1의 새 모양을 코드로 고정한다: domain event 10개(이름, subject, payload, 같은 tx 규칙), agent event 12개, 남지 않는 event 3개, Bus에 실리는 event의 union과 구독 조건, Gateway 구독 frame(조건, ready, 끊김), shell main이 renderer로 넘기는 event IPC, core events port(Bus, Reactor). 다른 계약(S3~S9)이 쓰는 event도 모두 여기에 모은다. type, schema, 상수, type-only port만 둔다. 옛 `ledger event`·`events/list`·옛 구독 frame은 지우지 않고 새것을 옆에 더한다.

- 단위: contract-events (wave 2)
- 선행: contract-approvals (`PendingApproval`, `TurnPermissionRequest`, `REACTION_EVENT_TYPES`, `IntentKind`를 import한다), contract-calls-places-calls (`callFromSchema`, `callAgentSchema`를 import한다. 그 task가 places를 선행으로 둔다). lead가 `packages/protocol/base/ids.ts`에 `trn`(Turn), `cal`(Call)을 먼저 더해 둔다.
- 소유(이 task만 고친다):
  - `packages/protocol/events/` (새 file `domain.ts`, `agent.ts`, `transient.ts`, `bus.ts`, `gateway.ts`, `snapshot.ts`를 더하고 `mod.ts`에서 내보낸다. 옛 `events.ts`·`stream.ts`는 지우지 않는다)
  - `packages/protocol/server/` (손댈 것이 없으면 손대지 않는다. `question-option.ts`는 contract-agent-tools의 것이다)
  - `packages/shell/ipc/core.ts`
  - `packages/shell/ipc/core-api.ts`
  - `packages/shell/preload/core-api.ts` (`CoreApi` 구현. ownership.md에서는 contract-shell의 것이다. 보고의 "소유 바꾸기 요청"을 오케스트레이터가 받아들인 뒤에 고친다)
  - `packages/core/events/ports.ts` (새 file, type만)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I3.1#9`
  - spec: S1 2~10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`. 그 밖에 이름을 찾을 spec: S3 `agent-call.md` 3·5장(봉투 `from`·`reply_to`), S4 `agent-definition.md` 3장 "사람에게 묻기", S6 `coding-agent.md` 2장 표(`CodingSessionEndedUnreported`, `TicketCompletionReported`, `TicketClaimExpired`, hook → agent event), S7 `activation.md` 5장(`TicketVerified`), S5 `app-call.md`(앱 view 다시 그리기), S9 `annotation.md` 11장(domain event 아님) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/`
  - inventory: `I3.1#2`, `U2.1#2`, `U2.6#2` (`../assignment.md`의 contract-events 줄 전부)
  - 결정: `../README.md` 3장 #2(agent runtime의 agent event는 감독 pipe로 core Bus에), #11(event 구독은 shell main이 중계, token은 main에만), #12(Gateway에 붙는 쪽은 shell main 하나, 자격은 연결 때 본다), #17(앱 view를 다시 그리는 신호는 남지 않는 event `AppViewChanged{app, reason}`), #117·118(`SettingsChanged`)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`("package 사이 약속"), `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md`
  - 지금 코드(읽기만): `packages/protocol/events/{events,stream}.ts`(옛 envelope·`defineEvent`·옛 frame), `packages/shell/main/desktop/core/events.ts`(지금 main의 구독), `packages/shell/preload/core-api.ts`(CoreApi 구현), `packages/core/apps/tickets/ports.ts`(port file 본보기)
- 계약:
  - 쓰는 것: contract-approvals의 `PendingApproval`, `TurnPermissionRequest`, `IntentKind`, `REACTION_EVENT_TYPES`, `turnDecisionSchema`(`protocol/approvals`). contract-calls-places의 `callFromSchema`·`CallFrom`·`callAgentSchema`·`CallAgent`(`protocol/lophn-agent/calls.ts`), `placeSchema`(`places.ts`). `protocol/base`의 `idSchema`(접두사 `ses`, `msg`, `tcl`, `qgr`, `apr`, `prb`, `app`, `rel`, `tkt`, `ctx`, `prj`, `chk`, `trn`, `cal`), `actorSchema`, `atSchema`, `seqSchema`.
  - 내놓는 것: `DOMAIN_EVENTS`, `AGENT_EVENTS`, `TRANSIENT_EVENTS`, `busEventSchema`, `eventConditionSchema`, Gateway frame schema, `sessionSnapshotsList`, `Bus`·`Reactor` port, shell IPC channel. contract-calls-places, contract-agent-tools, contract-app-calls, contract-releases-problems, contract-coding이 필요한 event 이름과 payload를 여기서 import한다(그들의 brief는 S1을 따른다고만 적는다).

## 할 일

1. 말을 맞춘다 (S1 2장)
   - domain event는 Ledger에 남고 Reactor가 반응한다. agent event는 session에서 일어나고 메모리로만 흐른다. 남지 않는 event는 session 밖에서 화면만 알면 되는 것이다. 이 셋을 아우르는 말이 event이고, Bus에 실리는 것은 셋 모두다.
   - 모든 event 이름은 `<Entity><과거형 동사>` PascalCase다(`defineEvent`의 정규식을 따른다).

2. `packages/protocol/events/domain.ts` — domain event 10개 (S1 5장, `I3.1#2`의 짝)
   - 옛 `defineEvent`(`events.ts`)로 정의한다. 옛 `eventEnvelopeSchema`는 `run` 칸이 있어 쓰지 않고, `domainEventEnvelopeSchema(definition)`을 새로 만든다: `{ seq, type, subject, actor, at, payload }` (S1 4장, `run` 없음).
   - 이름은 최종 이름이다. 지금 코드의 같은 이름 event(`protocol/problems/reports.ts`의 `problemOpened` 등)와 export 이름이 같아도 module이 달라 충돌하지 않는다. 옛 것은 소유 wave 3 단위가 쓰기를 그만두고 cleanup이 지운다.
   - 각 event의 payload는 아래 표다. 받는 handler가 쓰는 칸만 둔다. `actor`는 envelope에 있다.

   | event | subject | payload | 성격 | 같은 tx에 쓰는 command |
   |---|---|---|---|---|
   | `ProblemOpened` | `prb` | `{ app, report: rpt }` | 새 일 | 문제가 처음 열리는 command(problems) |
   | `ProblemReopened` | `prb` | `{ app, report: rpt }` | 새 일 | 해결됨 문제가 활성 release에서 다시 남는 command |
   | `AppRestartHalted` | `app` | `{ release: rel, crashes: 정수 }` | 새 일 | app-runtime이 자동 재시작을 멈추는 command |
   | `ReleaseActivationFailed` | `rel` | `{ app, ticket: tkt, failure: { code, summary } }` | 새 일 | activation 실패를 기록하는 command |
   | `ContextViolationFound` | `prj` | `{ project: prj, context: ctx, check: chk }` | 새 일 | 이전 검사와 위반 집합을 비교해 새 위반이 생긴 context 검사 command |
   | `TicketCompletionReported` | `tkt` | `{ app, release: rel }` | call 닫음 | CLI 완료 보고 command |
   | `TicketClaimExpired` | `tkt` | `{ app }` | call 닫음 | claim 기한 정리 command |
   | `CodingSessionEndedUnreported` | `ses` | `{ app, ticket: tkt }` | call 닫음 | 보고 없이 끝난 coding session 정리(시작 때 정리 포함) |
   | `ApprovalDecided` | `apr` | `{ kind: IntentKind(activation 또는 reaction), decision: "granted" \| "rejected" }` | program 일 | 보류 request 결정 command |
   | `TicketVerified` | `tkt` | `{ app }` | program 일 | `ticket.verify(result: verified)` command |

   - 같은 tx 규칙(S1 3장 "command 층"): 위 event는 그 도메인 상태를 바꾸는 command가 같은 transaction에서 쓴다. commit 뒤 같은 event를 Bus에도 낸다(구현은 wave 3 events). 이 규칙을 `domain.ts` 위 주석 한 곳에 적는다.
   - 내보내는 것: 각 event 정의, `DOMAIN_EVENTS`(10개 배열), `DomainEventType`, `DomainEvent`(10개 envelope의 union), `DOMAIN_EVENT_KINDS: Record<DomainEventType, "new_work" | "call_closing" | "program">`. 새 일 다섯은 contract-approvals의 `REACTION_EVENT_TYPES`와 같아야 한다(`satisfies`나 type 검사로 묶는다).
   - 이 목록에 없는 변경은 domain event를 만들지 않는다(S1 5장 "domain event가 아닌 것"). 이 task는 목록 밖 event를 만들지 않는다.

3. `packages/protocol/events/agent.ts` — agent event 12개 (S1 6장, `I3.1#2`)
   - envelope: `{ session, type, at, payload }`. `seq`가 없다. `defineAgentEvent(type, payloadSchema)` 도우미를 둔다.
   - 입력의 보낸 쪽은 contract-calls-places의 `callFromSchema`(사람, program과 근거 domain event seq, agent session, coding agent session)를 그대로 쓴다. 새로 정의하지 않는다(S3 3장 `from`).
   - 목록과 payload:

   | event | payload |
   |---|---|
   | `SessionStarted` | `{ agent: CallAgent, place: Place \| null, kind: "lophn" \| "coding_agent", external_session: string \| null, revived: boolean }`. 이름(title)은 싣지 않는다. store가 필요하면 session을 read로 읽는다(S1 8장 store 층) |
   | `MessageReceived` | `{ message: msg, body: string, from: CallFrom, call: cal \| null, reply_to: cal \| null, steer: boolean }`. 사람 메시지·call·답·reaction이 모두 이것으로 보인다. 도는 turn 안에서 steer로 들어온 메시지면 `steer: true`(req-1509) |
   | `TurnStarted` | `{ turn: trn, trigger: msg }` |
   | `TurnEnded` | `{ turn: trn, outcome: "completed" \| "failed" \| "interrupted", messages: msg[], error: { code, message } \| null }` |
   | `ToolCallStarted` | `{ turn, tool_call: tcl, tool: string }` |
   | `ToolCallEnded` | `{ turn, tool_call, outcome: "ok" \| "error" \| "denied" \| "cancelled" }` |
   | `PermissionRequested` | `{ request: TurnPermissionRequest }` |
   | `PermissionResolved` | `{ request: apr, outcome: "allowed" \| "rejected" \| "cancelled" }` |
   | `QuestionAsked` | `{ group: qgr, turn, tool_call }`. 질문 내용은 싣지 않는다. 내용은 contract-agent-tools가 고정하는 질문 type을 session snapshot이 준다 |
   | `QuestionResolved` | `{ group: qgr, outcome: "submitted" \| "cancelled" \| "human_message" }` |
   | `CompactStarted` | `{ turn: trn \| null }` |
   | `CompactEnded` | `{ ok: boolean }` |
   | `SessionEnded` | `{ reason: "archived" \| "deleted" \| "exited" \| "lophn_stopped" }` |

   - coding agent는 이 가운데 `SessionStarted`, `MessageReceived`, `TurnStarted`, `TurnEnded`, `PermissionRequested/Resolved`(harness가 물어 올 때만), `SessionEnded`를 낸다. `ToolCall*`, `Question*`, `Compact*`는 coding agent가 내지 않는다는 것을 주석 한 줄로 적는다.
   - subagent와 model 호출은 event로 두지 않는다. 대화 기록은 session 기록에 쓰고 agent event로 저장하지 않는다.

4. `packages/protocol/events/transient.ts` — 남지 않는 event (S1 7장)
   - envelope: `{ type, subject, at, payload }`.
   - `ApprovalRequested`: subject `apr`, payload `{ request: PendingApproval }`. 보류 request를 표에 쓰고 commit한 뒤 낸다.
   - `AppViewChanged`: subject `app`, payload `{ reason: "activation" | "grant" | "rewind" }`. activation, 앱 grant 바뀜, 앱 rewind가 끝난 뒤 낸다(`../README.md` 3장 #17). 열린 앱 view가 다시 그린다. 기존 `refreshAppViews`(`GrantCreated` 등 ledger event를 읽던 것)를 대신한다.
   - `SettingsChanged`: subject `null`, payload `{ keys: string[] }`. core가 설정 파일 바뀜을 보고 낸다(`../README.md` 3장 #117·118). 쓰는 요소가 값을 다시 읽는 신호이고 Ledger에는 쓰지 않는다.
   - `TRANSIENT_EVENTS` 배열을 내보낸다.

5. `packages/protocol/events/bus.ts` — Bus에 실리는 것과 구독 조건 (S1 3·4장)
   - `busEventSchema`: domain envelope 10개, agent event 12개, 남지 않는 event 3개의 union(`type` 이름이 서로 겹치지 않는다). `BusEvent` type.
   - `eventConditionSchema`: `{ session?: ses, types?: 이름[] }`. `session`을 생략하면 어느 session이든(session이 없는 event 포함), `types`를 생략하면 어느 종류든이다. 일치 규칙을 주석으로 적는다(구현은 wave 3).
     - event가 조건에 맞는다 = (`session`이 없거나 event의 `session`과 같다) 그리고 (`types`가 없거나 event의 `type`이 들어 있다). 조건 여럿은 OR이고, 같은 event는 연결 하나에 한 번만 간다.
     - `session`을 건 조건은 session이 없는 event(domain, 남지 않는 event)와 맞지 않는다.
   - 사람 화면 쪽 기본 구독(S1 8장 "구독 (기본)")은 이 task가 값으로 고정하지 않는다. renderer의 event client(screens-data)가 조건 목록을 만든다.

6. `packages/protocol/events/gateway.ts` — Gateway 구독 frame (S1 3장, `U2.1#2`, `I2.1#5`의 짝)
   - 연결: `GATEWAY_PATH = "/v1/gateway"`, `GATEWAY_SUBPROTOCOL = "lophn.gateway.1"`. 받는 principal은 사람 token 하나(`GATEWAY_ACTORS = ["user"]`). replay도 ack도 없다.
   - client frame: `{ type: "watch", conditions: EventCondition[] }` 하나. 연결 안에서 여러 번 보내면 조건을 통째로 바꾼다.
   - server frame: `{ type: "ready" }` (조건이 적용됐고 이제부터 맞는 event가 온다. renderer는 이 frame을 받은 뒤 read API로 snapshot을 읽는다. snapshot read route는 이 계약의 `sessionSnapshotsList`(아래)와 contract-approvals의 `approvalsPending`이 준다), `{ type: "event", event: BusEvent }`, `{ type: "closed", reason: "slow_consumer" | "credential_revoked" | "shutdown" }`.
   - server frame 목록은 배열(`GATEWAY_SERVER_FRAMES`)과 그것으로 만든 `gatewayServerFrameSchema`(discriminated union)로 둔다. contract-coding이 core → shell main 터미널 요청 frame(`coding_terminal`, renderer로 중계하지 않는다)을 이 목록에 더하는 일은 lead가 한다(보고의 등록할 것). `ready`·`event`·`closed`는 renderer에도 가는 frame이고 터미널 요청 같은 shell main 전용 frame과 구별된다는 것을 주석 한 줄로 적는다.
   - close code: `GATEWAY_CLOSE_SLOW_CONSUMER = 1013`, `GATEWAY_CLOSE_CREDENTIAL_REVOKED = 1008`. `closed` frame을 먼저 보내고 연결을 닫는다. 느린 구독자는 끊고, 붙은 쪽이 snapshot부터 다시 읽는다(S1 4·10장).
   - `parseGatewayClientFrame(text)`: 옛 `parseClientEventFrame`과 같은 꼴로 `Result`를 돌려주고 `invalid_input`만 낸다.

   - session snapshot read (S1 4장 "session snapshot", `ready` 뒤 renderer가 읽는다): `packages/protocol/events/snapshot.ts`(새)에 둔다.
     - `SESSION_STATES = ["running", "waiting", "idle", "unknown"]`. `waiting`은 대기 권한 요청이나 질문이 있는 때, `unknown`은 coding agent가 harness 신호를 못 받았을 때다.
     - `sessionSnapshotSchema`: `{ session: ses, state, permission_requests: TurnPermissionRequest[], questions: [{ group: qgr, turn: trn, tool_call: tcl }] }`. 질문 내용은 싣지 않고 contract-agent-tools의 질문 read로 읽는다.
     - `sessionSnapshotsList`: `defineRead`, resource `session_snapshots`, method `list`, name `ListSessionSnapshots`, actors `["user"]`. input `{ sessions?: ses[] }`(없으면 열린 session 전부). output `withReadCommon({ snapshots: SessionSnapshot[] })`.
     - 구현은 wave 3 places-sessions(`I3.1#4`)가 session 상태를 agent event에서 계산하고 approvals의 `turnRequests(session)`을 합쳐 낸다. 보류 request 목록은 contract-approvals의 `approvalsPending`이다.

7. `packages/shell/ipc/core.ts`, `core-api.ts` — shell main이 renderer로 넘기는 event (S1 8장, `U2.1#2`, `U2.6#2`)
   - shell tsc가 `packages`를 보지 않을 수 있으므로 `packages/protocol`을 import하지 않는다. event 본문은 `z.unknown()`으로 두고 renderer가 `busEventSchema`로 읽는다.
   - `core.ts`에 더한다:
     - `CORE_EVENT_CHANNEL = "shell:core-event"` (main → renderer push)
     - `CORE_WATCH_CHANNEL = "shell:core-watch"` (renderer → main invoke)
     - `coreEventMessageSchema`: `{ kind: "ready" }` | `{ kind: "event", event: unknown }` | `{ kind: "closed", reason }`. Gateway server frame과 1:1이다.
     - `coreWatchSchema`: `{ conditions: [{ session?: string, types?: string[] }] }`. 이 renderer의 조건 전체다(통째로 바꾼다). main은 연결이 새로 붙을 때마다 이 조건으로 다시 걸고 `ready`를 renderer에 다시 민다.
   - `ConnectionState`(옛 것은 그대로)에 칸 하나를 더한다: `schemaFailure?: "newer_schema" | "history_mismatch" | "damaged_original"`. `state`가 `failed-schema`일 때 시작 실패 화면이 세 경우를 구별해 "원본을 그대로 두고 시작하지 않았다"와 update 안내를 보이는 데 쓴다. 칸이 선택이라 지금 main 코드는 깨지지 않는다.
   - `core-api.ts`의 `CoreApi`에 더한다:
     - `watch(conditions): Promise<void>` — 조건을 통째로 바꾼다.
     - `onEvent(listener: (message: CoreEventMessage) => void): () => void` — main이 중계한 Gateway 메시지를 듣고, 해제는 반환 함수다.
   - `CoreApi` 구현은 `packages/shell/preload/core-api.ts`의 `createCoreApi`다. `CoreApi`에 필수 member를 더하면 그 file이 type 오류를 내므로 같은 변경에서 두 member를 구현한다: `watch`는 `transport.invoke(CORE_WATCH_CHANNEL, { conditions })`, `onEvent`는 `transport.on(CORE_EVENT_CHANNEL, ...)`이고 payload는 `coreEventMessageSchema`로 거른다. 해제는 `removeListener`다. 연결 상태 `subscribe`는 그대로 둔다.

8. `packages/core/events/ports.ts` — core events port (type만, 구현 없음)
   - `BusSink`: `send(event: BusEvent): void`, `close(reason: "slow_consumer" | "shutdown"): void`.
   - `Bus`: `publish(event: BusEvent): void`(메모리, 동기, 느린 구독자 때문에 막히지 않는다. 놓칠 수 있다), `subscribe(conditions: readonly EventCondition[], sink: BusSink): () => void`(해제 함수. 같은 event는 sink에 한 번).
   - `ReactorHandler<T extends DomainEventType>`: `{ name: string, handle(event: DomainEvent 중 type이 T인 것, context: ReactorContext): Promise<Result<void>> }`. handler 이름은 idempotency key의 일부다.
   - `ReactorContext`: `{ idempotencyKey(reaction: string): Promise<string> }`. handler가 부르는 command가 같은 `(handler 이름, seq, reaction)`으로 두 번 일해도 효과가 한 번이게 한다(지금의 `reactionIdempotencyKey`).
   - `Reactor`: `on<T>(type: T, handler: ReactorHandler<T>): void`(종류마다 handler 여럿 가능, 이름으로 구별). 시작·정지는 조립이 맡는다.
   - Bus가 어떤 module에서 쓰이는지(run-loop, harness adapter, approvals command 층, Gateway)는 주석으로 적는다. agent runtime child에서 오는 agent event는 감독 pipe로 core에 와서 core가 `publish`한다(`../README.md` 3장 #2).

9. `packages/protocol/events/mod.ts`에 새 file들을 `export *`로 더한다(옛 export는 그대로). 이름이 옛 `events.ts`·`stream.ts`와 겹치면 새 이름을 바꾼다.
10. (lead가 맞추며 더함 (`I3.1#9`)) 새 domain event `CodingSessionEndedUnreported`
11. (lead가 맞추며 더함) `TicketCompletionReported`와 `TicketClaimExpired`의 payload에 `session`을 더한다. lophn이 다시 켜진 뒤 Reactor가 call을 찾는 데 쓴다(coding 보고). Gateway server frame에 coding 터미널 요청 frame(`coding_terminal`)을 더한다. 모양은 contract-coding-routes와 맞추고, renderer로는 중계하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (type과 schema만 있다. Bus, Reactor, ledger 쓰기는 wave 3 events가 test한다)
- 남지 않음: 해당 없음. 옛 계약은 지우지 않는다. 새 file의 export 이름이 옛 `protocol/events/{events,stream}.ts` export와 겹치지 않는다(`deno check`가 잡는다).

## 보고

- 바꾼 file
- 등록할 것: `protocol/registry.ts`(또는 session 쪽 registry)의 `ROUTES`에 `sessionSnapshotsList`(lead). contract-coding의 `coding_terminal` frame을 `GATEWAY_SERVER_FRAMES`에 더한다(lead). `packages/protocol/registry.ts`·`packages/protocol/mod.ts`의 `ALL_EVENTS`는 지금 바꾸지 않는다. 새 `DOMAIN_EVENTS`의 이름이 옛 정의(`problems/`, `apps/`, `coding-agent/`)와 겹쳐서 목록에 같이 넣으면 중복이다. lead가 wave 3에서 옛 정의가 빠지는 대로 `ALL_EVENTS`를 `DOMAIN_EVENTS` 하나로 바꾼다. `protocol/events/mod.ts` 목록은 이 task가 직접 고친다.
- 안 쓰게 된 export: `eventsList`, `advanceSubscriberCursor`(wave 3 events-reactor가 쓴다. 지우지 않는다), 옛 `stream.ts`의 frame 전부, `EventVisibilityDefinition`, `Tx.useApproval`, 옛 `eventEnvelopeBaseSchema`의 `run` 칸
- 정한 것
  - 각 event의 payload 칸(위 표). S1에는 payload 칸이 없다.
  - S1 6장 목록에 model이 쓴 응답 글을 싣는 agent event가 없다. 이 계약은 목록 열둘 그대로 두고, `TurnEnded.messages`(msg id)로 대화 탭이 session 기록을 읽는 길만 둔다. 진행 중에 응답 글이 보여야 하면 agent event 하나가 더 필요하다. lead가 정한다.
  - `QuestionAsked`는 질문 내용을 싣지 않고 `group` id만 싣는다(질문 type은 contract-agent-tools의 것이라 순환을 피함).
  - `AppRestartHalted`·`ContextViolationFound`·`CodingSessionEndedUnreported`의 payload는 handler가 받는 곳(앱, project, ticket)을 고르는 데 필요한 칸만 둔 추정이다.
- 소유 바꾸기 요청: `packages/shell/preload/core-api.ts`를 contract-shell에서 contract-events로 (위 7)
- 계약 바꾸기 요청: 없음 (wave 2)
