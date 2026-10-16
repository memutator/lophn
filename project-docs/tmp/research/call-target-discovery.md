# call 대상 찾기 조사: 부를 수 있는 agent와 열린 session을 아는 법 (2026-10-15)

R3. 질문: model이 메시지를 보낼 수 있는 상대(다른 agent 종류, 열린 session)를 어떻게 아나. 받는 쪽을 무엇으로 가리키나. 목록이 바뀔 때 prompt cache는 어떻게 하나. 보낼 수 없는 상대는 숨기나 거절하나. 끝난 session에 보내면 어떻게 되나.

## 대상과 근거

| 대상 | 판 | 근거 |
|---|---|---|
| Claude Code | v2.1.299 wire 캡처, v2.1.300 binary 문자열(사람 조사) | `tmp/claude-code-cross-session-messaging.md` 2·3·5장, `tmp/claude-code-prompt-assembly copy.md` 4장(Available agent types)·6장(tools), 공식 문서 2026-10-15 조회: code.claude.com/docs/en/{cross-session-messaging, sub-agents, agent-teams, errors} |
| Codex | `openai/codex` @ `bb64b894` (2026-10-15). 읽기만 함, 실행 안 함 | `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`, `multi_agents_v2/{list_agents,send_message,message_tool}.rs`, `multi_agents/send_input.rs`, `multi_agents_common.rs`, `agent/control.rs`, `agent/control/{api,target}.rs`, `agent/role.rs`, `session/world_state.rs`, `context/world_state/environment.rs` |
| OpenCode | `sst/opencode` @ `bdf47932` (2026-10-15) | `packages/core/src/tool/plugin/subagent.ts`, `packages/core/src/permission.ts` |
| Hermes | 사용자 설치본 `~/.hermes/hermes-agent` @ `decf1921` (2026-10-11). 읽기만 함 | `tools/delegate_tool.py`, `tools/delegate_tool_registry.py`, `tools/send_message_tool.py`, `tools/kanban_tools_schemas.py`, `agent/prompt_builder.py:331` |
| A2A | 기존 조사로 갈음 | `research/agent-call-a2a.md` 8장 |

Codex에는 multi-agent 판이 둘 있다. v1(`spawn_agent`, `send_input`, `wait_agent`, `close_agent`, `resume_agent`)과 v2(`spawn_agent`, `send_message`, `followup_task`, `list_agents`, `wait_agent`, `interrupt_agent`). `list_agents`는 v2에만 있다. v2는 `multi_agent_v2` feature로 켠다(기본 꺼짐, `features/src/lib.rs`).

## 1. Claude Code

### 1.1 목록을 아는 길

길이 셋이고 용도가 다르다.

| 대상 | 길 | 근거 |
|---|---|---|
| Agent tool로 띄울 agent 종류 | tool description에는 "Available agent types are listed in system-reminder messages"라고만 적고 목록은 messages 쪽 system 블록(`# Environment` 다음)에 둔다. 한 줄에 `이름: 설명 (Tools: ...)` | 캡처 4장, 6장 Agent description |
| SendMessage로 보낼 상대 | `ListAgents` tool을 부른다. 결과는 tool result로 돌아온다. 행은 `name [ref]`로 시작한다 | 사람 조사 1·3장, 캡처 ListAgents description |
| subagent가 보낼 수 있는 형제 | subagent가 시작할 때 system reminder로 `main`과 이름 붙은 다른 agent를 한 번 적는다. 시작 시점 snapshot이라 나중에 이름 붙은 agent는 안 나온다. SendMessage가 있고 이름 붙은 다른 agent가 하나 이상일 때만 나온다 | 공식 sub-agents "What loads at startup / Sibling roster" |

- ListAgents 행에 든 것: 이름, 필요할 때만 붙는 `[ref]`, 종류(subagent, teammate, 로컬 session, cloud, Remote Control. 행에 종류 label), 상태(busy/idle, `offline`, `can't receive cross-session messages (off in that session)`), 로컬 session이면 작업 디렉터리. 행의 정확한 줄 꼴은 캡처에 없다(확인 못함). 근거: ListAgents description("each row labeled by kind"), SendMessage description("its ListAgents row says whether it is busy or idle"), 공식 cross-session-messaging "See which sessions Claude can reach".
- ListAgents 입력 `channel`, `q`는 이 빌드에서 "Not available in this build; leave unset"(사람 조사 2.2). 필터는 없고 전체를 돌려준다.
- 목록에 드는 session: roster 파일(pid별 json)이 있고 inbox socket을 연 session. protocol 버전이 낮고 24시간 넘게 갱신 없는 항목은 뺀다(사람 조사 5장). `claude -p`도 목록에 들지만 bare mode는 socket이 없어 안 든다(공식 "Non-interactive sessions").
- 사람이 직접 가리키는 길도 있다. 입력창에서 `@api-worker`를 치면 Claude Code가 그 session을 가리킨다고 알려 줘서 ListAgents 없이 보낸다(공식, v2.1.232+).
- 불필요한 조회를 막는 문구: "Never poll ListAgents in a loop or send 'are you done?' messages instead"(SendMessage description). 대신 `notify_when_idle`로 한 번 알림을 받는다.

### 1.2 받는 쪽을 가리키는 값

- `to`는 한 줄 문자열(300자 이하). 이름이 곧 주소다("the name IS the address; there is no separate address syntax").
- 값의 종류: 목록의 이름, teammate 이름, `main`, background agent의 `agentId`(`a...-...` 꼴. 이름이 없는 agent에만 쓰라고 안내).
- 이름이 겹칠 때: 이름과 정확히 맞는 live 대상이 하나면 이름만으로 간다. 목록에 같은 이름이 두 행이면 ListAgents가 행마다 ` [ref]`를 붙이고 `to`에 `이름 [ref]`로 쓴다. 목록이나 오류에서 방금 읽은 ref만 풀린다. 같은 이름이 in-process agent도 가리키면 in-process가 이긴다(SendMessage description).
- 이름 재사용 보호: 공식 문서는 "SendMessage checks that a name still refers to the same agent it reached earlier in the conversation. If a newer agent has taken the name ... Claude Code refuses the send rather than delivering it to the wrong agent, and the error reports which agent the name now reaches"라고 적는다. 한편 tool description은 "agentId는 새 agent가 이름을 가져갔을 때 쓴다(latest wins)"고 적는다. 즉 이름은 최신을 가리키고, 앞서 닿았던 agent와 달라지면 거절하며, 앞 agent는 agentId로 닿는다. 범위는 현재 대화이고 `/clear`로 초기화된다.
- session 이름은 `/rename`·`--name`으로 사람이 정하고, 없으면 Claude Code가 cwd basename 등에서 만든다(`nameSource: derived`). 사람이 같은 이름을 두 session에 줄 수 있어 `[ref]`가 필요해진다.
- 값의 출처: ListAgents 결과, 받은 메시지의 `from` 속성("To reply, copy its `from` attribute as your `to`"), spawn 결과의 agentId.

### 1.3 목록이 바뀔 때 cache

- 바뀌는 데이터를 prefix 앞쪽에 두지 않는다. 캡처 8장의 정리: system은 짧고 거의 정적이고, 위치마다 달라지는 정보(cwd, agent 목록, skill 목록)는 messages의 system 블록으로 보내며 이후 요청은 이미 들어간 내용을 그대로 다시 보내 cache를 맞춘다. Agent tool description에 목록 대신 "목록은 reminder에 있다"를 둔 것도 같은 이유로 읽힌다(Agent description은 정적).
- ListAgents 결과는 대화 끝에 붙는 tool result라 prefix를 깨지 않는다. 열린 session 같은 자주 바뀌는 목록은 이 길에만 둔다.
- SendMessage description은 완전히 고정은 아니다. 가용성 gate(`Gi()`)와 subagent 여부에 따라 Cross-session 절이 빠지거나 들어간다. 이 값들은 session 안에서 바뀌지 않는 조건이다(사람 조사 3장).
- 목록이 바뀐 것을 알리는 push는 없다. subagent roster는 시작 시점 snapshot이고 일부러 갱신하지 않는다.
- 공식 문서 정의 파일(`.claude/agents/`)은 시작 뒤 바뀌어도 몇 초 안에 감지하고 다음 delegation이 새 정의를 쓴다(sub-agents). 이때 cache 영향은 문서에 없다(확인 못함).

### 1.4 보낼 수 없는 상대: 숨기나 거절하나

- 상대별로는 숨기지 않는다. 불가 상태를 행에 표시하고 보낼 때 거절한다. 예: `can't receive cross-session messages (off in that session)` 행에 보내면 결과가 `Not sent`로 시작하고 이유를 적는다. 메시지는 보내는 session에서 나가기 전에 막힌다(공식).
- tool 수준 금지는 있다. 권한 deny 규칙에 `SendMessage`, `ListAgents`를 쓰면 두 tool이 모두 사라진다(공식 "Stop sending and listing"). 이름 단위 allow/deny는 없다. subagent는 `Agent(worker, researcher)` allowlist로 spawn할 종류를 제한하고, 어긴 요청은 실패하며 "agent sees only the allowed types in its prompt"(공식 sub-agents). 정확한 오류 문구는 문서에 없다(확인 못함).
- 받는 쪽 정책(`crossSessionInbound`: accept/hold/refuse)은 sender 쪽 목록에 반영되지 않는다. `refuse`인 로컬 session은 다른 session의 listing에서 눈에 띄는 변화가 없다고 문서에 적혀 있다. 로컬 session이 hold·deny하면 sender에게 `[Cross-session delivery notice]`가 간다(사람 조사 4.2). 클라우드·다른 machine session은 아무 통지도 안 간다(SendMessage description).
- 크기 한도(약 100만 자), 짧은 시간 폭주는 sender 쪽에서 거절한다(공식 Limitations, errors: `Message too large for cross-session delivery`, `Too many messages to this session just now`).
- "목록에 있으면 닿는다"를 약속한다. SendMessage description: "A listed peer is alive and will receive your message". 단 닿는 것이 읽는 것은 아니다.

### 1.5 끝난 session에 보내면

| 대상 | 결과 | 근거 |
|---|---|---|
| 끝난 로컬 session | roster에서 빠져 목록에 없다. 정확한 오류 문구는 확인 못함 | 사람 조사 5장(roster), 공식 |
| 끝난(completed) subagent | 되살아난다. 같은 agent ID로 background에서 새 run. 전체 history 유지 | 공식 sub-agents "Resume subagents", SendMessage description("a send resumes it from its transcript") |
| 사람이 `x`로 멈춘 subagent | 되살리지 않고 거절한다. Claude에게 "cancelled"라고 알린다 | 공식 sub-agents |
| 끝난 teammate(in-process) | 같은 session 안에서 되살리고 저장된 대화를 복원해 메시지를 다음 prompt로 준다. `/resume` 뒤에는 복원 안 됨 | 공식 agent-teams |
| 한 번에 끝나는 Explore, Plan | agent ID가 없어 되살릴 수 없다 | 공식 sub-agents |

## 2. Codex

### 2.1 목록을 아는 길

| 대상 | 길 | 근거 |
|---|---|---|
| spawn할 role | `spawn_agent` tool description 안의 "Available roles:" 절. 형식은 `이름: {설명 + 잠긴 model/effort 메모}` 또는 `이름: no description`. 사용자 정의 role 먼저, 그다음 built-in | `agent/role.rs:269~337` `spawn_tool_spec::build` |
| spawn한 child | 환경 context의 `<subagents>` 블록. 줄은 `<agent name="/root/task1/..." />`, 최대 8개, 1024 bytes. v1은 `- 이름: nickname` 줄 | `session/world_state.rs:40,127~158`, `context/world_state/environment.rs:317` |
| 보낼 수 있는 live agent | `list_agents` tool(v2). 입력은 선택적 `path_prefix`(trailing slash 없이). 출력 `{agents:[{agent_name, agent_status}]}`. `agent_name`은 canonical task path, 없으면 agent id. status는 `pending_init`, `running`, `interrupted`, `shutdown`, `not_found`, `{completed: 마지막 메시지}`, `{errored: 이유}` | `multi_agents_spec.rs:316~333,479~`, `multi_agents_v2/list_agents.rs` |
| 서로의 이름 | spawn 결과 `task_name`과 spawn 때 child에게 주는 canonical task name | `multi_agents_spec.rs:433~` |

- list 범위는 "현재 root thread tree에서 live인 agent"다(tool description). root는 prefix가 맞으면 맨 앞에 넣고, 나머지는 path와 id 순으로 정렬한다(`agent/control.rs:380~`). 정렬이 결정적이라 같은 상태에서 같은 결과가 나온다.
- 같은 spawn 안내에 "wait_agent는 아주 드물게만, 습관적으로 기다리지 말라"가 있다. 목록을 폴링하라는 안내는 없다.
- 병렬 호출은 허용한다(`supports_parallel_tool_calls`).

### 2.2 받는 쪽을 가리키는 값

- v2 `send_message`·`followup_task`의 `target`: "상대 또는 canonical task name"(`/root/task1/task_3` 꼴 path). 상대 경로(`task_3`)는 호출한 agent의 path 기준으로 풀린다. 다른 agent 아래의 형제는 canonical name으로만 닿는다(spawn description: "`/root/task2/task_3` would only be able to communicate with this agent via its canonical name"). `AgentPath::resolve`가 절대·상대를 구분한다(`protocol/src/agent_path.rs:59`).
- 이름 겹침은 path 구조로 막는다. `task_name`은 소문자·숫자·밑줄이고 부모 path 아래에서 유일해야 한다(path가 registry key). 같은 이름을 두 번 만드는 일은 spawn 단계에서 걸린다.
- v1 `send_input`의 `target`은 agent id(UUID 꼴 thread id)다. spawn 결과에서 받는다.
- 값의 출처: spawn 결과, `list_agents`, 받은 메시지의 sender path(메시지가 `author`·`recipient` path와 함께 `InterAgentMessage`로 렌더됨, `context/inter_agent_message.rs`).

### 2.3 cache

- 정적에 가까운 것은 tool description에 둔다: "Available roles"는 config가 바뀌어야 변한다. model 목록은 `model_catalog_in_context` feature(개발 중)로 tool description에서 context 쪽으로 옮길 수 있게 한 흔적이 있다(`multi_agents_spec.rs`, `features/src/lib.rs:1485`). 이유 문서는 확인 못함.
- 바뀌는 것(child 목록)은 환경 context에 넣는다. 환경 context는 `WorldStateSection::render_diff`로 직전 snapshot과 비교해, 바뀐 부분만 새 user-role 조각으로 덧붙인다(`environment.rs:113~`). 이미 보낸 prefix를 고쳐 쓰지 않는다. 다만 `<subagents>` 변화만으로는 조각이 새로 나가지 않는 것으로 읽힌다: diff 조건(`turn_context_values_changed`)에 `subagents`가 없다(`environment.rs:~140`). 그래서 이 목록은 낡을 수 있고, 최신은 `list_agents`로 본다. 실행해 확인하지는 않았다(확인 못함).
- 목록 크기에 상한(8개, 1KB)을 둬서 push가 커지지 않게 한다.
- 결과적으로 Codex도 "자주 바뀌는 목록은 tool result, 느리게 바뀌는 것은 description, 중간은 상한 있는 diff"로 나눈다.

### 2.4 보낼 수 없는 상대

- 권한 기반 숨김은 없다. 범위가 구조(tree)다. list는 자기 root tree의 live agent만 보인다. tree 밖 path는 `resolve_path_reference`가 registry에서 못 찾아 `live agent path `{path}` not found`로 실패한다(`agent/control/target.rs`).
- 보낼 수 없는 경우의 거절 문구(모두 tool 오류로 model에게 돌아감):
  - 빈 메시지: `Empty message can't be sent to an agent`(`message_tool.rs`)
  - root에게 followup: `Follow-up tasks can't target the root agent`(`control/api.rs:137`)
  - id를 모름: `agent with id {id} not found`, 닫힘: `agent with id {id} is closed`(`multi_agents_common.rs:116~`, v1)
  - 다른 UnsupportedOperation은 문구를 그대로 model에 돌린다(`collab_v2_agent_error`).
- spawn 쪽 허가: spawn은 "사용자나 AGENTS.md/skill이 명시적으로 요청하지 않으면 하지 말라"는 지침(spawn_agent description)으로 막는다. program이 막는 것이 아니라 지침이다.

### 2.5 끝난 agent에 보내면

- v1: `close_agent`로 닫으면 `send_input`은 `agent with id ... is closed`로 실패한다. `resume_agent`(id)로 다시 열어야 한다. 되살림은 model이 명시적으로 부른다.
- v2: close tool이 없다. 메모리에서 내려진(evict) 또는 cold-restore된 child에 메시지가 오면 `ensure_v2_agent_loaded`가 저장된 상태에서 다시 올린 뒤 전달한다(`control/api.rs:100~`, 주석 "Cold-restored children still reload lazily on any message"). `queue only` 메시지는 evict된 수신자의 mailbox에 쌓아 두고 되살리지 않는다(`control/mailbox.rs`). `followup_task`는 idle이면 새 turn을 시작한다. 즉 보내는 쪽은 되살림 여부를 신경 쓰지 않는다. 한 번 shutdown된 agent는 registry에서 빠지므로 `not found`다(상태 `shutdown`은 list 출력 타입에 있지만 live만 list한다고 적혀 있어 실제로 보이는지는 확인 못함).

## 3. OpenCode

### 3.1 목록을 아는 길

- 길 하나: `subagent` tool의 description 끝에 동적으로 덧붙인다.

```
Available subagents:
- <agent id>: <description>   (설명이 없으면 "This subagent should only be called when explicitly requested.")
```

  근거 `packages/core/src/tool/plugin/subagent.ts:280~308`. 이 목록은 session hook(`context`, `compaction`, `generate`)에서 요청마다 다시 만든다.
- 목록에 드는 것: `mode !== "primary"`, `hidden`이 아님, 호출하는 agent의 permission 규칙으로 `subagent` action이 `deny`가 아님. `id` 순 정렬. 후보가 하나도 없으면 목록 절을 붙이지 않는다.
- 열린 child session을 나열하는 tool은 없다. model은 이전 호출의 결과에서만 sessionID를 얻는다(출력 `sessionID`, 본문 `<subagent sessionID="..." state="completed">`, background 결과 문구에도 sessionID).

### 3.2 받는 쪽을 가리키는 값

- 새 child: `agent`(agent id 문자열). 계속하려면 `sessionID`를 준다. "Calls without a sessionID start a new conversation."
- `sessionID`는 호출한 session의 child여야 한다: `Session {id} is not a child of the current session`. 없는 id는 `Subagent session not found: {id}`.
- 이름이 겹칠 일이 없다. agent id는 config의 key이고, 계속 대화는 불투명한 sessionID로만 가리킨다.
- 다른 agent로 같은 sessionID를 부르면 child의 agent를 바꾼다("switchAgent").

### 3.3 cache

- 목록은 tool description에 있고, 목록의 내용은 agent 설정과 permission에서만 나온다. 실행 중 child의 수와 무관하므로 session 안에서는 보통 안 바뀐다. 정렬이 결정적이라 같은 설정이면 같은 문자열이다. 설정·permission이 바뀌면 description이 바뀌는데, 이때의 cache 처리는 코드에 없다(확인 못함).

### 3.4 보낼 수 없는 상대

- 숨김과 거절을 둘 다 한다. 명시적 `deny`는 목록에서 뺀다. `ask`(규칙 없을 때의 기본 `ask`, `permission.ts:87~97`)는 목록에 두고 호출 때 묻는다. 호출 때는 다시 검사한다: `agent.mode === "primary"`면 `Agent {name} cannot run as a subagent`, 모르는 이름이면 `Unknown agent: {name}`, permission이 막으면 `Subagent denied: {id}`.
- 깊이 한도: `Subagent depth limit reached (N). Increase "experimental.subagent_depth" ...`(기본 1).

### 3.5 끝난 session에 보내면

- 끝난 child session도 `sessionID`로 이어 갈 수 있다. 같은 session에 새 prompt를 넣고, 돌고 있으면 steer, idle이면 깨운다("the default wake starts an idle child or steers a running one"). 실패한 child의 오류 메시지에도 sessionID가 들어 있어 이어 갈 수 있다("Failure surfaces keep the sessionID visible"). 지워진 session은 `not found`다.

## 4. Hermes

### 4.1 목록을 아는 길

| 대상 | 길 | 근거 |
|---|---|---|
| 띄울 agent 종류 | 없음. 매번 새 child이고 종류 목록이 없다 | `delegate_tool.py` |
| 실행 중 child | `delegate_task(action="list")`. 호출한 대화가 소유한 live child만 돌려준다. 행: `subagent_id`, `parent_id`, `goal`, `model`, `status`, `running_seconds`, `accepting_steer`, `live_transcript` 경로. 없으면 `count: 0`과 "No live subagents right now. Children that already finished have delivered ... there is nothing to steer or stop" | `delegate_tool_registry.py` `_list_payload` |
| kanban 담당자(profile) | prompt가 "orchestrator는 먼저 profile을 조회하라"고만 안내하고, 조회는 terminal로 `hermes profile list`를 돌린다. 전용 list tool은 없다 | `agent/prompt_builder.py:331`, `kanban_tools_schemas.py` `kanban_create` |
| 채팅 platform | `send_message(action="list")`가 channel directory를 문자열로 돌려준다. 단 이 설치본의 주석은 `send_message`가 agent가 부르는 tool로 등록되지 않는다고 적는다(cron, CLI, kanban notifier, 선택 MCP server만 쓴다) | `send_message_tool.py:24~26,57` |

- description에 "While children run, `action` (list/steer/stop) controls them live."를 넣어 두고, "Never wait or poll on transcripts, artifact files, or CI for a child"를 적는다.
- 완료된 child는 list에 안 나온다. 결과는 새 메시지로 돌아온다.

### 4.2 받는 쪽을 가리키는 값

- steer·stop 대상은 `subagent_id`(`sa-<번호>-<hex 8>` 꼴, `delegate_tool.py:233`). 출처는 spawn 응답과 `action=list`.
- kanban 담당은 `assignee`에 profile 이름 문자열. 이름이 겹칠 일은 profile 디렉터리 이름이 유일해서 없다.
- 소유 판정: 같은 대화의 spawn tree 안인지 본다(weakref chain, 그리고 재구성된 parent를 위해 session id lineage). 다른 대화의 child는 보이지도 건드리지도 못한다(`_owns_subagent_record`).

### 4.3 cache

- 목록을 prompt나 tool description에 넣지 않는다. 동적인 것은 전부 `action=list`의 tool result다. description에는 제한값(동시 child 수)처럼 설정으로만 바뀌는 문구만 들어간다(`_build_tasks_param_description`).

### 4.4 보낼 수 없는 상대

- 숨기지 않고 거절한다(소유 밖은 목록에서 안 보이는 것이 사실상 숨김). 거절 문구: `No live subagent '{sid}' in this conversation's spawn tree. It may have already finished (its result arrives as a normal completion message). Use action='list' to see live children.`
- steer가 늦었을 때: `Subagent '{sid}' is no longer accepting steering (finishing or already finished). Its result arrives as a normal completion message; re-delegate a follow-up task if more work is needed.` 그리고 끝나기 전에 못 닿은 steer는 완료 항목에 `missed_steer`로 돌려준다(기존 조사 5-1).
- kanban은 알 수 없는 `assignee`를 만들 때 거절하지 않는다(비어 있는지만 검사, `kanban_tools.py:1099~`). dispatcher가 나중에 `skipped_nonspawnable` event를 남기고 card를 `ready`에 둔다. prompt는 이것이 "silently drops"라고 적고 미리 profile을 확인하라고 한다.

### 4.5 끝난 session에 보내면

- 끝난 child에 보내는 길 자체가 없다. 후속은 새 `delegate_task`를 부른다(위 문구가 안내). kanban은 같은 task를 retry·review하면 새 run을 만든다(기존 조사).

## 5. A2A (기존 조사로 갈음)

- Agent Card가 상대를 알리는 문서다. 찾는 길: well-known URI, registry, 직접 설정. 카드에 name, description, skills, 인증 방식이 있다.
- 인증된 caller에게만 더 많은 skill을 보이는 extended card가 있다(`GetExtendedAgentCard`). 즉 권한에 따라 목록 내용이 달라지는 선례다.
- caller가 카드를 읽고 자연어로 부른다. skill id를 가리키는 필드가 없다(`research/agent-call-a2a.md` 8장). 기존 조사의 결론: lophn은 role 이름이 주소이므로 카드 대신 role별 한 줄 설명이면 충분하다.

## 6. 비교 표

| | Claude Code | Codex (v2) | OpenCode | Hermes |
|---|---|---|---|---|
| 새로 띄울 종류를 아는 길 | system-reminder(messages 쪽)에 `이름: 설명 (Tools)`. tool description은 정적 | `spawn_agent` description의 "Available roles" | `subagent` description에 "Available subagents" 동적으로 덧붙임. permission 규칙으로 걸러 id 순 정렬 | 없음(종류 목록 없음). kanban은 CLI로 profile 조회 |
| 열린 상대를 아는 길 | `ListAgents` tool(필터 없음). subagent는 시작 때 roster reminder | `list_agents` tool(`path_prefix`). 환경 context에 `<subagents>` 최대 8개 | 없음. 이전 호출 결과의 sessionID만 | `delegate_task(action=list)`. 대화가 소유한 live child만 |
| 목록의 항목 | 이름, `[ref]`, 종류 label, busy/idle/offline/수신불가, 로컬은 cwd | `agent_name`(path), `agent_status`(enum, completed면 마지막 메시지) | agent id, 설명 | subagent_id, parent_id, goal, model, status, 경과 초, accepting_steer, transcript 경로 |
| 받는 쪽 값 | 이름(`to`). 겹치면 `이름 [ref]`. agentId는 이름 없는 agent용 | task path(상대·절대). v1은 agent id | agent id(새로), sessionID(이어서) | subagent_id, profile 이름(kanban) |
| 값의 출처 | ListAgents, 받은 메시지의 `from`, spawn 결과 | spawn 결과, list_agents, 받은 메시지의 sender path | 이전 호출 결과 | spawn 응답, list |
| 이름 겹침 | `[ref]`, in-process 우선, 재사용 시 거절(오류가 현재 가리키는 agent를 알림), agentId로 우회 | path가 unique key라 겹침이 없음 | 없음(opaque id) | 없음 |
| 바뀌는 목록과 cache | 바뀌는 것은 tool result(ListAgents). agent 종류는 messages 쪽. 갱신 push 없음 | 느린 것은 description, 중간은 diff 방식 context 조각(상한 있음), 최신은 tool | description을 요청마다 재생성하되 내용이 설정에서만 나옴. 바뀔 때 처리는 확인 못함 | 전부 tool result |
| 권한 밖 상대 | 목록에 두고 상태 표시(수신 불가). tool 단위 deny는 tool 자체를 없앰. subagent는 `Agent(type)` allowlist | 구조(tree)로 한정. 권한 기반 숨김 없음 | `deny`는 목록에서 숨기고 호출 때도 `Subagent denied`. `ask`는 목록에 둠 | 소유 밖은 안 보임, 보내면 거절 문구 |
| 거절 문구 꼴 | `Not sent` + 이유. 이름 재사용은 현재 가리키는 agent를 알림 | 짧은 영어 한 줄(`live agent path ... not found`, `agent with id ... is closed`) | `Unknown agent: x`, `Subagent denied: x`, `Session x is not a child of the current session` | 문장형: 이유 + "아직 안 끝났다면 list" 안내 |
| 끝난 상대에 보내기 | subagent·teammate는 되살림(사람이 멈춘 것은 거절). 끝난 로컬 session은 목록에서 빠짐 | v2는 저장 상태에서 자동 reload. v1은 `closed` 실패, `resume_agent`로 명시적 되살림 | 같은 sessionID로 이어 감(idle 깨움, 도는 중이면 steer) | 길이 없음, 새로 spawn |
| 폴링 금지 안내 | description에 있음 | spawn description("wait를 습관적으로 하지 말라") | background 결과 문구에 있음 | description에 있음 |

## 7. lophn에 비춰 본 점

전제: S3는 받는 곳을 새 session(role, place), 열린 session(session ID), 또는 둘 다로 정했고(S3 4장), 이름은 정확히 맞아야 하며 짐작하지 않는다(3장). 거절은 `not_found`, `not_allowed`, `closed`로 나뉜다(5장). 누가 누구를 부르는지는 고정 표가 아니라 grant가 정한다(AGENT-ROLE 5.1, 7장). 추천은 제안이다.

| lophn이 정할 것 | 추천 | 근거 harness |
|---|---|---|
| 열린 session을 알리는 길 | list tool을 둔다(call tool과 별개의 읽기 tool). 열린 session 목록을 system prompt나 tool description에 넣지 않는다. tool result로만 준다 | Claude ListAgents, Codex list_agents, Hermes action=list. Claude는 Agent 종류 목록도 description 밖에 두었다 |
| 새로 띄울 수 있는 role과 place를 알리는 길 | agent 지침(role별 한 줄 설명)과 call tool 설명에 grant가 허락한 role만 정적으로 적는다. grant가 session 중에 바뀌면 R5와 함께 정한다. place는 목록을 지침에 넣지 않고 list 결과에서 준다 | Codex "Available roles", OpenCode "Available subagents", A2A card(기존 조사 결론) |
| list 행에 넣을 것 | role, place, session ID, session 제목, 상태(돌고 있음/idle), 열린 때. 대화 내용·transcript는 넣지 않는다. 상태는 보낼지 말지 고르는 데 필요하다(돌고 있으면 다음 turn에 들어감, S3 4장) | Claude(종류, busy/idle), Codex(status), Hermes(goal, status, 경과) |
| list 필터와 크기 | 선택 입력 `role`, `place`. 응답은 상한을 두고 넘으면 일부만 줬다고 알린다. 기본은 grant가 허락한 열린 session 전부 | Codex `path_prefix`와 환경 context의 8개·1KB 상한. Claude는 필터가 꺼진 빌드라 전체를 반환 |
| 받는 쪽을 가리키는 값 | 열린 session은 session ID를 주소로 한다(S3 3장 그대로). 사람이 읽는 label(role@place, 제목)은 표시용이고 주소로 쓰지 않는다. 이름을 주소로 쓰면 겹침 장치([ref], 우선순위, 재사용 거절)가 따로 필요해진다 | OpenCode(opaque sessionID), Hermes(subagent_id), Codex(unique path)와 반대로 Claude는 이름이 주소라 장치가 많다 |
| model이 session ID를 얻는 곳 | 셋: list 결과, 받은 메시지의 보낸 쪽 정보(session ID), 자기가 보낸 call의 결과(열린 session이면 그 ID). 이미 대화 중인 상대에게 답하는 흔한 경우는 `reply_to`/보낸 쪽 정보만으로 끝나게 하고 list 호출이 필요 없게 한다 | Claude(`from`을 `to`로 복사), OpenCode·Hermes(spawn 결과의 ID) |
| 이름이 겹칠 때 | 새 session 대상은 role과 place(Operator는 이름 포함)가 정확히 하나로 풀리지 않으면 실패시키고 후보를 이유에 적는다. 짐작하지 않는다. 열린 session은 ID라 겹침이 없다 | CrewAI가 후보 목록을 오류에 적는 방식(기존 조사), Claude의 거절 + 현재 가리키는 대상 안내 |
| grant 밖 상대를 목록에서 숨길지 | 목록은 grant가 deny가 아닌 것만 보인다(allow와 ask). 호출 때 Gate가 다시 판정한다. 목록은 snapshot이라 그사이 grant가 바뀔 수 있고, program이 지켜야 하는 것은 호출 때의 판정이다. 숨기는 이유는 토큰과 헛된 시도를 줄이는 것이다 | OpenCode(deny 숨김 + 호출 때 `Subagent denied`, ask는 목록에 둠), A2A extended card. 반대 선례: Claude는 상태 표시 + 보낼 때 거절 |
| 숨긴 상대를 직접 지정해 부르면 | `not_allowed`와 이유를 돌려준다(S3 6장 그대로). 존재 여부를 숨기려면 `not_found`로 합칠 수 있으나, 현재 설계는 둘을 나눈다. 둘을 합칠지는 사람이 정한다 | OpenCode(`Unknown agent`와 `Subagent denied`를 나눔) |
| 목록이 바뀔 때 cache | prefix(system, tool 정의, 지침)에 열린 session 목록을 넣지 않는다. 바뀌는 것은 전부 tool result로 둔다. 어떤 형태로든 push가 필요하면 Codex처럼 직전과의 diff를 새 입력으로 덧붙이고 상한을 둔다. 갱신을 안 해도 최신은 list로 본다 | Claude(tool result, 시작 시점 roster snapshot), Codex(diff 조각, 변화만으로는 안 나가는 것으로 읽힘), Hermes |
| list 호출 습관 | tool 설명에 "답을 기다리며 list를 반복 호출하지 않는다. 답은 새 입력으로 온다"를 적는다. S3의 "보낸 쪽은 기다리며 막히지 않는다"와 맞는다 | Claude("Never poll ListAgents"), Hermes("Never wait or poll"), OpenCode background 문구 |
| 끝난 session에 보내면 | S3 현재 설계(실패 `closed`, 되살리지 않음, 이유에 "새 session으로 보내려면 role과 place로 다시 부르라"를 적음)를 유지한다. list에는 열린 session만 보인다. 되살림은 S3 9장 "나중"에 둔 대로 남긴다 | OpenCode·Codex v2·Claude subagent는 이어 가거나 되살림. Hermes·Codex v1은 실패. lophn은 session이 저절로 끝나지 않으므로 `closed`는 archive나 삭제된 경우로 한정되고 드물다 |
| 거절 메시지 꼴 | 보낸 session의 새 입력으로 돌려준다(S3 5장). 내용은 한 덩어리: 코드(`not_found`, `not_allowed`, `closed`), 한 줄 이유, 다음에 할 일(예: "list로 열린 session 확인", "새 session으로 부르기"). `not_found`는 같은 role의 허락된 후보를 최대 몇 개 적는다 | Hermes 문구("이유 + list 안내"), Claude(`Not sent` + 이유), CrewAI(후보 목록) |
| call 입력에서 두 모드를 가르는 방법 | 한 입력에 `to`를 열거형으로 둔다: `{session: <ID>}`, `{role, place[, name]}`, 둘 다. 이 모양은 S4에서 정한다. list 행은 `session` 값을 그대로 복사해 쓸 수 있는 꼴로 출력한다 | Claude `to` 한 칸 + 문자열 해석은 오류 원인이 된다. OpenCode는 `agent`와 `sessionID`를 칸으로 나눔 |

## 8. 확인하지 못한 것

- Claude `ListAgents` 결과 행의 정확한 줄 꼴과, 이름 없는 로컬 session의 행 꼴(캡처에 tool 정의만 있고 결과 예시가 없다).
- 끝난 로컬 session에 이름이나 ref로 보냈을 때의 정확한 오류 문구. 공식 errors 문서의 표에 해당 항목이 보이지 않았다. errors 본문은 앞 10만 자만 읽었다.
- Claude에서 `.claude/agents/` 변경이 Agent tool의 agent 목록(messages 쪽)과 prompt cache에 주는 영향.
- Codex에서 `<subagents>` 변화만으로 환경 context 조각이 새로 나가는지(코드 읽기로는 아니라고 보지만 실행해 확인하지 않음). Codex v2에서 shutdown된 agent가 `list_agents`에 `shutdown` 상태로 보이는지.
- OpenCode에서 permission·설정이 바뀌어 description이 달라질 때 cache를 어떻게 다루는지.
- Hermes `delegate_task` 문서와 설치본은 `decf1921`이고, 기존 조사(`agent-call-frameworks.md`)는 `1f6c02c0`를 본 것이다. 이번에는 list·steer·stop 코드만 다시 읽었다.
- 캡처 파일 안의 식별자(device, account, session 값 등)는 이 문서에 옮기지 않았다.
