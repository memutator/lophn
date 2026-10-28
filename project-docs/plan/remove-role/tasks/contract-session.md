# contract-session

session의 정체와 call의 주소를 바꾸는 계약을 옛 꼴 옆에 더하고, 옆에 둘 수 없어 뒤 wave가 제자리에서 바꿀 꼴(event·snapshot, run, job, workflow, flow wire)의 목표 모양을 여기서 고정한다. 앱 annotation 보내기에 고른 agent 칸을 더한다.

- 단위: contract (wave 1)
- 선행: contract-agent. `AgentId`, `AgentAtPlace`, `AgentAddress`를 쓴다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agent-sessions,calls}.ts`
  - `packages/protocol/apps/annotation.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것"에서 아래를 읽는다.
    - "session과 place 종류": session의 정체는 (agent id, place)다.
    - "주소와 넘기기": call의 `to`, domain 일을 받는 쪽, 앱 화면 annotation.
    - "뼈대 검토": 계약은 일부만 옛 꼴 옆에 둔다. annotation 받는 쪽. `coding_agent` actor는 wave 4가 지운다.
  - roadmap: `project-docs/products/roadmap/remove-role.md`의 "지금 코드" > "role이 정하는 것"의 session, 주소, annotation 줄
  - architecture:
    - `project-docs/architecture/place-session.md`의 "지키는 것": 열 때 정해지고 바뀌지 않는다. fork는 같은 agent·place다.
    - `project-docs/architecture/agent-call.md`의 "흐름"·"지키는 것": 받는 곳 셋, `agent_calls` 행, `unattended`, `dedup`.
    - `project-docs/architecture/annotation.md`의 "지키는 것": 받는 session은 사람이 보고 있는 대화다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `agent-sessions`, `router`, `apps`, interface `core-api`. `project-docs/module-catalog.yaml`의 `packages/protocol`(boundary `protocol`)
  - 고칠 코드: `packages/protocol/lophn-agent/agent-sessions.ts`(옛 `agentSessionSchema`, `openAgentSession`, `agentSessionRead`, `agentSessionList`, `AGENT_SESSION_ROUTES`), `packages/protocol/lophn-agent/calls.ts`(옛 `callToInputSchema`, `callToSchema`, `callEnvelopeSchema`, `agentCallRecordSchema`, `callSend`·`callReply`·`callCancel`·`callSendable`·`callRead`, `CALL_ROUTES`), `packages/protocol/apps/annotation.ts`(`annotationSendInputSchema`와 그 위 주석)
  - 읽기만:
    - `packages/protocol/lophn-agent/places.ts`: `contract-agent`가 더한 `agentIdSchema`, `agentAtPlaceOutputSchema`, `agentAddressSchema`(strictObject), `placeSchema`·`placeOutputSchema`
    - `packages/protocol/lophn-agent/sessions.ts`: 옛 `sessionCompactRequests`(427줄)의 모양. `compactionOutputSchema`·`forkOriginOutputSchema`·`sessionTitleSchema`. 고치지 않는다.
    - `packages/protocol/lophn-agent/registry.ts`, `packages/protocol/lophn-agent/mod.ts`: 고치지 않는다. mod.ts가 두 file을 이미 `export *`한다.
    - `packages/protocol/base/route.ts`: route 값의 `.input`은 넘긴 schema 그대로다.
  - "제자리에서 바꿀 꼴의 목표"의 file(`events/*`, `runs/runs.ts`, `jobs/*`, `workflows/*`, `sdk/flow/wire.ts`)은 이 task가 고치지 않으므로 읽지 않아도 된다.
- 계약:
  - 쓰는 것: `contract-agent`의 `AgentId`, `placeKindOf`, `AgentAtPlace`, `AgentAddress`, `placeNameSchema`. 지금의 `placeSchema`.
  - 내놓는 것: 옛 꼴(`AgentSession`, `openAgentSession`, `agentSessionRead`, `agentSessionList`, `sessionCompactRequests`, `CallAgent`, `NamedAgent`, `CallTo`, `callSend`, `callSendable`, `callRead`)은 지우지 않는다. 새 route는 resource·method·name이 옛 것과 같아 registry에 같이 둘 수 없다. 구현 task가 합쳐질 때 lead가 registry에서 옛 상수를 새 상수로 바꾼다. 옛 상수를 쓰는 화면·e2e·eval·CLI는 wave 3이 옮긴다.
    - session(`agent-sessions.ts`):
      - `placeSessionSchema`·`type PlaceSession` = `{ id, agent: AgentId, place: Place | null, title, lifecycle, forked_from, model_selection, compaction, skip, state_seq }`(role·place 맞춤 refine 없음).
      - `placeSessionOpen`: `sessions/open` `OpenSession`, input `{ id, agent: AgentId, place: Place | null }`, output은 옛 것과 같다.
      - `placeSessionRead`: `sessions/read` `ReadSession`, output `{ session: PlaceSession }`.
      - `placeSessionList`: `sessions/list` `ListSessions`, input `{ agent: AgentId, place: Place | null, archived?, cursor? }`, output `{ sessions: PlaceSession[] }`.
      - `placeSessionCompactRequests`: `sessions/compact-requests` `ListSessionCompactRequests`, 한 줄 `{ session, agent: AgentId, place, request_seq }`.
      - `PLACE_SESSION_ROUTES` = 위 넷. actors에 `coding_agent`를 넣지 않는다. `sessions-core`가 합쳐질 때 registry의 `AGENT_SESSION_ROUTES`와 `sessionCompactRequests` 자리에 들어간다.
    - call(`calls.ts`):
      - `callAddressInputSchema`·`type CallAddressInput` = `{ session } | AgentAddress | AgentAddress & { session, fallback: "new" }`.
      - `callTargetSchema`·`type CallTarget` = `{ kind: "new_session", agent: AgentAtPlace } | { kind: "open_session", session } | { kind: "open_session_or_new", session, agent: AgentAtPlace }`. 표 `agent_calls."to"`에 이 JSON을 둔다.
      - `agentCallEnvelopeSchema`·`type AgentCallEnvelope`: 옛 `CallEnvelope`에서 `to`가 `CallTarget`이고 `options`가 없다.
      - `agentCallRowSchema`·`type AgentCallRow`: 옛 `AgentCallRecord`에서 `to`가 `CallTarget`이다.
      - `agentCallSend`: `calls/send` `SendCall`, input `{ to: CallAddressInput, reply, body, refs, dedup, unattended? }`(`options` 없음).
      - `agentCallSendable`: `calls/sendable` `ListSendableSessions`, output `{ sessions: [{ session, agent: AgentId, name(agent 이름), place, state }] }`(`queued_coding` 없음).
      - `agentCallRead`: `calls/read` `ReadCall`, output `{ call: AgentCallRow }`.
      - `AGENT_CALL_ROUTES` = 위 셋과 그대로 쓰는 `callReply`·`callCancel`. `router-core`가 합쳐질 때 registry의 `CALL_ROUTES` 자리에 들어간다.
    - annotation(`apps/annotation.ts`, 제자리 더하기): `annotationSendInputSchema`에 `agent: agentIdSchema.optional()`. app target이면 앱 title bar agent select가 고른 agent이고, session이 null이면 그 agent의 그 앱 place session을 새로 연다. 없으면 lophn이다. artifact·file target은 이 칸을 받지 않는다.
    - 제자리에서 바꿀 꼴의 목표(이 task는 고치지 않는다. 괄호 안 task가 바꾼다):
      - event·snapshot(`packages/protocol/events/{agent,snapshot}.ts`, `shell-events`): `SessionStarted.payload` = `{ agent: AgentId, place, revived }`(`external_session` 없음), session snapshot의 `agent: AgentId`(`harness` 없음). 그 전까지 core는 옛 꼴(`{ role: "lophn" }`, `{ role: "operator", agent }`)로 낸다.
      - run(`packages/protocol/runs/runs.ts`, `runs-core`): 기록의 `target` = `{ agent: AgentAtPlace } | { app, tool }`, `StartRun` input의 `agent?: AgentAddress`, `ListRuns` input의 `agent?: AgentId`, `CreateRun`의 target `{ agent: AgentAtPlace }`. 열 `runs.agent_key` = `<agent id>`(home) 또는 `<agent id>@<place id>`.
      - job(`packages/protocol/jobs/{values,jobs}.ts`, `jobs-core`): 기록의 `creator: AgentAtPlace`, action input `agent_run.agent: AgentAddress`, 저장 action `agent_run` = `{ agent: AgentId, agent_place: Place | null, ... }`. 열 `jobs.creator_agent TEXT NOT NULL`, `jobs.creator_place TEXT`(null이면 home, 아니면 `prj_…`·`app_…`).
      - workflow(`packages/protocol/workflows/*`, `packages/sdk/flow/wire.ts`, `workflows-core`): 참가자 = `{ agent: string, place?: placeName }`(place가 없으면 instance의 project) | `{ kind: "human" }` | `{ kind: "harness" }`. 선언에 `agent?: string`(flow의 앱 tool 호출이 쓸 할당과 domain의 agent, 없으면 lophn). handoff `delivery.to` = `AgentAddress | AgentAddress & { session, fallback: "new" }`. flow 요청 `{ type: "agent", agent: AgentAddress, ... }`(place가 없으면 instance의 project). SDK의 `NamedAgent` type은 `AgentAddress`가 된다.

## 할 일

새 꼴은 옛 꼴 옆에 더하고 옛 export는 지우거나 모양을 바꾸지 않는다(README "뼈대 검토"). 새 묶음은 file 끝(옛 route 목록 뒤)에 모은다. wave 4가 옛 것을 지울 때 diff가 깨끗하고, 아래 "끝남"의 grep이 새 묶음만 본다. 새 route는 `registry.ts`와 `mod.ts`에 넣지 않는다. 새 꼴에는 `coding_agent`, `options`, `queued_coding`을 넣지 않는다(README "주소용 `coding_agent`는 지운다"). 새 묶음의 주석에도 coding을 쓰지 않는다. "끝남"의 grep이 주석까지 본다.

1. **`agent-sessions.ts`의 session**: README "session의 정체는 (agent id, place)다"와 `place-session.md` "role과 place는 session을 열 때 정해지고 바뀌지 않는다"를 따른다.
   - import: `./places.ts`에서 `agentIdSchema`, `placeSchema`를 더한다. `placeOutputSchema`는 이미 있다.
   - `export const placeSessionSchema`: `z.object`이고 칸은 옛 `agentSessionSchema`와 같다.
     - 다른 것은 `agent: agentIdSchema`와 `place: placeOutputSchema.nullable()` 둘이다. `place`는 이제 편의 칸이 아니라 정체의 한 쪽이다.
     - refine은 fork 원본이 자기 자신이 아닌지만 본다. `rolePlaceFits`는 부르지 않는다.
   - `export type PlaceSession = z.infer<typeof placeSessionSchema>`.
   - 아래 route를 더한다. errors는 그 file의 `commandErrors`·`readErrors`를 쓴다.

   | 상수 | 종류 | resource/method, name | input | output | compare | actors |
   |---|---|---|---|---|---|---|
   | `placeSessionOpen` | `defineCommand` | `sessions/open`, `OpenSession` | `z.strictObject({ id: idSchema("ses"), agent: agentIdSchema, place: placeSchema.nullable() })` | 옛 `openAgentSession`과 같다(`{ id, lifecycle: "open", place, state_seq }`) | `z.strictObject({})` | user |
   | `placeSessionRead` | `defineRead` | `sessions/read`, `ReadSession` | `{ session: idSchema("ses") }` | `withReadCommon({ session: placeSessionSchema })` | - | user, agent, machine |
   | `placeSessionList` | `defineRead` | `sessions/list`, `ListSessions` | `z.strictObject({ agent: agentIdSchema, place: placeSchema.nullable(), archived: z.enum(SESSION_ARCHIVED_CHOICES).optional(), cursor: readCursorSchema.optional() })` | `withReadCommon({ sessions: z.array(placeSessionSchema) })` | - | user, agent, machine |
   | `placeSessionCompactRequests` | `defineRead` | `sessions/compact-requests`, `ListSessionCompactRequests` | `z.strictObject({})` | `withReadCommon({ requests: z.array(z.object({ session: idSchema("ses"), agent: agentIdSchema, place: placeOutputSchema.nullable(), request_seq: seqSchema })) })` | - | machine |

   - `export const PLACE_SESSION_ROUTES = [placeSessionOpen, placeSessionRead, placeSessionList, placeSessionCompactRequests] as const`.
   - 옛 `sessionCompactRequests`는 `sessions.ts`의 `SESSION_COMMANDS` 안에 있다. 이 task는 `sessions.ts`를 고치지 않는다. registry에서 바꾸는 것은 lead 몫이다.
2. **`calls.ts`의 주소와 call**: README "call의 `to`는 `{session}`이나 `{agent, place?}`(+ `fallback`)다"를 따른다.
   - import: `./places.ts`에서 `agentAddressSchema`, `agentAtPlaceOutputSchema`, `agentIdSchema`를 더한다.
   - `export const callAddressInputSchema = z.union([z.strictObject({ session: idSchema("ses") }), agentAddressSchema, agentAddressSchema.extend({ session: idSchema("ses"), fallback: z.literal("new") })])`, `type CallAddressInput`.
     - 옛 `callToInputSchema`와 같은 세 갈래다. 갈래마다 strict라 칸으로 갈린다.
   - `export const callTargetSchema = z.discriminatedUnion("kind", [...])`, `type CallTarget`.
     - 갈래 셋은 `z.object({ kind: "new_session", agent: agentAtPlaceOutputSchema })`, `z.object({ kind: "open_session", session })`, `z.object({ kind: "open_session_or_new", session, agent: agentAtPlaceOutputSchema })`다.
     - 저장된 JSON(`agent_calls."to"`)을 읽는 꼴이라 옛 `callToSchema`처럼 `z.object`다.
   - `export const agentCallEnvelopeSchema`, `type AgentCallEnvelope`: 옛 `callEnvelopeSchema`에서 두 가지를 바꾼다.
     - `to: callTargetSchema`로 바꾸고 `options` 칸과 `launchesCoding` refine을 뺀다.
     - `dedup`은 agent가 보낸 call에만 있다는 refine은 남긴다. `from`은 옛 `callFromOutputSchema`를 그대로 쓴다. 그 안의 `coding_agent`는 wave 4가 지운다.
   - `export const agentCallRowSchema`, `type AgentCallRow`: 옛 `agentCallRecordSchema`에서 `to: callTargetSchema`로 바꾼다.
     - `receiver_session` 주석은 "배달이 실패하면 null"로 쓴다. 옛 주석의 줄에 선 맡기기는 새 꼴에 없다.
     - `fail_reason` refine은 남긴다.
   - 아래 route를 더한다. 표에 없는 칸(resource, method, name, compare, errors)은 옛 route와 같다.

   | 상수 | 옛 것 | 다른 것 |
   |---|---|---|
   | `agentCallSend` | `callSend` | input은 `z.strictObject({ to: callAddressInputSchema, reply: callReplySchema, body: z.string().min(1), refs: z.array(callRefSchema), dedup: z.string().min(1), unattended: z.literal(true).optional() })`. `options`가 없다 |
   | `agentCallSendable` | `callSendable` | output은 `withReadCommon({ sessions: z.array(z.object({ session, agent: agentIdSchema, name: z.string(), place: placeOutputSchema.nullable(), state: z.enum(SENDABLE_SESSION_STATES) })) })`. `role`·`queued_coding`이 없다. `name`은 agent 이름이다 |
   | `agentCallRead` | `callRead` | output은 `withReadCommon({ call: agentCallRowSchema })` |

   - `export const AGENT_CALL_ROUTES = [agentCallSend, callReply, callCancel, agentCallSendable, agentCallRead] as const`. `callReply`·`callCancel`은 그대로 쓴다.
   - input schema는 따로 export하지 않는다(정한 것: 쓰는 쪽은 `agentCallSend.input`으로 닿는다. 지금 `call` tool이 `callSendInputSchema.omit(...)`을 하듯 `router-core`는 `agentCallSend.input.omit(...)`을 쓴다).
3. **`apps/annotation.ts`**: README "앱 화면 annotation은 앱 title bar agent select가 고른 agent의, 그 앱 place session으로 간다", "뼈대 검토"의 annotation 받는 쪽을 따른다.
   - import: `../lophn-agent/places.ts`에서 `agentIdSchema`. 이 file은 `places.ts`와 순환이 없다. `places.ts`는 `base/ids.ts`만 import한다.
   - `annotationSendInputSchema`의 strictObject에 `agent: agentIdSchema.optional()`을 더한다.
   - refine을 하나 더한다: `(value) => value.target.kind === "app" || value.agent === undefined`. message는 `"only app annotations choose an agent"`다.
   - 그 위 주석(140~144줄)을 새 받는 쪽으로 고친다.
     - app: `agent`(없으면 lophn)의 그 앱 place session이다. `session`이 null이면 새로 연다.
     - artifact: 그 artifact를 마지막으로 쓴 열린 session이다. 없으면 domain 주인 그릇 place의 lophn session이다.
     - file: 그 project place의 lophn session이다.
     - 실제로 보내는 것은 `router-core`가 바꾼다.
   - `annotationsGet`의 actors(`coding_agent`)는 그대로 둔다. wave 4가 지운다.
4. "제자리에서 바꿀 꼴의 목표"(event·snapshot, run, job, workflow, flow wire)는 위 계약에 적힌 대로 둔다. 코드는 고치지 않는다.
5. 바꾼 주석과 새 이름을 `grep -rn`으로 본다. 소유 밖 file이 type check에서 깨지면 고치지 말고 보고한다. 조사한 바로는 칸을 더하기만 해서 깨지는 곳이 없다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 꼴만 더하고 판정 규칙을 만들지 않는다. zod가 보장하는 꼴은 test하지 않는다(`write-test`).
- 새 이름이 있다:
  - `grep -cE "^export (const|type) (placeSessionSchema|PlaceSession|placeSessionOpen|placeSessionRead|placeSessionList|placeSessionCompactRequests|PLACE_SESSION_ROUTES)\b" packages/protocol/lophn-agent/agent-sessions.ts`가 7이다.
  - `grep -cE "^export (const|type) (callAddressInputSchema|CallAddressInput|callTargetSchema|CallTarget|agentCallEnvelopeSchema|AgentCallEnvelope|agentCallRowSchema|AgentCallRow|agentCallSend|agentCallSendable|agentCallRead|AGENT_CALL_ROUTES)\b" packages/protocol/lophn-agent/calls.ts`가 12다.
  - `grep -c "agentIdSchema" packages/protocol/apps/annotation.ts`가 2다(import와 칸).
- 새 묶음에 coding 갈래가 없다:
  - `sed -n '/^export const placeSessionSchema/,$p' packages/protocol/lophn-agent/agent-sessions.ts | grep -c "coding_agent"`가 0이다.
  - `sed -n '/^export const callAddressInputSchema/,$p' packages/protocol/lophn-agent/calls.ts | grep -cE "coding|options"`가 0이다.
- 옛 이름이 그대로다:
  - `grep -cE "^export const (openAgentSession|agentSessionRead|agentSessionList|AGENT_SESSION_ROUTES)\b" packages/protocol/lophn-agent/agent-sessions.ts`가 4다.
  - `grep -cE "^export (const|type) (callAgentSchema|CallAgent|namedAgentSchema|NamedAgent|CallToInput|callToSchema|CallTo|CallEnvelope|AgentCallRecord|callSend|callSendable|callRead|CALL_ROUTES)\b" packages/protocol/lophn-agent/calls.ts`가 13이다.
  - `git diff --stat plan/remove-role...HEAD -- packages/protocol/registry.ts packages/protocol/lophn-agent/registry.ts packages/protocol/lophn-agent/mod.ts packages/protocol/lophn-agent/sessions.ts`가 비었다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
