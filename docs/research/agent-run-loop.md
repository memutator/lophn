---
type: research
concerns: [lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery]
---
# agent run loop, 재시도, 멈춤, 대기와 복구

## 질문

run을 접수부터 종료까지 돌리는 loop가 입력(steering·follow-up), 불완전 응답, tool 묶음, 한도, 사람 대기, 재시작을 어느 경계에서 다루는지 알아야 한다. 조사한 여섯 프로젝트는 이 경계를 전부 메모리 안에서 처리하고, lophn은 같은 경계를 ledger 기록으로 남긴다. 아래는 그 차이를 숫자와 함께 비교한다.

조사일 2026-10-04. 코드로 읽은 프로젝트: OpenClaw `37efa0b4a644`, Hermes `343500b3547e`, OpenCode `907b3bc518fa`, Codex `3a69ec3ef8fb`, Pi `83692682f095`, Gemini CLI `fb972b2f87fe`. Claude Code 저장소에는 harness 소스가 없어 세지 않았다. `[확인]`은 해당 revision 코드에서 본 것, `[추측]`은 정황, `[미확인]`은 이번 조사에서 못 찾은 것이다.

## 프로젝트별

### Codex (`3a69ec3ef8fb`)

- turn 하나(`codex:codex-rs/core/src/session/turn.rs` `run_turn` 163–840)가 sampling과 tool 실행을 반복한다. sampling 전에 `input_queue.get_pending_input`을 비워 `PersistContext::SteeredUserInput`로 기록하고(439–449), sampling 중에는 `input_queue.watch_user_input`으로 새 입력이 오면 진행 중 sampling을 선점 취소한다(1644–1650). 선점 취소는 실패가 아니라 `needs_follow_up: true`로 돌아와 같은 turn이 이어진다. 모델이 follow-up을 요구하지 않고 대기 입력도 없으면 stop hook 뒤 turn이 끝난다. sampling 오류는 오류 이벤트를 내고 loop를 깨며 사람이 수동으로 이어 간다(833). `[확인]`
- 입력 모드는 `TurnInputMode` = StartOrSteer / StartIfIdle / ContinueIfIdle{expected_previous_turn_id} / Steer{expected_turn_id}다(`codex:codex-rs/protocol/src/turn_input.rs` 131–239). Steer 결과는 Started·Steered 또는 NotSubmitted(Superseded, ServerDraining, NotIdle, PendingTriggerTurn, PlanMode, NoActiveTurn)이고, 접수 자체는 hook·영속·sampling을 기다리지 않는다. steer로 받은 입력은 다음 turn부터 thread 설정에 적용되며 `final_output_json_schema`가 다르면 거절된다. `[확인]`
- 재시도는 두 층이다. `DEFAULT_STREAM_MAX_RETRIES = 5`, `DEFAULT_REQUEST_MAX_RETRIES = 4`, 상한 100(`codex:codex-rs/model-provider-info/src/lib.rs` 66–75, 499–510). `ApiRetryConfig`는 base_delay 200ms, `retry_429: false`, `retry_5xx: true`, `retry_transport: true`(454–460). 연결 실패는 `INITIAL_CONNECTION_RETRY_DELAY` 5초에서 시작해 2배씩 `MAX_CONNECTION_RETRY_DELAY` 60초까지이고(`codex:codex-rs/core/src/responses_retry.rs` `handle_response_stream_error` 57–176), `UnboundedConnectionRetries` feature가 켜진 외부 비-Bedrock 세션은 연결 실패를 예산 없이 재시도한다. 대기는 `sleep_until(max(now+delay, retry_after.deadline))`라 서버 시각보다 일찍 재시도하지 않는다. 소진되면 `ExhaustedResponseRetry {turn_id, retry_at}`를 남긴다. 재시도는 원래 입력에서 요청 전체를 다시 하므로 부분 stream은 버려진다(turn.rs 1668–1759). `[확인]`
- tool 병렬은 call별 `RwLock`이다(`codex:codex-rs/core/src/tools/parallel.rs` 125–347). `supports_parallel`이면 read lock, 아니면 write lock(205–209)이라 병렬 불가 call 하나가 나머지를 전부 직렬화한다. `tool_supports_parallel`은 registry 조회이고 기본값은 false다(`codex:codex-rs/core/src/tools/router.rs` 237–241, registry.rs 523). 결과는 stream이 끝난 뒤 요청 순서로 모은다(parallel.rs 229 주석). 취소 시 아직 terminal이 아닌 task는 abort하고 `AbortedToolOutput`("aborted by user after {secs:.1}s")을 합성한다(330–347). 일반 실패는 `success: false`인 `FunctionCallOutput` 텍스트가 되고 `Fatal`만 결과 없이 전파된다(303–327). `[확인]`
- 인자 파싱 실패는 `FunctionCallError::RespondToModel`로 모델에 오류 텍스트를 돌려 준다(router.rs 248–281). JSON을 고치는 코드는 찾지 못했다. `[확인]`
- 실행된 call은 기록해 재부착하므로 turn이 이어진다. 그러나 시작은 했으나 결과를 모르는 call의 rollout 재개 의미는 이번 조사에서 확인하지 못했다. `[미확인]`

### OpenCode (`907b3bc518fa`)

- 세션당 `Runner` 하나다(`opencode:packages/opencode/src/session/run-state.ts`). 메모리 `Map`이고, `ensureRunning`은 이미 도는 runner에 합류한다. 즉 실행 중 들어온 새 prompt는 같은 loop가 이어 받는다. `startShell`은 busy면 `BusyError`로 실패하고, `cancel`은 runner와 sessionId·parentSessionId가 맞는 background job을 함께 취소한다. `[확인]`
- `runLoop`는 무한 `while`이다(`opencode:packages/opencode/src/session/prompt.ts` 1081–1341). 마지막 assistant `finish`가 `tool-calls`·`unknown` 밖이고 살아있는 tool part가 없으면 나간다. `isOrphanedInterruptedTool`(96–100)은 status가 error이면서 `metadata.interrupted === true`인 part라 loop를 살리지 못한다. `maxSteps = agent.steps ?? Infinity`(1178)이고, 마지막 step에서는 `MAX_STEPS_PROMPT`(`opencode:packages/core/src/session/runner/max-steps.ts`)를 assistant prefill로 붙여 tool을 끄고 텍스트 요약 model call을 한 번 더 한다. 한도 뒤 model call을 금지하는 lophn R22와 정반대다. `[확인]`
- 같은 도구 이름·입력이 연속 3회면 `permission.ask({permission: "doom_loop"})`로 사람에게 묻는다(`opencode:packages/opencode/src/session/processor.ts` `DOOM_LOOP_THRESHOLD = 3`, 29, 352–380). 하드 스톱이 아니다. `cleanup()`(553–611)은 in-flight tool Deferred를 250ms 기다린 뒤 끝나지 않은 tool call마다 status error, "Tool execution aborted", `metadata.interrupted: true`를 찍는다. `[확인]`
- 재시도(`opencode:packages/opencode/src/session/retry.ts`): 초기 2초, backoff 2배, jitter 25%, 헤더가 없으면 상한 30초, 있으면 int32 최댓값, 최대 5회. `delay()`(47–78)는 `retry-after-ms`, `retry-after` 초, HTTP-date 순으로 서버 시각을 그대로 쓴다. `retryable()`(85–155)은 context overflow를 절대 재시도하지 않고 5xx는 항상 재시도하며, 429·500·502·503·504·524·rate-limit·overloaded·네트워크 오류를 정규식으로 잡는다. 재시도 상태는 `{attempt, message, action, next}`로 공개된다(processor.ts 674–688). `[확인]`
- 상태(`opencode:packages/opencode/src/session/status.ts`)는 idle / busy / retry 셋뿐인 메모리 `Map`이고 idle이면 항목을 지운다. 퍼센트는 없다. 사람 승인 대기도 busy로 남는다. `[확인]`
- 알 수 없는 tool은 오류 결과 "Unknown tool: name", execute handler가 없으면 오류 결과, schema decode 실패는 `ToolFailure("Invalid tool input")`이다(`opencode:packages/llm/src/tool-runtime.ts` `dispatch` 23–35). JSON 복구는 찾지 못했다. `[확인]` 일반 경로의 tool 실행 동시성과, `running` 상태로 남은 tool의 재시작 처리는 확인하지 못했다. `[미확인]`

### Pi (`83692682f095`)

- loop는 두 겹이다(`pi:packages/agent/src/agent-loop.ts` `runLoop` 163–321). 안쪽은 tool call과 steering, 바깥은 follow-up이다. `getSteeringMessages`는 시작(176), `prepareNextTurn` 뒤(204–206, 한 번에 하나씩 모드의 중복 전달 가드 포함), turn마다(295) 폴링되어 다음 assistant 응답 전에 주입된다. `getFollowUpMessages`(302)는 agent가 아니면 멈출 자리에서만 꺼낸다. `stopReason`이 error·aborted면 즉시 끝난다(245–256). `[확인]`
- `stopReason === "length"`면 `failToolCallsFromTruncatedMessage`(478–503)가 그 메시지의 tool call마다 "인자가 잘렸을 수 있어 실행하지 않았다, 다시 내라"는 오류 결과를 붙이고 `terminate: false`로 loop를 계속한다. 잘린 tool call을 실행하지 않고 다음 판단에 넘기는 조사 대상 중 가장 가까운 구현이다. `[확인]`
- `executeToolCalls`(508–523)는 `config.toolExecution === "sequential"`이거나 tool 하나의 `executionMode === "sequential"`이면 전부 순차고, 아니면 병렬이다. 병렬(586–660)은 모두 준비한 뒤 `Promise.all`하고 결과를 요청 순서로 내보내며, abort된 미시작 call은 "Operation aborted"를 받는다. 순차(530–584)는 abort에서 `break`하므로 꼬리 call은 결과 없이 남는다. `[확인]`
- `prepareToolCall`(707–776)은 없는 tool에 "Tool X not found" 오류 결과를, 인자 검증 실패에 오류 결과를 돌려 주고, `beforeToolCall`이 막을 수 있다. `runToolCall`(810)은 reject하지 않는다. 다만 `validateToolArguments`(`pi:packages/ai/src/utils/validation.ts` 317–350)는 검증 전에 `structuredClone` + TypeBox `Value.Convert` + `coerceWithJsonSchema`로 인자를 변환한다. harness가 인자를 고치지 않는다는 lophn R13과 충돌한다. `[확인]`
- 큐는 메모리 배열이다(`pi:packages/agent/src/agent.ts` `PendingMessageQueue` 143–174). 모드는 "all" | "one-at-a-time"이고 steering·follow-up 모두 기본은 한 번에 하나씩이다. `steer()`(299)와 `followUp()`(304)이 갈라지고, `toolExecution` 기본은 "parallel"(253), `abort()`는 run의 `AbortController`를 취소한다(341). 실행 중 `prompt()`는 throw한다(373–378). `maxRetryDelayMs`는 provider 재시도 대기 상한일 뿐 횟수 제한이 아니다. `[확인]`

### Gemini CLI (`fb972b2f87fe`)

- 재시도(`gemini-cli:packages/core/src/utils/retry.ts` `retryWithBackoff` 258–529): `DEFAULT_MAX_ATTEMPTS = 10`(20), 초기 5초, 상한 30초, jitter ±30%(320 부근). quota 오류는 서버 `retryDelayMs`를 바닥으로 삼고 그 위에 최대 +20% jitter를 더한다(472–488). 5xx는 재시도한다. capacity 소진은 1초·3초로 조용히 3회 재시도한 뒤 `onPersistent429`가 fallback model로 갈아타고 시도 카운터를 0으로 되돌린다(360–407). `AbortError`는 즉시 중단이다. `config.ts` 1386–1388이 `maxAttempts`를 `DEFAULT_MAX_ATTEMPTS`로 클램프하고, `defaultModelConfigs.ts`는 모델별 10 또는 3을 준다. 서버 시각 위에 jitter를 더하므로 lophn R23의 "서버 최소 재시도 시각을 지킨다"를 어긴다. `[확인]`
- turn 한도는 `DEFAULT_MAX_TURNS = 30`, `DEFAULT_MAX_TIME_MINUTES = 10`이다(`gemini-cli:packages/core/src/agents/types.ts` 51, 56). `agents/local-executor.ts` 592–593과 `agent/legacy-agent-session.ts` 181–189에서 검사하고 넘으면 `MAX_TURNS_EXCEEDED`를 낸다. 한도 뒤 요약 model call은 확인되지 않았다. subagent 재정의는 browser 50, codebase-investigator 50, generalist 20, cli-help 10이다. `[확인]`
- loop 감지(`gemini-cli:packages/core/src/services/loopDetectionService.ts` 29–66): 같은 tool call 5회, content loop는 50자 chunk 10회, history 상한 5000, turn 30 이후 5–15 turn마다(기본 10) LLM 판정, 신뢰도 0.9, `loop-detection-double-check` 별칭으로 재확인. 감지 뒤 실제로 무엇을 하는지는 읽지 못했다. `[미확인]`
- scheduler(`gemini-cli:packages/core/src/scheduler/scheduler.ts` `_processNextItem` 456–575)는 연속된 병렬 가능 call을 묶는다. `_isParallelizable`(577–594)는 `update_topic`과 `EDIT_TOOL_NAMES`를 강제로 순차, `args.wait_for_previous`를 존중하고, 기본은 병렬이다. 모든 활성 call이 scheduled 또는 terminal이 된 뒤에만 `Promise.all`로 실행한다(530–533). 상태는 validating, scheduled, awaiting_approval, executing, error, cancelled다. 취소는 `cancelAllQueued('Operation cancelled')`와 signal abort로 Cancelled가 된다(596–623). 승인 대기는 10ms마다 폴링하며(566–569) run이 살아 있는 채로 기다린다. `_createToolNotFoundErroredToolCall`(372)이 없는 tool을 오류 call로 만든다. `[확인]`
- finish reason이 없거나 `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL`, 빈 텍스트(MAX_TOKENS·SAFETY·RECITATION 포함)인 stream은 `InvalidStreamError`를 던져 재시도한다(`gemini-cli:packages/core/src/core/geminiChat.ts` 1573–1632). 이 분기는 `!hasToolCall`일 때라, MAX_TOKENS와 tool call이 함께 온 경우의 처리는 확인하지 못했다. `[미확인]`

### Hermes (`343500b3547e`)

- loop 조건은 `while (api_call_count < max_iterations and budget.remaining > 0) or _budget_grace_call`이다(`hermes:agent/conversation_loop.py` 1636). 예산 소진 뒤 grace call 한 번을 허용한다. `iteration_budget.py`의 모듈 docstring은 부모 기본 500, subagent `delegation.max_iterations` 기본 50이라고 하지만, `agent_init.py` 2391의 시그니처 기본값은 `max_iterations: int = sys.maxsize`다. 500은 docstring에만 있고 코드 기본값은 사실상 무제한이다. `[확인]`
- `api_max_retries` 기본 3(최소 1), `auto_recovery_cycles` 기본 5다(`hermes:agent/agent_init.py` 1461–1472). 5회 사다리의 각 단계는 `turn_recovery_autorecover.py`에 있고 이번 조사에서 읽지 못했다. `[미확인]` 빈 응답 재시도는 3회(축소 시 1), 비용 임계 $0.25, 기본 켜짐이다(`hermes:agent/empty_response_guard.py` 54–57). 바깥 loop 오류 상한은 `_MAX_OUTER_LOOP_ERRORS = 8`이다(conversation_loop.py 235). `[확인]`
- 잘림(`hermes:agent/turn_truncation.py`): tool call 잘림은 `boosted_output_cap`으로 최대 4회 재시도한다(382–397). cap은 `base·2ⁿ`, 천장 `max(32768, 2×cap)`, 모델의 알려진 출력 한계를 넘지 않는다. 깨진 응답은 이력에 붙이지 않는다(400–415). 4회 뒤에는 불완전 인자 실행을 거절하고 turn을 끝낸다(416–445, `close_interrupted_tool_sequence`). 텍스트 잘림은 fragment와 합성 user 메시지로 최대 4회 이어 붙인 뒤 천장에서 기워 붙인 부분을 유지한다(305–370). thinking 소진과 반복은 이어 붙이기 전에 abort한다(250–262). content-filter stall은 먼저 fallback 체인으로 올린다(265–302). `[확인]`
- tool 실행(`hermes:agent/tool_executor.py`): 워커 상한 `_MAX_TOOL_WORKERS = 8`(129). 순차 경로는 call마다 `_interrupt_requested`를 확인하고, 남은 call에는 "[Tool execution cancelled — {name} was skipped due to user interrupt]"와 "[Tool execution skipped — {name} was not started...]"를 합성한다(1840–1890). timeout 결과는 `effect_disposition="unknown"`을 실어 나른다(1809 부근). `run_tool_round`(`hermes:agent/turn_tool_round.py` 46–163)는 어떤 side effect보다 먼저 assistant tool-call 메시지를 영속하고, 잘못된 tool 이름은 오류 결과를 받되 같은 묶음의 정상 call은 실행되며, 파싱 불가 인자는 순차 장벽과 invalid-arguments 결과가 된다. JSON 복구는 없다. `[확인]`
- 묶음 분할(`hermes:agent/tool_dispatch_helpers.py` `_plan_tool_batch_segments` 198–244)은 호출 순서를 지키며 ("parallel" | "sequential") segment로 나눈다. `_NEVER_PARALLEL_TOOLS`, 파싱 불가·dict가 아닌 인자, 병렬 안전 집합 밖은 장벽이다. 경로가 겹치면 reader↔reader일 때만 같은 run에 두고 writer가 끼면 run을 닫는다. 길이 2 미만 run은 순차로 내린다. connector만으로 된 묶음은 병렬 안전하고 로컬 항목이 하나라도 있으면 아니다(150–155). `[확인]`
- 실패한 turn의 durable tail이 `user`면 Hermes가 쓴 assistant 경계를 붙여 다음 prompt가 합쳐지지 않게 한다(`hermes:agent/conversation_loop.py` `_close_durable_failed_turn` 1789–1832). context 압력 실패는 제외한다. 재시작 중복 제거는 플랫폼 메시지 id를 쓴다(1551–1553 docstring). `[확인]` `deadline.py`의 `resolve_timeout`은 환경변수 override와 Windows clamp가 있으나 기본 숫자값은 읽지 못했다. `[미확인]`

### OpenClaw (`37efa0b4a644`)

- 큐 모드는 interrupt / steer / followup / collect이고, 레거시 `queue`는 steer로, `steer+backlog`는 followup으로 정규화된다(`openclaw:src/auto-reply/reply/queue/normalize.ts` 6–37). drop 정책은 old / new / summarize다. 기본 모드는 "steer"이고(`openclaw:src/auto-reply/reply/queue/settings.ts` `resolveQueueSettingsCore` 22–57), `state.ts` 47–49의 기본값은 debounce 500ms, cap 20, drop "summarize"다. `[확인]`
- 큐 저장소는 `FOLLOWUP_QUEUES = resolveGlobalMap(Symbol.for("openclaw.followupQueues"))`로 프로세스 메모리 전역이다(`openclaw:src/auto-reply/reply/queue/state.ts` 55–57). 디스크가 아니다. `[확인]`
- 세션당 활성 reply run은 `admitReplyTurn`으로 하나다(`openclaw:src/auto-reply/reply/get-reply-run-admission.ts` 552–628). steer는 활성 run에 주입하고, followup·collect는 뒤에 줄 세우며, interrupt는 대상을 정한 뒤 run이 가라앉기를 기다려(`REPLY_RUN_IDLE_SETTLE_TIMEOUT_MS`, 값은 읽지 못했다 `[미확인]`) 즉시 실행한다. `[확인]`
- 실제 steering은 내장 Pi agent가 한다. `steer()`(`openclaw:src/agents/sessions/agent-session-prompting.ts` 443–477)의 주석은 다음 미시작 tool 실행이나 model call 전에 전달되고, 이미 도는 tool은 계속되며, 억제된 call은 짝이 맞는 합성 결과를 받는다고 적는다. `followUp()`은 486–492다. 주입 시 `steeringMode: "all"`을 준다(`openclaw:src/gateway/server-methods/chat-send-message-injection.ts` 190, `openclaw:src/agents/embedded-agent-runner/run/attempt-stream-prepare.ts` 504–505). collect 모드의 합치기(`queue/drain.ts` 1082)는 본문을 읽지 못했다. `[미확인]`

## 비교

### 재시도와 한도

| | model 재시도 | 대기 | 서버 retry 시각 | tool 재시도 | turn·시간 한도 | 한도 뒤 model call |
|---|---|---|---|---|---|---|
| lophn | 일시 실패만, 최초 뒤 최대 2 (R23) | 2초·4초 | 그대로 지킴 | 읽기·계약 멱등 쓰기만, 최초 뒤 1, 1초±10% (R24) | model 시도 30, 무진행 5분, 활성 30분 (R20) | 없음. machine 정리 (R22) |
| Codex | stream 5 + request 4, 429 제외 | base 200ms, 연결 5초→60초 | `max(now+delay, deadline)`로 지킴 | 별도 자동 재시도 없음 `[확인]` | turn 횟수 한도 없음 `[확인]` | 없음. 오류 내고 사람이 이음 |
| OpenCode | 5, context overflow 제외 | 2초×2, jitter 25%, 무헤더 상한 30초 | 헤더 값을 그대로 | 없음 `[확인]` | `agent.steps ?? Infinity` | 있음. `MAX_STEPS_PROMPT` 요약 call |
| Pi | 횟수 제한 없음, `maxRetryDelayMs`는 대기 상한뿐 | provider 구현에 따름 | `[미확인]` | 없음 `[확인]` | 없음 `[확인]` | 없음 |
| Gemini CLI | 10 (모델별 3), 5xx 포함, 429는 fallback model | 5초, 상한 30초, jitter ±30% | 바닥으로만 쓰고 +20%를 더함 | 없음 `[확인]` | turn 30, 시간 10분 | 없음 `[확인]` |
| Hermes | `api_max_retries` 3 + `auto_recovery_cycles` 5 | `[미확인]` | `[미확인]` | 없음. timeout은 `effect_disposition="unknown"` | `max_iterations` 코드 기본 `sys.maxsize`, docstring만 500. grace call 1 | 잘림 이어 붙이기 최대 4 |
| OpenClaw | 내장 Pi에 위임 | — | — | — | — | — |

lophn의 재시도 예산이 조사 대상 전부보다 작다. 서버 시각을 정확히 지키는 것은 Codex와 OpenCode뿐이고, Gemini는 그 위에 jitter를 더한다.

### 입력, 병렬, 잘림

| | 실행 중 입력 | 큐 저장 | 병렬 조건 | 잘린 tool call | 인자 오류 |
|---|---|---|---|---|---|
| lophn | 다음 tool 시작 전 반영 (R10) | ledger `runs(state=accepted)` | 전부 확인된 읽기일 때만, 아니면 전체 순차 (R12) | 0개 시작, 잘림 사실을 다음 판단에 (R11) | 오류 결과, 인자 수정 없음 (R13) |
| Codex | sampling 선점 취소 후 같은 turn에서 재요청 | 세션 `input_queue`, 기록 전 유실 | `supports_parallel` read lock, 하나라도 아니면 전체 직렬 | 부분 stream 폐기 후 요청 전체 재시도 | `RespondToModel` 오류 텍스트 |
| OpenCode | 같은 runner에 합류 | 메모리 runner `Map` | `[미확인]` | `[미확인]` | `ToolFailure("Invalid tool input")` |
| Pi | steering은 다음 응답 전, follow-up은 멈출 자리에서 | 메모리 배열, 기본 한 번에 하나 | 기본 병렬, sequential tool 하나면 전체 순차 | 오류 결과로 바꾸고 재발행 유도 | 검증 전 TypeBox 변환 |
| Gemini CLI | `[미확인]` | `[미확인]` | 기본 병렬, edit tool·`wait_for_previous`만 순차 | tool call 없는 경우만 `InvalidStreamError` 재시도 | 없는 tool은 오류 call (372) |
| Hermes | interrupt 합성 결과 | 플랫폼 메시지 영속 | 경로 겹침 분할, writer 포함 시 순차, 워커 8 | 4회 증액 재시도 후 turn 종료, 실행 안 함 | 순차 장벽 + invalid-arguments 결과 |
| OpenClaw | steer는 미시작 tool 전 주입, 도는 tool은 유지 | 프로세스 전역 `Map`, cap 20, drop summarize | Pi에 위임 | Pi에 위임 | Pi에 위임 |

사람 대기 상태는 어느 프로젝트에도 없다. OpenCode는 idle/busy/retry뿐이고 승인 대기 중에도 busy다. Gemini는 `awaiting_approval`을 run이 살아있는 채로 10ms마다 폴링한다. 큐는 여섯 프로젝트 모두 메모리다. Codex만 steer를 `run_hooks_and_record_inputs`로 기록한 뒤라, 기록 전 죽은 경우만 잃는다.

## lophn에 가져올 것과 버릴 것

### 접수와 시작 (R1–R7)

- R1, R2. 가져올 것 없음. 조사 대상은 자료 변경·결과 도착으로 run을 만들지 않는 규칙을 둘 필요가 없는 단일 세션 구조다. ledger 중복 규칙으로 재전달을 이전 결과에 합치는 것은 lophn 고유다.
- R3. 세션당 run 하나라는 형태는 공통이다. Codex `TurnInputMode`, OpenCode `ensureRunning`, OpenClaw `admitReplyTurn` 모두 세션 하나 = 활성 run 하나다. 다만 범위가 세션이지 assignment가 아니다. assignment 부분 유니크 인덱스는 그대로 둔다.
- R4. 우선순위 3단과 8연속 후 양보는 어느 프로젝트에도 없다. OpenClaw의 cap 20 + drop "summarize"는 오래된 입력을 요약으로 버린다. R5가 10분이 넘어도 폐기를 금지하고 R20이 역할의 한도 인상을 금지하므로 이 방식은 버린다. 8회 양보와 assignment FIFO는 전용 테스트가 필요하다(architecture §8.3).
- R6. Codex는 sampling 오류에서 loop를 깨고 사람 입력을 기다린다(turn.rs 833). "실패하면 사람이 확인하기 전 다음 요청을 시작하지 않는다"와 방향이 같다. 다만 Codex는 대기 입력을 보존하는 명시 상태가 없다.
- R7. 대응 구현 없음. handoff packet은 lophn 고유다.

### turn과 tool 묶음 (R8–R13)

- R8. model 대기가 저장 트랜잭션을 잡지 않는 점은 모두 같다. 명시 규칙으로 적은 곳은 없다.
- R9. Pi의 두 겹 loop(안쪽 tool+steering, 바깥 follow-up)와 Codex의 "sampling 전 입력 drain, 조립 뒤 재확인"이 가장 가깝다. lophn의 멈춤 확인→입력 선택→대기·한도 검사→조립→model call→완전성 확인→tool 묶음→영속→계속 판정 순서를 그대로 쓰고, 조립 뒤 입력·멈춤 재확인은 Codex의 `watch_user_input` 선점처럼 진행 중에도 받게 한다.
- R10. 가져올 것: OpenClaw `steer()`의 주석대로 이미 실행 중인 tool은 끝내고 미시작 tool 앞에서 반영한다. 억제된 call에 짝이 맞는 합성 결과를 남기는 것도 R15의 미실행 처리와 맞다. 버릴 것: Codex의 sampling 선점 취소. lophn은 진행 중 model call을 입력 때문에 취소하지 않고 그 응답이 끝난 뒤 반영한다.
- R11. 가져올 것: Pi `failToolCallsFromTruncatedMessage`. 잘린 메시지의 tool call을 실행하지 않고 오류 결과로 다음 판단에 넘긴다. 버릴 것: Hermes의 출력 cap 증액 재시도 4회. R23은 부분 응답을 채택하지 않고 같은 입력만 재시도한다. 버릴 것: Gemini의 `InvalidStreamError` 재시도. tool call이 없는 분기에만 적용돼 경계가 흐리고, 재시도 예산도 10회로 크다.
- R12. 가져올 것: 결과 순서 고정. Codex·Pi 모두 병렬 실행 뒤 요청 순서로 모은다. 버릴 것: 네 프로젝트의 병렬 판정. Codex의 `supports_parallel` 기본 false, Pi의 기본 병렬, Gemini의 기본 병렬, Hermes의 경로 겹침 분할은 모두 "전부 확인된 읽기일 때만"보다 느슨하다. lophn은 tool이 병렬을 선언하는 대신 읽기 확인으로 판정한다.
- R13. 가져올 것: 오류를 tool 결과로 돌려 주는 방식. Codex `RespondToModel`, OpenCode `ToolFailure`, Pi의 "Tool X not found", Hermes의 invalid-arguments 결과가 모두 그렇다. 가져올 것: Hermes의 혼합 묶음 처리. 잘못된 이름이 있어도 정상 call은 실행하고, 파싱 불가 인자는 순차 장벽이 된다. 버릴 것: Pi `validateToolArguments`의 TypeBox `Value.Convert` 변환. 검증 전 인자 변환은 R13이 금지한다. JSON 복구는 여섯 프로젝트 어디에도 없어 새로 만들 이유가 없다.

### 끝남과 멈춤 (R14–R18)

- R14. 가져올 것: Pi의 종료 조건 분리. steering은 다음 응답 전에 반영하고 follow-up은 멈출 자리에서만 꺼낸다. "다음 일 요청이 정상 종료를 막지 않는다"와 같다. 버릴 것: OpenCode의 무한 loop. `finish`가 `tool-calls`·`unknown`이면 입력이 없어도 계속 돈다.
- R15. 가져올 것: 미시작 call의 합성 결과. Codex `AbortedToolOutput`, Hermes의 "skipped due to user interrupt" / "was not started", Pi 병렬 경로의 "Operation aborted"가 같은 자리다. 주의: Pi 순차 경로는 abort에서 `break`만 하고 꼬리 call 결과를 남기지 않는다(agent-loop.ts 575). lophn은 미시작 call 전부에 미실행 이유를 남기므로 Pi 순차 경로를 따르지 않는다.
- R16. 가져올 것: Hermes의 timeout `effect_disposition="unknown"`. 이미 시작한 외부 효과를 취소·성공으로 꾸미지 않는 유일한 명시 표현이다. 다만 Hermes는 run을 끝내지 않고 표시만 한다. lophn R10(waiting-and-recovery)은 확인 불가면 `effect_unknown`으로 끝낸다.
- R17. 대응 구현 없음. 조사 대상은 사람이 멈춘 run을 재시작 때 자동으로 살리지 않는다는 규칙을 따로 두지 않는다. 사람 멈춤과 프로세스 죽음을 구분해 저장해야 lophn에서만 의미가 있다.
- R18. 가져올 것: Hermes `_close_durable_failed_turn`. 실패한 turn의 tail이 `user`면 assistant 경계를 붙여 다음 입력이 합쳐지지 않게 한다. run 종료 기록의 원자성과 같은 문제다.

### 보이는 상태 (R19, waiting R6)

- 가져올 것: OpenCode의 상태 공개 방식. `{attempt, message, action, next}`로 재시도 이유를 보여 주고 퍼센트는 없다. 버릴 것: idle/busy/retry 세 값. 사람 대기가 busy에 섞여 R19의 "내 답 기다림"이 사라진다. 사람 대기 상태는 조사 대상 전체에 없으므로 lophn이 새로 만든다. Gemini의 10ms 폴링은 run을 살려 둔 채 기다리는 방식이라 R8의 "대기가 쓰기 흐름을 점유하지 않는다"와 맞지 않아 버린다.

### 한도와 retry (R20–R25)

- R20. 숫자 비교는 위 표와 같다. Gemini의 turn 30은 lophn의 model 시도 30과 단위가 다르다. Gemini는 turn을 세고 lophn은 실패 포함 model 시도를 센다(R21). 어느 쪽도 역할이 한도를 올리지 못한다. Gemini `maxAttempts` 클램프(config.ts 1386–1388)가 같은 방향이다.
- R21. 가져올 것 없음. 부분 token을 진행으로 치지 않는 명시 규칙은 조사 대상에 없다. Codex가 부분 stream을 버리고 원래 입력으로 재시도하는 것이 가장 가깝다.
- R22. 가져올 것 없음. OpenCode의 `MAX_STEPS_PROMPT` 마무리 model call은 R22가 명시한 버린 것(한도 뒤 30초 model call 한 번)과 같다. 테스트는 한도 도달 뒤 model call 0건을 단언해야 한다. Hermes의 grace call 1회(`_budget_grace_call`)와 텍스트 잘림 이어 붙이기 4회도 한도 뒤 model call이라 따르지 않는다.
- R23. 가져올 것: Codex의 `sleep_until(max(now+delay, retry_after.deadline))`과 OpenCode의 헤더 우선 `delay()`. 서버 시각 전에는 재시도하지 않는다. 버릴 것: Gemini의 서버 지연 +20% jitter, Codex의 `UnboundedConnectionRetries`(예산 없는 재시도), Gemini의 429 fallback model 전환(계정을 숨어서 바꾸지 않는다). 대기 2초·4초는 조사 대상보다 짧다. OpenCode 기본 2초에서 시작해 30초까지 늘어나고 Codex 연결 재시도는 5초에서 시작한다.
- R24. 대응 구현 없음. 조사 대상은 tool 자동 재시도를 두지 않고 오류 결과를 모델에 돌려 다음 판단에 맡긴다. lophn의 "읽기 또는 계약상 멱등인 쓰기만, 1회, 매번 재판정"은 그 사이에 좁은 재시도를 끼워 넣는 것이라 판정 재실행 순서가 핵심이다. 거절·잘못된 입력·문맥 초과를 재시도하지 않는 점은 OpenCode가 context overflow를 재시도에서 제외하는 것과 같다.
- R25. 가져올 것: OpenCode `cancel`이 runner와 파생 background job을 함께 취소하는 범위. 이미 시작한 결과의 확인은 waiting-and-recovery R10 경계로 넘긴다.

### 기다림 (waiting R1–R5)

- R1. 대응 구현 없음. 조사 대상은 질문과 답 만료를 run 종료 이유로 다루지 않는다. "답 없음"을 `stopped` 이유로 남기는 것은 lophn 고유다.
- R2. 가져올 것 없음. 승인 후 현재 상태·scope·입력을 다시 검사하고 그 call 한 번만 실행하는 구현은 찾지 못했다. Gemini의 `awaiting_approval`은 검사 없이 10ms 폴링으로 재개한다.
- R3. 가져올 것 없음. 사람 거절을 실패 횟수에서 빼는 규칙은 조사 대상에 없다. OpenCode `doom_loop`은 반대로 반복을 사람에게 물어 실패 횟수 대신 허가를 센다.
- R4. 가져올 것: Codex의 NotSubmitted 사유 구분(Superseded, PlanMode, NoActiveTurn). 명시 steering이 옛 질문을 취소할 때 "왜 적용되지 않았는지"를 결과로 남기는 형태가 참고가 된다. 처리 규칙 자체(질문 취소 → no_answer, approval 취소 → 미실행 후 같은 run 재판단)는 lophn 고유다.
- R5. 대응 구현 없음. 결정 접수와 적용을 따로 기록하는 곳은 없다.

### 복구 (waiting R7–R12)

- R7. 가져올 것: Codex `ExhaustedResponseRetry {turn_id, retry_at}`. 재시도 예정 시각을 남겨 재시작 뒤 남은 대기만 잇는 형태다. lophn은 이를 ledger에 남긴다.
- R8. 가져올 것: Hermes `run_tool_round`의 순서. side effect 전에 assistant tool-call 메시지를 영속한다. "순차 세 call 중 둘째 결과 뒤 끊기면 셋째부터"는 이 기록이 있어야 가능하다. 저장 실패를 완료로 가정하지 않는 점도 Hermes가 durable tail을 따로 닫는 이유와 같다.
- R9. 가져올 것 없음. 비사용자 중단을 저장된 경계에서 같은 run으로 자동 복구하는 구현은 찾지 못했다. Codex는 오류에서 멈추고 사람이 잇는다. 자동 복구 자체는 lophn이 더 적극적이므로, 새 진입 전 assignment·판정·안전·credential·누적 한도 재확인이 빠지면 위험하다.
- R10. 가져올 것: Hermes의 `effect_disposition="unknown"` 표현. 버릴 것: 그 뒤의 처리. Hermes는 표시만 하고 계속 돌릴 수 있다. lophn은 확인 불가면 run을 `effect_unknown`으로 끝내고 충돌하는 후속 call을 막는다. 확인 가능한 효과와 확인 불가 효과를 owner contract로 나누는 것은 조사 대상에 없다.
- R11. 대응 구현 없음. 재시작 뒤 대기 요청을 실제 현재 결정과 대조해 한 번만 반영하는 구현은 찾지 못했다.
- R12. 이 조사의 범위 밖이다. prompt 조립 조사를 따른다.

### open-issues 후보

없음. 조사 대상과 숫자가 다른 지점(재시도 횟수, 대기 시간, 한도 단위)은 요구가 이미 명시적으로 더 작게 고른 값이라 요구를 바꿀 근거가 되지 않는다. 요구가 빠뜨린 경계도 찾지 못했다.

## 구현 메모

### 상태와 기록 경계

run 상태는 accepted → running → waiting_user → finished다. finished는 다시 열지 않는다. 종료 이유는 completed / failed / stopped와 고정 이유 enum 하나다.

복구가 되려면 경계마다 ledger 기록이 먼저다.

| 경계 | 죽기 직전 상태 | 재시작 시 |
|---|---|---|
| 접수 | accepted 기록 완료 | 그대로 큐에 있음 |
| model 요청 전송, 응답 없음 | 시도 횟수만 증가 | 불확실로 표시, 남은 예산 안에서 같은 입력 재시도 |
| 완전 응답 저장됨 | tool 미시작 | 응답 재사용, 미시작 call부터 |
| 응답 저장 응답 유실 | 쓰기 결과 모름 | idempotency 조회로 확인 |
| tool 실행, 결과 모름 | 외부 효과 | owner contract로 조회, 불가하면 `effect_unknown` 종료 |
| waiting_user | 결정 미반영 | 살아있는 결정을 다시 읽어 한 번만 적용 |
| finished | 늦은 결과 도착 | 감사 보충만, 재개 없음 |

사람 멈춤은 별도 표시로 저장한다. 프로세스 죽음과 구분되지 않으면 R17의 "자동 재개 금지"를 지킬 수 없다.

### 기본값

| 항목 | 값 | 근거 |
|---|---|---|
| model 시도 | 30 (실패 포함) | run-loop R20, R21 |
| 무진행 시간 | 300000ms, 완전 응답 또는 확정 tool 결과만 리셋 | R20, R21 |
| 활성 시간 | 1800000ms, waiting_user 제외 | R20 |
| model 재시도 | 최초 뒤 최대 2, 2초·4초, 서버 시각 우선 | R23 |
| tool 재시도 | 최초 뒤 최대 1, 1000ms±10%, 읽기·계약 멱등 쓰기만 | R24 |
| 우선순위 양보 | 상위 8개 연속 시작 후 최장 대기 하위에 양보 | R4 |
| 활성 run | assignment당 running·waiting_user 하나 | R3 |

### 오류 분류

| 오류 | 처리 | 횟수에 셈 |
|---|---|---|
| provider 일시 실패 | 같은 입력 재시도, 부분 응답 폐기 | model 시도에 셈 |
| 출력 잘림·단절 | tool 0개 시작, 잘림 사실을 다음 판단에 | model 시도에 셈 |
| 없는 tool·잘못된 인자 | call별 오류 결과, 인자 수정 없음 | 재시도 없음 |
| 거절·만료·취소·대상 소멸·문맥 초과 | 재시도 없음 | tool·run 실패에서 제외 (사람 거절·만료·취소) |
| 읽기 tool 일시 실패 | 1회 재시도 후 재판정 | 셈 |
| 쓰기 결과 불명 | 조회 또는 `effect_unknown` 종료 | 셈하지 않고 종료 이유로 |
| 사람 멈춤 | 미시작 call 미실행, 진행 중 호출에 중단 요청 | 셈하지 않음 |

### 테스트 경계

architecture §8.3의 항목 가운데 이 주제가 만들 fixture다. fake provider, fake clock, fake owner contract, fresh ledger를 쓴다.

- 한도 도달 뒤 model call 0건. model 시도 30, 무진행 5분, 활성 30분 각각에서 단언한다. OpenCode식 마무리 call이 들어가지 않는지 본다.
- 잘린 응답. tool call JSON이 중간에 끊긴 응답에서 tool 시작 0건, 다음 판단 입력에 잘림 사실이 있는지.
- 인자 변환 금지. 타입이 다른 인자(문자열 숫자 등)를 받아도 변환 없이 오류 결과로 돌려 주는지.
- 병렬 조건. 읽기 확인 call만 병렬, 미분류 call 하나가 섞이면 묶음 전체가 요청 순서 순차, 병렬 결과는 요청 순서.
- 멈춤 경합. tool 묶음 실행 중 사람 멈춤이 접수되면 미시작 call 전부에 미실행 이유가 남고, 이미 시작한 외부 효과는 취소 성공으로 바뀌지 않는지. Pi 순차 경로처럼 꼬리가 비면 실패다.
- 재시도 시각. 서버 `retry_at`이 4초 대기보다 늦으면 그 시각 전에 재시도가 없는지. fake clock으로 확인한다.
- 큐 내구성. accepted 기록 직후, model 응답 저장 직후, tool 결과 저장 직후 각각 죽여도 중복 run·중복 효과가 없는지.
- 양보. 상위 우선순위 8개 연속 시작 뒤 최장 대기 하위가 다음 자리를 받는지. 사람 대기 중인 run이 있어도 주기는 skip되고 최근 missed 하나만 접수되는지.
- 사람 멈춤 재시작. 사람이 멈춘 run은 프로세스 재시작으로 재개되지 않고, 프로세스 죽음으로 끊긴 run은 저장된 경계에서 같은 run으로 재개되는지.
- 효과 불명. owner contract가 결과를 모르면 `effect_unknown`으로 끝나고, 그 효과와 충돌하는 후속 call이 시작되지 않는지.
- 늦은 결정. finished 뒤 도착한 답·approval·tool 결과는 감사 보충만 되고 새 동작을 만들지 않는지.
