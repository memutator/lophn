# IDE·editor 쪽 agent의 lifecycle event 조사

조사일 2026-10-13. 사실만 쓴다. 추천과 lophn 설계 제안은 없다.

## 읽은 방법과 한계

- Cline은 source를 직접 읽었다. `github.com/cline/cline` main, commit `12a4c6bf` (clone: scratchpad `research/cline`). 경로는 repo 기준.
- Cursor, Windsurf, Kiro, GitHub Copilot, VS Code는 공식 문서 page를 fetch 도구로 읽었다. 이 도구는 page를 작은 model로 요약해서 돌려준다. 그래서 표의 field 이름과 blocking 여부는 공식 page 내용이지만, 원문 그대로 대조한 것은 아니다. 요약이 "문서에 없음"이라고 한 것은 아래에 "확인 못함"으로 적었다.
- 같은 이름의 event가 제품마다 다른 뜻이다. 예: `stop`은 Cursor에서는 agent loop 끝, Cline의 `TaskComplete`는 run 끝이다.
- 이름 붙이는 방식: Cursor는 camelCase, Cline·Kiro·VS Code는 PascalCase(Claude Code식), Windsurf는 snake_case, Copilot CLI는 camelCase와 PascalCase 두 가지 payload.

---

## 1. Cursor

### 1-1. Hooks

설정: `hooks.json` (`version: 1`). 위치는 Enterprise, Team(cloud), `<project>/.cursor/hooks.json`, `~/.cursor/hooks.json`. 같은 event에 걸린 hook은 모두 돈다. 결과가 겹치면 `deny` > `ask` > `allow`. exit code 0은 JSON output 사용, 2는 block, 그 밖에는 fail open(`failClosed: true`이면 block). hook 종류는 `command`와 `prompt`(LLM이 `{ok, reason}` 반환). `matcher`는 regex.
모든 hook input 공통 field: `conversation_id`, `generation_id`, `model`, `hook_event_name`, `cursor_version`, `workspace_roots`, `user_email`, `transcript_path` 등. (app lifecycle hook은 `conversation_id`, `generation_id`, `model`, `session_id`, `transcript_path`가 없다.)

#### Agent hook

| event | 언제 | 주요 field (input → output) | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `sessionStart` | 새 composer conversation 생성. fire-and-forget | `session_id`, `is_background_agent`, `composer_mode` → `env`, `additional_context` | 못 막음. session env와 context 추가 | A |
| `sessionEnd` | conversation 끝. fire-and-forget | `session_id`, `reason`(completed/aborted/error/window_close/user_close), `duration_ms`, `is_background_agent`, `final_status`, `error_message` → 없음 | 못 막음 | A |
| `preToolUse` | 모든 tool 실행 전 (Shell, Read, Write, MCP, Task 등) | `tool_name`, `tool_input`, `tool_use_id`, `cwd`, `agent_message` → `permission`(allow/deny), `user_message`, `agent_message`, `updated_input` | 막을 수 있음(deny), input 바꿀 수 있음. `ask`는 받지만 적용 안 됨 | A |
| `postToolUse` | tool 성공 뒤 | `tool_name`, `tool_input`, `tool_output`, `tool_use_id`, `cwd`, `duration` → `updated_mcp_tool_output`(MCP만), `additional_context` | 못 막음. MCP output 교체, context 추가 | A |
| `postToolUseFailure` | tool이 실패·timeout·거부됨 | `tool_name`, `tool_input`, `tool_use_id`, `cwd`, `error_message`, `failure_type`(error/timeout/permission_denied), `duration`, `is_interrupt` → `additional_context` | 못 막음 | A |
| `subagentStart` | subagent(Task tool) 만들기 전 | `subagent_id`, `subagent_type`, `task`, `parent_conversation_id`, `tool_call_id`, `subagent_model`, `is_parallel_worker`, `git_branch` → `permission`, `user_message` | 막을 수 있음 (`ask`는 deny로 처리) | A |
| `subagentStop` | subagent가 끝남·오류·중단 | `subagent_type`, `status`, `task`, `description`, `summary`, `duration_ms`, `message_count`, `tool_call_count`, `loop_count`, `modified_files`, `agent_transcript_path` → `followup_message` | 못 막음. `completed`일 때 follow-up 보낼 수 있음. `loop_limit` 적용 | A |
| `beforeShellExecution` | shell 명령 실행 전 | `command`, `cwd`, `sandbox` → `permission`(allow/deny/ask), `user_message`, `agent_message` | 막기, 승인 요구 | A |
| `afterShellExecution` | shell 명령 실행 뒤 | `command`, `output`, `duration`(승인 대기 제외), `sandbox` | 관찰만 | A |
| `beforeMCPExecution` | MCP tool 실행 전 | `tool_name`, `tool_input`, `mcp_server_name`, `url`/`mcp_server_url` 또는 `command` → `permission`, `user_message`, `agent_message` | 막기, 승인 요구 | A |
| `afterMCPExecution` | MCP tool 실행 뒤 | `tool_name`, `tool_input`, `mcp_server_name`, `mcp_server_url`, `result_json`, `duration` | 관찰만 | A |
| `beforeReadFile` | agent가 파일을 읽기 전 | `file_path`, `content`, `attachments`(`type` file/rule) → `permission`(allow/deny), `user_message` | 막을 수 있음 | A |
| `afterFileEdit` | agent가 파일을 고친 뒤 | `file_path`, `edits`(`old_string`, `new_string`) | 관찰만 | A |
| `beforeSubmitPrompt` | 사람이 보낸 뒤, backend 요청 전 | `prompt`, `attachments` → `continue`(bool), `user_message` | 제출을 막을 수 있음 | A |
| `preCompact` | context compaction 전 | `trigger`(auto/manual), `context_usage_percent`, `context_tokens`, `context_window_size`, `message_count`, `messages_to_compact`, `is_first_compaction` → `user_message` | 못 막음, 못 바꿈 | A |
| `stop` | agent loop 끝 | `status`(completed/aborted/error), `loop_count` → `followup_message` | follow-up message를 자동으로 보낼 수 있음. `loop_limit` 기본 5 | A |
| `afterAgentResponse` | assistant message 하나가 끝난 뒤 | `text` | 관찰만 | A |
| `afterAgentThought` | thinking block 하나가 끝난 뒤 | `text`, `duration_ms`(optional) | 관찰만 | A |

#### Tab hook (inline 완성)

| event | 언제 | 주요 field | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `beforeTabFileRead` | Tab이 파일을 읽기 전 | `file_path`, `content` → `permission` | 막을 수 있음 | A |
| `afterTabFileEdit` | Tab이 파일을 고친 뒤 | `file_path`, `edits`(`old_string`, `new_string`, `range`, `old_line`, `new_line`) | 관찰만 | A |

#### App lifecycle hook

| event | 언제 | 주요 field | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `workspaceOpen` | workspace를 열 때와 folder가 바뀔 때. desktop app과 CLI만 | 공통 field만 → `pluginPaths` | 못 막음. plugin 경로 추가 | A |

#### 그 밖의 사실

- matcher 대상: `preToolUse`·`postToolUse`·`postToolUseFailure`는 tool 종류(`Shell`, `Read`, `Write`, `Grep`, `Delete`, `Task`, `MCP:<tool_name>`), `subagentStart`·`subagentStop`은 subagent 종류, `beforeShellExecution`·`afterShellExecution`은 명령 문자열 전체. (A)
- cloud agent에서 안 되는 event: `sessionStart`, `sessionEnd`, `beforeMCPExecution`, `afterMCPExecution`, `beforeTabFileRead`, `afterTabFileEdit`, `workspaceOpen`. cloud agent는 command hook만 된다. (A)
- 확인 못함: Cursor CLI(cursor-agent)에서 어느 hook이 도는지. 문서에 CLI 전용 hook page는 없다(`/docs/cli/hooks`는 404). `workspaceOpen`만 "desktop app과 CLI" 라고 적혀 있다.

### 1-2. Cursor CLI의 stream-json 출력 event

`cursor-agent -p --output-format stream-json`. 한 줄에 JSON 하나(NDJSON). (B)

| event | 언제 | 주요 field | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `system` / `init` | session 시작에 한 번 | `apiKeySource`, `cwd`, `session_id`, `model`, `permissionMode` | 관찰만 (출력 stream) | B |
| `user` | 사람 prompt | `message.role`, `message.content[]`(`type: text`), `session_id` | 관찰만 | B |
| `assistant` | assistant message 하나가 끝날 때 (tool call 사이마다) | `message.content[]`, `session_id`. `--stream-partial-output`이면 `timestamp_ms`, `model_call_id` 추가되고 delta로도 나옴 | 관찰만 | B |
| `tool_call` / `started` | tool 호출 시작 | `call_id`, `tool_call.readToolCall.args.path`, `tool_call.writeToolCall.args`(`path`, `fileText`, `toolCallId`), 그 밖의 tool은 `tool_call.function`(`name`, `arguments`) | 관찰만 | B |
| `tool_call` / `completed` | tool 호출 끝 | `call_id`, `result.success`(read: `content`, `isEmpty`, `exceededLimit`, `totalLines`, `totalChars`. write: `path`, `linesCreated`, `fileSize`) | 관찰만 | B |
| `result` / `success` | 성공으로 끝 | `is_error`, `duration_ms`, `duration_api_ms`, `result`, `session_id`, `request_id` | 관찰만 | B |

- 오류 event는 없다. 실패하면 process가 non-zero로 끝나고 stderr에 메시지를 쓴다. stream은 `result` 없이 끊길 수 있다. (B)
- `thinking` event는 print mode에서 나오지 않는다. (B)
- 문서에 shell, MCP, subagent 전용 event는 없다. 확인 못함: `readToolCall`·`writeToolCall` 말고 tool별 payload 모양.

근거
- A: https://cursor.com/docs/agent/hooks
- B: https://cursor.com/docs/cli/reference/output-format

---

## 2. Cline

Cline repo는 SDK(`sdk/`) 위로 옮겨진 상태다. event 통로가 네 가지다: file hook(script), runtime hook(plugin, in-process), runtime event(구독), CLI `--json` 출력. 옛 VS Code 확장(`apps/vscode`)에 남은 hook 목록도 있어 따로 적는다.

### 2-1. File hook (script가 stdin으로 JSON을 받고 stdout으로 JSON을 돌려줌)

위치 `.cline/hooks/<이름>`(CLI), `.clinerules/hooks/<이름>`(VS Code). 이름이 event를 정한다. (C1, C2)

| event (file 이름 → payload `hookName`) | 언제 | 주요 field | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `TaskStart` → `agent_start` | run 시작 (`beforeRun`) | 공통: `clineVersion`, `hookName`, `timestamp`, `taskId`, `workspaceRoots`, `workspaceInfo`, `userId`, `agent_id`, `parent_agent_id`, `taskStart.taskMetadata` | output `cancel`이 run을 멈춤(`mapStopControl`). 이벤트별 적용 범위는 확인 못함 | C1, C3, C5 |
| `TaskResume` → `agent_resume` | 재개한 run 시작 | 공통 + `taskResume`(`taskMetadata`, `previousState`) | 위와 같음 | C1, C2 |
| `UserPromptSubmit` → `prompt_submit` | 사람 prompt 제출 (`beforeRun` + 제출된 prompt) | 공통 + `userPromptSubmit`(`prompt`, `attachments`) | 위와 같음 | C1, C2 |
| `PreToolUse` → `tool_call` | tool 실행 전 (`beforeTool`) | 공통 + `iteration`, `tool_call`(`id`, `name`, `input`), `preToolUse`(`toolName`, `parameters`) | `cancel`(막기), `review`(사람 검토를 거치게 함), `overrideInput`(input 교체), `context`(다음 turn에 주입), `errorMessage` | C1, C3, C4 |
| `PostToolUse` → `tool_result` | tool 실행 뒤 (`afterTool`) | 공통 + `iteration`, `tool_result`(`id`, `name`, `input`, `output`, `error`, `durationMs`), `postToolUse`(`result`, `success`, `executionTimeMs`) | `context`만 (결과 교체는 runtime hook에서) | C1, C3, C4 |
| `TaskComplete` → `agent_end` | run이 `completed`로 끝 (`afterRun`) | 공통 + `iteration`, `turn`, `taskComplete.taskMetadata` | 관찰 | C1, C2 |
| `TaskError` → `agent_error` | run이 실패로 끝 (`afterRun`) | 공통 + `iteration`, `error`(`name`, `message`, `stack`) | 관찰 | C1, C2 |
| `TaskCancel` → `agent_abort` | run이 중단됨 (`afterRun` 또는 abort 사유의 session shutdown) | 공통 + `reason`, `taskCancel.taskMetadata` | 관찰 | C1, C2 |
| `SessionShutdown` → `session_shutdown` | session 정리·runtime 종료 | 공통 + `reason` | 관찰 | C1, C2 |
| `PreCompact` → (연결 안 됨) | file 이름은 있으나 event 연결이 `undefined`. 문서도 "not wired for file hooks today" | payload type `PreCompactData`: `taskId`, `ulid`, `contextSize`, `compactionStrategy`, `previousApiReqIndex`, `tokensIn/Out`, `tokensInCache/OutCache`, `deletedRangeStart/End`, `contextJsonPath`, `contextRawPath` | 해당 없음 | C1, C2 |

- 한 번의 `run()`/`continue()` 호출이 `beforeRun`~`afterRun`이고, interactive session에서는 사람이 낸 turn 하나다. `afterRun`은 completed, aborted, failed 모두에서 난다. (C2)
- hook 실패: 기본 `hookErrorMode: "ignore"`. plugin hook은 3초 timeout. (C6)
- `--yolo` mode에서는 file hook이 꺼진다. (C2)
- 옛 VS Code 확장의 hook 이름 목록(`apps/vscode/src/core/hooks/utils.ts`): `TaskStart`, `TaskResume`, `TaskCancel`, `TaskComplete`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `PreCompact`. 이 중 SDK 연결에서 "연결 안 함"(deferred)으로 적힌 것: `TaskResume`, `TaskError`, `SessionShutdown`, `PreCompact`, `Notification`. (C5) 즉 VS Code 확장은 `TaskStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `TaskComplete`, `TaskCancel`만 SDK hook으로 이어진다.
- `Notification` (옛 VS Code 구현): `notification.event`(예: `user_attention` = 사람 입력이 필요한 ask, `task_complete`), `source`, `message`, `waitingForUserInput`, `requiresUserAction`, `severity`, `eventId`, `sourceType`, `sourceId`. 관찰만: `cancel`과 `contextModification`을 무시한다. (C7)

### 2-2. Runtime hook (plugin의 `hooks`, in-process)

| event | 언제 | 받는 것 → 돌려줄 수 있는 것 | 근거 |
|---|---|---|---|
| `beforeRun` | run 시작 전 | snapshot → `stop`·`reason`(run 끝내기), `appendContext` | C6 |
| `afterRun` | run 끝, `result.status` 포함 | `result` → 없음 | C6 |
| `beforeModel` | model 요청마다 | `request` → `messages`, `tools`, `options` 바꾸기, `stop` | C6 |
| `afterModel` | model 응답마다 | `assistantMessage`, `finishReason` → `stop` | C6 |
| `beforeTool` | tool 실행 전 | `tool`, `toolCall`, `input` → `skip`·`reason`(막기, reason은 model에게 돌아감), `input` 교체, `policy`(예: `{autoApprove: false}`로 승인 요구), `appendContext`, `stop` | C6 |
| `afterTool` | tool 실행 뒤 | `result`, 시간 → `result` 교체, `appendContext`, `stop` | C6 |
| `onEvent` | runtime event 구독 | event → 없음 | C6 |

snapshot에는 agent id, conversation id, iteration, messages, usage가 들어 있다. (C6)

### 2-3. Runtime event (`AgentRuntimeEvent`, `agent.subscribe`)

`run-started`, `message-added`, `turn-started`, `assistant-text-delta`, `assistant-reasoning-delta`, `assistant-media`, `assistant-message`(+`finishReason`), `tool-started`, `tool-updated`, `tool-finished`, `usage-updated`, `turn-finished`(+`toolCallCount`), `status-notice`, `run-finished`(+`result`), `run-failed`(+`error`, `errorClass`). 관찰만. (C8)

host 쪽 `AgentEvent` (`onEvent`, CLI `--json`): `content_start`, `content_update`, `content_end`, `iteration_start`, `iteration_end`, `usage`, `notice`, `done`(`reason`: completed/max_iterations/aborted/mistake_limit/error), `error`. (C9)

### 2-4. 승인

runtime 설정의 `requestToolApproval(request)` callback이 tool 승인을 받는다. hook이 아니라 host callback이다. file hook의 `PreToolUse`는 `review: true`로 같은 검토 흐름을 부를 수 있다. (C8, C4) 이 callback이 내는 event 이름은 확인 못함.

### 2-5. CLI `--json` 출력 줄

`type`이 `agent_event`(위 `AgentEvent`), `hook_event`(`hookEventName`, `agentId`, `taskId`), `team_event`, `run_result`(`finishReason`, `iterations`, `usage`, `durationMs`, `model`, `text`), `run_aborted`(`reason`, `message`), `run_start`(`--verbose`일 때). 오류는 stderr에 `{"type":"error","message":...}`. (C10)

### 2-6. Telemetry event (OpenTelemetry)

hook과 별개로 `task.created`, `task.restarted`, `task.completed`, `task.conversation_turn`, `task.tokens`, `task.tool_used`, `task.mcp_tool_called`(started/success/error), `task.terminal_execution`, `task.subagent_started`, `task.subagent_completed`, `task.summarize_task`(auto-compact), `hooks.execution`(started/completed/failed/cancelled) 등이 있다. (C11)

근거
- C1: `sdk/packages/core/src/hooks/hook-file-config.ts` (file 이름, event 연결표)
- C2: `sdk/examples/hooks/README.md` (file hook ↔ runtime hook 표, 용어, `--yolo`)
- C3: `sdk/packages/shared/src/hooks/events.ts` (payload type, `HookEventName`)
- C4: `sdk/examples/hooks/README.md`의 Output 표, `sdk/packages/shared/src/hooks/contracts.ts` (`HookControl`)
- C5: `apps/vscode/src/sdk/hooks-adapter.ts`, `apps/vscode/src/core/hooks/utils.ts`
- C6: `docs/sdk/plugins.mdx` (Hooks 절)
- C7: `apps/vscode/src/core/hooks/templates.ts` (`getNotificationTemplate`)
- C8: `sdk/packages/shared/src/agent.ts` (`AgentRuntimeEvent`, `requestToolApproval`)
- C9: `docs/sdk/reference/events.mdx`
- C10: `docs/cli/cli-reference.mdx` ("JSON Output for Agent Runs")
- C11: `docs/enterprise-solutions/monitoring/opentelemetry-events.mdx`

---

## 3. Windsurf (Cascade)

Windsurf 문서가 `docs.devin.ai/desktop/cascade/hooks`로 옮겨져 있다. 설정 경로에 `Devin`이 들어 있고 옛 `Windsurf` 경로도 쓴다. 같은 hook 기능이다. (D)

공통 input field: `agent_action_name`, `trajectory_id`, `execution_id`, `timestamp`, `model_name`, `tool_info`. 설정: `hooks.json`의 `hooks.<event>[]` 안에 `command`, `powershell`, `show_output`, `working_directory`. 위치는 cloud(Enterprise) → system → `~/.codeium/windsurf/hooks.json`(user) → `.devin/hooks.json`(workspace, 옛 `.windsurf/hooks.json`도 읽음) 순서로 합쳐서 돈다. exit code 0 성공, 2는 pre hook을 막고 stderr를 agent에게 보여줌, 그 밖은 오류지만 계속. Restricted Mode에서는 안 돈다. (D)

| event | 언제 | `tool_info` field | 막을 수 있나 | 근거 |
|---|---|---|---|---|
| `pre_read_code` | 코드 파일 읽기 전 | `file_path`(재귀 읽기 때 directory일 수 있음) | 예 | D |
| `post_read_code` | 읽기 성공 뒤 | `file_path` | 아니오 | D |
| `pre_write_code` | 코드 파일 쓰기·수정 전 | `file_path`, `edits`(`old_string`, `new_string`) | 예 | D |
| `post_write_code` | 쓰기·수정 뒤 | `file_path`, `edits` | 아니오 | D |
| `pre_run_command` | terminal 명령 실행 전 | `command_line`, `cwd` | 예 | D |
| `post_run_command` | 명령 실행 뒤 | `command_line`, `cwd` | 아니오 | D |
| `pre_mcp_tool_use` | MCP tool 호출 전 | `mcp_server_name`, `mcp_tool_name`, `mcp_tool_arguments` | 예 | D |
| `post_mcp_tool_use` | MCP 호출 성공 뒤 | 위 + `mcp_result` | 아니오 | D |
| `pre_user_prompt` | 사람 prompt를 처리하기 전 | `user_prompt` | 예 | D |
| `post_cascade_response` | Cascade 응답이 끝난 뒤, 비동기 | `response`(마지막 사람 입력 이후 step들의 markdown) | 아니오 | D |
| `post_cascade_response_with_transcript` | 같은 때, 비동기 | `transcript_path`(`~/.windsurf/transcripts/{trajectory_id}.jsonl`, 최대 100개 유지) | 아니오 | D |
| `post_setup_worktree` | git worktree를 만들고 설정한 뒤, 새 worktree 안에서 | `worktree_path`, `root_workspace_path` | 아니오 | D |

"막을 수 있다"는 pre hook만 해당한다. 값을 바꾸는 output(input 교체 등)은 문서에 없다. 확인 못함: `show_output` 외의 JSON output field.

근거
- D: https://docs.devin.ai/desktop/cascade/hooks (옛 주소 https://docs.windsurf.com/windsurf/cascade/hooks 가 여기로 307 redirect)

---

## 4. Kiro

hook 기능이 두 겹이다. 사람이 쓰는 IDE/CLI "agent hooks"(trigger 이름은 PascalCase, 1.0 이후)와 CLI 2.x의 옛 이름. 설정 field: `name`, `trigger`, `description`, `matcher`, `action`(`type`: `command` 또는 `agent`, `command`/`prompt`), `timeout`(기본 60초), `enabled`, `confirm`(`Stop`의 command hook용). `command` action은 session context를 JSON으로 STDIN에 받고, exit 0이면 stdout이 agent context에 들어가며, 그 밖이면 stderr가 agent에게 가고 오류 통보. `agent` action은 prompt를 현재 conversation에 넣어 새 agent loop를 돌리고 credit을 쓴다. (E1, E3)

matcher: `PreToolUse`·`PostToolUse`는 tool id regex. 내장 분류 `read`, `write`, `shell`, `web`, `spec`, 출처 선택자 `@mcp`, `@powers`, `@builtin`, `@<server>`, `@<server>/<tool>`, 와일드카드 `*`·`?`. 파일 trigger의 matcher는 file path regex. (E1, E2)

| event (trigger) | 언제 | 주요 field | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `SessionStart` | 새 chat session 시작. IDE 가능, CLI는 V3 | `hook_event_name`, `cwd`, `session_id` (2.x `agentSpawn` 문서 기준) | 못 막음. exit 0이면 stdout이 agent context에 들어감 | E2, E4 |
| `UserPromptSubmit` | 사람이 prompt 제출 | prompt는 STDIN이 아니라 환경변수 `USER_PROMPT`로 전달 | IDE에서는 막을 수 있음(non-zero exit가 제출을 막음). CLI에서는 못 막음, 출력과 exit code가 context로 전달 | E2, E3, E4 |
| `PreToolUse` | tool 호출 직전 | `hook_event_name`, `cwd`, `session_id`, `tool_name`, `tool_input` | 막을 수 있음(non-zero exit가 호출을 막음). 입력 교체는 문서에 없음 | E2, E3, E4 |
| `PostToolUse` | tool 호출 뒤 | 결과를 쓸 수 있다고만 적혀 있고 field는 확인 못함 | 못 막음 | E2, E4 |
| `PostFileCreate` | agent가 패턴에 맞는 파일을 만들 때 (옛 이름 `fileCreated`) | 확인 못함 | 못 막음 | E2, E4, E5 |
| `PostFileSave` | agent가 패턴에 맞는 파일을 저장·수정할 때 (`fileEdited`) | 파일 경로와 session context | 못 막음 | E1, E4, E5 |
| `PostFileDelete` | agent가 패턴에 맞는 파일을 지울 때 (`fileDeleted`) | 확인 못함 | 못 막음 | E2, E4, E5 |
| `PreTaskExec` | spec task 시작 전 (`preTaskExecution`) | 확인 못함 | 막을 수 있음 | E2, E4, E5 |
| `PostTaskExec` | spec task 끝난 뒤 (`postTaskExecution`) | 확인 못함 | 못 막음 | E2, E4, E5 |
| `Stop` | agent가 turn을 끝내고 응답할 때 (`agentStop`, CLI 2.x `stop`) | 확인 못함. `confirm` block 사용 가능 | CLI V3: exit 1 또는 JSON `"decision":"block"`+reason이면 한 turn 더 돌림. exit 2로는 거부 못함 | E1, E4 |
| `SessionEnd` | CLI V3에서 session을 닫을 때 | 확인 못함 | 확인 못함 | E2 |
| `Manual` | CLI V3 목록에 있으나 `/hooks`에서 부를 방법이 없다고 함. 옛 IDE `userTriggered`는 새로 못 만들고 옛 hook으로만 돎 | 해당 없음 | 해당 없음 | E2, E5 |

- 파일 trigger는 agent가 한 변경에만 반응한다. 사람이 에디터에서 고친 것은 안 난다. (E2)
- 근거끼리 안 맞는 곳: `SessionEnd`는 trigger page(E2)에는 있고 CLI V3 migration page(E4)의 10개 trigger 목록에는 없다. 확인 못함.
- Kiro hook 문서에 compact, subagent, 권한 요청, 알림, 오류 event는 없다.
- 확인 못함: trigger별 STDIN field 전체. 문서 page에 `agentSpawn`과 `PreToolUse`의 field만 나온다.

근거
- E1: https://kiro.dev/docs/hooks/
- E2: https://kiro.dev/docs/hooks/types/
- E3: https://kiro.dev/docs/hooks/actions/
- E4: https://kiro.dev/docs/cli/v3/hooks-migration/
- E5: https://kiro.dev/docs/ide/whats-new-v1/hooks/

---

## 5. GitHub Copilot

hook이 두 곳에 있다. (1) Copilot CLI와 Copilot cloud agent(coding agent), (2) VS Code의 agent hook.

### 5-1. Copilot CLI / cloud agent

설정: `{"version": 1, "hooks": {...}}`. 위치: policy 파일(`/etc/github-copilot/policy.d/` 등, 끌 수 없음), `.github/hooks/*.json`(cloud agent는 이것만), `~/.copilot/hooks/`, `.github/copilot/settings.json`, `.claude/settings*.json`, `~/.copilot/settings.json`, plugin `hooks.json`. handler: `command`, `http`(JSON POST), `prompt`(`sessionStart`만, 자동으로 user message 제출). `timeoutSec` 기본 30. matcher(regex, 전체 일치): `notification`은 `notification_type`, `permissionRequest`·`preToolUse`·`postToolUse`는 `toolName`, `preCompact`는 `trigger`, `subagentStart`는 `agentName`. 실패: 대부분 event는 오류를 기록하고 계속. `preToolUse` command hook은 fail-closed(exit 2, crash, non-zero가 tool 호출을 deny). timeout은 모든 event에서 fail-open. exit 2는 보통 경고이고 `preToolUse`·`permissionRequest`에서만 deny. (F1)

payload는 camelCase(`sessionId`, `timestamp`(epoch ms), `cwd` 공통)와 PascalCase(snake_case field + `hook_event_name`, ISO 8601 timestamp) 두 가지. (F1)

| event | 언제 | 주요 field (input → output) | 막거나 바꿀 수 있나 | CLI / cloud | 근거 |
|---|---|---|---|---|---|
| `sessionStart` | session 시작 또는 재개 | `source`(startup/resume/new), `initialPrompt` → `additionalContext` | 못 막음. context 추가 | 둘 다 | F1, F2 |
| `sessionEnd` | session 끝 | `reason`(complete/error/abort/timeout/user_exit) | 관찰만 | 둘 다 | F1 |
| `userPromptSubmitted` | 사람이 prompt 제출 | `prompt` → `modifiedPrompt` | 못 막음. prompt 교체는 SDK 코드 hook만 됨(설정 file output은 버림) | 둘 다 | F1 |
| `userPromptTransformed` | runtime이 prompt를 model용 내용으로 바꿀 때 | `prompt`, `transformedPrompt` → `modifiedTransformedPrompt` | 못 막음. model에 가는 내용만 교체(화면 prompt는 그대로) | 둘 다 | F1 |
| `preToolUse` | 모든 tool 실행 전 | `toolName`, `toolArgs` → `permissionDecision`(allow/deny/ask), `permissionDecisionReason`, `modifiedArgs` | 막기, args 교체. cloud에서는 `ask`가 deny | 둘 다 | F1, F2 |
| `permissionRequest` | permission service가 돌기 전 | input 확인 못함(문서에 없음) → `behavior`(allow/deny), `message`, `interrupt` | 허용·거부를 정함. `interrupt`+deny는 agent를 멈춤 | CLI만 | F1 |
| `postToolUse` | tool 성공 뒤 | `toolName`, `toolArgs`, `toolResult`(`resultType`, `textResultForLlm`) → `modifiedResult`, `additionalContext` | 못 막음. 결과 교체, context 추가(합쳐 10KB 한도) | 둘 다 | F1 |
| `postToolUseFailure` | tool 실패 뒤 | `toolName`, `toolArgs`, `error` → `additionalContext` | 못 막음 | 둘 다 | F1 |
| `agentStop` | 주 agent가 turn을 끝낼 때 | `transcriptPath`, `stopReason`, `stop_hook_active` → `decision`(block/allow), `reason` | `block`이면 `reason`을 prompt로 한 turn 더 돌림. 연속 8번 block이면 CLI가 hook을 무시 | 둘 다 | F1 |
| `subagentStart` | subagent를 만든 뒤 실행 전 | `transcriptPath`, `agentName`, `agentDisplayName`, `agentDescription` → `additionalContext` | 못 막음. subagent 첫 message 앞에 context 붙임 | 둘 다 | F1 |
| `subagentStop` | subagent 끝 | `transcriptPath`, `agentId`, `agentType`, `agentName`, `response`, `stopReason` → `decision`, `reason`, `modifiedResponse` | `block`이면 계속 돌림. 아니면 `modifiedResponse`로 응답 교체 | 둘 다 | F1 |
| `errorOccurred` | 오류 발생 | `error`(`message`, `name`, `stack`), `errorContext`(model_call/tool_execution/system/user_input), `recoverable` | 관찰만 | 둘 다 | F1 |
| `preCompact` | compaction 시작 전 | `transcriptPath`, `trigger`(manual/auto), `customInstructions` | 관찰만 | CLI, cloud는 auto만 | F1 |
| `notification` | CLI가 system notification을 낼 때 | `message`, `title`, `notification_type`(`shell_completed`, `shell_detached_completed`, `agent_completed`, `agent_idle`, `permission_prompt`, `elicitation_dialog`) → `additionalContext` | 못 막음(비동기). idle이면 context 주입이 추가 처리를 일으킬 수 있음 | CLI만 | F1 |

- `subagentStart`·`subagentStop`은 내장 `general-purpose` agent에는 안 난다. (F1)
- cloud agent docs의 요약 page는 8개(`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `agentStop`, `subagentStop`, `errorOccurred`)만 소개한다. 위 표는 reference page 기준이다. (F2)
- 확인 못함: `permissionRequest`의 input field.

### 5-2. VS Code agent hook (Local harness)

Preview. 8개 event. Copilot·Claude·Codex harness는 각자 provider hook을 쓰고, 아래는 VS Code 자체(Local) agent용. 공통 input: `timestamp`, `hook_event_name`, `cwd`, `session_id`, `transcript_path`(불안정). 공통 output: `continue`(false면 실행 중단), `stopReason`, `systemMessage`. exit code 0 성공, 2 block(stderr가 model에게), 그 밖은 경고. 결과가 겹치면 가장 엄격한 쪽. (G2)

| event | 언제 | 주요 field | 막거나 바꿀 수 있나 | 근거 |
|---|---|---|---|---|
| `SessionStart` | 첫 prompt로 session 시작 | `source`(지금은 항상 `new`) → `hookSpecificOutput.additionalContext` | 공통 방식(`continue: false`, exit 2)만 | G2 |
| `UserPromptSubmit` | 사람이 prompt 제출 | `prompt` | 공통 방식만 | G2 |
| `PreToolUse` | tool 호출 전 | `tool_name`, `tool_input`, `tool_use_id` → `permissionDecision`(allow/deny/ask), `permissionDecisionReason`, `updatedInput`, `additionalContext` | 막기(deny, exit 2), input 교체, 승인 요구. 우선순위 deny > ask > allow | G2 |
| `PostToolUse` | tool 성공 뒤 | `tool_name`, `tool_input`, `tool_use_id`, `tool_response` → `decision: "block"`, `reason`, `additionalContext` | block 가능 | G2 |
| `PreCompact` | compaction 전 | `trigger`(`auto`) | 공통 방식만 | G2 |
| `SubagentStart` | subagent 시작 | `agent_id`, `agent_type` → `additionalContext` | 막는 방법 문서에 없음 | G2 |
| `SubagentStop` | subagent가 멈추려 할 때 | `agent_id`, `agent_type`, `stop_hook_active` → `decision: "block"`, `reason` | 멈추지 못하게 함 | G2 |
| `Stop` | 현재 agent 실행이 멈추려 할 때 (session 끝 아님) | `stop_hook_active` → `hookSpecificOutput.decision: "block"`, `reason` | 멈추지 못하게 함. 막을 때마다 AI credit이 듦. subagent로 돌면 `SubagentStop`으로 처리 | G2 |

근거
- F1: https://docs.github.com/en/copilot/reference/hooks-configuration
- F2: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks
- G1: https://code.visualstudio.com/docs/copilot/customization/hooks
- G2: https://code.visualstudio.com/docs/agents/reference/hooks-reference

---

## 6. lifecycle 단계별 정리

"없음"은 그 제품에 그 event가 문서나 source에 없다는 뜻이다. "공통 tool event"는 따로 나누지 않고 tool 전·후 event 하나로 처리하며 `tool_name`으로 구분한다는 뜻이다. Cline 열의 file hook 이름 뒤 괄호는 runtime hook이나 event다.

| 단계 | Cursor (hooks / CLI stream) | Cline | Windsurf | Kiro | Copilot CLI·cloud | VS Code agent |
|---|---|---|---|---|---|---|
| session 시작 | `sessionStart` / stream `system`(`init`) | `TaskStart`(`agent_start`), 재개는 `TaskResume`(`agent_resume`). runtime `run-started` | 없음 | `SessionStart` (CLI 2.x `agentSpawn`) | `sessionStart` | `SessionStart` |
| 사람 입력(prompt) | `beforeSubmitPrompt` / stream `user` | `UserPromptSubmit`(`prompt_submit`) | `pre_user_prompt` | `UserPromptSubmit` | `userPromptSubmitted`, `userPromptTransformed` | `UserPromptSubmit` |
| turn 시작 | 없음 | runtime `turn-started`, `iteration_start`(`AgentEvent`) | 없음 | 없음 | 없음 | 없음 |
| turn 끝 | `stop`, `afterAgentResponse`(assistant message 끝) / stream `result`(`success`) | `TaskComplete`(`agent_end`)(run 끝), runtime `turn-finished`, `run-finished`, `iteration_end` | `post_cascade_response`, `post_cascade_response_with_transcript` (비동기) | `Stop` | `agentStop` | `Stop` |
| model 호출 | 없음 (끝난 뒤 `afterAgentResponse`, `afterAgentThought`) | runtime hook `beforeModel`, `afterModel`. runtime `assistant-message`. 이 둘은 file hook 아님 | 없음 | 없음 | `userPromptTransformed`(model에 가는 prompt 변환. model 호출 자체는 아님) | 없음 |
| tool 호출 전 (공통) | `preToolUse` | `PreToolUse`(`tool_call`), runtime `beforeTool` | 없음 (종류별 pre event만) | `PreToolUse` | `preToolUse` | `PreToolUse` |
| tool 호출 후 (공통) | `postToolUse`, 실패는 `postToolUseFailure` / stream `tool_call`(`started`·`completed`) | `PostToolUse`(`tool_result`), runtime `afterTool`, `tool-finished` | 없음 (종류별 post event만) | `PostToolUse` | `postToolUse`, 실패는 `postToolUseFailure` | `PostToolUse` |
| shell 전 / 후 | `beforeShellExecution` / `afterShellExecution` | 공통 tool event | `pre_run_command` / `post_run_command` | 공통 tool event (matcher `shell`) | 공통 tool event | 공통 tool event |
| 파일 읽기 전 / 후 | `beforeReadFile` / 없음 (Tab: `beforeTabFileRead`) | 공통 tool event | `pre_read_code` / `post_read_code` | 공통 tool event (matcher `read`) | 공통 tool event | 공통 tool event |
| 파일 쓰기 전 / 후 | 없음 / `afterFileEdit` (Tab: `afterTabFileEdit`) | 공통 tool event | `pre_write_code` / `post_write_code` | 전 없음 / 후 `PostFileCreate`, `PostFileSave`, `PostFileDelete` | 공통 tool event | 공통 tool event |
| MCP 전 / 후 | `beforeMCPExecution` / `afterMCPExecution` | 공통 tool event | `pre_mcp_tool_use` / `post_mcp_tool_use` | 공통 tool event (matcher `@mcp`, `@<server>`) | 공통 tool event | 공통 tool event |
| 권한 요청 | 없음 (`before*` hook이 `permission: ask`를 돌려 승인을 요구) | 없음 (file hook `PreToolUse`의 `review: true`, runtime hook `beforeTool`의 `policy.autoApprove: false`, host callback `requestToolApproval`) | 없음 | 없음 | `permissionRequest`, `notification`(`permission_prompt`) | 없음 (`PreToolUse`가 `ask`를 돌려 승인을 요구) |
| compact | `preCompact` | runtime hook으로 처리. file 이름 `PreCompact`는 있으나 SDK에서 event에 연결 안 됨. telemetry `task.summarize_task` | 없음 | 없음 | `preCompact` | `PreCompact` |
| subagent | `subagentStart`, `subagentStop` | hook 없음. payload에 `parent_agent_id`, telemetry `task.subagent_started`·`task.subagent_completed` | 없음 | 없음 | `subagentStart`, `subagentStop` | `SubagentStart`, `SubagentStop` |
| 알림과 idle | 없음 | `Notification`(`user_attention`, `task_complete`; 옛 VS Code 구현, SDK에는 연결 안 됨), runtime `status-notice`, `notice` | 없음 | 없음 | `notification`(`shell_completed`, `shell_detached_completed`, `agent_completed`, `agent_idle`, `permission_prompt`, `elicitation_dialog`) | 없음 |
| 오류 | 별도 event 없음. `postToolUseFailure`(tool 단위), `stop`·`sessionEnd`의 status/reason에 `error`. stream은 오류 event 없음(non-zero exit + stderr) | `TaskError`(`agent_error`), runtime `run-failed`, `error`(`AgentEvent`) | 없음 | 없음 | `errorOccurred`, `postToolUseFailure` | 없음 |
| session 끝 | `sessionEnd` | `SessionShutdown`(`session_shutdown`), 중단은 `TaskCancel`(`agent_abort`) | 없음 | `SessionEnd` (CLI V3, 근거 사이에 불일치 있음. 위 4절 참고) | `sessionEnd` | 없음 (`Stop`은 session 끝이 아님) |
| 그 밖 | `workspaceOpen`, Tab hook | CLI `--json`의 `hook_event`, `run_result`, `run_aborted` | `post_setup_worktree` | `PreTaskExec`, `PostTaskExec`, `Manual` | 없음 | 없음 |

### 표를 읽을 때 알아둘 것

- 막을 수 있는 시점: Cursor는 `preToolUse`, shell, MCP, 파일 읽기, prompt 제출, subagent 시작. Cline은 `PreToolUse`(그리고 `cancel`이 run을 멈추는 hook들). Windsurf는 모든 `pre_*`. Kiro는 `PreToolUse`, `PreTaskExec`, IDE의 `UserPromptSubmit`. Copilot CLI는 `preToolUse`, `permissionRequest`, `agentStop`/`subagentStop`(계속 돌리기). VS Code는 `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`.
- "Stop을 막아 한 turn 더 돌리기"는 Cursor(`followup_message`), Copilot(`decision: block`), VS Code(`decision: block`), Kiro CLI V3(`decision: block`)에 있다. Windsurf, Cline file hook에는 문서에 없다.
- 확인 못함 요약: Cursor CLI에서 도는 hook 범위, Kiro trigger별 STDIN 전체와 `SessionEnd`의 정확한 위치, Copilot `permissionRequest`의 input field, Cline file hook `cancel`의 event별 적용 범위, Cline `requestToolApproval` 쪽 event 이름.
