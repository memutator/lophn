# Claude Code가 밖으로 내는 lifecycle event 조사

조사일 2026-10-13. 사실만 쓴다. 추천과 lophn 설계 제안은 없다.

## 0. 무엇을 읽었나

공식 문서는 `https://code.claude.com/docs/en/<page>.md`를 내려받아 읽었다 (docs.anthropic.com은 쓰지 않음). 문서에 나온 최신 버전은 Claude Code v2.1.295, TypeScript Agent SDK 0.3.296이다. SDK type 정의는 npm `@anthropic-ai/claude-agent-sdk@0.3.296`을 받아 `package/sdk.d.ts`를 직접 읽었다.

근거 약칭:

| 약칭 | 가리키는 곳 |
|---|---|
| H | `https://code.claude.com/docs/en/hooks.md` (뒤에 `#anchor`) |
| SDK-H | `.../agent-sdk/hooks.md` |
| TS | `.../agent-sdk/typescript.md` (뒤에 `#anchor`) |
| PY | `.../agent-sdk/python.md` |
| LOOP | `.../agent-sdk/agent-loop.md` |
| STREAM | `.../agent-sdk/streaming-output.md` |
| HL | `.../headless.md` |
| CLI | `.../cli-reference.md` |
| ENV | `.../env-vars.md` |
| OTEL | `.../monitoring-usage.md` |
| SL | `.../statusline.md` |
| MODS | `.../plugins/mods/reference.md` |
| DTS | npm `@anthropic-ai/claude-agent-sdk@0.3.296`의 `package/sdk.d.ts` (뒤에 줄 번호) |

## 1. hook event

### 1.1 먼저 알 것

- event는 33개다. H의 표, TS `HookEvent`, DTS `HOOK_EVENTS`(963줄)가 같은 33개를 가리킨다.
- 같은 event가 terminal, IDE extension, Desktop app, cloud session 어디서나 난다. (H 첫 문단)
- 문서가 가르는 cadence: per session = `SessionStart`, `SessionEnd`. per turn = `UserPromptSubmit`, `Stop`, `StopFailure`. tool 호출마다 = `PreToolUse`, `PostToolUse` (`EndConversation` tool은 둘 다 건너뜀). (H#hook-lifecycle)
- 모든 event가 받는 공통 field (H#common-input-fields): `session_id`, `prompt_id`(첫 입력 전엔 없음, OTel `prompt.id`와 같은 값), `transcript_path`, `cwd`, `hook_event_name`. 일부 event만 `permission_mode`, `effort.level`, `scratchpad_dir`. subagent 안이면 `agent_id`, `agent_type`.
- 아래 표의 payload 칸은 공통 field 말고 그 event만의 field다.
- handler 종류는 5가지: `command`(stdin JSON), `http`(POST body), `mcp_tool`, `prompt`(LLM 한 번), `agent`(tool 쓰는 verifier). event마다 되는 종류가 다르다. (H#hook-handler-fields, H#prompt-based-hooks)
- 같은 event에 맞는 hook은 병렬로 돈다. `async: true`(command만)면 기다리지 않고, 그 결과(`additionalContext`, `systemMessage`)는 다음 turn에 간다. async hook의 `decision`, `continue`는 효과가 없다. (H#run-hooks-in-the-background)
- exit code: 0 = 성공, 2 = 막기(막을 수 있는 event만), 그 밖 = 막지 않는 오류. JSON을 stdout으로 내면 더 세밀하게 제어. 모든 event 공통 JSON field: `continue`, `stopReason`, `suppressOutput`(효과 없음), `systemMessage`, `terminalSequence`. (H#exit-code-output, H#json-output)
- `additionalContext`는 system reminder로 model에게 간다. 한 string 10,000자 상한, 넘으면 파일로 빼고 앞 2,000자만 줌. (H#json-output)

### 1.2 event 표

"막기/바꾸기"는 hook 응답으로 할 수 있는 것이다. "못 막음"은 문서가 막을 수 없다고 쓴 것.

| event | 언제 나는가 | payload 주요 field | 막기/바꾸기 | matcher | 근거 |
|---|---|---|---|---|---|
| `SessionStart` | session이 시작/재개될 때 | `source`(startup/resume/clear/compact/fork), `model`(없을 수 있음), `agent_type`, `session_title`. resume/fork면 `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` | 못 막음. `additionalContext`, `initialUserMessage`(-p일 때 첫 user message), `sessionTitle`, `watchPaths`, `reloadSkills` 반환 가능. `CLAUDE_ENV_FILE`로 env 저장 | `source` 값 | H#sessionstart |
| `Setup` | `--init-only`, 또는 `-p`와 `--init`/`--maintenance`로 띄울 때만. 일반 시작엔 안 남 | `trigger`(init/maintenance) | 못 막음. JSON 출력은 전부 버려짐 | `init`, `maintenance` | H#setup |
| `InstructionsLoaded` | CLAUDE.md나 `.claude/rules/*.md`가 context에 올라갈 때 (시작 때 + lazy load + compact 뒤) | `file_path`, `memory_type`(User/Project/Local/Managed), `load_reason`, `globs`, `trigger_file_path`, `parent_file_path` | 못 막음. 관찰용, async | `load_reason`(session_start, nested_traversal, path_glob_match, include, compact) | H#instructionsloaded |
| `UserPromptSubmit` | prompt를 냈을 때, model이 보기 전. 사람이 친 것 말고 scheduled task, `/loop`, background subagent 보고, 다른 session이 보낸 message로 시작하는 turn에도 남 | `prompt`(붙여넣기는 펼쳐서), `session_title` | 막기 가능(`decision:"block"` 또는 exit 2). prompt text는 못 바꿈, `additionalContext`만 붙임. `sessionTitle`. 막은 prompt도 transcript에 남음. timeout 기본 30초 | 없음 | H#userpromptsubmit |
| `UserPromptExpansion` | 사람이 친 `/command`나 MCP prompt가 prompt로 펼쳐질 때. Claude가 skill을 직접 부르면 안 남 | `expansion_type`(slash_command/mcp_prompt), `command_name`, `command_args`, `command_source`, `prompt` | 막기 가능, `additionalContext` | `command_name` | H#userpromptexpansion |
| `MessageDisplay` | assistant text가 화면에 그려질 때. 터미널은 완성된 줄 묶음마다, `-p`와 SDK는 message당 한 번(전체 text) | `turn_id`, `message_id`, `index`, `final`, `delta` | 못 막음. `displayContent`로 화면에 그리는 text만 바꿈. transcript와 model은 원본을 봄. tool 없이 text 없는 message엔 안 남. timeout 10초 | 없음 | H#messagedisplay |
| `PreToolUse` | tool 인자가 만들어진 뒤, 실행 전 | `tool_name`, `tool_input`, `tool_use_id`, `mcp_server`{name, source} | `permissionDecision` allow/deny/ask/defer, `permissionDecisionReason`, `updatedInput`(입력 전체 교체), `additionalContext`. 여럿이면 deny > defer > ask > allow. deny/ask rule은 hook과 상관없이 계속 적용. `defer`는 `-p`에서만, 한 turn에 tool 하나일 때만 (result가 `stop_reason:"tool_deferred"`) | tool 이름 | H#pretooluse |
| `PermissionRequest` | tool 호출이 권한을 물어야 할 때 (prompt가 뜰 때, 또는 prompt를 못 띄워 자동 거부할 때) | `tool_name`, `tool_input`, `permission_suggestions`, `mcp_server` (`tool_use_id` 없음) | `decision.behavior` allow/deny, allow면 `updatedInput`, `updatedPermissions`, deny면 `message`, `interrupt`. exit 2는 안 먹음. 샌드박스 network 요청엔 안 남 | tool 이름 | H#permissionrequest |
| `PermissionDenied` | auto mode가 tool 호출을 거부했을 때만 | `tool_name`, `tool_input`, `tool_use_id`, `reason` | 못 막음. `retry:true`로 model에게 다시 해도 된다고 알림 (classifier 판정이 없는 거부는 무시됨) | tool 이름 | H#permissiondenied |
| `PostToolUse` | tool이 성공한 뒤 | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` | 못 막음(이미 실행됨). `decision:"block"`은 reason을 결과 옆에 붙일 뿐. `updatedToolOutput`(model이 보는 결과 교체, 형태가 맞아야 함), `additionalContext`, `classifierContext`. OTel에는 원본이 남음 | tool 이름 | H#posttooluse |
| `PostToolUseFailure` | 시작된 tool이 실패했을 때 (예외, MCP error). validation 실패, 권한 거부, 취소엔 안 남 | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms` | 못 막음. `additionalContext`만 | tool 이름 | H#posttoolusefailure |
| `PostToolBatch` | 병렬 tool 호출 한 묶음이 다 끝난 뒤, 다음 model 호출 전 | `tool_calls[]`{`tool_name`, `tool_input`, `tool_use_id`, `tool_response`(model이 본 직렬화된 결과)} | `additionalContext`. `decision:"block"`/`continue:false`/exit 2는 다음 model 호출 전에 loop를 멈춤 | 없음 | H#posttoolbatch |
| `Notification` | Claude Code가 notification을 보낼 때 | `message`, `title`, `notification_type` | 못 막음. `terminalSequence`만 먹음 | `notification_type`: permission_prompt(prompt가 약 6초 기다린 뒤), idle_prompt(응답 끝나고 약 60초), auth_success, elicitation_dialog, elicitation_url_dialog, elicitation_complete, elicitation_response, agent_needs_input, agent_completed, quota_auto_resume_fired/stale/disabled | H#notification |
| `SubagentStart` | subagent가 spawn/재개될 때, in-process teammate가 새 message를 받을 때 | `agent_id`, `agent_type` | 못 막음. subagent context에 `additionalContext` 주입 | agent type (plugin이면 `my-plugin:reviewer`) | H#subagentstart |
| `SubagentStop` | subagent가 응답을 끝냈을 때. prompt 제안, `/btw` 같은 Claude Code 내부 agent가 끝나도 남 (그때 `agent_type`은 빈 문자열일 수 있음) | `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `background_tasks`, `session_crons` | `decision:"block"`+`reason`(subagent의 다음 지시가 됨) 또는 exit 2로 계속 일하게 함. `additionalContext` | agent type | H#subagentstop |
| `TaskCreated` | `TaskCreate` tool로 task가 만들어질 때 (Task tool이 없는 session엔 안 남) | `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name`(deprecated), `agent_id` | 막기 가능(exit 2, `decision:"block"`). task를 지우고 message를 Claude에게 돌려줌. `continue:false`는 무시 | 없음 | H#taskcreated |
| `TaskCompleted` | task를 완료로 표시할 때 (`TaskUpdate`, 또는 teammate가 in-progress task를 둔 채 turn을 끝낼 때) | `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name`, `agent_id` | exit 2로 완료 막기. teammate turn일 때만 `continue:false`가 teammate를 멈춤 | 없음 | H#taskcompleted |
| `Stop` | 주 agent가 응답을 끝냈을 때. 사용자 interrupt로 멈추면 안 남. API 오류는 `StopFailure` | `stop_hook_active`, `last_assistant_message`, `background_tasks`(id/type/status/description/command/agent_type/server/tool/name), `session_crons`(id/schedule/recurring/prompt) | `decision:"block"`+`reason` 또는 exit 2로 멈추지 못하게 함(계속 진행). `additionalContext`는 오류 아닌 feedback으로 계속 진행. 연속 8번 block 하면 강제 종료(env로 조정) | 없음 | H#stop |
| `StopFailure` | turn이 API 오류로 끝났을 때 (`Stop` 대신) | `error`, `error_details`, `last_assistant_message`(오류 문구) | 출력과 exit code 전부 무시 (`terminalSequence`만) | `error`: rate_limit, overloaded, authentication_failed, oauth_org_not_allowed, account_on_hold, billing_error, invalid_request, model_not_found, server_error, max_output_tokens, cloud_credential_error, unknown | H#stopfailure |
| `TeammateIdle` | agent team teammate가 idle로 들어가려 할 때 | `teammate_name`, `team_name`(deprecated), `agent_id` | exit 2로 계속 일하게 함. `continue:false`로 teammate 중지 | 없음 | H#teammateidle |
| `ConfigChange` | session 중 설정/policy/skill 파일이 바뀔 때 | `source`, `file_path` | 막기 가능(`decision:"block"`/exit 2). 단 `policy_settings`는 못 막음. 막아도 사용자와 Claude 둘 다 모르고 debug log에만 남음 | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` | H#configchange |
| `CwdChanged` | main conversation의 shell 명령이 cwd를 바꿨을 때 (`cd` 등) | `old_cwd`, `new_cwd` | 못 막음. `watchPaths` 반환. `CLAUDE_ENV_FILE` 사용 가능 | 없음 | H#cwdchanged |
| `DirectoryAdded` | `/add-dir` 또는 SDK `register_repo_root`로 작업 dir이 추가된 뒤 (`--add-dir` flag엔 안 남) | `directory`, `source` | 못 막음. 기다리지 않고 background로 돔 | `slash_command`, `register_repo_root` | H#directoryadded |
| `FileChanged` | 감시 중인 파일이 disk에서 바뀔 때 (누가 바꿨든) | `file_path`, `event`(change/add/unlink) | 못 막음. `watchPaths` 반환 | 감시할 파일 이름 (`.envrc\|.env`) | H#filechanged |
| `WorktreeCreate` | worktree를 만들 때 (`--worktree`, `EnterWorktree`, subagent `isolation:"worktree"`, workflow, background session, remote-control) | `name` | 기본 git 동작을 대체함. command hook은 stdout 마지막 줄에 경로를 내야 하고, 실패하거나 경로가 없으면 생성 실패 | 없음 | H#worktreecreate |
| `WorktreeRemove` | `WorktreeCreate` hook이 만든 worktree를 지울 때 (subagent/workflow가 끝났을 때는 안 지움) | `worktree_path` | non-zero exit이면 dir이 남아 있을 때 삭제 실패. JSON은 버려짐 | 없음 | H#worktreeremove |
| `PreCompact` | compact 직전 | `trigger`(manual/auto), `custom_instructions`(`/compact`에 준 text, 없으면 null) | 막기 가능(exit 2, `decision:"block"`). 자동 compact를 막으면: 미리 한 것이면 건너뛰고, context 한도 오류 복구용이면 오류가 그대로 올라옴 | `manual`, `auto` | H#precompact |
| `PostCompact` | compact가 끝난 뒤 | `trigger`, `compact_summary` | 못 막음 | `manual`, `auto` | H#postcompact |
| `PreModelSwitch` | 사용자나 client가 요청한 model 전환을 적용하기 직전 (`/model`, picker, `/config`, fast mode 켜기, SDK `set_model`). 자동 fallback이나 resume 복원엔 안 남. v2.1.251+ | `from_model`, `to_model`, `requested_model`, `source`(command/picker/sdk), `context_tokens`, `prompt_cache_warm`, `cache_ttl`, `estimated_cache_write_usd`, `pricing` | 막기 가능(exit 2, `decision:"block"`, `permissionDecision` allow/deny/ask). `ask`는 interactive `/model`에서만 prompt가 뜨고 나머지는 거부로 취급. timeout이면 전환이 막힘 | 전환할 model의 canonical 이름 (`claude-opus-5`) | H#premodelswitch |
| `PostModelSwitch` | session의 model이 바뀐 뒤 (요청, 자동 fallback, `opusplan`의 plan mode 출입, resume 복원). 한 turn만 쓰는 fallback chain 대체엔 안 남. v2.1.251+ | PreModelSwitch와 같은 field. `source`에 `auto`, `resume`이 더 있음 | 못 막음. `additionalContext`는 다음 요청에 같이 감 | 바뀐 model의 canonical 이름 | H#postmodelswitch |
| `Elicitation` | MCP server가 tool 호출 중에 user 입력을 요청할 때 | `mcp_server_name`, `message`, `mode`(form/url), `url`, `elicitation_id`, `requested_schema` | `action` accept(+`content`)/decline/cancel로 dialog 없이 대신 답함. exit 2나 `decision:"block"`은 decline | MCP server 이름 | H#elicitation |
| `ElicitationResult` | 사용자가 elicitation에 답한 뒤, server로 보내기 전. `Elicitation` hook이 답했으면 안 남 | `mcp_server_name`, `action`, `mode`, `elicitation_id`, `content` | 응답 값을 바꾸거나 막음(decline) | MCP server 이름 | H#elicitationresult |
| `SessionEnd` | session이 끝날 때 (`/clear`, `/resume` 전환 포함) | `reason`(clear/resume/logout/prompt_input_exit/other) | 못 막음. JSON 출력 버려짐. 기본 timeout 1.5초(per-hook `timeout`이나 `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`로 늘림, 최대 60초) | `reason` | H#sessionend |

### 1.3 SDK에서 hook

- SDK는 같은 33개 event 이름을 쓴다. callback은 `options.hooks`에 넣고, 반환값은 CLI hook의 JSON 출력과 같은 모양이다. (SDK-H, TS#hookevent, DTS 982줄)
- 단 Python SDK는 10개만 된다: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `Notification`, `PermissionRequest`. 나머지 23개는 TypeScript만. (SDK-H#available-hooks, PY#hookevent)
- SDK callback이 timeout 나면: `PreToolUse`는 tool 호출을 막고, `UserPromptSubmit`은 prompt를 막는다. (H#pretooluse, H#userpromptsubmit)
- `SDK-H`는 `MessageDisplay`가 SDK에서 message당 한 번 전체 text로 남는다고 쓴다.

## 2. SDK stream message

### 2.1 먼저 알 것

- TypeScript `SDKMessage`는 39개 type의 union이다 (DTS 5383줄). 문서(TS#sdkmessage)의 union은 36개로 DTS보다 3개 적다. `control_request_progress`, `model_refusal_fallback`, `model_refusal_no_fallback`은 DTS에만 있다. 문서 union에 이름만 있고 설명이 없는 것도 있다(`api_retry`는 HL에 field 표가 있고, `notification`, `memory_recall`, `elicitation_complete`, `mirror_error`는 DTS에서만 field를 읽음).
- Python은 `Message` union이 7개: `UserMessage`, `AssistantMessage`, `SystemMessage`, `ResultMessage`, `StreamEvent`, `RateLimitEvent`, `ConversationResetMessage`. `TaskStartedMessage`, `TaskProgressMessage`, `TaskNotificationMessage`는 `SystemMessage`의 subclass. 나머지 system subtype은 `SystemMessage(subtype, data)`로 온다. (PY#message-types)
- `claude -p --output-format stream-json --verbose`가 내는 줄도 같은 message다. (HL#stream-responses)
- 켜야 나오는 것: `stream_event` = `includePartialMessages`(`--include-partial-messages`), `session_state_changed` = env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`, `prompt_suggestion` = `promptSuggestions`(`--prompt-suggestions`), `plugin_install` = env `CLAUDE_CODE_SYNC_PLUGIN_INSTALL`, `hook_started/progress/response` = `--include-hook-events` (SessionStart/Setup hook은 항상 나옴), 그 밖 subagent text는 `forwardSubagentText`. (ENV, CLI, TS)
- 권한 prompt는 stream message가 아니라 `canUseTool` callback(내부적으로 control request/response)으로 온다. (TS#canusetool)
- 한 응답은 content block마다 `assistant` message 하나로 나오고, 같은 응답이면 `message.id`가 같다. (LOOP#message-types, STREAM)
- `result` 뒤에 `prompt_suggestion` 같은 message가 더 올 수 있어서 stream은 끝까지 읽어야 한다. (LOOP#message-types)
- 모든 message는 `uuid`, `session_id`가 있다 (user message는 선택).

### 2.2 표

| 종류 (`type` / `subtype`) | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `system` / `init` | 첫 prompt를 받고 loop가 시작될 때 (SessionStart/Setup hook의 `hook_*` message가 먼저 올 수 있음) | `model`, `tools`, `mcp_servers`{name,status,source}, `permissionMode`, `slash_commands`, `skills`, `plugins`, `plugin_errors`, `agents`, `cwd`, `claude_code_version`, `apiKeySource`, `output_style`, `fast_mode_state`, `capabilities` | TS#sdksystemmessage, HL |
| `assistant` | model 응답의 content block 하나가 끝날 때 (text, thinking, tool_use) | `message`(Anthropic `BetaMessage`: id, content, model, stop_reason, usage), `parent_tool_use_id`(subagent면 값), `agent_id`, `error`(authentication_failed, rate_limit, overloaded, max_output_tokens 등), `aborted`, `timestamp`, `user_message_uuid(s)` | TS#sdkassistantmessage |
| `user` | tool 실행 뒤 tool_result를 돌려줄 때, 그리고 stream으로 넣은 user 입력 | `message`, `parent_tool_use_id`, `tool_use_result`(tool별 구조), `isSynthetic`, `origin`, `priority`, `agent_id` | TS#sdkusermessage |
| `user` + `isReplay:true` | 밖에서 주입된 turn(`origin.kind`가 peer/channel)이 stream에 되돌려질 때 | `uuid`, `session_id`, `message`, `origin`, `isReplay` | TS#sdkusermessagereplay |
| `result` / `success` | loop가 끝났을 때 (turn 단위, 마지막 줄) | `result`, `is_error`, `stop_reason`, `terminal_reason`(completed, max_turns, tool_deferred, aborted_streaming, aborted_tools, hook_stopped, stop_hook_prevented, prompt_too_long, api_error, ... 19가지), `num_turns`, `duration_ms`, `duration_api_ms`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `deferred_tool_use`, `structured_output`, `api_error_status`, `origin`, `result_index` | TS#sdkresultmessage |
| `result` / `error_*` | `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries` | 위와 비슷 + `errors[]`, `startup_failure_reason` | TS#sdkresultmessage |
| `stream_event` | partial message를 켰을 때 API streaming event마다 (`message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`) | `event`(raw API event), `parent_tool_use_id`(항상 null, main session만), `ttft_ms` | TS#sdkpartialassistantmessage, STREAM |
| `system` / `compact_boundary` | compact가 끝났을 때 | `compact_metadata`{`trigger`, `pre_tokens`, `post_tokens`, `duration_ms`, `preserved_segment`, `preserved_messages`} | TS#sdkcompactboundarymessage, DTS 3776 |
| `system` / `status` | 상태가 바뀔 때 (예: compact 중) | `status`("compacting" \| null), `permissionMode` | TS#sdkstatusmessage |
| `system` / `session_state_changed` | env로 켰을 때. 같은 상태를 여러 번 보낼 수 있음 | `state`: `idle`(다음 prompt를 기다림), `running`, `requires_action`(permission 같은 host 응답 대기). 같은 turn의 `idle`과 `result`는 어느 쪽이 먼저 올지 정해져 있지 않음. background 일이 있으면 turn이 끝나도 `running`을 유지(`CLAUDE_CODE_BG_TASKS_REPORT_RUNNING=0`이면 끝나자마자 idle) | TS#sdksessionstatechangedmessage, ENV |
| `system` / `api_retry` | API 요청이 재시도 가능한 오류로 실패해 다시 시도하기 전 | `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`(분류), `no_response` | HL#handle-api-retries, DTS 3608 |
| `rate_limit_event` | rate limit 상태가 바뀔 때 | `rate_limit_info`{`status` allowed/allowed_warning/rejected, `resetsAt`, `utilization`, `errorCode`("credits_required" 등)}. Python은 `rate_limit_type`, `overage_*`도 | TS#sdkratelimitevent, PY#ratelimitevent |
| `system` / `model_refusal_fallback`, `model_refusal_no_fallback` | model이 refusal을 냈을 때 fallback model로 다시 하거나(retry/revert/sticky), fallback 없이 끝날 때 | `original_model`, `fallback_model`, `scope`, `direction`, `api_refusal_category`, `retracted_message_uuids`(지워야 할 message), `refused_user_message_uuid`, `content` | DTS 5469, 5506 (문서에 설명 없음) |
| `system` / `control_request_progress` | 진행 중인 control request의 시작/재시도 | `request_id`, `status`(started/api_retry), `attempt`, `max_retries`, `retry_delay_ms`, `error_status` | DTS 5045 (문서에 설명 없음) |
| `tool_progress` | tool이 도는 동안. main conversation tool은 30초마다 heartbeat | `tool_use_id`, `tool_name`, `elapsed_time_seconds`, `parent_tool_use_id`, `heartbeat`, `subagent_type`, `subagent_retry`{attempt, max_retries, retry_delay_ms, error_status, error_category} | TS#sdktoolprogressmessage |
| `tool_use_summary` | tool 사용 요약 | `summary`, `preceding_tool_use_ids` | TS#sdktoolusesummarymessage (언제 내는지는 확인 못함) |
| `system` / `permission_denied` | 권한 시스템이 prompt 없이 tool 호출을 거부했을 때 (best-effort, 권위 있는 기록은 `result.permission_denials`). PreToolUse hook이 거부한 건 안 남. MCP prompt tool을 쓰면 안 남 | `tool_name`, `tool_use_id`, `agent_id`, `decision_reason_type`(rule/mode/classifier/asyncAgent), `decision_reason`, `message` | TS#sdkpermissiondeniedmessage |
| `system` / `task_started` | background task 시작 (backgrounded Bash, Monitor, subagent, remote agent) | `task_id`, `run_id`, `tool_use_id`, `description`, `task_type`(local_bash/local_agent/remote_agent), `is_backgrounded`, `spawn_depth`, `parent_task_id`, `ambient` | TS#sdktaskstartedmessage |
| `system` / `task_progress` | subagent/background task가 도는 동안 주기적으로 | `task_id`, `description`, `usage`{total_tokens, tool_uses, duration_ms}, `last_tool_name`, `summary`(`agentProgressSummaries`를 켰을 때) | TS#sdktaskprogressmessage |
| `system` / `task_updated` | task 상태가 바뀔 때 | `task_id`, `patch`{status(pending/running/completed/failed/killed), description, end_time, error, is_backgrounded} | TS#sdktaskupdatedmessage |
| `system` / `task_notification` | background task가 completed/failed/stopped 되었을 때. 이어서 합성 user turn(`origin.kind:"task-notification"`)이 따라옴 | `task_id`, `status`, `output_file`, `summary`, `usage`, `tool_use_id`, `resource_links`, `reason`(worker_restart) | TS#sdktasknotificationmessage |
| `system` / `background_tasks_changed` | live background task 집합이 바뀔 때 | `tasks[]`(전체 집합. 이전 것을 통째로 교체). 시작 시엔 안 나옴 | TS#sdkbackgroundtaskschangedmessage |
| `system` / `thinking_tokens` | thinking block 생성 중 | `estimated_tokens`, `estimated_tokens_delta` | TS#sdkthinkingtokensmessage |
| `system` / `hook_started`, `hook_progress`, `hook_response` | hook이 시작/실행 중/끝났을 때 | `hook_id`, `hook_name`, `hook_event`, (`stdout`, `stderr`, `output`, `exit_code`, `outcome` success/error/cancelled). `Notification`, `SessionEnd`, `PreCompact`, `PostCompact`는 `hook_started`가 안 나옴 | TS#sdkhookstartedmessage, CLI(`--include-hook-events`) |
| `system` / `informational` | loop가 내는 text banner. hook의 `systemMessage`도 여기로 옴 (v2.1.227+) | `content`, `level`(info/notice/suggestion/warning), `tool_use_id`, `prevent_continuation` | TS#sdkinformationalmessage |
| `system` / `notification` | UI 알림 | `key`, `text`, `priority`(low/medium/high/immediate), `color`, `timeout_ms`. hook의 `Notification`과 같은 것인지는 확인 못함 | DTS 5522 (문서에 설명 없음) |
| `system` / `elicitation_complete` | MCP elicitation이 끝났을 때 | `mcp_server_name`, `elicitation_id` | DTS 5199 (문서에 설명 없음) |
| `system` / `memory_recall` | memory를 꺼내 context에 넣을 때 | `mode`(select/synthesize), `memories[]`{path, scope, content} | DTS 5358 (문서에 설명 없음) |
| `system` / `files_persisted` | file checkpoint를 disk에 쓴 뒤 | `files[]`, `failed[]`, `processed_at` | TS#sdkfilespersistedevent |
| `system` / `commands_changed` | 쓸 수 있는 command 목록이 바뀔 때 (skill 발견, MCP prompt) | `commands[]`(전체 목록) | TS#sdkcommandschangedmessage |
| `system` / `plugin_install` | env를 켰을 때 첫 turn 전에 plugin 설치 진행 | `status`(started/installed/failed/completed), `name`, `error` | TS#sdkplugininstallmessage |
| `auth_status` | 인증 flow 중 | `isAuthenticating`, `output[]`, `error` | TS#sdkauthstatusmessage |
| `prompt_suggestion` | 옵션을 켰을 때 turn 뒤에 | `suggestion` | TS#sdkpromptsuggestionmessage |
| `conversation_reset` | `/clear`로 session은 두고 대화만 바꿀 때 | `new_conversation_id`, `trigger`(clear/plan_mode_exit/fresh_session/onboarding), `user_message_uuid`, `timestamp` | TS#sdkconversationresetmessage |
| `system` / `worker_shutting_down` | worker가 정상 종료할 때 (host exit, remote control 끊김). resume하면 과거 것이 다시 재생되므로 live stream에서만 처리 | `reason` | TS#sdkworkershuttingdownmessage |
| `system` / `mirror_error` | session 저장소 mirror 실패 | `error`, `key`{projectKey, sessionId, subpath} | DTS 5453 (문서에 설명 없음) |
| `system` / `local_command_output` | type만 있고 Claude Code가 내지 않음 (`/context`, `/usage` 결과는 `assistant` message로 옴) | `content` | TS#sdklocalcommandoutputmessage |

### 2.3 message 안의 출처 표시: `origin`

`user` message와 `result`에 붙는다. `kind`: `human`, `channel`(MCP server), `peer`(teammate나 다른 session), `task-notification`(background task 끝, routine 같은 합성 turn. `subkind` scheduled-trigger/peer-send-message), `coordinator`, `auto-continuation`, `unclassified`. 직접 사람 입력이면 host가 `{kind:"human"}`을 직접 넣어야 한다 (없으면 출처 불명으로 취급). (TS#sdkmessageorigin)

## 3. 그 밖의 상태 통로

| 통로 | 무엇이 나오나 | 어떻게 켜나 | 근거 |
|---|---|---|---|
| `session_state_changed` | `idle` / `running` / `requires_action` | env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (SDK, 또는 `--print --output-format stream-json --verbose`가 필요) | ENV, TS#sdksessionstatechangedmessage |
| statusline | 주기적으로 도는 command의 stdin으로 JSON snapshot을 받음. event가 아니라 현재 상태: `model`, `cwd`, `workspace`, `cost`, `context_window`(사용률, token), `rate_limits`, `prompt_cache`, `session_id`, `session_name`, `prompt_id`, `transcript_path`, `version`, `effort`, `thinking`, `agent`, `worktree`, `pr`, `vim`. 갱신 시점: session 시작/재개 때 한 번, 그 뒤 새 assistant message, `/compact` 끝, permission mode 변경, vim mode 변경, `refreshInterval`, rate limit window 만료, prompt cache 만료. 300ms debounce. `subagentStatusLine`은 subagent row(id, name, agentType, status, label, tokenCount 등)를 줌 | `statusLine` 설정 | SL#available-data, SL#how-status-lines-work, SL#subagent-status-lines |
| OpenTelemetry log event | 아래 3.1 참조 | `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_LOGS_EXPORTER` | OTEL#events |
| OpenTelemetry metric | `claude_code.session.count`, `lines_of_code.count`, `pull_request.count`, `commit.count`, `cost.usage`, `token.usage`, `code_edit_tool.decision`, `active_time.total` | 같음 + `OTEL_METRICS_EXPORTER` | OTEL#metrics |
| OpenTelemetry trace (beta) | prompt 하나가 `claude_code.interaction` root span. 아래에 `claude_code.llm_request`, `claude_code.hook`(detailed beta tracing 필요), `claude_code.tool`(자식 `tool.blocked_on_user`, `tool.execution`, subagent의 span). subprocess에 `TRACEPARENT` 전달 | 위 + `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` + `OTEL_TRACES_EXPORTER` | OTEL#traces-beta |
| transcript 파일 | `~/.claude/projects/<project>/<session>.jsonl`. 모든 message, tool call, tool result. subagent는 `<session>/subagents/`. hook이 비동기로 쓰므로 hook이 불릴 때 최신 turn이 아직 안 들어 있을 수 있음 (`transcript_path`) | 항상 | H#common-input-fields, `.../claude-directory.md` |
| 환경 변수 | `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS=1`은 SDK host session에서 `permission_prompt` notification을 끔 | | H#notification |
| mods 이벤트 | plugin이 Claude Code process 안에서 JS 함수로 받는 event. hook보다 넓음: `tool.call`, `tool.check`, `tool.describe`, `prompt.submit`, `prompt.compose`, `prompt.section`, `prompt.context`, `prompt.attachment`, `prompt.mention`, `skill.prompt`, `command.run`, `config.set`, `turn.start`, `turn.step`(model 요청 직전), `turn.complete`, `session.start`, `session.end`, `session.compact`, `session.receive`, `session.send`, `session.append`, `session.attach`, `session.detach`, `session.measure`, `agent.offer`, `agent.spawn`, `ui.*`, `plugin.register`, `engine.create`, `telemetry.log`, `telemetry.mark`. 기존 settings hook은 `classic.<Event>`로 받음. 관찰, 바꾸기, 대신 답하기가 다 됨. v2.1.290 기준 reference | `hooks` module | MODS#events (`.d.ts`는 읽지 못함) |

### 3.1 OTel log event 이름 (monitoring-usage)

각 event는 `claude_code.<이름>`이고 `prompt.id`, `event.sequence`(process별 순번), `event.timestamp`를 가진다. 아래는 이름과 읽은 field.

| event | 언제 | 읽은 주요 field |
|---|---|---|
| `user_prompt` | prompt를 냈을 때 (Claude Code가 스스로 시작한 turn 포함) | `prompt_length`, `prompt`(기본 가림, `OTEL_LOG_USER_PROMPTS=1`), `command_name`, `command_source`, `message.uuid` |
| `assistant_response` | text를 돌려준 API 요청마다 | `response_length`, `response`(기본 가림), `model`, `request_id`, `query_source`, `message.uuid` |
| `api_request` | API 요청마다 | `model`, `cost_usd`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `speed`, `query_source`, `effort` |
| `api_error` | API 요청 실패 | `error`, `status_code`, `attempt`, `duration_ms`, `request_id`, `client_request_id` |
| `api_retries_exhausted` | 재시도 끝에 실패 (`api_error`와 같이) | `total_attempts`, `total_retry_duration_ms`, `status_code` |
| `api_refusal` | `stop_reason:"refusal"` | api_request와 같은 속성 |
| `api_request_body`, `api_response_body` | `OTEL_LOG_RAW_API_BODIES` 켰을 때 | 원문 |
| `tool_result` | tool이 실행을 마칠 때 (거부된 호출엔 없음) | `tool_name`, `tool_use_id`, `success`, `duration_ms`, `error_type`, `decision_type`, `decision_source`, `tool_input_size_bytes`, `tool_result_size_bytes` |
| `tool_decision` | tool 권한 결정 (accept/reject) | `tool_name`, `tool_use_id`, `decision`, `source`(config/hook/user_permanent/user_temporary/user_abort/user_reject), `tool_source` |
| `permission_mode_changed` | permission mode 변경 | `from_mode`, `to_mode`, `trigger` |
| `compaction` | compact 끝 | `trigger`, `success`, `duration_ms`, `pre_tokens`, `post_tokens`, `error` |
| `subagent_completed` | subagent가 끝나 결과를 돌려줄 때 | `agent_type`, `is_async`, `total_tokens`, `total_tool_uses`, `duration_ms`, `model`, `final_model` |
| `hook_registered`, `hook_execution_start`, `hook_execution_complete`, `hook_plugin_metrics` | hook 목록(session 시작 때 hook마다), hook 실행 시작/끝 | (field 세부는 읽지 않음) |
| `auth` | `/login`, `/logout` 끝 | |
| `mcp_server_connection` | MCP server 연결/해제/실패 | |
| `skill_activated` | skill 호출 | |
| `at_mention` | prompt의 `@` mention을 풀었을 때 | |
| `plugin_installed`, `plugin_loaded` | plugin 설치, session 시작 시 enabled plugin마다 | |
| `internal_error` | 예상 못한 내부 오류 (class 이름과 errno만) | |
| `feedback_survey`, `retention_sweep`, `managed_settings_resolved` | survey, 보관 기간 정리, managed settings 해석 | |

## 4. lifecycle 단계별 정리

"없음"은 조사한 문서 안에서 그 단계를 가리키는 이름이 없다는 뜻이다. 가까운 것을 괄호로 적었다.

| 단계 | hook event | SDK stream message | 그 밖 (OTel, mods 등) |
|---|---|---|---|
| session 시작 | `Setup`(`--init-only`/`-p --init` 때만), `SessionStart`(source: startup/resume/clear/compact/fork), `InstructionsLoaded`, `ConfigChange`(중간에) | `hook_*`(SessionStart/Setup hook), `system/init`, `plugin_install`, `commands_changed` | OTel `hook_registered`, `plugin_loaded`, `managed_settings_resolved`, metric `session.count`. mods `session.start`. statusline 첫 실행 |
| 사람 입력(prompt) | `UserPromptSubmit`(scheduled task, `/loop`, background subagent 보고, 다른 session message에도 남), `UserPromptExpansion`(`/command` 직접 입력) | `user`(replay, `origin`), `conversation_reset`(`/clear`) | OTel `user_prompt`, `at_mention`, `skill_activated`. mods `prompt.submit`, `command.run` |
| turn 시작 | 없음 (문서가 `UserPromptSubmit`을 per-turn event로 분류) | 없음 (`system/init`은 loop가 시작될 때 나온다고 LOOP에 있으나, turn마다 나는지는 확인 못함) | mods `turn.start`. OTel `claude_code.interaction` span 시작 |
| turn 끝 | `Stop`(interrupt면 안 남), `StopFailure`(API 오류) | `result`(success/error_*), `session_state_changed: idle`(env 켰을 때) | mods `turn.complete`, `session.measure`. statusline 갱신 |
| model 호출 | 없음 (model이 바뀔 때만 `PreModelSwitch`, `PostModelSwitch`) | `stream_event`(`message_start`~`message_stop`, 옵션), `assistant`, `thinking_tokens`, `api_retry`, `rate_limit_event`, `model_refusal_*` | OTel `api_request`, `api_error`, `api_retries_exhausted`, `assistant_response`, span `llm_request`. mods `turn.step`. (`MessageDisplay`는 화면 출력용) |
| tool 호출 전 | `PreToolUse`(막기/입력 바꾸기) | `assistant`(tool_use block), `tool_progress`(실행 중) | OTel `tool_decision`. mods `tool.call`, `tool.check` |
| tool 호출 후 | `PostToolUse`(성공), `PostToolUseFailure`(실패), `PostToolBatch`(병렬 묶음 뒤) | `user`(tool_result, `tool_use_result`), `tool_use_summary` | OTel `tool_result`. mods `tool.call`의 반환 |
| 권한 요청 | `PermissionRequest`, `PermissionDenied`(auto mode 거부만), `Notification`(`permission_prompt`, 약 6초 뒤), `Elicitation`/`ElicitationResult`(MCP 입력 요청) | `session_state_changed: requires_action`, `permission_denied`, `canUseTool` callback(stream message 아님), result의 `permission_denials`, `elicitation_complete` | OTel `tool_decision`, `permission_mode_changed`. mods `tool.check` |
| compact | `PreCompact`(막기 가능), `PostCompact`, 뒤이어 `SessionStart`(source `compact`)와 `InstructionsLoaded`(`compact`) | `status: compacting`, `compact_boundary` | OTel `compaction`. mods `session.compact` |
| subagent | `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`(`TaskCreate`/`TaskUpdate` tool의 task), `TeammateIdle`(agent team) | `task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`, `assistant`/`user`의 `parent_tool_use_id`, `agent_id` | OTel `subagent_completed`. mods `agent.offer`, `agent.spawn`. statusline `subagentStatusLine` |
| 알림과 idle | `Notification`(`idle_prompt` 응답 끝나고 약 60초, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*` 등), `TeammateIdle` | `session_state_changed: idle`, `notification`, `informational`, `prompt_suggestion` | |
| 오류 | `StopFailure`(error 분류 12가지), `PostToolUseFailure` | `assistant.error`, `api_retry`, `result`의 `error_*`와 `is_error`와 `terminal_reason`, `rate_limit_event`, `mirror_error` | OTel `api_error`, `api_retries_exhausted`, `internal_error` |
| session 끝 | `SessionEnd`(reason: clear/resume/logout/prompt_input_exit/other) | 없음 (`result`는 turn 끝. 끝날 때 `worker_shutting_down`이 나올 수 있음. `/clear`는 `conversation_reset`) | mods `session.end`. 종료 시점의 OTel event는 읽지 못함 |

## 5. 확인 못한 것

- hooks-guide, how-claude-code-works, sub-agents, agent-teams, permission-modes 문서는 읽지 않았다. 필요한 만큼은 hooks.md와 SDK 문서에서 확인했다.
- 문서 내용만 읽었고 Claude Code를 실제로 실행해 event가 나는지는 확인하지 않았다.
- Claude Code 본체 source는 공개된 곳에서 읽지 못했다. SDK는 npm의 `sdk.d.ts`(type 정의)만 읽었고 `sdk.mjs` 실행 코드는 읽지 않았다.
- Python SDK는 문서(PY)만 읽었다. 실제 package 코드는 받지 않았다.
- `SDKNotificationMessage`가 hook의 `Notification` event와 같은 알림에서 나오는지, `tool_use_summary`를 언제 내는지, `memory_recall`, `mirror_error`, `control_request_progress`, `model_refusal_*`가 정확히 언제 나는지는 문서에 설명이 없다. DTS의 type 정의와 주석만 봤다.
- OTel event 중 `hook_*`, `mcp_server_connection`, `auth`, `skill_activated`, `at_mention`, `plugin_*`, `feedback_survey`, `retention_sweep`는 field 세부를 읽지 않았다. 이름과 한 줄 설명만 있다.
- 종료 시 OTel event가 나는지(session end에 해당하는 것)는 읽은 범위에서 찾지 못했다.
- mods는 reference의 event 표만 읽었다. 공식 `claude-code.d.ts`(GitHub)는 읽지 못했다.
- PreToolUse의 tool별 `tool_input` field(Bash, Edit, Agent 등)는 이 표에서 뺐다. H#pretooluse 아래에 tool별 표가 있다.
- Claude Desktop, VS Code extension, remote control이 따로 내는 event가 있는지는 읽은 범위에서 확인하지 못했다. (H는 hook event가 같다고 쓴다.)
