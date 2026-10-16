# Codex CLI와 Gemini CLI가 밖으로 드러내는 lifecycle event

조사일: 2026-10-13. 사실만 적는다. 추천이나 lophn 설계 제안은 없다.

## 근거 기준

- Codex source: `github.com/openai/codex` main, commit `f82e365` (`codex-rs/` 아래). 이하 `codex:` 로 줄여 쓴다.
- Gemini source: `github.com/google-gemini/gemini-cli` main, commit `51617c1`. 이하 `gemini:` 로 줄여 쓴다.
- 공식 문서: Codex hook 문서는 `https://developers.openai.com/codex/hooks` 가 `https://learn.chatgpt.com/docs/hooks` 로 redirect된다. 읽은 것은 후자다. Codex `noninteractive` 문서는 404여서 못 읽었다 (exec 쪽은 source로만 확인). Gemini 문서는 clone한 `docs/`를 읽었다.
- 표의 "막거나 바꿀 수 있는가"는 hook 출력으로 흐름을 바꿀 수 있는지를 뜻한다. app-server, exec json, stream-json 같은 통로는 읽기 전용이면 "관찰만"이라고 쓴다.

---

# 1. OpenAI Codex CLI

통로는 다섯 가지다.

1. hook (command 또는 mcp_tool을 부르는 설정)
2. `codex app-server` (JSON-RPC notification, server request)
3. `codex exec --json` (JSONL)
4. `notify` 설정과 TUI notification
5. OpenTelemetry (`[otel]` 설정)

## 1.1 hook

### 설정

- 파일: `~/.codex/hooks.json`, `~/.codex/config.toml`의 `[hooks]`, 프로젝트의 `<repo>/.codex/hooks.json`과 `config.toml`, plugin의 `hooks/hooks.json`, managed(`requirements.toml`의 `[hooks]`). 모든 source의 hook이 다 돈다(위 layer가 아래를 덮지 않는다). 근거: `learn.chatgpt.com/docs/hooks`, `codex:codex-rs/hooks/src/engine/discovery.rs` (`load_hooks_json`, `discover_handlers`).
- 모양: `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type":"command","command":"...","timeout":30,"async":false,"statusMessage":"..."}]}]}}`. 근거: `codex:codex-rs/config/src/hook_config.rs` (`HookHandlerConfig`).
- handler type: `command`, `mcp_tool`(server, tool, input). `prompt`와 `agent`는 파싱만 하고 건너뛴다. 근거: 같은 파일, 위 docs.
- 기본 timeout 600초. SessionEnd와 Interrupt는 기본 1초, 최대 3초. `async: true`면 background로 돌고 흐름을 못 바꾼다 (SessionEnd는 async여도 sync로 돈다). 근거: `codex:codex-rs/hooks/src/engine/discovery.rs` (`normalize_command_hook`).
- project와 plugin 등 managed가 아닌 hook은 `/hooks`에서 review하고 trust해야 돈다. `[features] hooks = false`로 전체를 끈다. 근거: `learn.chatgpt.com/docs/hooks`.
- 입력은 stdin에 JSON 한 개. 공통 field: `session_id`, `transcript_path`(null 가능), `cwd`, `hook_event_name`, `model`. 대부분 `permission_mode`(`default|acceptEdits|plan|dontAsk|bypassPermissions`)도 있다. 근거: `codex:codex-rs/hooks/schema/generated/*.command.input.schema.json`.
- exit code: 0 성공, 2는 지원하는 event에서 막기(stderr가 이유). 근거: `learn.chatgpt.com/docs/hooks`.
- 공통 output field: `continue`, `stopReason`, `systemMessage`, `suppressOutput`(파싱만 하고 구현 안 됨, docs). 근거: `.../*.command.output.schema.json`.

### hook event 12종

event 이름 목록 근거: `codex:codex-rs/hooks/src/lib.rs` (`HOOK_EVENT_NAMES`), `codex:codex-rs/protocol/src/protocol.rs:1688` (`HookEventName`).

| event 이름 | 통로 | 언제 나는가 | 주요 field (공통 외) | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `SessionStart` | hook | session이 시작하거나 이어질 때. matcher는 `source`(`startup`/`resume`/`clear`/`compact`. schema에는 `fork`도 있음) | `source` | developer context 추가(`hookSpecificOutput.additionalContext`). `continue:false`로 turn 끝냄 | schema `session-start.*`, docs |
| `SessionEnd` | hook | 대화를 archive/delete하거나 Codex가 닫힐 때, 30분 idle일 때(main thread만, docs) | `reason`(지금은 항상 `other`) | 못 막음. 알림 성격. 항상 sync | `codex:hooks/src/events/session_end.rs`, docs |
| `UserPromptSubmit` | hook | 사람 prompt를 model로 보내기 전. matcher 안 씀 | `turn_id`, `prompt` | context 추가, `decision:"block"`+`reason`으로 막기 | schema `user-prompt-submit.*` |
| `PreToolUse` | hook | tool 호출 전(Bash, `apply_patch`, MCP, 그 밖의 function tool). matcher는 tool 이름(`apply_patch`는 `Edit`/`Write` alias도) | `turn_id`, `tool_name`, `tool_use_id`, `tool_input` | deny(`decision:"block"` 또는 `permissionDecision:"deny"`), context 추가, `updatedInput`으로 input 바꾸기. `ask`/`continue:false`/`stopReason`은 지원 안 해서 hook이 실패 처리됨 | schema `pre-tool-use.*`, docs |
| `PermissionRequest` | hook | Codex가 사람에게 승인을 물으려 할 때. matcher는 tool 이름 | `turn_id`, `tool_name`, `tool_input` (`tool_input.description` 포함, docs), `agent_id`, `agent_type` | `decision.behavior: allow\|deny`, `message`, `interrupt`, `updatedInput`, `updatedPermissions`. deny가 하나라도 있으면 deny. 결정이 없으면 원래 prompt로 넘어감 | schema `permission-request.*`, docs |
| `PostToolUse` | hook | tool이 output을 낸 뒤(실패한 Bash 포함). matcher는 tool 이름 | `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response` | `decision:"block"`으로 결과를 feedback으로 바꿈(이미 한 부작용은 못 되돌림), `additionalContext`, MCP tool이면 `updatedMCPToolOutput`, `continue:false` | schema `post-tool-use.*`, docs |
| `PreCompact` | hook | compact 전. matcher는 `trigger`(`manual`/`auto`) | `turn_id`, `trigger` | `continue:false`로 compact 멈춤 | schema `pre-compact.*` |
| `PostCompact` | hook | compact 후. matcher는 `trigger` | `turn_id`, `trigger` | `continue:false`로 compact 뒤 멈춤 | schema `post-compact.*` |
| `SubagentStart` | hook | subagent가 시작할 때. matcher는 `agent_type` (내부/system subagent는 건너뜀) | `agent_id`, `agent_type`, `turn_id`, `permission_mode` | context 추가. `continue:false`로 subagent를 못 멈춤 | schema `subagent-start.*`, `codex:core/src/hook_runtime.rs:134` |
| `SubagentStop` | hook | subagent가 멈출 때. matcher는 `agent_type` | `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `last_assistant_message`, `turn_id` | `decision:"block"`+`reason`으로 계속 시킴. exit 0일 때 JSON 출력이 필요함 | schema `subagent-stop.*`, docs |
| `Stop` | hook | turn이 끝날 때. matcher 안 씀 | `turn_id`, `stop_hook_active`, `last_assistant_message` | `decision:"block"`+`reason`이면 reason을 새 continuation prompt로 삼아 turn을 이어감 | schema `stop.*`, docs |
| `Interrupt` | hook | 사람이 진행 중인 main thread turn을 중단할 때. matcher 안 씀 | `turn_id`, `permission_mode` | 못 막음. `systemMessage`만 가능 | `codex:hooks/src/events/interrupt.rs`, schema `interrupt.*`, docs |

hook 실행 자체의 상태는 app-server로도 나온다 (1.2의 `hook/started`, `hook/completed`). 상태 값: `running|completed|failed|blocked|stopped`, output entry 종류: `warning|stop|feedback|context|error`. 근거: `codex:codex-rs/app-server-protocol/src/protocol/v2/hook.rs`.

## 1.2 app-server (JSON-RPC)

근거: `codex:codex-rs/app-server-protocol/src/protocol/common.rs` — server request는 `server_request_definitions!`(1793행~), server notification은 `server_notification_definitions!`(1948행~), 필드 정의는 `.../protocol/v2/*.rs`. 모든 notification에는 envelope로 `emittedAtMs`가 붙는다(`ServerNotificationEnvelope`). "experimental" 표시는 source의 `#[experimental(...)]`를 따른다.

핵심 모델: thread(대화) > turn(prompt 하나에 대한 작업) > item(turn 안의 단위. 메시지, 명령, 파일 변경 등).

### item 종류 (`ThreadItem`, `item/started`와 `item/completed`에 실림)

`userMessage`, `hookPrompt`, `agentMessage`, `functionCallOutput`, `plan`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `webSearch`, `imageView`, `sleep`, `imageGeneration`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`. 근거: `.../v2/item.rs:236`.

status 값: commandExecution `inProgress|completed|failed|declined`, fileChange 같은 값, mcpToolCall `inProgress|completed|failed`. Turn status: `completed|interrupted|failed|inProgress` (`v2/turn.rs:33`). Thread status: `notLoaded|idle|systemError|active{activeFlags: waitingOnApproval|waitingOnUserInput}` (`v2/thread.rs:1683`).

### server notification (서버가 보냄)

| event 이름 (method) | 통로 | 언제 나는가 | 주요 field | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `thread/started` | app-server | thread가 새로 시작됨 | `thread` | 관찰만 | common.rs, v2/thread.rs |
| `thread/status/changed` | app-server | thread status가 바뀜(idle, active, 승인/입력 대기 flag, systemError) | `threadId`, `status` | 관찰만 | `codex:app-server/src/thread_status.rs` |
| `thread/closed` | app-server | thread가 닫힘 (정확한 조건은 확인 못함) | `threadId` | 관찰만 | common.rs |
| `thread/archived`, `thread/unarchived`, `thread/deleted` | app-server | 대화를 archive, 복원, 삭제 | `threadId` | 관찰만 | common.rs |
| `thread/reverted` | app-server | thread가 이전 지점으로 되돌려짐 | 확인 못함 (field 안 읽음) | 관찰만 | common.rs |
| `thread/name/updated` | app-server | thread 이름이 바뀜 | 확인 못함 | 관찰만 | common.rs |
| `thread/tokenUsage/updated` | app-server | token 사용량이 갱신됨 | `threadId`, `turnId`, `tokenUsage` | 관찰만 | v2 |
| `thread/goal/updated`, `thread/goal/cleared` | app-server | thread goal이 바뀜/지워짐 | 확인 못함 | 관찰만 | common.rs |
| `thread/attachment/updated`, `thread/prediction/updated`(experimental), `thread/queue/changed`(experimental), `thread/readState/changed`(experimental), `thread/settings/updated`(experimental), `thread/project/updated`(experimental), `thread/environment/connected`/`disconnected`(experimental), `project/changed`(experimental) | app-server | thread 부속 상태(첨부, 예측, 대기 queue, 읽음, 설정, 프로젝트, environment)가 바뀜 | 확인 못함 | 관찰만 | common.rs |
| `thread/compacted` | app-server | context compact가 끝남. **deprecated**, 대신 `contextCompaction` item | `threadId`, `turnId` | 관찰만 | common.rs |
| `turn/started` | app-server | turn 시작 | `threadId`, `turn`(id, status, items, startedAt…) | 관찰만 | v2/thread_data.rs:386 |
| `turn/completed` | app-server | turn이 끝남(completed, interrupted, failed 모두) | `threadId`, `turn`(`status`, `error`, `completedAt`, `durationMs`) | 관찰만 | 같은 곳 |
| `turn/diff/updated` | app-server | turn의 누적 diff가 바뀜 | `threadId`, `turnId`, `diff` | 관찰만 | v2 |
| `turn/plan/updated` | app-server | 계획(todo)이 바뀜 | `threadId`, `turnId`, `explanation`, `plan[]` | 관찰만 | v2 |
| `turn/moderationMetadata`(experimental) | app-server | turn moderation 정보 | 확인 못함 | 관찰만 | common.rs |
| `item/started` | app-server | item 시작 | `item`, `threadId`, `turnId`, `startedAtMs` | 관찰만 | v2 |
| `item/completed` | app-server | item이 끝남 | `item`, `threadId`, `turnId`, `completedAtMs` | 관찰만 | v2 |
| `item/agentMessage/delta` | app-server | agent 메시지가 streaming됨 | `threadId`, `turnId`, `itemId`, `delta` | 관찰만 | v2 |
| `item/plan/delta`(experimental) | app-server | 제안 plan text가 streaming됨 | 확인 못함 | 관찰만 | common.rs |
| `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded` | app-server | reasoning이 streaming됨 | `threadId`, `turnId`, `itemId`, `delta`, `contentIndex` (textDelta) | 관찰만 | v2 |
| `item/commandExecution/outputDelta` | app-server | 명령 stdout/stderr가 streaming됨 | `threadId`, `turnId`, `itemId`, `delta` | 관찰만 | v2 |
| `item/commandExecution/terminalInteraction` | app-server | 실행 중인 명령 terminal과 상호작용이 있음 | 확인 못함 | 관찰만 | common.rs |
| `item/fileChange/outputDelta` | app-server | **deprecated** apply_patch output stream | 확인 못함 | 관찰만 | common.rs |
| `item/fileChange/patchUpdated` | app-server | 파일 변경 patch가 갱신됨 | 확인 못함 | 관찰만 | common.rs |
| `item/mcpToolCall/progress` | app-server | MCP tool 진행 상황 | `threadId`, `turnId`, `itemId`, `message` | 관찰만 | v2 |
| `item/autoApprovalReview/started`, `item/autoApprovalReview/completed` | app-server | 자동 승인 review(guardian)가 시작/끝남 | `reviewId`, `targetItemId`, `review`, `action`, (completed) `decisionSource` | 관찰만 | v2 |
| `autoApprovalReview/strictReviewRequired`(experimental) | app-server | 엄격 review가 필요함 | 확인 못함 | 관찰만 | common.rs |
| `serverRequest/resolved` | app-server | 보류 중이던 server request가 해결됨 | `threadId`, `requestId` | 관찰만 | v2 |
| `hook/started`, `hook/completed` | app-server | hook 한 번이 시작/끝남 | `threadId`, `turnId`(null 가능), `run`(`eventName`, `handlerType`, `executionMode`, `scope`, `source`, `status`, `entries`, `durationMs`…) | 관찰만 | v2/hook.rs:103 |
| `model/rerouted` | app-server | 요청한 model이 다른 model로 우회됨 | `threadId`, `turnId`, `fromModel`, `toModel`, `reason`(`highRiskCyberActivity`) | 관찰만 | v2/model.rs |
| `model/verification` | app-server | model 검증 요구(`trustedAccessForCyber`) | 확인 못함 | 관찰만 | v2/model.rs |
| `model/safetyBuffering/updated` | app-server | 안전 buffering 상태가 바뀜 | 확인 못함 | 관찰만 | common.rs |
| `modelProvider/authRecoveryStarted`, `modelProvider/authRecoveryCompleted` | app-server | provider 인증 복구가 시작/끝남 | 확인 못함 | 관찰만 | common.rs |
| `rawResponseItem/completed`, `rawResponse/completed` | app-server | 원본 response item / 최종 사용량. **internal-only** 주석이 붙음 | 확인 못함 | 관찰만 | common.rs |
| `error` | app-server | turn 중 오류 | `error`(`message`, `codexErrorInfo`, `additionalDetails`), `willRetry`, `threadId`, `turnId` | 관찰만 | v2 |
| `warning` | app-server | 경고 | `threadId`(null 가능), `message` | 관찰만 | v2 |
| `guardianWarning`, `deprecationNotice`, `configWarning` | app-server | guardian 경고, deprecated 기능 알림, 설정 경고 | 확인 못함 (exec는 `summary`, `details` 사용) | 관찰만 | common.rs |
| `skills/changed` | app-server | skill 목록이 바뀜 | 확인 못함 | 관찰만 | common.rs |
| `mcpServer/startupStatus/updated`, `mcpServer/oauthLogin/completed`, `mcpServer/event/stream/notification`(experimental) | app-server | MCP server 시작 상태, OAuth 로그인 끝, MCP event stream | 확인 못함 | 관찰만 | common.rs |
| `command/exec/outputDelta`, `process/outputDelta`(experimental), `process/exited`(experimental) | app-server | `command/exec`, `process/spawn`로 띄운 별도 process의 output과 종료 | 확인 못함 (base64 chunk) | 관찰만 | common.rs |
| `account/updated`, `account/login/completed`, `account/rateLimits/updated`, `account/gatewayOAuth/changed` | app-server | 계정, 로그인, 사용 한도 변화 | 확인 못함 | 관찰만 | common.rs |
| `app/list/updated`, `remoteControl/status/changed`, `externalAgentConfig/import/progress`, `externalAgentConfig/import/completed`, `fs/changed`, `fuzzyFileSearch/sessionUpdated`, `fuzzyFileSearch/sessionCompleted`, `windows/worldWritableWarning`, `windowsSandbox/setupCompleted` | app-server | 제품 주변 기능(app 목록, 원격 제어, 설정 가져오기, 파일 watch, 파일 검색, Windows sandbox) | 확인 못함 | 관찰만 | common.rs |
| `thread/realtime/*` 10종(started, itemAdded, item/started, item/transcript/delta, item/completed, transcript/delta, transcript/done, outputAudio/delta, sdp, error, closed) (모두 experimental) | app-server | realtime(음성) 대화 | 확인 못함 | 관찰만 | common.rs |

위 표에서 "확인 못함"은 field를 읽지 않았다는 뜻이다 (method 이름과 존재는 source에서 확인함).

### server request (서버가 client에게 응답을 요구함)

근거: `codex:codex-rs/app-server-protocol/src/protocol/common.rs:1793~1850`.

| event 이름 (method) | 통로 | 언제 나는가 | 주요 field | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `item/commandExecution/requestApproval` | app-server (server request) | 명령 실행 승인이 필요할 때 | `threadId`, `turnId`, `itemId`, `startedAtMs`, `reason`, `command`, `cwd`, `commandActions`, `additionalPermissions`, `proposedExecpolicyAmendment`, `proposedNetworkPolicyAmendments`, `availableDecisions`, `networkApprovalContext` | client 응답이 결정. 선택지: `accept`, `acceptForSession`, `acceptWithExecpolicyAmendment`, `applyNetworkPolicyAmendment`, `decline`(turn 계속), `cancel`(turn도 중단) | v2/item.rs:66, v2 |
| `item/fileChange/requestApproval` | app-server (server request) | 파일 변경 승인이 필요할 때 | `threadId`, `turnId`, `itemId`, `startedAtMs`, `reason`, `grantRoot` | client 응답이 결정 | v2 |
| `item/permissions/requestApproval` | app-server (server request) | 추가 권한 승인이 필요할 때 | `threadId`, `turnId`, `itemId`, `cwd`, `reason`, `permissions` | client 응답이 결정 | v2 |
| `item/tool/requestUserInput`(experimental) | app-server (server request) | tool이 사람에게 질문할 때 | `threadId`, `turnId`, `itemId`, `questions[]`, `isBlocking`, `autoResolutionMs` | 응답으로 답을 줌 | v2 |
| `mcpServer/elicitation/request` | app-server (server request) | MCP server가 사람에게 입력/승인을 요청할 때 | `threadId`, `turnId`(null 가능), `serverName`, `request` | 응답이 결정 | v2 |
| `item/tool/call` | app-server (server request) | client가 대신 실행해야 하는 dynamic tool 호출 | `threadId`, `turnId`, `callId`, `namespace`, `tool`, `arguments` | client가 실행 결과를 응답 | v2 |
| `account/chatgptAuthTokens/refresh` | app-server (server request) | ChatGPT 인증 token 갱신이 필요할 때 | 확인 못함 | client가 응답 | common.rs |
| `attestation/generate` | app-server (server request) | upstream attestation 값이 필요할 때 | 확인 못함 | client가 응답 | common.rs |
| `currentTime/read`(experimental) | app-server (server request) | client가 가진 외부 시계 값이 필요할 때 | 확인 못함 | client가 응답 | common.rs |
| `applyPatchApproval`, `execCommandApproval` (**deprecated**, 옛 API용) | app-server (server request) | 옛 API(`SendUserTurn`, `SendUserMessage`)로 시작한 turn의 승인 | `v1.rs` 참고, 확인 못함 | client 응답이 결정 | common.rs |

### turn과 session을 다루는 client request (참고)

event는 아니지만 흐름 제어 통로라서 이름만 적는다: `thread/start`, `thread/resume`, `thread/fork`, `thread/archive`, `thread/compact/start`, `thread/revert`, `turn/start`, `turn/steer`, `turn/interrupt`, `review/start`, `hooks/list`. 근거: `codex:codex-rs/app-server-protocol/src/protocol/common.rs:499~1530`.

## 1.3 `codex exec --json`

- 켜는 법: `--json` (alias `--experimental-json`). 근거: `codex:codex-rs/exec/src/cli.rs:65`.
- 한 줄에 event 하나인 JSONL. 정의: `codex:codex-rs/exec/src/exec_events.rs` (`ThreadEvent`). app-server 안의 notification을 `collect_thread_events`가 줄여서 바꾼다 (`event_processor_with_jsonl_output.rs`).
- exec는 승인 요청(`requestApproval`, `requestUserInput`, `item/tool/call` 등)을 사람에게 묻지 않고 reject하며 MCP elicitation은 자동 cancel한다. 근거: `codex:codex-rs/exec/src/lib.rs:2072~2200` (`handle_server_request`).

| event 이름 | 통로 | 언제 나는가 | 주요 field | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `thread.started` | exec json | 첫 event. thread 시작 | `thread_id` | 관찰만 | exec_events.rs |
| `turn.started` | exec json | prompt를 model에 보내 turn이 시작됨 | (없음) | 관찰만 | 같음 |
| `turn.completed` | exec json | turn이 끝남 | `usage`(`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`) | 관찰만 | 같음 |
| `turn.failed` | exec json | turn이 오류로 실패 | `error.message` | 관찰만 | 같음 |
| `item.started` | exec json | item이 추가됨(보통 진행 중 상태) | `item`(`id`, `type`, 종류별 field) | 관찰만 | 같음 |
| `item.updated` | exec json | item이 갱신됨 (type 정의는 있음. 이 mapper가 어디서 내는지는 todo_list 갱신 외에는 확인 못함) | `item` | 관찰만 | 같음 |
| `item.completed` | exec json | item이 성공/실패로 끝남 | `item` | 관찰만 | 같음 |
| `error` | exec json | stream이 직접 내는 오류(경고, deprecation 알림도 `error` 타입 item으로 `item.completed`에 실림) | `message` | 관찰만 | 같음, jsonl_output.rs |

exec json의 item `type`: `agent_message`(`text`), `reasoning`(`text`), `command_execution`(`command`, `aggregated_output`, `exit_code`, `status`), `file_change`(`changes[]`, `status`; completed만 나옴), `mcp_tool_call`(`server`, `tool`, `arguments`, `result`, `error`, `status`), `collab_tool_call`(`tool`: spawn_agent, send_input, wait, close_agent; `sender_thread_id`, `receiver_thread_ids`, `prompt`, `agents_states`, `status`), `web_search`(`query`, `action`), `todo_list`(`items[]`), `error`(`message`). 근거: exec_events.rs.

exec json에서 안 나오는 것: `hook/started`, `hook/completed`는 명시적으로 버린다. 그 밖의 notification(thread/status/changed 등)도 `_ => Running`으로 버린다. 근거: `event_processor_with_jsonl_output.rs:474, 594~`.

## 1.4 notify와 TUI notification

| event 이름 | 통로 | 언제 나는가 | 주요 field | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `agent-turn-complete` | `notify` 설정 (config.toml의 `notify = ["program", "arg"...]`) | turn이 끝나면 argv 마지막 인자로 JSON 한 개를 붙여 외부 program을 spawn함. stdin/stdout/stderr는 null | `type`, `thread-id`, `turn-id`, `cwd`, `client`(없을 수 있음), `input-messages`, `last-assistant-message` | 못 막음. spawn 후 기다리지 않음. 내부적으로는 `after_agent` hook(`legacy_notify`)이고, 코드에 "legacy notify support를 없앨 때 지운다"는 TODO가 있음 | `codex:codex-rs/hooks/src/legacy_notify.rs`, `codex:codex-rs/config/src/config_toml.rs:247`, `codex:codex-rs/hooks/src/types.rs` (`HookEvent::AfterAgent`) |
| `agent-turn-complete`, `approval-requested`, `plan-mode-prompt`, `async-question` | TUI desktop notification (`tui.notifications`, `tui.notification_method`=`auto|osc9|bel`, `tui.notification_condition`=`unfocused|always`) | TUI가 terminal escape(OSC 9, BEL)로 알림을 냄. 외부 program을 부르는 통로는 아님. `notifications`는 `true/false` 또는 허용할 type 이름 list | 알림 문구만(명령, 파일, server 이름 등) | 못 막음 | `codex:codex-rs/tui/src/chatwidget/notifications.rs:27~81`, `codex:codex-rs/config/src/types.rs:710~754, 798~810` |

`approval-requested` 하나로 묶이는 내부 종류: `ExecApprovalRequested`, `EditApprovalRequested`, `ElicitationRequested`. 같은 파일.

## 1.5 OpenTelemetry

- `[otel]` 설정으로 OTLP(http/grpc) exporter를 켠다. 근거: `codex:codex-rs/config/src/types.rs` (`OtelExporterKind`), `codex:codex-rs/otel/`. 공식 문서는 못 읽음.
- source에서 확인한 event/metric 이름 일부: `codex.conversation_starts`, `codex.user_prompt`, `codex.api_request`, `codex.sse_event`, `codex.websocket_connect`, `codex.websocket_request`, `codex.tool_decision`, `codex.tool_result`, `codex.approval.requested`, `codex.sandbox_outcome`, `codex.turn_ttft`, `codex.turn_cost`, `codex.compaction`, `codex.hooks.run`, `codex.mcp.call`, `codex.auth_recovery`, `codex.startup_phase`, `codex.guardian_assessment`, `codex.goal.*`. 근거: `codex:codex-rs/otel/src/events/session_telemetry.rs`, `.../tool_result.rs:57`, `codex:codex-rs/core/src`. 전체 목록과 field는 확인 못함.

---

# 2. Google Gemini CLI

통로는 세 가지다.

1. hook (settings.json의 `hooks`, command 실행)
2. `--output-format stream-json` (JSONL)
3. OpenTelemetry. 이 밖에 ACP(JSON-RPC, `--experimental-acp`)와 library용 AgentEvent가 있다.

## 2.1 hook

### 설정

- `settings.json`의 `hooks`(event별 배열), `hooksConfig`(`enabled`, `disabled` 이름 목록, `notifications`=hook 실행 표시). 근거: `gemini:docs/hooks/reference.md`, `gemini:packages/cli/src/config/settingsSchema.ts:2548~`.
- 위치와 합치기: project `.gemini/settings.json`, user `~/.gemini/settings.json`, system `/etc/gemini-cli/settings.json`. event 배열은 CONCAT. 근거: `gemini:docs/hooks/index.md`. 이 밖에 extension의 `hooks/hooks.json` (`gemini:docs/extensions/reference.md:242`), runtime hook(코드로 등록, `HookType.Runtime`) (`gemini:packages/core/src/hooks/types.ts:65`). 신뢰하지 않는 folder의 project hook은 꺼진다 (`hookRegistry.ts:184`).
- handler type은 사실상 `command`만 (docs). source에는 `runtime`도 있다.
- 입력: stdin JSON. 공통 field: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`. 출력: stdout JSON 한 개(다른 text 금지). exit 0이면 JSON 해석, 2는 block(stderr가 이유), 그 밖은 경고. 기본 timeout 60000 ms. 근거: `gemini:docs/hooks/reference.md`.
- matcher: tool event는 정규식, lifecycle event는 정확한 문자열, `"*"`/빈 문자열은 전부. `sequential`로 한 group을 순서대로 돌릴지(기본 병렬) 정한다. 근거: `gemini:docs/hooks/index.md:84~92`, reference.md.
- 공통 output: `systemMessage`, `suppressOutput`, `continue`(false면 agent loop 전체 중단), `stopReason`, `decision`(`allow|deny`, alias `block`), `reason`. 근거: reference.md.
- 실행 기록은 telemetry `gemini_cli.hook_call`(`hook_name`, `hook_type`, `duration_ms`, `success`)로 남는다. 근거: `gemini:docs/cli/telemetry.md:877`.

### hook event 11종

event 이름 목록 근거: `gemini:packages/core/src/hooks/types.ts:43` (`HookEventName`), `gemini:docs/hooks/index.md:38`.

| event 이름 | 통로 | 언제 나는가 | 주요 field (공통 외) | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `SessionStart` | hook | 시작, resume, `/clear` 때. matcher는 source | `source`(`startup`/`resume`/`clear`) | `additionalContext` 주입(interactive는 첫 turn 기록으로, 비interactive는 prompt 앞에 붙임), `systemMessage`. `continue`와 `decision`은 무시됨 | reference.md, `gemini:packages/cli/src/gemini.tsx:940`, `clearCommand.ts:62` |
| `SessionEnd` | hook | CLI 종료 때(`exit`), `/clear` 때 | `reason`(`exit`/`clear`/`logout`/`prompt_input_exit`/`other`. 코드에서 부르는 곳은 `exit`, `clear`만 확인) | 못 막음. CLI가 끝나길 기다리지 않음(best effort). `systemMessage`만 | reference.md, `gemini.tsx:776`, `AppContainer.tsx:536`, `clearCommand.ts:31` |
| `BeforeAgent` | hook | 사람이 prompt를 내고 planning 전에. 같은 prompt id에서는 한 번만 | `prompt` | `additionalContext`를 이번 turn prompt에 덧붙임. `decision:"deny"`는 turn을 막고 메시지도 history에서 버림. `continue:false`는 turn을 막되 메시지는 history에 남김. exit 2도 deny와 같음 | reference.md, `gemini:packages/core/src/core/client.ts:180~220` |
| `AfterAgent` | hook | turn의 최종 응답이 나온 뒤, 가장 바깥 호출에서 한 번(tool 호출이 남아 있으면 안 남) | `prompt`, `prompt_response`, `stop_hook_active` | `decision:"deny"`+`reason`이면 응답을 거부하고 reason을 새 prompt로 삼아 retry. `continue:false`는 retry 없이 멈춤. `hookSpecificOutput.clearContext`로 model 기억을 지움. exit 2는 retry | reference.md, `client.ts:224~262` |
| `BeforeModel` | hook | LLM 요청을 보내기 전 | `llm_request`(`model`, `messages`, `config`, `toolConfig`) | `hookSpecificOutput.llm_request`로 요청 일부 덮어쓰기, `llm_response`를 주면 LLM 호출을 건너뛰고 가짜 응답 사용, `decision:"deny"`로 turn 중단 | reference.md, `gemini:packages/core/src/core/geminiChat.ts:1079` |
| `BeforeToolSelection` | hook | LLM이 tool을 고르기 전 | `llm_request` | `toolConfig.mode`(`AUTO`/`ANY`/`NONE`), `allowedFunctionNames`(여러 hook은 합집합, `NONE`이 이김). `decision`, `continue`, `systemMessage`는 지원 안 함 | reference.md, `geminiChat.ts:1140` |
| `AfterModel` | hook | LLM 응답 chunk마다(streaming이면 chunk마다) | `llm_request`, `llm_response` | `llm_response`로 해당 chunk를 교체, `decision:"deny"`로 chunk 버리고 turn 중단, `continue:false` | reference.md, `geminiChat.ts:1591` |
| `BeforeTool` | hook | tool 실행 전. matcher는 tool 이름 정규식(MCP는 `mcp_<server>_<tool>`) | `tool_name`, `tool_input`, `mcp_context`, `original_request_name` | `decision:"deny"`+`reason`(agent에게 tool 오류로 전달, turn 계속), `hookSpecificOutput.tool_input`으로 인자 병합/덮어쓰기, `continue:false`는 loop 전체 중단. exit 2는 tool 막기 | reference.md, `gemini:packages/core/src/core/coreToolHookTriggers.ts:89`, `scheduler/hook-utils.ts:43` |
| `AfterTool` | hook | tool 실행 후. matcher는 tool 이름 | `tool_name`, `tool_input`, `tool_response`(`llmContent`, `returnDisplay`, `error`), `mcp_context`, `original_request_name` | `decision:"deny"`+`reason`이 결과를 대체, `additionalContext`를 결과에 덧붙임, `tailToolCallRequest{name,args}`로 tool을 이어서 호출(그 결과가 원래 결과를 대체), `continue:false`. exit 2는 결과 숨김 | reference.md, `coreToolHookTriggers.ts:182` |
| `PreCompress` | hook | context를 요약해 줄이기 전. `force`면 `manual`, 아니면 `auto` | `trigger`(`manual`/`auto`) | 못 막음, 비동기로 fire. `systemMessage`만 | reference.md, `gemini:packages/core/src/context/chatCompressionService.ts:492` |
| `Notification` | hook | 시스템 알림. 지금 코드에서 나는 것은 tool 승인 요청(`ToolPermission`) 하나뿐 | `notification_type`(`ToolPermission`), `message`, `details`(tool 이름, 파일 경로 등) | 못 막고 승인도 대신 못함. `systemMessage`만 | reference.md, `gemini:packages/core/src/hooks/hookSystem.ts:428`, `scheduler/confirmation.ts:204` |

없는 것: subagent 시작/끝 hook, 오류 hook, turn 시작을 따로 알리는 hook, idle hook. `docs/hooks/`와 `HookEventName`에 없다. subagent 안에서 `BeforeTool`/`AfterTool`이 도는지는 확인 못함.

## 2.2 `--output-format stream-json` (`-o stream-json`)

- 비interactive(headless) 실행에서만 쓴다. 근거: `gemini:docs/cli/cli-reference.md:70`, `gemini:packages/core/src/output/stream-json-formatter.ts`, `gemini:packages/cli/src/nonInteractiveCli.ts`.
- 정의: `gemini:packages/core/src/output/types.ts` (`JsonStreamEventType`). 모든 event에 `type`, `timestamp`(ISO)가 있다.
- 출력 format은 `text|json|stream-json` 세 가지. `json`은 끝에 한 번 `{session_id, response, stats, error, warnings}`를 낸다.

| event 이름 | 통로 | 언제 나는가 | 주요 field | 막거나 바꿀 수 있는가 | 근거 |
|---|---|---|---|---|---|
| `init` | stream-json | session 시작 때 첫 event | `session_id`, `model` | 관찰만 | types.ts, nonInteractiveCli.ts:254 |
| `message` | stream-json | 사람 입력 echo와 assistant 응답 | `role`(`user`/`assistant`), `content`, `delta`(streaming chunk면 true) | 관찰만 | types.ts, nonInteractiveCli.ts:303, 345 |
| `tool_use` | stream-json | tool 호출 요청이 나옴 | `tool_name`, `tool_id`, `parameters` | 관찰만 | types.ts, nonInteractiveCli.ts:361 |
| `tool_result` | stream-json | tool 결과가 나옴 | `tool_id`, `status`(`success`/`error`), `output`, `error{type,message}` | 관찰만 | types.ts, nonInteractiveCli.ts:495 |
| `error` | stream-json | 경고 또는 오류 | `severity`(`warning`/`error`), `message` | 관찰만 | types.ts, nonInteractiveCli.ts:374 |
| `result` | stream-json | 마지막 event. 실행 끝 | `status`(`success`/`error`), `error`, `stats`(`total_tokens`, `input_tokens`, `output_tokens`, `cached`, `input`, `duration_ms`, `tool_calls`, `models{}`) | 관찰만 | types.ts, nonInteractiveCli.ts:404 |

권한 요청, compact, subagent, turn 경계에 해당하는 event는 stream-json에 없다.

## 2.3 그 밖의 통로

### OpenTelemetry

`gemini_cli.*` log event와 metric. 근거: `gemini:docs/cli/telemetry.md`. 이름만 적는다 (field는 문서 참고).

- session과 입력: `gemini_cli.config`, `gemini_cli.user_prompt`, `gemini_cli.startup_stats`
- tool: `gemini_cli.tool_call`, `gemini_cli.tool_output_truncated`, `gemini_cli.tool_output_masking`, `gemini_cli.file_operation`, `gemini_cli.edit_strategy`, `gemini_cli.edit_correction`
- model 호출: `gemini_cli.api_request`, `gemini_cli.api_response`, `gemini_cli.api_error`, `gemini_cli.malformed_json_response`, `gemini_cli.model_routing`, `gemini_cli.flash_fallback`, `gen_ai.client.inference.operation.details`
- chat: `gemini_cli.chat_compression`, `gemini_cli.chat.invalid_chunk`, `gemini_cli.chat.content_retry`, `gemini_cli.chat.content_retry_failure`, `gemini_cli.conversation_finished`
- agent(subagent 포함으로 보이나 확인 못함): `gemini_cli.agent.start`(`agent_id`, `agent_name`), `gemini_cli.agent.finish`(`duration_ms`, `turn_count`, `terminate_reason`), `gemini_cli.agent.recovery_attempt`
- hook: `gemini_cli.hook_call`
- 그 밖: `approval_mode_switch`, `approval_mode_duration`, `plan_execution`, `slash_command`, `rewind`, `conseca.verdict`, extension install/uninstall/enable/disable, `ide_connection`.
- metric은 `gemini_cli.session.count`, `tool.call.count`, `api.request.count`, `token.usage`, `agent.run.count`, `agent.duration`, `agent.turns` 등.

### ACP (Agent Client Protocol, `--experimental-acp`)

IDE 같은 client가 JSON-RPC(ndjson, stdio)로 붙는 실험 기능. 근거: `gemini:docs/cli/cli-reference.md:59`, `gemini:packages/cli/src/acp/README.md`, `acpSession.ts`.

- agent -> client `sessionUpdate` 종류(source grep): `agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`, `tool_call`, `tool_call_update`, `available_commands_update`, `usage_update`.
- 권한: `connection.requestPermission(...)` (agent -> client, `acpSession.ts:764, 1114`). prompt 결과의 `stopReason`은 테스트에서 `end_turn`만 확인함. 나머지 값은 확인 못함.

### 내부 AgentEvent (library/SDK)

`gemini:packages/core/src/agent/types.ts`의 `AgentEvents`: `initialize`, `session_update`, `message`, `agent_start`, `agent_end`, `tool_request`, `tool_update`, `tool_response`, `elicitation_request`, `elicitation_response`, `usage`, `error`(`fatal` flag), `custom`. 모든 event에 `id`, `threadId`(subagent thread면 값 있음, main이면 없음), `streamId`, `timestamp`. `agent_end.reason`: `completed|failed|aborted|max_turns|max_budget|max_time|refusal|elicitation`. `packages/sdk`가 이를 노출하는 것으로 보이나, 외부 process가 받는 wire format인지는 확인 못함(stream-json이나 ACP와 별개의 in-process API로 보임).

---

# 3. lifecycle 단계별 정리

"없음"은 조사한 통로에 해당 event가 없다는 뜻이다. app-server, exec, stream-json 같은 관찰 통로는 `(관찰)`로 표시한다.

| 단계 | Codex | Gemini |
|---|---|---|
| session 시작 | hook `SessionStart`(source: startup/resume/clear/compact/fork). app-server `thread/started`. exec json `thread.started`. OTel `codex.conversation_starts` | hook `SessionStart`(source: startup/resume/clear). stream-json `init`. OTel `gemini_cli.config` |
| 사람 입력 (prompt) | hook `UserPromptSubmit`(막기, context 추가). app-server `item/started`·`item/completed`의 `userMessage` item. OTel `codex.user_prompt` | hook `BeforeAgent`(막기, context 추가). stream-json `message`(role user). OTel `gemini_cli.user_prompt` |
| turn 시작 | app-server `turn/started`. exec json `turn.started`. (hook은 없음. `UserPromptSubmit`이 가장 가까움) | 없음 (turn 시작을 따로 알리는 hook/stream event 없음. `BeforeAgent`가 가장 가까움). 내부 AgentEvent `agent_start` |
| turn 끝 | hook `Stop`(막으면 이어감), `Interrupt`(사람이 중단). app-server `turn/completed`(status completed/interrupted/failed). exec json `turn.completed`, `turn.failed`. `notify` `agent-turn-complete` | hook `AfterAgent`(deny하면 retry). stream-json `result`(실행 전체 끝). 내부 `agent_end` |
| model 호출 | hook 없음. app-server `item/agentMessage/delta`, `item/reasoning/*Delta`, `thread/tokenUsage/updated`, `model/rerouted`, `model/verification`. OTel `codex.api_request`, `codex.sse_event` | hook `BeforeModel`(요청 바꾸기, 가짜 응답), `BeforeToolSelection`(tool 후보 제한), `AfterModel`(chunk별 교체). stream-json `message`(delta). OTel `gemini_cli.api_request/response/error` |
| tool 호출 전 | hook `PreToolUse`(막기, input 바꾸기). app-server `item/started`(`commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`…). exec json `item.started` | hook `BeforeTool`(막기, 인자 바꾸기). stream-json `tool_use` |
| tool 호출 후 | hook `PostToolUse`(결과 교체, context 추가). app-server `item/completed`, `item/commandExecution/outputDelta`, `item/mcpToolCall/progress`. exec json `item.completed`. OTel `codex.tool_result` | hook `AfterTool`(결과 교체, 이어서 tool 호출). stream-json `tool_result`. OTel `gemini_cli.tool_call` |
| 권한 요청 | hook `PermissionRequest`(allow/deny로 대신 결정). app-server server request `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`. app-server `thread/status/changed`의 `waitingOnApproval`/`waitingOnUserInput`, `serverRequest/resolved`, `item/autoApprovalReview/*`. exec는 승인을 reject함 | hook `Notification`(`ToolPermission`, 관찰만). ACP `requestPermission`. 내부 `elicitation_request`. stream-json에는 없음 |
| compact | hook `PreCompact`(멈출 수 있음), `PostCompact`. app-server `contextCompaction` item, `thread/compacted`(deprecated). OTel `codex.compaction` | hook `PreCompress`(관찰만, 비동기). OTel `gemini_cli.chat_compression`. 이후 hook 없음 |
| subagent | hook `SubagentStart`, `SubagentStop`(계속 시킬 수 있음). app-server `collabAgentToolCall`·`subAgentActivity` item. exec json `collab_tool_call` item | hook 없음. OTel `gemini_cli.agent.start`, `agent.finish`. 내부 AgentEvent의 `threadId` |
| 알림, idle | `notify` `agent-turn-complete`(외부 program 호출). TUI 알림 `agent-turn-complete`, `approval-requested`, `plan-mode-prompt`, `async-question`. app-server `thread/status/changed`(idle/active). `SessionEnd`는 30분 idle일 때도 남(docs) | hook `Notification`(`ToolPermission`만). idle event는 없음 |
| 오류 | app-server `error`(`willRetry`), `warning`, `configWarning`, `deprecationNotice`, turn status `failed`와 `turn.error`. exec json `error`, `turn.failed`. hook 없음 | stream-json `error`(warning/error), `result.status=error`. 내부 `error`(`fatal`). OTel `gemini_cli.api_error`. hook 없음 |
| session 끝 | hook `SessionEnd`(reason 항상 `other`). app-server `thread/closed`, `thread/archived`, `thread/deleted`. exec json은 마지막 `turn.completed` 또는 `turn.failed`로 끝나고 별도 end event 없음 | hook `SessionEnd`(exit/clear). stream-json `result`. OTel `gemini_cli.conversation_finished` |

---

# 4. 확인 못한 것

- Codex `noninteractive` 공식 문서(404). exec json은 source만 읽었다.
- Codex app-server notification 중 "확인 못함"으로 표시한 것의 field. method 이름은 `common.rs`에서 확인했다.
- Codex OTel의 전체 event 목록과 field, 공식 문서.
- Codex 옛 `v1` approval 요청의 field.
- Gemini에서 subagent 안의 tool 호출이 `BeforeTool`/`AfterTool` hook을 타는지.
- Gemini `SessionEndReason`의 `logout`, `prompt_input_exit`, `other`를 실제로 부르는 곳.
- Gemini SDK(`packages/sdk`)의 event가 외부에 어떤 형태로 나가는지, `a2a-server` package의 event.
