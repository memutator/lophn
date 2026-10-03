---
type: research
concerns: [lophn-agent/handoff]
---
# handoff와 delegation

## 질문
역할 사이 일 전달의 target·context·권한·중복 접수를 어떻게 제한하는가.
subagent의 parent wait·결과 wake와 lophn의 독립 handoff를 구별하고 결과·비용·trace를 실제 수신 run에 어떻게 연결하는가.

조사일: 2026-10-04. 경로 접두사는 `/tmp/claude-1000/lophn-research/` 아래 clone 이름이다. `[확인]`은 실제 함수·타입·테스트에서 확인한 사실, `[추측]`은 설계 해석, `[미확인]`은 읽은 경로에서 확인하지 못한 것이다. v1/v2 같은 upstream 이름은 원 소스의 식별자이며 lophn 파일·모듈 이름으로 가져오지 않는다. lophn의 기준은 requirements·domain model `lophn-agent/handoff`, 수신 Run.source·dedup은 `lophn-agent/harness/run-loop`다.

## 프로젝트별

### LangChain (57236d55d9ff)

- **[확인] tool로 명시 child query를 만들 수 있다.** `langchain:libs/langchain_v1/tests/unit_tests/agents/test_subagent_transformer.py`의 `test_subagents_surfaces_named_subagent`(40–81)는 named `weather_agent=create_agent(...)`를 만들고 supervisor의 `call_weather(city)` tool 안에서 `weather_agent.invoke({"messages": [HumanMessage(f"weather in {city}")]})`를 부른다. child 최종 text를 supervisor tool result로 반환한다. 이 **테스트 구성에서는** parent 전체 messages를 복사하지 않고 tool이 선택한 query만 주며 parent가 child 완료를 기다린다. 임의의 application tool은 다른 context를 전달할 수 있으므로 LangChain 전역 context 정책이라고 단정하지 않는다.
- **[확인] stream trace 연결.** `langchain:libs/langchain_v1/langchain/agents/_subagent_transformer.py`의 `SubagentRunStream`, `SubagentTransformer._on_started`, `_mark_terminal`, `process/aprocess`는 named nested run을 `run.subagents` handle로 노출하고 namespace·name·trigger tool call 및 `cause={type:'toolCall', tool_call_id:...}`를 연결한다. namespace당 handle map으로 중복 handle을 막고 terminal은 `_seen_terminal`로 한 번 처리한다. **handle 중복 방지와 업무 요청 dedup은 다르다.** 테스트는 handle 1개·name·cause를 검사한다.
- **[확인] 주석보다 실제 조건을 읽어야 한다.** 파일 앞 설명은 이름 transition을 경계로 설명하지만 `_on_started`(169–178)의 실제 조건은 child `lc_agent_name`이 non-null이면 추적한다. same-name nested agent와 parent 이름을 상속한 non-agent graph도 노출될 수 있다는 후반 주석·테스트가 있다. run.subagents 존재를 “반드시 독립 agent”라는 권한 경계로 쓰면 안 된다.
- **[확인] routing 제한의 범위.** `langchain:libs/langchain_v1/langchain/agents/factory.py`의 `_build_commands`(224–280)는 wrap_model_call middleware의 `Command.goto/resume/graph`를 `NotImplementedError`로 거절하고 before_model/after_model의 `jump_to`를 안내한다. 이는 **이 middleware 자리**의 제한이지 LangChain 전체 handoff 불가가 아니다. 같은 파일 graph compile(1900–1921)은 caller checkpointer/store와 `SubagentTransformer`를 연결한다.
- **[미확인]** `libs/langchain_v1`에서 lophn식 역할 방향 allowlist·실제 assignment·원 사람 요청 lineage 거절 억제·handoff transaction·수신 비용 보장까지 제공하는 전용 handoff contract는 확인하지 못했다. application graph가 정의하는 영역을 framework 기본 보장으로 쓰지 않는다. 모델 비용 귀속도 transformer만으로 확인할 수 없다.

### OpenCode (907b3bc518fa)

- **[확인] target은 agent registry+task permission.** `opencode:packages/opencode/src/tool/task.ts`의 `TaskTool` input은 `description/prompt/subagent_type`, optional `task_id/command/background`다. parent chain으로 depth를 계산하고 `cfg.subagent_depth ?? 1`에 도달하면 오류다. `ctx.ask`의 task permission은 subagent_type pattern을 사용한다. unknown agent type은 error다. foreground가 기본이고 background는 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`가 필요하다. lophn의 고정 역할 다섯 방향·actual assignment 검사와는 다른 registry 모델이다.
- **[확인] fresh child와 resume의 차이.** 같은 파일은 새 session에 `parentID`·agent 이름·child permission을 저장한다. 전달은 `resolvePromptParts(params.prompt)`와 child prompt이며 이 경로에서 parent messages 전체를 자동 복사하지 않는다. child model은 child agent 지정 또는 parent assistant model/provider를 사용한다. `task_id`가 있으면 기존 session을 조회해 resume하지만 **lookup 실패는 새 session 생성으로 fallback**한다. 이것은 target 없음 거절을 요구하는 lophn에 그대로 가져오면 안 된다.
- **[확인] permission 상속은 제한적.** `opencode:packages/opencode/src/agent/subagent-permissions.ts`의 child permission 구성은 parent session rules 중 deny와 external_directory rules를 전달한다. parent agent restrictions를 통째로 child에 적용하지 않고 child own agent permissions가 capability를 결정한다. own rule 없는 task/todowrite는 default deny다. individual human approval decision의 자동 재사용은 이 helper에서 `[미확인]`이다. permission config·deny 전파와 approval grant 이전을 구별한다.
- **[확인] parent wait 및 background wake.** `task.ts`는 foreground job을 wait하고 마지막 child text를 tool result로 준다. assistant error 또는 마지막 error tool은 task failure다. foreground parent abort는 child cancel로 전달된다. background 완료 `injectBackgroundResult`는 parent `ops.prompt`에 synthetic task result를 넣어 **parent 판단을 다시 시작**한다. background extend는 running child session에 추가 context를 넣는다. lophn sender 종료·수신 결과로 자동 판단 없음과 정반대다.
- **[확인/미확인] 조회·중복·비용.** session/job metadata에 `parentSessionId/sessionId/model/background`를 연결하고 task_id로 child를 재사용할 수 있다. 매번 fresh call의 업무 dedup key나 “같은 prompt→receiver 하나” 보장은 이 tool에서 `[미확인]`이다. model metadata는 trace 연결 근거이며 실제 token/cost의 parent rollup 정책까지 증명하지 않는다.
- **[확인] 테스트.** `opencode:packages/opencode/test/tool/task.test.ts`의 `promotes a running foreground task without restarting it`(685–751)는 fake `TaskPromptOps`, ready/done/injected Deferred를 사용한다. promotion 전후 child runs=1, background 완료 parent prompt injection 및 job parentSessionId를 검사한다. lophn fixture는 중복 접수 1번을 가져오되 injection 성공을 기대하면 안 된다.

### Codex (3a69ec3ef8fb)

- **[확인] role/depth 기반 spawn.** `codex:codex-rs/core/src/tools/handlers/multi_agents/spawn.rs`의 `SpawnAgentHandler`는 message 또는 typed items, agent_type, optional model/reasoning, `fork_context=false`를 받는다. role을 trim하고 default role·depth limit을 검사한다. `codex:codex-rs/core/src/agent/role.rs`의 role 적용 함수(50–107)는 unknown type 또는 config load 실패를 거절하고 developer instructions/model/reasoning/personality/service tier를 layer한다. 보인 feature override는 ShellTool/Apps/Plugins/MemoryTool/RequestPermissionsTool을 disable하는 방향이다. lophn 역할쌍과 actual assignment는 이와 별개다.
- **[확인] full-history fork는 선택 기능.** spawn의 `fork_context=true`는 `SpawnAgentForkMode::FullHistory`다. `codex:codex-rs/core/src/agent/child_config.rs`(100–204)는 full-history fork 때 agent_type override를 거절하고 parent type을 상속하도록 한다. false spawn은 명시 message/items를 전달한다. lophn은 full-history/세션 summary 복사를 허용하지 않으므로 옵션으로 남겨 두지 않는다.
- **[확인] effective config 상속.** `child_config.rs`는 parent effective config를 clone하고 provider/model/reasoning/token budget/developer instructions를 정리한다. **runtime approval policy·permission profile snapshot·cwd를 명시적으로 child에 복사**한다. 이후 role layer를 적용한다. 이것은 config inheritance 확인이며 개별 tool approval grant가 다른 child call에 재사용된다는 사실은 `[미확인]`이다. lophn은 receiver current scope/judgment를 다시 계산해야 한다.
- **[확인] target input과 wait.** `codex:codex-rs/core/src/tools/handlers/multi_agents/send_input.rs`의 handler는 agent ID와 message/items, optional interrupt를 받는다. interrupt이면 먼저 기존 run을 interrupt하고 필요하면 stored metadata 기반 resume config를 준비한다. result는 submission_id다. `multi_agents/wait.rs`의 `WaitAgentHandler`는 여러 target을 watch하고 첫 final 상태를 기다리며 즉시 준비된 다른 finals도 모은다. missing target은 `AgentStatus::NotFound`; timeout은 `timed_out=true`이고 이 wait가 child를 cancel하지 않는다. parent는 tool result 뒤 판단을 계속할 수 있다. 업무 key 기반 spawn dedup은 이 handler에서 `[미확인]`이다.
- **[확인] 숫자.** wait default **30,000ms**, min **10,000ms**, max **3,600,000ms**이며 `timeout<=0`은 error, 유효 값은 clamp한다. `codex:codex-rs/core/src/config/mod.rs`의 agent defaults는 max threads **Some(6)**, max depth **1**, multi-agent-v2 concurrent/session **4**다. 이는 참고 concurrency control이며 lophn handoff에 subagent depth를 만들 이유는 아니다. v2 config에 따른 실제 제한 변경은 v1 handler와 혼동하지 않는다.
- **[확인] trace lineage.** spawn/send_input/wait의 CollabAgent tool-call events는 sender/receiver thread IDs·role/nickname·prompt·model/reasoning·status를 남긴다. spawn/send input options에 parent_thread_id·parent_turn_id·root_turn_id·turn_trigger와 originating call을 연결한다. 이것은 관계 trace 참고다. receiver token/cost의 최종 aggregation과 parent 이중 집계 방지는 해당 handler에서 `[미확인]`이다.
- **[확인] message board는 별도 범위.** `codex:codex-rs/core/src/agent_message_board.rs`의 feature installation/storage/`LocalBoardHost`(39–150)는 AgentMessageBoard+MultiAgentV2 조건, in-memory/local SQLite/remote backend를 고른다. ephemeral local SQLite는 memory/remote가 아니면 거절하고 remote는 auth token이 필요하다. caller의 session_id가 board tree와 다르면 `agent belongs to another message board`다. notification callback에 expected_turn_id를 연결한다. **post dedup·notification이 어떤 새 model turn을 깨우는지·v2 전체 협업은 미확인**이다. v1 spawn/wait를 Codex의 모든 board 동작으로 일반화하지 않는다.
- **[확인] 테스트.** `codex:codex-rs/core/src/tools/handlers/multi_agents_tests.rs`의 `wait_agent_rejects_non_positive_timeout`, `wait_agent_rejects_invalid_target`, `wait_agent_rejects_empty_targets`(2945–3001)는 timeout 0, invalid ID, empty target list를 typed model error로 검사한다. lophn은 이에 actual assignment unavailable·direction matrix·dedup/lineage·no-wake 테스트가 필요하다.

### Gemini CLI (fb972b2f87fe)

- **[확인] named registry+명시 complete query.** `gemini-cli:packages/core/src/agents/agent-tool.ts`의 `AgentTool.createInvocation`은 agent_name/prompt가 필수이며 registry의 named definition이 없으면 error다. schema는 comprehensive query에 context/background/questions/expected output을 포함하라고 안내한다. invocation은 local/remote definition과 session feature flag에 따라 실행 implementation을 고른다. 이 값은 actual user-owned assignment를 선택하는 lophn 계약이 아니다.
- **[확인] local child context와 tool registry.** `gemini-cli:packages/core/src/agents/local-subagent-protocol.ts`의 `LocalSubagentProtocolClient.send`는 config를 buffer하고 text를 query로 합쳐 executor에 보낸다. active stream 중 send는 거절하며 parent history 전체 복사 코드는 이 protocol에 없다. `local-executor.ts`의 `LocalAgentExecutor.create`(160–301)는 tool/prompt/resource registry를 분리하고 parent message bus를 child 이름으로 derive한다. optional per-agent MCP를 별도 registry에 넣고 parent tool instance를 child bus와 clone한다. **Kind.Agent tool을 제외해 local child가 다른 agent를 부르지 못하고**, update_topic도 제외한다. explicit tool names/wildcard를 쓸 수 있으며 toolConfig 없으면 제외 항목 외 available parent tools를 쓴다. CompleteTaskTool은 필수다.
- **[확인/미확인] 권한.** child confirmation에 subagent identity가 붙지만 context.config를 공유한다. 별도 registry가 곧 별도 OS/security sandbox는 아니다. individual human approval 이전 여부·각 clone tool의 최종 per-call enforcement는 이번 범위에서 `[미확인]`이다. lophn은 receiver scope와 정확한 tool input을 독립 판정해야 한다.
- **[확인] local wait·limit·abort.** `local-subagent-protocol.ts`는 새 UUID stream, event `${streamId}-${counter}`, result promise, AbortController를 만든다. executor는 background macrotask로 돌고 parent invocation은 getResult를 await한다. 결과는 completed/max_turns/max_time/failed로 mapping하고 abort는 partial output을 버린 빈 ABORTED 결과다. elicitation/action protocol은 unsupported다. `gemini-cli:packages/core/src/agents/types.ts`의 constants는 default **30 turns / 10분**이다. protocol result 반환 뒤 parent 모델이 계속할 수 있다는 구조는 lophn R5와 다르다.
- **[확인] A2A continuity와 dedup 구분.** `gemini-cli:packages/core/src/agents/remote-subagent-protocol.ts`의 `RemoteAgentProtocolClient`는 `contextId/taskId`, optional initialState, `getSessionState`를 두고 text query를 `sendMessageStream`으로 보낸다. 새 response IDs를 갱신하고 clearTaskId를 처리하며 reassembler 결과를 parent llmContent로 준다. 이 state는 invocation persistence에 쓸 수 있는 continuity이고 **같은 업무 요청을 receiver 하나로 접수하는 semantic dedup은 아니다**. 새 send마다 stream UUID를 만든다. target definition auth/URL 기반 auth provider를 만들지만 remote server의 receiver 권한·approval enforcement는 `[미확인]`이다.
- **[확인] trace.** `agent-tool.ts`의 `DelegateInvocation.execute`(156–241)는 AgentCall DevTraceSpan에 sessionId·agent name/description·input/output을 연결한다. `local-executor.ts`의 parentCallId는 tool context callId에서 받아 child 호출에 전달한다. live child events와 관계 trace는 참고할 수 있으나 실제 billing attribution·reported/estimated 구분은 이 경로에서 `[미확인]`이다. withUserHints가 query를 보완하므로 protocol query만 보고 parent state 전달이 전혀 없다고 단정하지 않는다.

### Hermes Agent (343500b3547e)

- **[확인] focused child지만 ambient state도 있다.** `hermes-agent:tools/delegate_tool.py`의 child 생성(266–321)은 `AIAgent`에 goal/context로 만든 focused system prompt, child toolsets/blocked tools, own max_iterations·fresh budget, `platform='subagent'/side_agent=True`, `skip_context_files=True/skip_memory=True/clarify_callback=None`을 준다. child SessionDB는 parent와 같은 DB file에 전용 connection을 열고 parent_session_id를 남긴다. **parent `prefill_messages`도 전달**하므로 “parent 입력이 전혀 공유되지 않는다”고 쓰면 틀리다. intermediate tool/추론 전체를 parent 결과에 복사하는 대신 summary result를 반환하는 구성이다.
- **[확인] depth/concurrency/approval default.** `hermes-agent:tools/delegate_tool_config.py`의 설정 helper(18–122)는 max spawn depth default **1**·floor 1, concurrent children default **10**·floor 1·ceiling 없음, oneshot children default **2**·0이면 unlimited다. child wall-clock timeout default **None**, heartbeat가 stuck 상태를 본다. CLI subagent approval callback은 default deny, `delegation.subagent_auto_approve=true`면 once다. gateway session approval queue는 별개다. worktree isolation default false, independent_completions default false다. credentials/model capability inheritance는 provider+endpoint 조건을 쓰며 **credential pool 공유는 사람 approval grant 이전과 다르다**.
- **[확인] task-local identity isolation.** `hermes-agent:agent/delegation_context.py`의 `delegated_child_context`(28–40)는 ContextVar와 scoped_current_session_id로 child identity를 넣고 finally에서 parent identity를 복원한다. `owned_kanban_task/is_dispatcher_owned_worker_context`, `scrub_kanban_env`, `kanban_path_is_fenced`는 child가 dispatcher-owned worker로 오인되지 않게 task/run/claim env를 제거하고 descendant marker를 유지한다. 같은 파일(122–184)은 이것이 direct SQLite 접근까지 막는 confinement이 아니며 location/credentials는 그대로 유지한다고 명시한다. lophn에서는 role identity 검사와 security boundary를 혼동하지 않을 참고다.
- **[확인] sync/background 전달.** `hermes-agent:tools/delegate_tool_dispatch.py`의 `_resolve_async_wake_sid`, `_dispatch_background`, `_run_batch`는 sync로 join하거나 background async registry에 결과를 보낸다. detached completion consumer가 없으면 sync fallback, history consumer만 있으면 다음 client turn용 history에 저장하고 **model wake 없음**(266–277)이다. 일반 background note는 결과가 turn 종료 뒤 새 메시지로 재진입한다고 안내한다(324–368). independent_completions off는 call 전체를 한 unit으로 묶고 on은 group/ungrouped task별 unit이다. capacity admission 실패는 sync fallback, 후속 unit 실패는 inline 결과로 보존한다. 따라서 Hermes를 항상 자동 wake라고 단정하지 않지만 **parent 결과 소비 orchestration 자체는 lophn의 sender 종료 계약과 다르다.**
- **[확인] control ownership.** `hermes-agent:tools/delegate_tool_registry.py`의 `_handle_control_action` 경로는 list/steer/stop을 parent 소유 lineage로 제한한다. `hermes-agent:tests/tools/test_delegate_control_actions.py`의 `test_list_shows_only_own_children`, `test_steer_reaches_owned_child`, `test_steer_foreign_child_is_refused`(102–159)는 foreign child를 목록에서 빼고 internal agent/owner_transport를 숨기며, own steer는 queued·foreign steer는 거절/변경 없음인지 검사한다. runtime descendant ancestry만으로 lophn user/assignment current 권한을 대신하면 안 된다.
- **[확인] result·비용.** `delegate_tool.py`의 result shape는 completed/interrupted/failed status와 completed/max_iterations/interrupted/error exit_reason을 구별한다. `hermes-agent:tools/delegate_tool_results.py`의 `_finalize_child_results`(390–430)는 lock 안에서 summary budget·memory manager·stop hooks·cost rollup을 처리한다. child `_child_cost_usd`를 합산해 parent session estimated_cost에 올리고 source=subagent, unknown 상태면 estimated로 바꾼다. lophn은 관계 view와 실제 receiver ModelCall 비용을 구별해 이 rollup을 durable 비용으로 또 저장하지 않아야 한다. 업무 요청 key 기반 중복 접수 방지는 조사한 spawn/dispatch 경로에서 `[미확인]`이다.

### OpenClaw (37efa0b4a644)

- **[확인] sessions_send는 기존 세션 input coordination.** `openclaw:src/agents/tools/sessions-send-tool.ts`의 tool은 nonblank message, target sessionKey/label/agentId, mode notify/steer/followup/resume를 받는다. resume는 admitted parent tool caller가 필요하고 steer/resume는 timeout 0, 나머지 기본 **30초**다. unknown configured agent/label은 error, label resolve RPC **10초**, sandbox label target은 자기 agent로 제한한다. cross-agent에는 `tools.agentToAgent.enabled` 및 allow predicate, recipient visibility/access 재검사가 필요하다. configured agent의 main session은 missing key를 허용해 새로 만들 수 있다. **configured target과 실제 active assignment는 다르다.**
- **[확인] context/authority.** 같은 tool은 message와 provenance `kind=inter_session/sourceSessionKey/sourceChannel/sourceTool/sourceRole?`를 보내며 sender history 전체를 이 call에서 복사하지 않는다. synchronous self-send는 active lane deadlock을 피하려고 거절하고 thread session coordination target도 거절한다. transport/recipient authority 체크는 확인했지만 human approval decision의 receiver 재사용 여부는 `[미확인]`이다. provenance는 권한 grant가 아니다.
- **[확인] transport idempotency와 semantic dedup.** 같은 파일 `idempotencyKey = opts?.idempotencyKey ?? crypto.randomUUID()`로 gateway agent 요청을 보낸다. **같은 injected key를 쓰는 transport replay와 model의 새 repeated call은 다르며**, 후자는 기본 UUID가 새로 생긴다. result에는 runId·accepted/상태/답이 있다. wait timeout 뒤 reply flow로 이어질 수 있고 transport error·terminal timeout·sentBeforeError/no_reply를 구별한다. 이를 lophn의 sender별 고정 dedup_key 보장이라고 쓰지 않는다.
- **[확인] 결과가 requester 판단을 시작한다.** `openclaw:src/agents/tools/sessions-send-tool.a2a.ts`의 `runSessionsSendA2AFlow`(92–241)는 reply를 기다리고 requester session에 `runAgentStep` 또는 injected deliverRequesterReply를 호출한다. 결과 문구는 다른 세션/child의 결과이며 reply를 target으로 다시 보내지 않는다고 안내한다. failure도 requester에 판단 입력을 넣을 수 있다. own-session source delivery는 captured generation·`sessions-send:${runId}` key로 중복 delivery를 방지한다. **배송 한 번과 requester model 판단 한 번은 receiver 업무 접수 dedup과 별개**다. lophn R5에는 requester wake를 가져오지 않는다.
- **[확인] sessions_spawn target.** `openclaw:src/agents/subagents/spawn/subagent-target-policy.ts`의 `resolveSubagentAllowedTargetIds/resolveSubagentTargetPolicy`는 기본 self-spawn, explicit allowAgents는 configured agent와 교집합, `'*'`도 known registry로 제한한다. registry 밖과 policy 밖 오류를 구별한다. lophn은 self-spawn을 기본 허용하지 않고 다섯 역할쌍 및 actual assignment를 검사해야 한다.
- **[확인] isolated/fork 선택.** `openclaw:src/agents/subagents/spawn/subagent-spawn.ts`의 `spawnSubagentDirect`는 current authority/admission·child plan·context 준비를 거쳐 accepted childSessionKey/runId/mode/context/completion metadata를 반환한다. `subagent-spawn-context.ts`의 `prepareSubagentSessionContext`는 isolated면 복사 없이 성공, fork면 parent transcript를 실제 fork한다. fork는 same target agent만 가능하며 parent transcript 없음·fork 실패는 error, context-engine skip decision이면 isolated+fallback note다. lophn에서는 fork/기타 context-engine 복사를 모두 제거하고 allowlisted source references만 조립한다.
- **[미확인]** spawn pipeline 전체의 default max depth/concurrency/run timeout, child permission policy와 개별 approval grant enforcement, token/cost aggregation은 이번 read 범위에서 확정하지 않았다. childIdem·swarm replay key 이름을 본 것만으로 모든 spawn의 semantic dedup을 주장하지 않는다. sessions_send의 새 UUID 동작과 다른 pipeline은 따로 평가해야 한다.

## 비교

아래 표는 위 실제 코드의 요약이다. lophn은 subagent harness를 만드는 것이 아니므로 child 한도보다 실제 독립 수신 run 접수 계약이 기준이다.

### 방향·target·context·권한 (조사 질문 8·9·10)

| 프로젝트 | 허용 방향·target 없음 | context | 권한/approval |
|---|---|---|---|
| LangChain | application tool이 child를 선택; 공통 역할 matrix 미확인 | 읽은 test는 명시 query; application마다 다름 | application policy; 공통 이전 보장 미확인 |
| OpenCode | agent type+permission+default depth 1; missing task_id는 fresh fallback | focused prompt, child session; parent history 자동 복사 없음 | parent deny/external rules+child own permissions; grant 이전 미확인 |
| Codex | role registry+depth/thread limits; target ID; wait NotFound | message/items 또는 optional full history fork | effective approval policy/profile/cwd 복사; 개별 grant 이전 미확인 |
| Gemini CLI | named registry; missing error; local child의 agent tool 없음 | query/config/user hints; remote context/task continuity | derived child bus·registry; remote auth; grant 이전 미확인 |
| Hermes | leaf/orchestrator+depth/concurrency; child/control ownership | goal/context+prefill_messages; own child session | parent toolset 제외·default CLI approval deny; credentials 공유 가능 |
| OpenClaw | a2a allow/registry·visibility; spawn self default/allowlist; main session 생성 가능 | send는 message+provenance; spawn isolated/fork | current caller/recipient authority; grant 이전 미확인 |
| **lophn** | **허용 역할쌍 5개; Operator 양방향 금지; 실제 유효 assignment 없으면 거절** | **원 사람 요청 lineage+what/why/excludes/expected_outputs+고정 근거; 세션/tool/history/summary 복사 없음** | **receiver current scope/tool judgment; sender approval 이전 없음; 원 요청 lineage의 exact 거절 억제** |

### 생명주기·중복·결과·trace (조사 질문 11·12·13)

| 프로젝트 | sender wait/end·결과 뒤 판단 | 중복/상태/결과 조회 | 비용·trace |
|---|---|---|---|
| LangChain | nested invoke await→parent tool result | namespace handle/terminal 중복 억제; 업무 dedup 미확인 | subagent handle cause=toolCall; 비용 미확인 |
| OpenCode | foreground wait; background synthetic parent prompt wake | task_id resume/extend·job/session; promotion child 1회 | parentSessionId/sessionId/model; 비용 정책 미확인 |
| Codex | spawn handle→send/wait→parent 판단 계속 가능 | agent ID/submission/status; wait 10초–1시간; spawn dedup 미확인 | sender/receiver/root/parent turn/call; 비용 집계 미확인 |
| Gemini CLI | invocation await→parent result; abort child partial 폐기 | stream UUID·A2A context/taskId는 continuity; semantic dedup 미확인 | AgentCall span+parentCallId; 실제 billing 미확인 |
| Hermes | sync join 또는 background 새 message; history-only는 no wake | live list/steer/stop owner 제한; 업무 dedup 미확인 | parent/child hooks·session; child 추정 비용 parent rollup |
| OpenClaw | wait/accepted→requester runAgentStep 결과 wake | injected transport key/reply delivery key; 새 call 기본 UUID | runId+session provenance; 비용 미확인 |
| **lophn** | **sender 기록 후 종료; receiver 독립; 결과/ticket/problem 변화가 판단 자동 시작 안 함** | **(sender_run,dedup_key) unique; 같은 내용 기존 run, 다른 내용 conflict; current run 권한으로 읽기/입력/stop** | **송·수신 run 관계 trace; 비용은 실제 수신 ModelCall; 관계 합산으로 중복 저장 안 함** |

### 테스트 (조사 질문 14)

| 읽은 테스트 | 확인하는 경계 | lophn fixture에서 바꿀 기대 |
|---|---|---|
| LangChain `test_subagents_surfaces_named_subagent` | fake tool calling model·named child·toolCall cause 1개 | child handle이 아닌 sender/source 관계 검사; parent wait/wake 없음 |
| OpenCode foreground promotion test | fake ops/Deferred·child 재시작 없이 background 전환·parent injection | 같은 dedup replay receiver 1개; 결과 injection/new 판단 0 |
| Codex wait invalid tests | timeout 0·invalid target ID·빈 target typed errors | 역할 matrix·assignment inactive·lineage invalid·dedup mismatch |
| Hermes own/foreign control tests | list/steer/stop 소유 경계·internal field exclusion | 원 sender 관계만이 아닌 현재 user/assignment 권한 재검사 |
| Gemini/OpenClaw | protocol/target/context 실제 코드를 읽음; 이번 조사에서 전체 delegation test assertions 미확인 | fake A2A/adapter 결과를 업무 dedup으로 오인하지 않는 contract test |

## lophn에 가져올 것과 버릴 것

| 요구 | 가져올 것 | 버릴 것·이유 |
|---|---|---|
| lophn-agent/handoff#R1 | explicit target allowlist와 missing/policy 오류 구분 | 기본 self-spawn·agent name 자유 선택·depth로 역할 책임을 대신 제한 |
| lophn-agent/handoff#R2 | accept 시 실제 receiver 존재/current 상태 확인 | missing child ID의 fresh fallback·configured main session 자동 생성·담당 없는 queue |
| lophn-agent/handoff#R3 | typed source lineage와 상세 focused instruction; fixed references | goal text만으로 원 사람 요청·채택 판·Question ID를 대신함 |
| lophn-agent/handoff#R4 | allowlisted context assembly; source references만 읽기 | Codex/OpenClaw fork·세션 summary·parent prefill/ambient transcript 자동 복사 |
| lophn-agent/handoff#R5 | receiver independent result·sender/source 관계 trace | foreground parent wait·background synthetic prompt·completion requester wake·event 자동 재접수 |
| lophn-agent/handoff#R6 | target별 current scope/tool input judgment; privilege/config/grant 구분 | parent effective policy나 credential/승인 snapshot을 receiver 권한으로 간주 |
| lophn-agent/handoff#R7 | 원 사람 Message 참조와 normalized operation/targets/exact input 거절 키 | role/session 바꾸기·새 UUID로 사람 거절을 잊는 재요청 |
| lophn-agent/handoff#R8 | 실제 document/version 참조 또는 no-artifact reason | latest URL·summary 문자열만 결과 정본·후속 version으로 옛 결과 치환 |
| lophn-agent/handoff#R9 | 같은 sender/key/content 반환, 다른 내용 conflict; current 권한의 조회/입력/stop | transport retry UUID·task resume·namespace handle·A2A taskId를 업무 유일성으로 오인 |

**[추측] 구현 순서.** Run.source tagged union·unique index와 current assignment checker가 선행한다. 그 다음 atomic accept+sender finish, bounded source assembly, fixed-version/adoption validator, no-wake runtime route, current authority read/control adapter, trace 관계 fixture를 붙인다. 별도 Delegation 상태표·handoff ID·child queue를 만들지 않는다. 비용은 `lophn-agent/harness/usage`, trace는 `lophn-agent/observability` 정본에 참조만 연결한다.

### open-issues 후보

- **lophn-agent/handoff#R9 — replay와 현재 target 상태.** 참고 프로젝트의 task resume·main-session 생성은 replay와 새 input을 섞기 쉽다. lophn run-loop domain은 **같은 source key+내용이면 기존 run, 다른 내용이면 conflict**를 이미 정한다. 다만 receiver 회수/삭제 후 historical replay 결과 노출의 현재 read 권한은 이 concern만으로 확정할 수 없다. **추천:** 접수 replay는 새 run·새 input 없이 기존 저장 결과만, 현황·결과 상세는 current read contract로 별도 검사한다. 권한 없는 과거 결과를 dedup 성공 응답으로 노출하지 않는다. identity/run-loop 계약에 이미 정의돼 있으면 이 후보는 닫고 새 요구를 만들지 않는다.
- **lophn-agent/handoff#R3/R4 — 텍스트의 우회 복사 경계.** typed 구조는 필요한 설명과 금지 세션 복사를 구별하지만 agent가 what/why에 transcript·secret을 붙일 수 있다. **추천:** model이 source 객체를 완성해 권한을 정하게 하지 말고 machine이 original_message·references를 검증하고 platform safety/redaction 정책을 적용한다. byte cap만으로 의미적 history 복사를 완전히 판정할 수 있다는 주장은 하지 않는다. 이 concern 밖 정본의 차단 기준·오류 계약이 빠져 있다면 후속 open issue로 올린다.

비교한 구현과 요구 차이는 대부분 의도된 선택이다. 이 조사만으로 lophn에 subagent나 completion wake를 다시 넣을 이유는 없다. intent·`open-issues.md`는 수정하지 않았다.

## 구현 메모

### 자료 구조와 원자성

- 별도 handoff entity/ID/status/queue 없음. 수신 `Run.source.kind='handoff'`에 `sender_run/original_message/body/references/dedup_key`를 저장한다. source는 immutable이다.
- body는 UTF-8 JSON blob `HandoffContent {what, why, excludes, expected_outputs}`다. what/why는 nonblank, excludes는 빈 배열 가능하나 각 항목 nonblank, expected_outputs는 최소 1개·nonblank다. 문서 근거·채택 질문은 설명 문자열이 아닌 source structured reference다.
- `(source_sender_run, source_dedup_key)` partial unique가 최종 중복 방지다. 같은 key+같은 내용은 기존 run, 다른 내용은 conflict. fresh command UUID·동일 prompt 문자열·A2A context ID는 이 키를 대신하지 않는다.
- 발신 기록과 receiver 접수는 **한 command transaction**. 방향/현재 양쪽 assignment·사람 요청 lineage·필수 body·fixed version·adoption answer 일치를 검사한다. transaction 전에 준비한 blob만으로 접수 성공으로 표시하지 않는다.
- sender는 handoff 기록 후 종료, receiver는 자기 assignment의 독립 Run이다. 수신 완료에 대한 sender continuation enqueue·synthetic message·automatic ModelCall이 없다. 주기 run·Operator source는 거절한다.
- receiver source의 고정 판 읽기 예외는 App Engineer의 한시 계약만 적용하며 latest/연결 문서·write/approval를 확대하지 않는다. 받은 prompt/provenance를 권한으로 취급하지 않는다.

### 짧은 wire 예시

아래는 fixture용 값 shape다. ID·hash는 fixture에서 생성하고 최종 command envelope를 새로 정의하지 않는다.

```json
{
  "what": "채택한 설계 판을 기준으로 앱 변경 범위를 확인",
  "why": "원래 사람 요청의 구현 가능성을 확인해야 함",
  "excludes": ["외부 전송", "현재 설계 판의 자동 채택"],
  "expected_outputs": ["실제 결과 문서 고정 version 주소 또는 산출물 없는 이유"]
}
```

`original_message/sender_run/references/dedup_key`는 이 body가 아니라 수신 Run.source에 들어간다. references에는 채택 document/version 및 그 판을 답으로 채택한 Question ID를 함께 검사한다. 토큰·credential·approval·parent transcript를 JSON 필드로 추가하지 않는다.

### 오류·운영 경계

| 경우 | 처리 |
|---|---|
| 허용 역할 방향 5개 | 양쪽 실제 역할로 검사; lophn→App/Context, App→lophn/Context, Context→lophn |
| Context→App·Operator send/receive·주기 source | forbidden; receiver/run queue 생성 없음 |
| target 없음/paused/reclaimed | 거절; domain의 없거나 paused는 unavailable; reclaimed의 최종 code는 assignment 정본 |
| 필수 what/why/output·근거 불완전 | invalid_input |
| latest 주소·다른 채택 판/Question | 고정 판·채택 답 검사 실패; 해당 source로 시작 없음 |
| 같은 sender/key·같은 body/reference/target 내용 | 저장된 receiver 반환, 새 run/추가 입력 없음 |
| 같은 sender/key·다른 내용 | conflict; 기존 receiver 불변 |
| sender 권한/approval 있음 | receiver 현재 권한 검사 면제 아님 |
| 같은 original request의 사람 거절 exact operation | tool-judgment lineage key로 억제; 새 사람 요청은 별도 |
| receiver 종료 뒤 steer/stop | 실제 Run 현재 lifecycle·권한 계약; 종료 run을 새 판단으로 부활시키지 않음 |
| 수신 결과·ticket/problem 변경 | 저장/조회만; 발신자 ModelCall·후속 run 접수 없음 |
| 비용 | actual receiver call에 한 번; sender↔receiver 연결은 view·추가 청구 row 아님 |

run limits·retry·error envelope 정본은 해당 concern을 따른다. 참고 subagent depth 1/child timeout을 새 lophn handoff 기본값으로 만들지 않는다.

### 테스트·fake provider fixture

테스트 이름은 요구 번호로 시작한다. live 모델 없이 fake provider/clock/assignment/owner adapter로 상태와 금지 변경을 검사한다.

1. **handoff#R1:** 4개 역할의 16쌍 matrix. 허용 5쌍만 접수, Context→App·Operator 양방향 포함 나머지 변경 0. agent가 target role 문자열을 위조해도 actual assignment로 검사.
2. **handoff#R2:** target 없음·paused·reclaimed·접수 직전 revision 변경. 미소유 queue·세션·receiver run 생성 없음; typed 이유 표시.
3. **handoff#R3/R4:** body 필수값/공백/empty expected_outputs, latest reference, version-Question mismatch를 거절. child prompt snapshot은 고정 설명·필요 근거만; parent history/tool log/summary/secret/approval는 자동 첨부되지 않음.
4. **handoff#R5:** original_message 없는 schedule/event run send 거절. receiver 성공·실패·no-artifact 완료 및 ticket/problem change 뒤 sender 상태 종료 유지, sender ModelCall/추가 run 0.
5. **handoff#R6:** sender가 scope 밖 동작을 approved해도 receiver는 다시 판정; parent config·credential·approval injected payload로 권한 확대 없음. source fixed 판 읽기는 허용, latest/linked document write는 금지.
6. **handoff#R7:** A에서 거절한 operation/target/exact input을 B/C가 같은 original_message로 재요청→억제. input/대상 차이와 새 human request는 별도 판정; lineage 누락/교체는 접수 거절.
7. **handoff#R8:** receiver 문서 결과 version 후 새 version 작성→원 결과 주소/내용 유지; output 없는 경우 reason nonblank. model이 존재하지 않는 문서 URL을 반환하면 완료 결과의 실제 참조로 수용하지 않음.
8. **handoff#R9:** concurrent duplicate·같은 command replay·commit 뒤 response-loss retry→receiver 1개·sender 기록 1개. 같은 key/다른 body·target·reference는 conflict. atomic accept 중 실패→한쪽만 성공 기록 없음.
9. **handoff#R9:** foreign/current 권한 revoked·receiver 종료 이후 status/result/add-input/stop. historical sender relation만으로 쓰기 허용 없음; dedup replay가 추가 input을 넣지 않음.
10. **handoff#R5 및 비용/trace:** receiver provider call을 2 attempts fixture로 만들고 sender/receiver/root-message trace가 실제 call을 연결하는지 검사. 관계 합계 표시가 durable reported/estimated 비용 row를 또 만들지 않으며 수신 완료 notification이 model wake가 되지 않음.

### 미확인 범위

LangChain application graph의 전체 handoff semantics·durable store, Codex multi-agent-v2 board post/dedup/notification wake·개별 approval grant 재사용, Gemini remote A2A server enforcement·billing, Hermes direct SQLite confinement 및 각 transport completion consumer 전체, OpenClaw spawn pipeline의 최종 replay/permission/default limits·비용 aggregation은 확인하지 않았다. 각 프로젝트가 lophn식 exact-operation 거절 lineage를 끝까지 보장하는지도 읽은 delegation 경로만으로 확정하지 않는다.
