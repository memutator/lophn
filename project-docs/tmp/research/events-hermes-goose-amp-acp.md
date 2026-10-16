# Event 조사: Hermes, Goose, Amp, ACP

조사한 날: 2026-10-13. 사실만 쓴다. 추천이나 lophn 설계 제안은 없다.

## 읽는 법

- "통로"는 event가 밖으로 나오는 길이다. hook은 그 한 가지다.
- "막기/바꾸기"는 받는 쪽이 흐름을 멈추거나 입력과 결과를 바꿀 수 있는지다.
- 근거 표기:
  - 경로는 clone한 repo 안의 경로이고 commit을 붙였다.
  - Hermes `63d0b941`, Goose `69de89c5`, ACP `989389c1`.
  - clone 위치: `/tmp/claude-1000/-home-pyosechang-projects-lophn-project-docs/c3fd2111-562b-41c5-8a67-86a862b12e16/scratchpad/research/`
  - 경로 앞의 `hermes:`, `goose:`, `acp:`는 각 repo 이름이다.
- Amp는 closed source라 source를 못 읽었다. 공식 문서만 봤고, 문서 page는 WebFetch가 준 요약으로 읽었다(원문 그대로가 아니다). 그래서 Amp 쪽 field 이름은 한 번 더 확인이 필요하다.

---

## 1. Hermes Agent

repo: github.com/NousResearch/hermes-agent @ `63d0b941`.
event를 내보내는 통로가 여러 개다. 문서 `hermes:website/docs/user-guide/features/hooks.md`는 hook 시스템을 네 가지로 나눈다.

| 통로 | 등록 | 어디서 도나 |
|---|---|---|
| gateway hook | `~/.hermes/hooks/<name>/HOOK.yaml` + `handler.py` | gateway만 (Telegram, Discord 등). CLI, TUI, Desktop, cron은 안 읽는다 |
| plugin hook | plugin의 `ctx.register_hook()` (Python) | CLI + gateway |
| shell hook | `config.yaml`의 `hooks:` 블록 (subprocess) | CLI + gateway + Desktop/TUI/dashboard |
| outbound webhook | `config.yaml`의 `hooks.outbound:` | CLI + gateway |

이 밖에 desktop app과 TUI가 쓰는 JSON-RPC event frame(`tui_gateway`), ACP adapter, middleware가 있다.

### 1-1. gateway hook event

근거: `hermes:website/docs/user-guide/features/hooks.md` "Available Events". emit 호출은 `hermes:gateway/` 아래에서 `gateway:startup`, `session:start`, `session:end`, `session:reset`, `agent:start`, `agent:step`, `agent:end`, `command:<name>`을 확인했다. `session:compress`와 `reaction:*`의 emit 호출은 못 찾았다(문서에만 있음).

| event | 통로 | 언제 | 주요 field | 막기/바꾸기 | 근거 |
|---|---|---|---|---|---|
| `gateway:startup` | gateway hook | gateway process 시작 | `platforms` | 못 함 | 위 문서 |
| `session:start` | gateway hook | 새 messaging session 생성 | `platform`, `user_id`, `session_id`, `session_key` | 못 함 | 위 문서 |
| `session:end` | gateway hook | session 끝(reset 전) | `platform`, `user_id`, `session_key` | 못 함 | 위 문서 |
| `session:reset` | gateway hook | 사용자가 `/new`, `/reset` | 같음 | 못 함 | 위 문서 |
| `session:compress` | gateway hook | context compress 끝 | `session_id`, `old_session_id`, `in_place`, `compression_count` | 못 함 | 위 문서 (emit 코드 확인 못함) |
| `agent:start` | gateway hook | agent가 메시지 처리 시작 | `platform`, `user_id`, `chat_id`, `thread_id`, `chat_type`, `session_id`, `message`(500자까지) | 못 함 | 위 문서 |
| `agent:step` | gateway hook | tool 호출 loop 한 바퀴마다 | `iteration`, `tool_names` | 못 함 | 위 문서 |
| `agent:end` | gateway hook | agent 처리 끝 | `agent:start` field + `response`(500자) | 못 함 | 위 문서 |
| `reaction:added`, `reaction:removed` | gateway hook | emoji reaction (Slack만) | `reaction`, `channel_id`, `message_ts` 등 | 못 함 | 위 문서 |
| `command:*` | gateway hook | slash command 실행 | `command`, `args` | 못 함 | 위 문서, `hermes:gateway/run_inbound.py:789` |

gateway hook은 handler 오류를 잡아 로그만 남기고 agent를 멈추지 않는다. 판정을 돌려주는 값은 없다.

### 1-2. plugin hook event (`VALID_HOOKS`)

근거: 목록은 `hermes:hermes_cli/plugins.py` `VALID_HOOKS`(109행~), field와 시점은 `hermes:website/docs/user-guide/features/hooks.md` "Shipped plugin-hook catalog". 모든 callback에 `telemetry_schema_version="hermes.observer.v1"`이 붙는다.

| event | 언제 | 주요 field | 막기/바꾸기 |
|---|---|---|---|
| `pre_tool_call` | tool 실행 직전 | `tool_name`, `args`, `task_id`, `session_id`, `tool_call_id`, `turn_id` | 막는다 `{"action":"block"}`, 사람 승인으로 올린다 `approve`, 인자를 바꾼다 `modify`. timeout이나 예외면 막는 쪽(fail closed) |
| `post_tool_call` | tool 끝(성공, 오류, 막힘 모두) | 위 + `result`, `duration_ms`, `status`, `error_type` | 못 함 |
| `transform_tool_result` | `post_tool_call` 뒤, 대화에 붙이기 전 | `result` 등 | 결과 문자열 교체 |
| `transform_terminal_output` | terminal 출력 잡은 뒤 | `command`, `output`, `returncode` | 출력 교체 |
| `pre_llm_call` | user turn마다 한 번, loop 시작 전 | `user_message`, `conversation_history`, `is_first_turn`, `model`, `platform` | context 문자열을 user 메시지에 붙인다 |
| `post_llm_call` | turn이 정상 끝났을 때 | `user_message`, `assistant_response`, `conversation_history` | 못 함 |
| `transform_llm_output` | 최종 응답 보내기 전 | `response_text` | 응답 교체 |
| `pre_verify` | 코드를 고친 turn이 끝나기 직전 | `final_response`, `changed_paths`, `attempt` | continue/block으로 turn을 더 이어가게 한다 |
| `pre_api_request` | model API 시도마다, 요청 직전 | `api_request_id`, `provider`, `model`, `request_messages`, `approx_input_tokens`, `retry_count` | 못 함 |
| `post_api_request` | API 성공 | `api_duration`, `finish_reason`, `usage`, `assistant_message` | 못 함 |
| `api_request_error` | API 시도 실패마다 | `status_code`, `retryable`, `reason`, `error` | 못 함 |
| `transform_api_error_classification` | 실패한 API 시도의 오류 분류 직전 | `error_message`, `status_code`, `context_length` | 분류 결과 교체 (Python plugin만) |
| `pre_auxiliary_call`, `post_auxiliary_call` | 보조 LLM 호출(제목 짓기, compress, MoA, vision 등) | `aux_task`, 위 API field | 못 함 |
| `on_stream_start`, `on_stream_delta`, `on_stream_end`, `on_interim_message` | streaming 응답 시작, 조각, 끝, 중간 메시지 | `delta`, `kind`(text/reasoning), `final_text`, `turn_id`, `iteration` | 못 함. 별도 queue로 전달하고 가득 차면 오래된 것부터 버린다 |
| `on_session_start` | 새 session의 첫 turn | `session_id`, `model`, `platform` | 못 함 |
| `on_session_end` | turn(run) 마무리마다. CLI/TUI 종료 때는 축소된 모양도 있음 | `completed`, `failed`, `interrupted`, `turn_exit_reason` | 못 함 |
| `on_session_finalize` | CLI/TUI/gateway에서 session 정리 | `session_id`, `reason`, `old_session_id`, `new_session_id` | 못 함 |
| `on_session_reset` | session이 새 id로 넘어갈 때 | 위와 비슷 | 못 함 |
| `agent_loop_stopped` | 돌고 있던 agent를 interrupt한 직후 | `session_key`, `platform`, `reason` | 못 함 |
| `subagent_start` | child 생성, 실행 직전 | `parent_session_id`, `child_session_id`, `child_role`, `child_goal` | 못 함 |
| `subagent_stop` | child 종료 | `child_summary`, `child_status`, `tool_call_history`, `duration_ms` | 못 함 |
| `pre_approval_request` | 승인 묻기 직전 | `command`, `description`, `pattern_key`, `surface`, `tool_call_id` | 못 함 (막는 건 `pre_tool_call`에서) |
| `post_approval_response` | 승인 결정, timeout, 알림 실패 뒤 | 위 + `choice`, `decided_by` | 못 함 |
| `on_human_input_request` | agent가 사람을 기다리기 직전(sudo 비밀번호, clarify 질문, 위험 명령 승인) | `kind`, `request_id`, `prompt`(항상 가림) | 못 함 |
| `on_human_input_resolved` | 그 기다림이 끝났을 때 한 번 | 위 + `outcome` (답은 안 줌) | 못 함 |
| `on_skill_lifecycle` | skill 사용 상태가 바뀐 뒤 | `action`, `skill_name`, `use_count` | 못 함 |
| `pre_gateway_dispatch` | 들어온 메시지, 인증 전 | `event`, `gateway`, `session_store` | 버리기 `skip`, 글 바꾸기 `rewrite`, 통과 `allow` |
| `post_gateway_admission` | 인증과 slash command 통과 뒤, agent turn 전 | `session_key`, `platform`, `text` | `handled`면 agent turn을 건너뜀 |
| `gateway_platform_event` | 플랫폼 고유 event(Telegram reaction, 수정, Discord 삭제 등) | `platform`, `event_type`, `payload` | 못 함 |
| `pre_command` | slash command 실행 직전 | `surface`, `command`, `args_raw` | 못 함 (v1에서는 반환값 무시) |
| `pre_transcription` | STT 호출 전 | `file_path`, `provider`, `prompt` | prompt, language, model 바꿈 |
| `on_room_member_activity` | Group Chat member turn 안의 runtime event마다 | `room_id`, `member_id`, `kind`, `seq`, `payload` | 못 함. durable room log에는 안 씀 |
| `kanban_task_claimed`, `kanban_task_completed`, `kanban_task_blocked`, `on_kanban_worker_spawned`, `on_kanban_worker_exited`, `on_kanban_worker_stale_claim`, `on_kanban_task_updated`, `on_kanban_dispatch_tick` | kanban 보드 상태 변화 | `task_id`, `board`, `assignee`, `run_id` 등 | 못 함. DB commit 뒤에 호출 |

공통 규칙(위 문서 "General rules"):

- callback은 keyword 인자로 받는다.
- 예외는 로그만 남기고 넘어간다.
- timeout 기본 30초(`plugins.hook_callback_timeout`). 넘기면 `pre_tool_call`은 막고, 나머지는 건너뛴다.
- `compact` 전용 plugin hook은 `VALID_HOOKS`에 없다. compress는 보조 호출 hook(`aux_task`)과 gateway hook `session:compress`로 보인다.

### 1-3. shell hook, outbound webhook

근거: `hermes:website/docs/user-guide/features/hooks.md` "Shell Hooks", "Outbound Webhooks".

| 통로 | event | 전달 | 막기/바꾸기 |
|---|---|---|---|
| shell hook | `VALID_HOOKS`와 같은 이름(`transform_api_error_classification`만 제외, `SHELL_UNSUPPORTED_HOOKS`) | JSON을 stdin으로. `matcher`(regex)는 tool event에만. timeout 기본 60초, 최대 300초 | exit code 2 = 막기 (Claude Code 호환). stdout JSON으로 modify, context 주입. `fail_closed`는 `pre_tool_call`만. 처음 쓸 때 `(event, command)`마다 동의를 묻는다 |
| outbound webhook | `VALID_HOOKS` 안의 아무 event | HTTP POST. body: `hook_event_name`, `profile`, `tool_name`, `tool_input`, `session_id`, `cwd`, `extra`, `delivery_id`, `timestamp`. header `X-Hermes-Event`, `X-Hermes-Delivery`, `X-Hermes-Signature-256`(HMAC) | 못 함 (응답 body 무시). 실패하면 한 번 재시도하고 버림. queue가 차면 새 event를 버림 |

### 1-4. desktop app과 TUI로 흐르는 event (`tui_gateway`)

Ink TUI, dashboard, desktop app이 쓰는 JSON-RPC protocol이다. stdio나 WebSocket으로 간다.
근거: `hermes:tui_gateway/contracts/events.py`(event 정의 전체), `hermes:tui_gateway/contracts/server_requests.py`, `hermes:website/docs/developer-guide/programmatic-integration.md`.

event 이름만 `events.py`의 `event(...)` 호출 기준으로 적는다.

| 묶음 | event | 언제 / 주요 field | 막기/바꾸기 |
|---|---|---|---|
| 연결 | `gateway.ready`, `skin.changed`, `setup.ready`, `free_tier.challenge` | 첫 frame(`replay_epoch` 포함), 설정 변화 | 못 함 |
| turn | `message.start`, `message.delta`, `message.interim`, `message.complete` | turn 시작, 조각, 중간 문장, 끝. `complete`에 `text`, `usage`, `status`(complete/error/interrupted), `error`, `persisted_turn` | 못 함 |
| reasoning | `reasoning.delta`, `reasoning.available`, `thinking.delta` | reasoning 조각 / 완성된 블록 | 못 함 |
| tool | `tool.generating`, `tool.start`, `tool.complete`, `tool.output_risk`, `todo.updated` | model이 인자를 만드는 중 / 시작(`tool_id`, `name`, `args`) / 끝(`result`, `duration_s`, `inline_diff`) / 출력이 위험하다고 분류됨 / todo 전체 snapshot | 못 함 |
| subagent | `subagent.spawn_requested`, `subagent.start`, `subagent.progress`, `subagent.thinking`, `subagent.tool`, `subagent.complete` | child 생애. field: `subagent_id`, `parent_id`, `child_session_id`, `goal`, `status`, `summary`, token 수, `files_read/written` | 못 함 (`subagent.interrupt`, `subagent.steer`는 client가 보내는 method) |
| session | `session.info`, `session.usage`, `session.title`, `session.resume_progress`, `session.reclaimed`, `session.control.update` | 설정 snapshot, usage tick, 자동 제목, 복원 진행, 서버가 session을 회수, goal/loop/heartbeat 변경 | 못 함 |
| 상태, 알림 | `status.update`(kind: status, lifecycle, compacting, goal, loop, heartbeat, process ...), `notification.show`, `notification.clear`, `notice`, `error` | 짧은 상태줄 / key 있는 toast / session 밖의 오류 | 못 함 |
| 승인 취소 | `approval.cancelled`, `request.cancel` | 대기 중이던 승인이나 질문이 interrupt, timeout 등으로 없어짐 (`reason`) | 못 함 |
| 부가 | `background.complete`, `btw.complete`, `review.summary`, `moa.*`, `agent.terminal.output`, `terminal.close`, `browser.*`, `voice.*`, `wake.detected`, `pet.*`, `preview.*`, `layout.apply`, `pane.reveal`, `tip.show`, `message.reaction`, `reaction`, `billing.step_up.verification` | 기능별 | 못 함 |
| 변경 신호 | `cron.changed`, `sessions.changed`, `platforms.changed`, `projects.changed`, `pairing.changed`, `bot_relay.outbox.pending` | 파일이나 DB가 바뀜. payload는 `{}` | 못 함 |

서버가 client에게 거는 request(답을 기다린다): `approval`(답 `once`/`session`/`always`/`deny`), `clarify`, `sudo`, `secret`, `vault.*`, `terminal.read`, `window.read`, `preview.act`, `tour`, `setup_choose`.
client가 `client.capabilities`로 받겠다고 알리지 않은 WebSocket은 이 request를 바로 실패 처리한다.

모든 event frame에는 session별로 오르는 `seq`가 붙고, 메모리에 ring buffer로 남아 reconnect 때 `session.events.since`로 다시 받는다 (`hermes:tui_gateway/event_replay.py`, session당 512개와 4MiB 한도).

### 1-5. ACP adapter

`hermes acp`는 ACP를 stdio로 말한다. 근거: `hermes:website/docs/developer-guide/acp-internals.md`, `hermes:acp_adapter/`.

- 보내는 `session/update`는 코드에서 `plan`, `available_commands_update`, `session_info_update`, `usage_update`, tool call 갱신(`update_tool_call`), message chunk를 확인했다.
- 위험한 terminal 명령의 승인은 ACP `request_permission`으로 바꾼다. `allow_once`는 `once`, `allow_always`는 `always`, reject는 `deny`. timeout이면 deny.
- 취소는 `stop_reason="cancelled"`로 돌려준다.

### 1-6. middleware

근거: `hermes:website/docs/developer-guide/middleware.md`. event가 아니라 호출을 감싸는 plugin 통로다.

| 종류 | 언제 | 막기/바꾸기 |
|---|---|---|
| `llm_request` | provider 호출 전 | request kwargs 교체 |
| `tool_request` | hook, 승인, 실행 전 | tool 인자 교체 |
| `llm_execution` | 실제 provider 호출 | 호출을 감싸거나 대체 |
| `tool_execution` | 실제 tool 호출 | 호출을 감싸거나 대체 |

바꾼 내용은 이후 observer payload의 `middleware_trace`에 남는다.

### 1-7. 저장

- 대화는 SQLite `~/.hermes/state.db`에 쌓는다 (profile마다 자기 `state.db`). 근거: `hermes:website/docs/developer-guide/session-storage.md`.
  - `sessions`: `id`, `source`, `model`, `parent_session_id`, `started_at`, `ended_at`, `end_reason`, token 수, 비용, `title`, workspace 정보(`cwd`, `git_branch`) 등.
  - `messages`: `role`, `content`, `tool_calls`, `tool_name`, `reasoning`, `finish_reason`, `timestamp`, `active`, `compacted`, `display_kind`, `display_metadata`, `message_uid` 등.
  - compress하면 옛 row를 `active=0`으로 보관하고 남길 context를 `active=1` row로 새로 넣는다. `parent_session_id`로 session을 이어 붙인다(rotation).
  - 그 밖의 table: `async_delegations`, `delivery_obligations`(gateway가 아직 못 보낸 답), `compression_locks`, `gateway_routing`.
- hook event 자체를 저장한다는 설명은 못 찾았다. 확인 못함.
  - outbound webhook은 실패하면 버린다.
  - `on_room_member_activity`는 문서에서 "durable room log에 안 쓴다"고 한다.
- gateway 종료 흔적은 별도 파일 `<HERMES_HOME>/state/gateway.lifecycle.json`에 남긴다 (`hermes:gateway/lifecycle_ledger.py`). 이전에 비정상 종료했는지 알아내는 용도다.
- `tui_gateway` event는 위 ring buffer(메모리)에만 있다.

---

## 2. Goose

repo: github.com/block/goose @ `69de89c5`. 기능은 두 갈래다. hook(shell 명령, 문서 `goose:documentation/docs/guides/context-engineering/hooks.md`)과, desktop app이 쓰는 ACP 연결이다. agent loop는 state machine(`goose:crates/goose-agent/`, `goose:crates/goose/src/agents/state_machine/`)이다.

### 2-1. hook event

`goose:crates/goose/src/hooks/mod.rs`의 `enum HookEvent`가 12개이고 문서의 표와 같다. Open Plugins hooks 사양을 따른다. plugin은 `~/.agents/plugins/<name>/hooks/hooks.json`이나 `<project>/.agents/plugins/<name>/hooks/hooks.json`에 둔다. command를 `sh -c`로 돌리고 payload JSON을 stdin으로 준다. 기본 timeout 30초, `matcher`는 regex.

| event | 통로 | 언제 | 주요 field | 막기/바꾸기 | 근거 |
|---|---|---|---|---|---|
| `SessionStart` | hook | session 시작. hook의 stdout banner를 사용자에게 보여줌 | `session_id`, `working_dir` | 못 함 (banner만) | `goose:crates/goose/src/agents/agent.rs:305`, `.../state_machine/session.rs:279` |
| `SessionEnd` | hook | session 끝 | `session_id` | 못 함 | 호출은 `goose:crates/goose-cli/src/session/mod.rs`(566, 1128, 1293행)에서만 찾음 |
| `UserPromptSubmit` | hook | 사용자가 prompt를 보냄 (turn 시작에서 한 번) | `message`, `matcher_context`(prompt 글) | 못 함 (block 값은 무시) | `.../state_machine/session.rs:293`, `.../ops_steer.rs:90` |
| `PreToolUse` | hook | tool 실행 전 | `tool_name`, `tool_input`, `tool_call_id`, `working_dir` | 막기: exit 2(stderr가 이유) 또는 stdout `{"decision":"block","reason":..}`. 인자 수정은 문서에 없음. 실패 처리 `on_failure: allow`(기본)/`block` | `.../ops_toolcalling.rs:126`, hooks.md |
| `PreToolUseResult` | hook | `PreToolUse` 판정이 난 뒤, 허용과 거부 모두 | `decision`(allow/deny), `policy_evaluated`, `blocked_by`, `reason`, `cause`(policy_denial/hook_failure) | 관찰만. hook이 끝나길 기다리므로 tool 호출이 그만큼 늦어짐 | `.../ops_toolcalling.rs:100`, hooks.md |
| `PostToolUse` | hook | tool 성공 후 | `tool_name`, `tool_input`, `tool_call_id` | 못 함 | `.../ops_toolcalling.rs:226` |
| `PostToolUseFailure` | hook | tool 실패 후 | 같음 | 못 함 | 같음 |
| `BeforeReadFile` | hook | 파일 읽기 전 | `matcher_context`(파일 경로) | 못 함 | `.../ops_toolcalling.rs:192` |
| `AfterFileEdit` | hook | 파일 수정 성공 후 | 파일 경로 | 못 함 | hooks.md |
| `BeforeShellExecution` | hook | shell 명령 전 | `matcher_context`(명령) | 못 함 | `.../ops_toolcalling.rs:188` |
| `AfterShellExecution` | hook | shell 명령 성공 후 | 명령 | 못 함 | `.../ops_toolcalling.rs:319` |
| `Stop` | hook | turn이 끝나려 할 때 | `last_assistant_message`, `working_dir` | 막으면 turn이 계속 이어진다. 연속 차단 상한이 있고(`GOOSE_STOP_HOOK_BLOCK_CAP`) 넘으면 hook을 무시하고 끝낸다. `Stop`은 항상 fail open | `.../ops_stop_hook.rs` |

더 알아둘 것:

- 문서가 `SubagentStart`, `SubagentStop`은 지금 emit하지 않는다고 적었다 (hooks.md "My Hook Did Not Run"). `HookEvent` enum에도 없다.
- 모르는 event 이름은 읽을 때 무시한다.
- `SessionStart`, `SessionEnd`: CLI에서 호출하는 곳은 확인했다. desktop(ACP server)이 `SessionEnd`를 내는 곳은 못 찾았다. 확인 못함.
- `disabledPlugins`로 끈다 (`~/.config/goose/settings.json`).

### 2-2. desktop app으로 가는 event (ACP + goose 확장)

desktop app은 ACP SDK 타입을 쓴다 (`goose:AGENTS.md`의 "UI Desktop" 규칙). server는 `goose:crates/goose/src/acp/server.rs`.

| event | 통로 | 언제 | 주요 field | 막기/바꾸기 | 근거 |
|---|---|---|---|---|---|
| `session/update`: `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` | ACP notification | 메시지 조각 | content | 못 함 | `goose:crates/goose/src/acp/server.rs`의 `SessionUpdate::` 사용처 |
| `session/update`: `tool_call`, `tool_call_update` | ACP notification | tool 시작, 진행, 끝 | `toolCallId`, `status`, content. MCP tool의 logging, progress, shell 출력은 `_meta.toolNotification`(type: message, progress, platform_event, live_output)에 담는다 | 못 함 | `goose:crates/goose/src/acp/server/tool_notifications.rs` |
| `session/update`: `usage_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `available_commands_update` | ACP notification | 상태 변화 | 표준 field | 못 함 | `server.rs` |
| `session/request_permission` | ACP request (agent → client) | tool 승인이 필요할 때 | 옵션 4개: AllowAlways, AllowOnce, RejectOnce, RejectAlways | client가 답한다. 취소나 오류면 Cancel로 처리 | `server.rs:1595` 근처 |
| `_goose/unstable/session/update` | goose 확장 notification (client가 `goose.customNotifications`를 지원할 때만) | 아래 4가지 | | 못 함 | `goose:crates/goose-sdk-types/src/custom_notifications.rs` |
| 　`usage_update` | 위 확장 | context 사용량 | `used`, `contextLimit`, 누적 token, `accumulatedCost` | | 같은 파일 |
| 　`status_message` | 위 확장 | 알림이나 진행 한 줄 | `Notice{message}` 또는 `Progress{message}`. 저장하거나 replay하지 않는 것으로 정함 | | 같은 파일 |
| 　`message_usage` | 위 확장 | 메시지별 usage | token, `cost`, `elapsedMs`, `timeToFirstTokenMs`, `isCompaction` | | 같은 파일 |
| 　`live_voice_interaction_ended` | 위 확장 | 실시간 음성 끝 | `interactionId`, `outcome`(stopped/failed) | | 같은 파일 |
| `_goose/unstable/providers/authentication/device-code` | goose 확장 notification | provider OAuth device code 흐름 | `userCode`, `verificationUri`, `expiresIn` | | 같은 파일 |

그 밖:

- ACP 표준의 `plan`, `notice`, `compaction_update`를 goose가 내는 코드는 못 찾았다. compact 알림은 `SystemNotificationContent`(`thinkingMessage`, `progressMessage`, `inlineMessage`, `creditsExhausted`)와 `status_message`로 간다.
- compact는 state machine의 `CompactionOperation`이 하고 usage를 `is_compaction`으로 따로 표시한다 (`goose:crates/goose/src/agents/state_machine/ops_compaction.rs`).
- 내부 `AgentEvent`(`goose:crates/goose-agent/src/events.rs`)는 `Message`, `Usage`, `MessageUsage`, `McpNotification`, `HistoryReplaced` 다섯이다. 바깥 통로가 아니라 agent crate 안의 stream이다.
- subagent 진행은 `TaskExecutionNotificationEvent`(`line_output`, `tasks_update`, `tasks_complete`; `goose:crates/goose/src/agents/subagent_execution_tool/notification_events.rs`)로 나가고 CLI의 `task_execution_display`가 쓴다. foreground subagent는 `InlineMessage` 알림("Running subagent ...")으로 보인다 (`ops_foreground_subagent.rs`). ACP로 가는 길은 못 찾았다.

### 2-3. SDK의 observability hook

`goose:crates/goose-sdk/src/observability.rs`. Kotlin, Python 같은 GDK 호출자가 `set_observability_hook`으로 callback을 등록한다. model provider 요청 단위다.

| event | 언제 | field | 막기/바꾸기 |
|---|---|---|---|
| `on_request_start` | provider 요청 시작 | `request_id`, `provider`, `model`, `operation`(complete/stream), `payload`(켰을 때만) | 못 함 |
| `on_response_start` | 응답이 열림 | `elapsed_ms` | 못 함 |
| `on_request_end` | 요청 끝 | `outcome`(Success/Failure), `duration_ms`, `usage`, `response_json` | 못 함. callback panic은 잡는다 |

이 밖에 OpenTelemetry/Langfuse trace가 있다 (`goose:crates/goose/src/otel/`, `goose:crates/goose/src/tracing/`). message 내용은 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`일 때만 담는다. 자세히는 안 봤다.

### 2-4. 저장

- SQLite `~/.local/share/goose/sessions/sessions.db` (Windows는 `%APPDATA%\Block\goose\data\sessions\sessions.db`). 근거: `goose:documentation/docs/guides/logs.md`, `goose:crates/goose/src/session/session_manager.rs:1141~1215`. 1.10.0 이전에는 `.jsonl` 파일이었다.
  - `sessions`: `id`, `name`, `session_type`, `working_dir`, token 합계, `accumulated_cost`, `recipe_json`, `provider_name`, `goose_mode`, `parent_session_id` 등.
  - `messages`: `session_id`, `role`, `content_json`, `created_timestamp`, `tokens`, `metadata_json`.
  - `usage_ledger`: 호출마다 model, token, `cost`, `is_compaction`.
- hook이 낸 `SessionStart` banner는 숨은 assistant 메시지로 대화에 저장된다 (`session_start_message`). 그 외 hook event를 저장한다는 근거는 못 찾았다. 확인 못함.
- `PreToolUseResult`는 문서에서 "best effort, 기록이 남지 않는다"고 적었다.
- `status_message`는 코드 주석에서 transcript가 아니고 저장, replay하지 않는다고 적었다.

---

## 3. Amp (Sourcegraph) CLI

closed source라 공식 문서만 봤다. Amp 문서에는 "hook"이라는 말이 없고, 같은 일을 하는 plugin event API가 있다.

### 3-1. `--stream-json` 출력

근거: https://ampcode.com/docs/cli/streaming-json . `--execute`(`-x`)와 같이 쓴다. 한 줄에 JSON 하나. Claude Code의 stream JSON과 맞추려는 형식이라고 적혀 있다.

| event | 통로 | 언제 | 주요 field | 막기/바꾸기 |
|---|---|---|---|---|
| `system` / `init` | stdout JSON line | 대화 시작 | `cwd`, `session_id`, `tools`, `mcp_servers`(status: connected, failed, awaiting-approval), `agent_mode`(있을 때) | 못 함 |
| `assistant` | 같음 | model 응답마다 | `message.content` 블록: `text`, `tool_use`(`id`, `name`, `input`), `thinking`, `redacted_thinking`(thinking은 `--stream-json-thinking`을 켰을 때만). `stop_reason`(end_turn, tool_use, max_tokens), `usage`, `parent_tool_use_id` | 못 함 |
| `user` | 같음 | tool 결과마다 | `tool_result` 블록(`tool_use_id`, `content`, `is_error`), `parent_tool_use_id` | 못 함 |
| `result` | 같음 | 마지막 | subtype `success`면 `result`. `error_during_execution`, `error_max_turns`면 `error`와 `is_error:true`. `duration_ms`, `num_turns`, `usage`, `permission_denials` | 못 함 |
| `system` / 오류 | 같음 | 오류 | subtype `error_max_turns` 또는 `error_during_execution`, `error` 문자열 | 못 함 |

모든 message에 `session_id`가 있다.

입력 쪽: `--stream-json-input`은 stdin에서 한 줄에 JSON 하나(`type:"user"`, `message.content`에 `text`나 `image`)를 읽는다. 최상위 `steer: true`를 주면 agent가 바쁠 때 다음 끊을 수 있는 지점에서 처리한다.

### 3-2. plugin event API

근거: https://ampcode.com/docs/plugin-api , https://ampcode.com/docs/customize/plugins , https://ampcode.com/docs/cli/execute-mode .
plugin은 TypeScript나 JavaScript 모듈이다 (`.amp/plugins/`, `~/.config/amp/plugins/` 등). default export 함수가 `PluginAPI`를 받아 handler를 등록한다. handler는 `(event, ctx)`를 받는다.

| event | 통로 | 언제 | 주요 field | 막기/바꾸기 |
|---|---|---|---|---|
| `session.start` | plugin | thread session 시작(새 thread의 첫 메시지, thread 열기나 전환) | `thread.id` | 못 함 (반환 void) |
| `agent.start` | plugin | 사용자가 prompt를 보냄(처음이든 답이든) | `thread`, `message`, `id`, `changesWorkflow`('ship' 또는 'push_branch') | 사용자 글 뒤에 `{message:{content, display?}}`를 덧붙일 수 있다 |
| `tool.call` | plugin | tool 실행 전 | `toolUseID`, `tool`, `input`, `thread` | `allow`, `reject-and-continue`(message), `modify`(input), `synthesize`(output과 exitCode로 tool 대신 결과 만듦), `error`(thread worker를 멈추고 오류 표시) |
| `tool.result` | plugin | tool이 끝난 결과가 나올 때 | `toolUseID`, `tool`, `input`, `status`(done, error, cancelled), `error`, `output` | 결과 status, output, error 교체 |
| `agent.end` | plugin | agent가 prompt 처리를 끝냄 | `thread`, `message`, `id`, `status`(done, error, cancelled), `messages`(`agent.start` 이후) | `{action:'continue', userMessage, maxContinuations?}`로 한 번 더 돌리게 함. 기본 최대 5번, 사용자가 말하면 초기화 |
| `changes.prompt` | plugin | Ship이나 Push to Branch 버튼의 prompt를 만들 때 | `thread`, `workflow` | `{append}`로 글 덧붙임 |

- handler context: `logger`, `$`(shell), `ui`, `ai`, `system`, `span`, `thread`.
  - `ctx.ui.notify(message)`, `input`, `confirm`, `select`는 plugin이 호출하는 API이고 event가 아니다.
  - dialog에는 `requireHuman`, `skipIfUnwatched` 옵션이 있다.
- 문서에 없다고 한 것: `session.end` event, idle event, compact event, subagent event. 플러그인 문서가 `session.end`가 없다고 명시한다.
- subagent는 plugin이 `amp.createAgent()`, `amp.getBuiltinAgent()`로 만든다 (`parentThreadID`로 연결).
- 권한: Amp는 tool 실행 전에 승인을 묻지 않는다 (https://ampcode.com/docs/tools). 막으려면 plugin의 `tool.call`을 쓴다고 안내한다.
- execute mode에서는 `agent.start`와 `agent.end`가 `--plugin-ready-timeout`(기본 10초, 최대 300초, 0이면 끔)과 같이 나온다고 적혀 있다 (execute-mode 문서).
- 알림 설정 `notifications.enabled`가 있고 Mac, iOS app이 "thread가 다음 메시지를 기다릴 때" 알려준다고 문서에 적혀 있다 (https://ampcode.com/manual). 이 알림이 plugin event로 노출되는지는 확인 못함.

### 3-3. 저장

- thread에는 prompt, 답, 모든 tool call, 바꾼 파일이 들어간다. 메타: 제목, label, 보관 상태, 지금까지의 비용 (https://ampcode.com/docs/threads).
- thread는 `https://ampcode.com/threads/T-...` URL로 web, CLI, app에서 같이 열린다. 저장 위치(로컬 파일인지 서버인지)는 문서에 안 나온다. 확인 못함.
- `amp threads markdown T-...`, `amp threads export T-...`(JSON, 만든 사람만)으로 내보낸다.
- commit에 `Amp-Thread-ID` trailer가 붙는다.
- stream-json 출력을 Amp가 따로 저장한다는 설명은 없다.

---

## 4. ACP (Agent Client Protocol)

repo: github.com/agentclientprotocol/agent-client-protocol @ `989389c1`. 공식 문서 https://agentclientprotocol.com .
schema는 `acp:schema/v1/schema.json`, `acp:schema/v1/schema.unstable.json`, `acp:schema/v2/schema.json`, `acp:schema/v2/schema.unstable.json`. method 목록은 각 `meta*.json`.

중요: v1과 v2가 둘 다 있다.

- v2는 prompt lifecycle을 바꾼 큰 개정이고 문서에서 "still draft"라고 한다 (`acp:docs/protocol/v2/migration.mdx`). 연결마다 `initialize`의 `protocolVersion`으로 정한다.
- 그래서 v1과 v2를 나눠 적는다. `[unstable]`은 `schema.unstable.json`에만 있는 것이다.

### 4-1. `session/update` 종류 (agent → client notification)

근거: `acp:schema/v1/schema.json`과 `schema.unstable.json`의 `$defs.SessionUpdate`, `acp:schema/v2/schema.unstable.json`의 `$defs.SessionUpdate`, `acp:docs/protocol/v2/prompt-lifecycle.mdx`, `acp:docs/protocol/v2/migration.mdx`. v2의 표준(stable) 목록은 prompt-lifecycle.mdx 표에 있는 19개다.

| `sessionUpdate` 값 | v1 | v2 | 언제 / 주요 field |
|---|---|---|---|
| `user_message_chunk` | 있음 | 있음 | 사용자 메시지 조각 (replay 포함). v2는 `messageId` 필수 |
| `user_message` | 없음 | 있음 | 사용자 메시지 upsert (`messageId`, `content`) |
| `agent_message_chunk` | 있음 | 있음 | agent 응답 조각 |
| `agent_message` | 없음 | 있음 | agent 메시지 upsert. 같은 `messageId`면 field를 덮어씀 |
| `agent_thought_chunk` | 있음 | 있음 | reasoning 조각 |
| `agent_thought` | 없음 | 있음 | reasoning 메시지 upsert |
| `state_update` | 없음 | 있음 | foreground 작업 상태: `running`, `idle`, `requires_action`. `idle`에 `stopReason`(`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`, `error`)과 `error`(`code`, `message`)가 붙는다. `unknown` 상태는 [unstable]. prompt 없이 시작한 작업(끝난 background 작업의 후속)도 같은 상태로 알린다 |
| `tool_call` | 있음 | 없음 | tool call 시작. `toolCallId`, `title`, `kind`(read, edit, delete, move, search, execute, think, fetch, switch_mode, other), `status`, `content`, `locations`, `rawInput`, `rawOutput` |
| `tool_call_update` | 있음 | 있음 | tool call 갱신. v1은 바뀐 field만. v2는 이게 upsert이고 `toolCallId`로 처음 오면 생성. status: v1 `pending`, `in_progress`, `completed`, `failed`. v2는 `cancelled`가 더해짐 |
| `tool_call_content_chunk` | 없음 | 있음 | tool call content를 조각으로 이어 붙임 |
| `terminal_update` | 없음 | 있음 | agent가 가진 terminal의 상태 (`terminalId`, `command`, `cwd`, `output`, `exitStatus`). 보여주기만 하는 용도 |
| `terminal_output_chunk` | 없음 | 있음 | 그 terminal 출력 bytes 추가 |
| `plan` | 있음 | 없음 | 실행 계획 전체. `entries[]`: `content`, `priority`, `status`(pending, in_progress, completed) |
| `plan_update` | [unstable] | 있음 | `planId`로 식별하는 plan 내용 갱신 (`type` 구분자) |
| `plan_removed` | [unstable] | [unstable] | plan 삭제 (`planId`) |
| `available_commands_update` | 있음 | 있음 | slash command 목록 준비 또는 변경 |
| `current_mode_update` | 있음 | 없음 | mode 변경. v2는 mode를 config option으로 합침 |
| `config_option_update` | 있음 | 있음 | session 설정 option 변경 |
| `session_info_update` | 있음 | 있음 | `title`, `updatedAt`, `_meta` |
| `usage_update` | 있음 | 있음 | context 창 `used`, `size`, `cost` |
| `notice` | 있음 (client가 `notices` capability를 알렸을 때만) | 있음 (capability 불필요) | 사용자에게 보여줄 일회성 알림. `severity`(info, warning, error), `title`, `description`. 기록(replay) 대상이 아님. 받는 쪽이 무시해도 됨 |
| `compaction_update` | 있음 (client가 `compaction` capability를 알렸을 때만) | 있음 (capability 불필요) | context compact upsert. `compactionId`, `status`(in_progress, completed, failed, cancelled), `summary`, `error` |
| `compaction_summary_chunk` | 있음 (같은 조건) | 있음 | compact 요약에 내용 이어 붙임 |
| `subagent_update` | [unstable] | [unstable] | 이 session이 child session을 만들어 갖게 됨. `sessionId`, `title`, `description`, `capabilities`, `state`. child의 event는 같은 연결로 자동 전달 |
| `session_message` | [unstable] | [unstable] | session 사이 메시지 upsert (`messageId`, `senderSessionId`, `recipientSessionId`, `content`) |
| `session_message_chunk` | [unstable] | [unstable] | 그 메시지에 content 블록 추가 |

- 알 수 없는 update는 받는 쪽이 원문을 보존하거나 무시한다. `_`로 시작하는 값은 구현이 자유롭게 쓰는 값이다 (v2 extensibility).
- v1 stable `schema.json`의 `SessionUpdate`는 14개다: 위 표에서 v1 "있음"이면서 [unstable]이 아닌 것 전부 (`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`, `notice`, `compaction_update`, `compaction_summary_chunk`).
- 모두 notification이라서 client가 막거나 바꾸지 못한다.

### 4-2. `session/request_permission` (agent → client request)

근거: `acp:schema/v1/schema.json`, `acp:schema/v2/schema.unstable.json`의 `RequestPermissionRequest`, `RequestPermissionOutcome`, `PermissionOptionKind`.

| 항목 | v1 | v2 |
|---|---|---|
| request field | `sessionId`, `toolCall`(어떤 tool call인지), `options[]` | `sessionId`, `title`(필수), `description`, `subject`(`tool_call` 또는 `command`), `options[]` |
| option 종류 | `allow_once`, `allow_always`, `reject_once`, `reject_always` | 같음 (`_` 접두 사용자 정의 가능) |
| 답(outcome) | `selected{optionId}` 또는 `cancelled` | 같음 |
| 취소 | client가 `session/cancel`을 보내면 대기 중인 요청 모두에 `cancelled`로 답해야 한다 (MUST) | 같음 |
| 같이 나오는 update | 없음 | `state_update: requires_action` 다음 답이 오면 다시 `running` |

권한 요청은 agent가 막고 client가 판정하는 구조다. 요청 자체를 client가 거르는 통로는 protocol에 없다.

### 4-3. 그 밖의 흐름 (update는 아니지만 lifecycle)

근거: `acp:schema/v1/meta.unstable.json`, `acp:schema/v2/meta.unstable.json`, `acp:docs/protocol/v2/prompt-lifecycle.mdx`.

- client → agent: `session/new`, `session/prompt`, `session/cancel`(notification), `session/resume`, `session/list`, `session/close`, `session/delete`, `session/fork`, `session/set_config_option`.
  - v1에는 `session/load`(replay하며 복원), `session/set_mode`도 있다. v2에서는 `session/load`가 빠지고 `session/resume`에 `replayFrom` 옵션이 붙었다.
- v1: `session/prompt`의 응답이 turn의 끝이다. `PromptResponse`에 `stopReason`(`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`)과 `usage`.
- v2: `session/prompt` 응답은 "사용자 메시지가 대화에 들어갔다"는 확인이다(`messageId`만 돌려준다). 진행과 끝은 `state_update`로 온다. 오류도 `idle`의 `stopReason: error`로 온다.
- v2에서 빠진 것: `fs/read_text_file`, `fs/write_text_file`, `terminal/create` 등 5개 terminal method. v1에는 있다.
- 양쪽: `elicitation/create`, `elicitation/complete`(client가 받는 request와 notification), `$/cancel_request`, `mcp/message`.
- agent의 오류: v1은 JSON-RPC error. v2는 메시지가 들어간 뒤의 실패는 error 응답이 아니라 `state_update`(`stopReason: error`)로 보고한다.
- 취소 때 agent는 v1에서 `cancelled` stop reason으로 응답하고, v2에서는 `idle` + `cancelled`를 보낸다. 취소 오류를 `error`로 보고하면 안 된다 (MUST).

### 4-4. 저장

- protocol은 저장 방식을 정하지 않는다. v2 문서는 "agent가 입력을 저장하거나 일정 기간 보관할 의무가 없다"고 적었다 (prompt-lifecycle.mdx "Prompt Accepted").
- 저장하는 agent는 `session/load`(v1) 또는 `session/resume`의 `replayFrom`(v2)으로 복원할 때 같은 `messageId`를 써야 한다 (MUST).
- `notice`는 live 전용이라 replay에 넣지 않는 것을 권한다 (SHOULD NOT).
- 알 수 없는 update는 저장, replay, 전달할 때 원문 그대로 둔다.

---

## 5. lifecycle 단계별 정리

각 칸은 해당 대상에서 그 단계를 알려주는 event 이름이다. "없음"은 그런 event가 없다는 뜻이다. Hermes는 통로가 여러 개라 `gw` = gateway hook, `ph` = plugin hook(shell hook과 outbound webhook도 같은 이름), `ui` = `tui_gateway` event, `mw` = middleware로 표시했다. ACP는 v1 / v2로 나눴다.

| 단계 | Hermes | Goose | Amp | ACP |
|---|---|---|---|---|
| session 시작 | gw `gateway:startup`(process), `session:start` / ph `on_session_start`(첫 turn) / ui `gateway.ready`, `session.info` | hook `SessionStart` (CLI는 열 때, 아니면 첫 turn에서) | plugin `session.start` | 요청 `session/new`, `session/resume`, (v1) `session/load` |
| 사람 입력 (prompt) | gw `agent:start`(`message`), `command:*` / ph `pre_gateway_dispatch`, `post_gateway_admission`, `pre_command`, `pre_llm_call`(`user_message`) | hook `UserPromptSubmit` | plugin `agent.start`. stream-json 입력 `type:"user"` | 요청 `session/prompt`. update `user_message_chunk` / v2 `user_message` 추가 |
| turn 시작과 끝 | gw `agent:start` / `agent:end` / ph `pre_llm_call` / `post_llm_call`, `on_session_end`(turn마다) / ui `message.start` / `message.complete` | 시작: `UserPromptSubmit`. 끝: hook `Stop` | plugin `agent.start` / `agent.end`. stream-json `result` | v1: `session/prompt` 응답의 `stopReason`. v2: `state_update` `running` / `idle`+`stopReason` |
| model 호출 | ph `pre_api_request`, `post_api_request`, `api_request_error`, `on_stream_start/delta/end`, `on_interim_message`, `pre/post_auxiliary_call` / mw `llm_request`, `llm_execution` / ui `message.delta`, `reasoning.delta` | hook 없음. SDK `on_request_start`, `on_response_start`, `on_request_end`. ACP `agent_message_chunk`, `agent_thought_chunk`, `usage_update` | 없음 (stream-json `assistant` message가 응답 단위) | 호출 event 없음. `agent_message_chunk`, `agent_thought_chunk`, `usage_update` / v2 `agent_message`, `agent_thought` |
| tool 호출 전 | ph `pre_tool_call` / mw `tool_request`, `tool_execution` / ui `tool.generating`, `tool.start` / gw `agent:step`(`tool_names`) | hook `PreToolUse`, `PreToolUseResult`, `BeforeShellExecution`, `BeforeReadFile` / ACP `tool_call` | plugin `tool.call` / stream-json `assistant`의 `tool_use` | v1 `tool_call`(`pending`). v2 첫 `tool_call_update` |
| tool 호출 후 | ph `post_tool_call`, `transform_tool_result`, `transform_terminal_output` / ui `tool.complete`, `tool.output_risk`, `todo.updated` | hook `PostToolUse`, `PostToolUseFailure`, `AfterShellExecution`, `AfterFileEdit` / ACP `tool_call_update` | plugin `tool.result` / stream-json `user`의 `tool_result` | `tool_call_update` (`completed`, `failed`, v2 `cancelled`). v2 `tool_call_content_chunk` |
| 권한 요청 | ph `pre_approval_request`, `post_approval_response`, `on_human_input_request` / `_resolved`, `pre_tool_call`의 `approve` / ui 요청 `approval`, 이벤트 `approval.cancelled`, `request.cancel` / ACP adapter `request_permission` | hook 없음. ACP `session/request_permission` | 없음 (Amp는 승인을 묻지 않음. plugin `tool.call`로 판정, `ui.confirm` 호출은 API) | 요청 `session/request_permission`. v2는 거기에 `state_update` `requires_action` |
| compact | gw `session:compress` / ph `pre/post_auxiliary_call`(`aux_task`로 구분) / ui `status.update`(kind `compacting`) / DB `compacted`, `active` | hook 없음. `message_usage`의 `isCompaction`, `status_message` 알림 | 문서에 없음 | `compaction_update`, `compaction_summary_chunk` (v1은 client capability 필요) |
| subagent | ph `subagent_start`, `subagent_stop` / ui `subagent.spawn_requested`, `.start`, `.progress`, `.thinking`, `.tool`, `.complete` | hook 없음 (`SubagentStart/Stop`은 emit 안 함). CLI용 `tasks_update`, `tasks_complete` | plugin event 없음. stream-json의 `parent_tool_use_id`로 child message를 구분 | [unstable] `subagent_update`, `session_message`, `session_message_chunk` |
| 알림과 idle | ph `agent_loop_stopped` / ui `notification.show`, `notification.clear`, `notice`, `status.update`, `session.reclaimed` / idle event는 못 찾음 | hook 없음. 확장 `status_message`(Notice, Progress) / idle 없음 | plugin API `ctx.ui.notify()`(호출 쪽). idle event 없음. Mac, iOS app 알림 설정 `notifications.enabled` | `notice`, v2 `state_update` `idle` (v1에는 idle 신호가 없고 prompt 응답이 그 역할) |
| 오류 | ph `api_request_error`, `post_tool_call`(`status`, `error_type`), `on_session_end`(`failed`), `transform_api_error_classification` / ui `error`, `message.complete`(`status:error`) | hook `PostToolUseFailure`. `PreToolUseResult`의 `cause: hook_failure` | plugin `tool.result` / `agent.end`의 `status:error`. stream-json `result`의 `error_during_execution`, `error_max_turns` | v1 JSON-RPC error 응답. v2 `state_update` `idle`+`stopReason:error`+`error`. tool은 `failed` |
| session 끝 | gw `session:end`, `session:reset` / ph `on_session_finalize`, `on_session_reset` (`on_session_end`는 turn 단위) / ui `session.reclaimed` | hook `SessionEnd` (CLI에서만 확인) | 없음 (`session.end` 없다고 문서에 명시) | 요청 `session/close`, `session/delete`. 끝을 알리는 update는 없음 |
