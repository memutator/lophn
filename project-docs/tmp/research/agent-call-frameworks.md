# Agent call: 다른 framework는 어떻게 일을 넘기나

조사일 2026-10-14. 소스는 `--depth 1` clone이고 commit을 아래에 적는다. 인용은 `파일:줄@commit`.
Claude Code는 소스가 없어 공식 문서 URL만 인용한다. 문서에 없는 것은 "확인 못 함"이라 쓴다.

| 대상 | commit / URL |
|---|---|
| OpenAI Agents SDK | `openai-agents-python@1c1a28d` |
| LangGraph | `langgraph@ccb851e`, `langgraph-supervisor-py@88859b3`, `langgraph-swarm-py@5442a15` |
| AutoGen | `autogen@027ecf0` (README:21 에 maintenance mode라고 적혀 있다) |
| CrewAI | `crewAI@eb15c66` (경로는 `lib/crewai/src/crewai/` 기준) |
| Hermes Agent | `hermes@1f6c02c0` (docs는 `website/docs/user-guide/features/`) |
| Claude Code | code.claude.com/docs/en/{sub-agents, agent-teams, cross-session-messaging, tools-reference} |

---

## 1. OpenAI Agents SDK

두 가지 방식이 있고 둘 다 한 run 안의 호출이다.

**handoff** (제어권 이전)
- 표현: model이 `transfer_to_<agent>` tool을 부른다 (`src/agents/handoffs/__init__.py:216`).
- 새 vs 기존 receiver: 같은 run 안에서 active `Agent`를 갈아 끼운다. 새 session을 만드는 개념이 없다.
- reply: 없다. receiver가 대화를 이어받는다 ("the specialist becomes the active agent", `docs/multi_agent.md:27,29`). 돌려받는 일이 없다.
- sender blocking: 같은 turn 안에서 agent만 바뀐다. tool result는 `{"assistant": name}` 한 줄이다 (`handoffs/__init__.py:210`).
- context: 기본은 전체 history. `input_filter`로 걸러내거나 (`handoffs/__init__.py:158`), `nest_handoff_history`를 켜면 이전 transcript를 `<CONVERSATION HISTORY>` 요약 한 덩이로 접는다 (`handoffs/history.py:29`, 기본 꺼짐 `run_config.py:385`).
- receiver 선택: sender model이 고른다. 후보는 `Agent.handoffs`에 선언된 목록이다.
- correlation id: tool call id 하나. 별도 call id는 없다.
- 동시에 여러 개: 첫 번째만 실행하고 나머지에는 "Multiple handoffs detected, ignoring this one."을 돌려준다 (`run_internal/turn_resolution.py:582`).
- 권한: `is_enabled`는 후보를 model에 보여줄지 정한다. 인자 값에 따른 권한 검사는 `on_handoff` 안에서 하고, 실패하면 raise하라고 문서에 있다 (`docs/handoffs.md:93`).
- 사람이 보는 것: tracing의 `handoff_span(from_agent, to_agent)` (`turn_resolution.py:594`).

**agents-as-tools** (`Agent.as_tool`, `src/agents/agent.py:606`)
- 표현: 일반 function tool이다. receiver는 "생성된 입력"만 받고, 원래 agent가 대화를 계속한다 (docstring `agent.py:632-636`).
- reply: one result (tool output). `custom_output_extractor`로 무엇을 돌려줄지 고른다.
- sender blocking: 한다. tool call이 nested run이 끝날 때까지 기다린다. subagent 모양이다.
- 실패: `failure_error_function`이 있으면 오류 문자열을 model에 돌려주고, None이면 예외를 올린다 (`agent.py:661`).
- 사람 승인: `needs_approval`로 이 tool 호출 전에 멈출 수 있다 (`agent.py:623`).
- cancellation: 확인 못 함 (조사하지 않음).

요점: handoff는 "이 대화를 누가 이어 가나"를 바꾸는 것이다. "작업을 맡기고 결과를 받는" 것은 as_tool이며 blocking이다. 비동기 call은 없다.

---

## 2. LangGraph (+ supervisor, swarm)

- 표현: handoff tool이 `Command(goto=agent_name, graph=Command.PARENT, update={...})`를 돌려준다 (`langgraph-supervisor-py/langgraph_supervisor/handoff.py:121-125`; `Command`는 `langgraph/libs/langgraph/langgraph/types.py:833`, `PARENT`는 `:882`). 병렬 handoff는 `Send(node, arg)` (`types.py:738`; supervisor `handoff.py:111`).
- receiver 선택: sender model이 `transfer_to_<name>` tool을 고른다. receiver는 graph의 node 이름이라 정적으로 선언된 것뿐이다.
- 새 vs 기존: 새 session 개념이 없다. node는 항상 있다. 상태는 checkpointer의 `thread_id`에 붙는다 (swarm `swarm.py:124,138`).

**supervisor** (`langgraph_supervisor/supervisor.py`)
- worker는 supervisor graph의 node이고, `agent.invoke(state)`를 동기로 부른다 (`supervisor.py:103`). worker가 끝나면 supervisor로 돌아온다. sender는 blocking이다.
- 무엇이 돌아오나: `output_mode`가 `"last_message"`(기본) 또는 `"full_history"` (`supervisor.py:37,225`).
- 돌아올 때 `transfer_back_to_<supervisor>` 쌍(AIMessage+ToolMessage)을 기록에 붙인다 (`handoff.py:132`).
- `forward_message` tool로 worker의 말을 supervisor가 다시 쓰지 않고 그대로 전달할 수 있다. 정보 손실을 줄이려는 장치다 (`handoff.py:155`).

**swarm** (`langgraph_swarm`)
- active agent가 state의 `active_agent` 필드에 저장된다 (`swarm.py:19`, 쓰는 곳 `handoff.py:91`).
- 다음 입력은 `START`의 conditional edge가 `active_agent`를 읽어 그 agent로 보낸다 (`swarm.py:163-166`). 사람이 다시 말을 걸면 마지막 active agent가 받는다.
- 즉 "열려 있는 대화의 receiver가 누구인가"를 state 한 칸으로 추적한다.

reply: supervisor는 one result(동기), swarm은 reply 없이 제어권만 넘긴다 (conversation은 사람과 active agent 사이).
correlation: `tool_call_id`(`InjectedToolCallId`). 별도 call id는 없다.
실패: 알 수 없는 agent 이름은 graph compile 단계에서 걸린다. 런타임에 "없는 receiver"가 생길 일이 거의 없다.
권한/사람: agent 간 권한 전달은 없다. `interrupt()`와 `Command(resume=...)`로 사람 입력을 기다린다 (`types.py:900`).

---

## 3. AutoGen (core runtime + AgentChat)

가장 관련이 큰 구분이 core runtime에 있다 (`autogen/python/packages/autogen-core/src/autogen_core/_agent_runtime.py`).

| | `send_message` (`:22`) | `publish_message` (`:50`) |
|---|---|---|
| 주소 | `recipient: AgentId` (type + key) | `topic_id: TopicId` |
| reply | 있다. "send a message to an agent and get a response" | 없다. "No responses are expected from publishing." (`:61`) |
| 받는 쪽 | 한 agent | topic을 구독한 모든 agent |
| id | `message_id` (생략하면 uuid4, `_single_threaded_agent_runtime.py:344`) | 같은 방식 |
| 취소 | `cancellation_token`을 future에 연결 (`:383`) | token 받음 |
| 받는 쪽이 구분하는 법 | `MessageContext.is_rpc` (`_message_context.py:12`) | `topic_id`가 채워진다 |

- sender blocking: `send_message`는 `return await future` (`_single_threaded_agent_runtime.py:385`). 호출한 handler가 응답을 기다린다. `publish_message`는 queue에 넣고 바로 돌아온다 (`:387-`).
- 실패: 모르는 recipient type이면 `Exception("Recipient not found")` (`:365`), 처리 시점에도 `LookupError("Agent type ... does not exist.")` (`:471`). docstring에 `CantHandleException`, `UndeliverableException`이 명시된다 (`_agent_runtime.py:40`). queue에서 버려지면 `MessageDroppedException` (`:720`).
- 새 vs 기존: agent는 factory로 type에 등록되고, (type, key)마다 instance가 lazy하게 생긴다. 같은 type의 다른 key가 새 instance다.
- 권한: runtime 수준 권한 모델은 확인 못 함. 구독 선언이 사실상 allowlist다.

**AgentChat 계층** (`autogen-agentchat/src/autogen_agentchat/`)
- `HandoffMessage(target, context)` (`messages.py:421`). `context`는 receiver에 넘기는 `LLMMessage` 목록이라 "무엇을 넘기나"를 sender 쪽이 정한다.
- `Handoff` 설정은 tool 이름 `transfer_to_<target>`과 기본 메시지를 만든다 (`base/_handoff.py:12-48`).
- `AssistantAgent`는 handoff tool call이 여러 개면 "Only the first is executed" (`agents/_assistant_agent.py:1357`).
- Swarm: 마지막 `HandoffMessage.target`이 다음 speaker다. `_current_speaker`를 state로 저장/복원한다 (`teams/_group_chat/_swarm_group_chat.py:84-116`). target이 참가자가 아니면 assert로 실패한다 (`:96`).
- SelectorGroupChat: model(또는 selector 함수)이 thread를 보고 다음 speaker를 고른다 (`_selector_group_chat.py:152`). 모든 참가자가 모든 메시지를 본다.
- `AgentTool` / `TeamTool` (`tools/_agent.py:20`): agent를 tool로 감싼다. blocking, 결과는 `TaskResult`.
- 사람: `UserProxyAgent`나 `HandoffTermination`(target을 "user"로)로 실행을 멈추고 사람이 새 입력을 준다.

요점: AutoGen core는 "답을 기다리는 call(send)"과 "답을 안 기다리는 알림(publish)"을 API 수준에서 나눈다. 다만 `send_message`는 호출한 쪽이 await하므로 sender가 blocking이다.

---

## 4. CrewAI

- 표현: 두 tool. `"Delegate work to coworker"` (인자 `task`, `context`, `coworker`; `tools/agent_tools/delegate_work_tool.py:19`)와 `"Ask question to coworker"` (인자 `question`, `context`, `coworker`; `ask_question_tool.py:17`).
- receiver 선택: sender model이 `coworker`에 역할 이름을 문자열로 쓴다. 공백/대소문자/따옴표를 정리해서 `role`과 맞춘다 (`base_agent_tools.py:46` `_execute`).
- 새 vs 기존: 항상 같은 crew의 이미 있는 Agent다. 매번 새 `Task`를 만들고 `execute_task(task, context)`를 부른다 (`:120`). receiver와 이어지는 대화는 없고 호출마다 독립이다.
- reply: one result, 문자열. conversation 모드는 없다.
- sender blocking: 한다. `_run`이 동기 함수이고 결과 문자열이 tool result가 된다.
- context: sender가 쓴 `context` 문자열 하나만 간다. 전체 history는 안 간다.
- 실패: 없는 coworker면 예외가 아니라 오류 문자열을 tool result로 돌려준다. 가능한 coworker 목록을 같이 적어 model이 고치게 한다 (`:89`, `translations/en.json:48`). 실행 중 예외도 문자열 `agent_tool_execution_error`로 바꾼다.
- 권한: `allow_delegation` bool 하나 (`agents/agent_builder/base_agent.py:279`, 기본 False). 켜진 agent에게만 위 두 tool을 붙인다 (`crew.py:1658` `_prepare_tools`). 누구에게 위임할 수 있는지는 crew의 agents 전체라 세분화가 없다.
- hierarchical process: `manager_llm` 또는 `manager_agent`가 필요하고 (`crew.py:725`), manager에게 `AgentTools`와 `allow_delegation=True`를 준다 (`crew.py:1531-1551`). manager가 일을 쪼개 worker에게 위임하고 결과를 합친다.
- `Task.async_execution` (`task.py:171`)은 crew 안 task 배치를 비동기로 돌리는 것이고 agent 간 call이 아니다.
- cancellation, correlation id: 확인 못 함 (코드에서 찾지 못했다).

---

## 5. Hermes Agent

두 가지가 있고 모양이 정반대다.

### 5-1. `delegate_task` (async delegation)

- 표현: `delegate_task(goal, context)` 또는 `tasks=[...]` (`delegation.md:34-53`).
- 새 receiver만 있다. 매번 fresh child agent이고 "Subagents Know Nothing" (`delegation.md:82`). 기존 session에 보내는 길은 없다.
- context: `goal`과 `context` 문자열만. 전체 history는 안 간다. 예외는 workspace의 project context file(`AGENTS.md` 등)과 선택적 `images` (`delegation.md:88,107`).
- sender blocking: top-level은 background가 기본이다. "Hermes returns a handle immediately so the conversation can continue, then posts the result back as a new message." (`delegation.md:11`). `dispatch_async_delegation` (`tools/async_delegation.py:837`)이 daemon executor에 올리고 handle을 즉시 돌려준다 (`async_delegation.py:2-9`).
- 결과 도착: 완료 시 `type="async_delegation"` event를 `completion_queue`에 넣고, "results surface as a NEW turn (never mid-turn)" (`async_delegation.py:5-6`). reply가 새 입력으로 돌아오는 모양이라 lophn이 원하는 것과 같다.
- 단 orchestrator child는 자기 worker를 같은 turn에서 기다린다 (`delegation.md:11`). 이 경로는 blocking이다.
- correlation id: `delegation_id`. batch이면 `-1`, `-2` 접미 unit id (`delegation.md:209`). 실행 중 child는 `subagent_id`로 `list` / `steer` / `stop` 한다 (`delegation.md:482-497`).
- state: `running`, `stalling`, `finalizing` 등 (`async_delegation.py:84`). 완료 status는 `completed`, `failed`, `interrupted`, `unknown`(process 재시작 시, `delegation.md:561`).
- 내구성: 완료 event를 `state.db`에 먼저 쓰고 queue에 넣는다. 전달은 durable claim으로 한 consumer만 확정한다 (`delegation.md:219-232`, `async_delegation.py:438`). 전달 시도 상한 8 (`:46`). 재시작해도 child 실행은 이어지지 않는다 (`delegation.md:561`).
- cancellation: 소유 session의 `/stop`이나 close가 child를 끈다. 끊긴 child도 `status="interrupted"` 완료로 돌아온다 (`delegation.md:215,559-565`). 후속 메시지는 취소하지 않는다.
- 진행 중 조정: `steer`는 child의 다음 iteration boundary에 tool result 뒤에 붙는 out-of-band user message다. 못 닿으면 `missed_steer`로 되돌려준다 (`delegation.md:498-514`).
- 실패: child 실패는 조용하지 않고 `status: "failed"` + `error`로 parent tool result에 들어가고 CLI/gateway에도 한 줄 표시된다 (`delegation.md:383-391`). stall 감시가 있다 (`async_delegation.py:76-79,1011-1099`, idle 450초 / tool 중 1200초).
- 권한: child는 parent의 toolset을 그대로 상속하고 model이 넓힐 수 없다. leaf child는 `delegate_task`, `clarify`, `memory`, `send_message`, `cronjob`이 막힌다 (`delegation.md:329-340`). 깊이는 `max_spawn_depth`(기본 1)로 제한한다.
- 동시 수: async 기본 3 (`async_delegation.py:40`), batch 기본 최대 10.
- 사람: CLI tree, `/agents`, live transcript, gateway 알림 (`delegation.md:433,516`).

### 5-2. Kanban (`kanban.md`, `kanban-worker-lanes.md`)

문서가 스스로 구분한다: "`delegate_task` is a function call; Kanban is a work queue where every handoff is a row any profile (or human) can see and edit." (`kanban.md:97-110`)

- 표현: task 한 줄. `kanban_create(title, assignee, body, parents=[...])` (`kanban.md:457-514` 표, `:738-766` 예시).
- receiver 선택: `assignee`가 profile 이름이다. 이름이 풀리지 않으면 `ready`에 남고 `skipped_nonspawnable` event를 남긴다. 조용히 버리지도, 아무 agent로 대신 실행하지도 않는다 (`kanban-worker-lanes.md:29`). 오케스트레이터 prompt가 먼저 존재하는 profile을 조회하라고 안내한다 (`kanban.md:740`).
- 새 vs 기존: dispatcher가 task 하나마다 worker를 `hermes -p <assignee> chat -q ...`로 새로 띄운다. 같은 profile은 persistent memory를 가진다. 같은 task를 retry/review하면 새 run(attempt) row가 생긴다 (`kanban.md:1342`).
- reply: sender는 `create` 후 fire-and-forget (`kanban.md:101`). 결과는 `kanban_complete(summary, metadata)`가 run row에 남기고, 자식 task가 부모의 마지막 완료 run의 summary+metadata를 읽는다 (`kanban.md:1354`). 대화는 task의 comment thread이고 문서는 이를 "the inter-agent protocol"이라 부른다 (`kanban.md:133`).
- state: `triage | todo | ready | running | blocked | review | done | archived` (`kanban.md:131`).
- review lane: `kanban_request_review`로 같은 card가 `review`로 가고, reviewer가 `kanban_complete` 또는 `kanban_request_changes`로 닫는다. 후자는 원래 implementer에게 돌려보낸다 (`kanban.md:466-467`).
- block: `kanban_block(kind=dependency | needs_input | capability | transient)`. 같은 이유로 반복 block되면 `triage`로 올린다 (`kanban.md:468`).
- 완료 통보: gateway가 terminal event(`completed`, `blocked`, `gave_up`, `crashed`, `timed_out`)를 구독한 chat에 보내고, `notify+wake` 모드에서는 받는 agent에게 합성 inbound message를 만들어 새 turn을 돌린다 (`kanban.md:1249-1296`). "A 'wake' forges a synthetic inbound message to the destination gateway agent so it takes a normal turn" (`kanban.md:1291`). 이것도 reply = 새 입력 모양이다.
- correlation: task id(`t_...`), run id, 모든 변화는 `task_events`에 append (`kanban.md:1400`). 멱등 key도 있다 (`kanban.md:391`).
- liveness / cancellation: claim lock, `kanban_heartbeat`, stale 회수, crash 회수. 정상 종료인데 terminal tool을 안 부르면 protocol violation (`kanban.md:561-631`).
- 권한: dispatcher가 띄운 worker는 자기 task에만 파괴적 작업을 할 수 있고, "worker는 fan-out 안 한다 / orchestrator는 구현 안 한다"는 관례를 주입 prompt로 건다 (`kanban.md:513`). `delegate_task` 후손 process는 board에서 차단된다 (`kanban.md:570`).
- 맥락 한계: worker는 sibling card를 못 본다. 그래서 결정은 오케스트레이터가 각 card body에 적어 넣어야 한다 (`kanban.md:763`).
- 사람: 대시보드(drag, comment, unblock), CLI, gateway 알림 (`kanban.md:767`).

---

## 6. Claude Code (공식 문서만)

- **subagent** (`Agent` tool, 예전 이름 `Task`): https://code.claude.com/docs/en/sub-agents
  - foreground는 main conversation을 막는다. background는 병행 실행하고 결과는 completion notification으로 온다.
  - 새 context window. 대화 history를 못 본다. "Claude composes a delegation message that summarizes the task, and the subagent works from there." 예외는 fork로, 전체 대화를 상속한다.
  - 중첩은 기본 3단계까지다. `Agent(worker, researcher)` 식 allowlist로 spawn 가능한 type을 제한한다.
  - 권한: parent의 permission mode와 rule을 상속한다. "no agent message can change a subagent's permission settings".
  - 재개: 끝난 subagent는 `SendMessage`에 agent ID 또는 name을 `to`로 넣어 다시 깨우고, 전체 history가 유지된다.
- **agent teams** (실험): https://code.claude.com/docs/en/agent-teams
  - lead 1명 + teammate들, 각각 별도 Claude Code instance. 이름으로 서로 `SendMessage`.
  - mailbox는 `~/.claude/teams/{team}/inboxes/{agent}.json` 파일이다. "Claude Code reports a message as sent only when the write to the recipient's mailbox file succeeds", 실패하면 sender가 오류를 받는다.
  - 전달은 자동이다. teammate가 끝나면 idle notification에 마지막 답을 담아 lead에게 간다. 오류로 끝나면 오류 문구도 간다.
  - 공유 task list(pending/in progress/completed, 의존, file lock claim)가 있다.
  - 사람은 agent panel에서 teammate를 골라 transcript를 보고 직접 메시지를 보내거나 `x`로 멈춘다. 종료는 shutdown request를 보내고 teammate가 승인/거절한다.
  - 권한: teammate는 lead의 permission mode로 시작한다. 한계: 중첩 team 없음, lead 고정, resume 시 in-process teammate 복원 안 됨.
  - 메시지로 온 승인 주장은 신뢰하지 않는다. auto mode에서는 classifier가 전달 전에 메시지를 검사한다.
- **cross-session messaging**: https://code.claude.com/docs/en/cross-session-messaging (lophn과 가장 가깝다)
  - `ListAgents`로 대상을 찾고 `SendMessage`로 보낸다. 같은 machine이면 session별 Unix socket으로 간다.
  - 전달: "The receiving Claude reads the message between tool calls during an active turn... When the receiving session is idle, Claude Code starts a new turn with the message." sender는 기다리지 않는다.
  - 메시지는 plain text뿐이다. history나 파일은 안 간다. receiver는 sender 이름과 reply address를 받는다.
  - 수신 정책 `crossSessionInbound`: accept / hold(사람 승인) / refuse. 기본값은 두 session의 permission mode 등급으로 정한다.
  - sender 쪽 거절: 크기 상한(약 100만 자), 짧은 시간 폭주, 수신 불가 session은 sender 쪽에서 `Not sent`로 막는다. hold된 메시지는 5분 지나면 만료되고 닿을 수 있으면 sender에 expired로 알린다.
  - 반복 방지: receiver 쪽 sender별 rate limit, 같은 내용 중복 drop, 최대 50개 queue. "A message loop between two sessions therefore stops on its own."
  - 권한 경계: 받은 메시지는 승인으로 안 친다. 설정/CLAUDE.md를 바꿀 수 없다. 메시지 안 slash command는 실행되지 않는다. receiver의 permission prompt는 그대로 뜬다.
  - `notify_when_idle`: "다음에 idle이 되면 알려줘"를 구독한다. 12시간 안에 안 오면 구독을 버리고 Claude에게 알린다.
  - 사람: 대화에 `› Message from @api-worker: ...` 한 줄 preview가 남고 Ctrl+O로 전문을 본다.
- 확인 못 함: 메시지 간 correlation id(문서에 call id가 나오지 않는다). `TaskStop`은 background task, teammate, 이름 붙은 background agent를 ID/이름으로 멈춘다 (tools-reference의 `TaskStop` 행).

---

## 비교표

범례: block = sender가 그 turn에서 기다리나.

| | 표현 | 새 / 기존 receiver | reply | block | context | receiver 선택 | correlation | 없는 receiver |
|---|---|---|---|---|---|---|---|---|
| OpenAI handoff | `transfer_to_X` tool | 같은 run의 agent 교체 | 없음(제어권 이전) | turn 안에서 교체 | 전체 history, filter / 요약 가능 | model, 선언된 목록 | tool call id | 선언 밖은 호출 불가 |
| OpenAI as_tool | function tool | 호출마다 nested run | one result | 한다 | 생성한 입력만 | model | tool call id | tool 오류를 model에 돌림 |
| LangGraph supervisor | handoff tool, nested invoke | node(고정) | one result(동기) | 한다 | state, 반환은 last_message / full_history | model | tool_call_id | compile 때 걸림 |
| LangGraph swarm | `Command(goto, update)` | node + `active_agent` state | 없음(제어권 이전) | 같은 turn 교체 | state 전체 | model | tool_call_id | compile 때 걸림 |
| AutoGen `send_message` | `AgentId` 직접 | (type, key) instance lazy 생성 | one result | await (한다) | message 객체 | 호출자가 지정 | `message_id`, `is_rpc` | `Recipient not found` / `LookupError` |
| AutoGen `publish_message` | `TopicId` | 구독자 | 없음 | 안 한다 | message 객체 | 구독 선언 | `message_id` | 구독자 없으면 아무에게도 안 감 |
| AutoGen Swarm / Selector | `HandoffMessage` / selector | 참가자(고정) | 대화 | team 안에서 순차 | thread 전체, handoff는 `context` 지정 | handoff target / selector model | 메시지 순서 | assert |
| CrewAI delegate / ask | 두 tool | crew 안 기존 agent, 호출마다 새 Task | one result 문자열 | 한다 | `context` 문자열 | model이 역할 문자열 | 없음 | 오류 문자열 + 후보 목록 |
| Hermes `delegate_task` | tool | 항상 새 child | one result | 안 한다 (새 turn으로 돌아옴) | goal + context | parent가 spawn | `delegation_id`, `subagent_id` | child 실패는 `failed` 완료 |
| Hermes Kanban | task row | task마다 새 worker run, 같은 profile | one result + comment thread | 안 한다 | card body + parent 요약 | `assignee` profile | task id, run id, event | `skipped_nonspawnable` |
| Claude subagent | `Agent` tool | 새 instance (resume 가능) | one result | foreground 한다 / background 안 한다 | delegation message | model | agent ID | 확인 못 함 |
| Claude teams | `SendMessage` + task list | 이름 붙은 기존 teammate | 대화 | 안 한다 | 메시지 text | 이름 | 확인 못 함 | mailbox 쓰기 실패 시 오류 |
| Claude cross-session | `SendMessage` | 이미 열린 다른 session | 대화 (reply address) | 안 한다 | plain text만 | 이름 / @mention | reply address | `Not sent` + 이유 |

---

## lophn에 비춰 본 점

- **응답 기대 여부를 API로 나눈 선례는 AutoGen뿐이다.** `send_message`(응답 기대)와 `publish_message`(응답 없음)다. lophn의 reply mode 중 none과 one result가 여기에 대응한다. 다만 AutoGen `send_message`는 호출자가 await하므로 lophn은 이 부분을 복사하지 않는다. one result도 응답이 새 input으로 돌아오게 해야 한다.
- **"sender가 안 막히고 reply는 새 turn의 입력"은 Hermes 두 곳과 Claude cross-session messaging에 이미 있다.** Hermes는 완료 event를 `completion_queue`에 넣어 "새 turn, mid-turn 아님"으로 전달하고 (`async_delegation.py:5-6`), Claude는 "turn 중이면 tool call 사이에, idle이면 새 turn으로" 넣는다. lophn Router의 "session에 input을 넣는다"와 같은 모양이다. 배달 보장(claim, 시도 횟수 상한, 재시작 시 복구)은 Hermes 쪽을 참고할 만하다.
- **new session vs existing session은 framework마다 한쪽만 있는 경우가 많다.** 새 receiver만: Hermes `delegate_task`, CrewAI(매번 새 Task), OpenAI as_tool. 기존 receiver만: LangGraph/AutoGen의 고정 node, Claude teams, cross-session. 둘 다 가진 것은 Hermes Kanban(profile 이름으로 새 run을 띄움)과 Claude(subagent resume)다. lophn은 이 축을 envelope의 필드로 따로 두는 것이 맞다: "role의 새 session" 또는 "열린 session id".
- **열린 대화의 receiver 추적은 state 한 칸으로 충분하다.** LangGraph swarm의 `active_agent`, AutoGen Swarm의 `_current_speaker`가 그 예다. conversation이 "지금 어느 session을 가리키나"를 call 쪽 state에 두고, 사람이 입력을 어디로 보내는지와 섞지 않는 것이 좋다.
- **conversation(주고받다 한쪽이 닫음)은 handoff와 다르다.** OpenAI/LangGraph/AutoGen의 handoff는 제어권 이전이라 sender가 대화에서 빠진다. Claude agent teams와 cross-session은 양쪽이 계속 살아 있고 reply address로 서로 보낸다. lophn conversation은 후자이므로 `reply_to`와 "닫는 쪽" state가 필요하고, 닫힌 conversation으로 오는 메시지를 어떻게 할지 정해야 한다. Hermes `steer`의 `missed_steer`처럼 "닫힌 뒤 도착"을 조용히 버리지 않고 알리는 방식이 선례다.
- **correlation은 대부분 약하다.** OpenAI/LangGraph는 tool call id뿐이고 CrewAI는 없다. 강한 쪽은 Hermes(`delegation_id`, task id, run id, append-only event)와 AutoGen(`message_id`)이다. lophn은 call id를 1급 필드로 두고 `reply_to`가 call을 가리키게 하며 상태 변화를 event로 남기는 쪽이 Hermes에 가깝다.
- **없는 receiver / 허용 안 된 receiver는 "조용히 실패하지 않기"가 공통 교훈이다.** CrewAI는 후보 목록이 든 오류 문자열을 돌려주고, Hermes는 `skipped_nonspawnable` event를 남기고, Claude는 sender 쪽에서 `Not sent` + 이유를 돌려주고, AutoGen은 예외를 던진다. lophn은 failure를 reply와 같은 경로(sender의 새 input)로 돌려주되, 이유를 구분(없음 / 허용 안 됨 / 닫힘)하는 것이 좋다.
- **권한은 "메시지는 승인이 아니다"를 지킨다.** Claude는 받은 메시지를 사람의 승인으로 치지 않고, receiver의 permission prompt를 그대로 두고, 거부된 작업을 다른 agent에게 우회시키지 못하게 한다 (cross-session messaging, agent-teams Permissions). Hermes는 child에 parent보다 넓은 toolset을 주지 못하게 하고 `send_message` 등을 막는다. lophn도 call로 권한이 넓어지면 안 되고, 허용 목록(누가 누구를 부를 수 있나)을 Router가 검사하는 쪽이 CrewAI의 `allow_delegation` bool보다 낫다.
- **복사하지 말 것.**
  - blocking nested run: OpenAI as_tool, LangGraph supervisor의 `agent.invoke`, CrewAI `execute_task`, AutoGen `send_message`의 await, Claude foreground subagent. 우리가 쓰지 않기로 한 subagent 모양이다.
  - model이 receiver를 자유 문자열로 쓰고 fuzzy 매칭하는 방식 (CrewAI `sanitize_agent_name`). 이름은 정확히 해석하고 안 맞으면 실패시킨다.
  - 병렬 handoff 중 첫 번째만 실행하고 나머지는 무시하는 규칙 (OpenAI, AutoGen). call이 여럿이면 각각 독립 call로 둔다.
  - 전체 history를 receiver에 넘기는 기본값 (OpenAI handoff). Claude cross-session처럼 envelope의 `content`와 `references`만 넘기고 history는 보내지 않는다. 대가는 Hermes Kanban이 보여 준다: worker가 sibling을 못 보므로 결정을 body에 모두 적어 넣어야 한다.
  - Hermes의 durable queue, stall 감시, orphan 회수, 7일 보관을 한꺼번에 만드는 것. MVP는 call 상태와 완료 배달만 먼저 정하고 나머지는 나중에 한다.
  - Claude agent teams의 JSON mailbox 파일과 file lock. lophn에는 Router라는 단일 입구가 있으므로 따로 필요 없다.
