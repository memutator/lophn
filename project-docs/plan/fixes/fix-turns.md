# fix-turns

wave 3 중 계약 바꾸기 요청(router-run-loop-turn, screens-conversation-core-source 보고). turn이 실제로 돌려면 agent credential, 감독 pipe의 입력함·event 메시지, model·tool call 기록, agent 답 기록이 turn·session 모양이어야 한다. 지금은 `run_`·`asg_`를 요구하거나 막혀 있어 새 turn이 시작되지 않는다. 여러 단위의 계약 file에 걸쳐 lead가 fix로 돌린다.

- 단위: router (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - `packages/protocol/server/identity.ts`의 agent credential 조건
  - `packages/protocol/supervision/supervision.ts`의 agent credential 메시지와 새 입력함·event 메시지
  - `packages/protocol/lophn-agent/{model-calls,tool-calls,messages}.ts`와 instruction 읽기 route의 `run` 칸
  - `packages/core/server/identity/registry.ts`의 agent 분기(이 분기만. coding 쪽은 events-identity 몫)
  - `packages/core/lophn-agent/run-loop/` (`credentials.ts`, `agent-credentials.ts`, `core-ports.ts`, `work.ts`, `driver.ts`, `ports.ts` 등)
  - `packages/core/main/agent-runtime/` (`main.ts`, `credential-link.ts`, pipe 쪽)
  - `packages/core/lophn-agent/session/message-commands.ts`의 `record` handler
  - model call·tool call 기록 handler(`core/lophn-agent/models/`, `core/lophn-agent/tools/`의 기록 줄만)
  - 이름과 칸을 바꾼 것을 쓰는 줄(core, shell, renderer, tools 어디든. 그 줄만)
- 읽을 것:
  - spec: `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md` 3장(Run-loop 줄: agent event는 Bus, 대화 기록은 session 기록), `place-session.md`, `agent-definition.md` 6장(Router 입력), `approval.md`(agent principal)
  - router-run-loop-turn이 남긴 것: `core/lophn-agent/run-loop/{ports,work,driver,core-ports,credentials,agent-credentials,unwired}.ts`의 주석
  - 공통 규칙: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
  - `/home/pyosechang/projects/lophn/project-docs/tmp/docs-review.md` 끝 "오케스트레이터 기록"의 wave 3 절
- 계약: 아래 할 일이 정하는 모양을 내놓는다.

## 할 일

1. **agent credential은 session·turn으로.** `protocol/server/identity.ts`의 `conditions.run`·`assignment`, `protocol/supervision`의 `agent_credential_request`(`run`, `assignment`, `scope`)·`agent_credential_end`, `core/server/identity/registry.ts`의 agent 분기가 `run_`·`asg_`와 `scope.agent`(AgentAppScope)를 요구한다. `session`(`ses`)과 `turn`(`trn`)으로 바꾼다. `scope.agent`는 session id로 만들 수 없다. 앱 범위가 credential에 꼭 있어야 하는지 spec으로 보고, 없어도 되면 뺀다(앱 호출 판정은 Gate·grant가 한다). 지금 run-loop가 turn을 `run` 칸에, session을 `assignment` 칸에 담는 한 곳(`credentials.ts`, `agent-credentials.ts`)을 걷는다.
2. **감독 pipe의 입력함·event 메시지.** child → core 요청 `turn_source`(`op`: `next`|`began`|`ended`|`steering`|`settled`, `session`, `count?`)와 응답은 `run-loop/ports.ts`의 `TurnSource` 모양 그대로 둔다. child → core `agent_event`는 `AgentEvent` 하나이고 core가 Bus에 publish한다. core 쪽 handler는 `createTurnSource({ inbox, starter })`(`run-loop/work.ts`)를 부른다. child 쪽 `main/agent-runtime/main.ts`의 `NO_TURN_SOURCE`와 버리는 `events` sink를 pipe 구현으로 바꾼다.
3. **기록 route의 `run` 칸.** `model-calls.ts`, `tool-calls.ts`(기록과 `tool-calls/list`), instruction 읽기, `recordMessage`의 입력 칸 `run: idSchema("run")`을 `turn: idSchema("trn")`으로 바꾼다. `tool-calls/list`는 `turn` 또는 `session`으로 거를 수 있게 한다(사람 화면이 turn별 tool call을 읽는다. 지금 `agent-tab-core-source-thread.ts`는 trace로 돌아간다. 이 줄을 새 입력으로 바꾼다).
4. **agent 답 기록.** `message-commands.ts`의 `record`가 `blocked`라 답이 나오면 `answer()`가 실패하고 turn이 `configuration_unavailable`로 끝난다. agent 답을 session 기록에 남기는 command를 짓는다. 봉투는 받은 message 모양(`from`이 그 session 자신, `turn`)이고, 사람 화면(`agent-tab-core-source-thread.ts`)은 "`from`이 이 session인 agent 메시지가 답"으로 읽는다. 다르게 정하면 그 읽기 줄도 맞춘다. `session_messages` 읽기에 `created_at`이 없으면 더한다(core-source 요청 1).
5. **등록 줄.** `lophn-agent/register.ts`와 daemon wiring은 고치지 않는다. 보고의 "등록할 것"에 적는다(agent-definition-register가 모아 넣는다). 단, 2번의 core 쪽 pipe handler를 거는 곳이 `core/main/` 안의 감독 code라면 그 줄은 고친다.

## 끝남

- `deno task check:full`이 통과한다. `deno run -A tools/check-deps.ts`가 통과한다.
- 위 file의 새 줄에 `run_`·`asg_`·`assignment`(turn·session 뜻)가 남지 않는다. `grep -rn "NO_TURN_SOURCE\|being rebuilt" packages/core/lophn-agent/run-loop packages/core/main/agent-runtime packages/core/lophn-agent/session/message-commands.ts`가 `record` 쪽에서 0줄이다(`apply`·`assign`·fact는 그대로 둔다).
- 위험 test: agent credential은 그 session·turn 밖의 호출을 받지 않는다(1개). pipe와 기록은 test를 더하지 않는다.

## 보고

- 바꾼 file
- 등록할 것: register.ts·wiring에 넣을 줄, 새 route
- 이름을 바꾸며 고친 남의 줄
- 정한 것
- 계약 바꾸기 요청: 없으면 "없음"
