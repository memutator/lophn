# paseo 조사: coding agent를 띄우고 상태를 아는 법

대상: https://github.com/getpaseo/paseo, commit `9551b2cc` (2026-10-12, `--depth 1` clone). 근거는 source다. 경로는 저장소 root 기준이고 줄 번호가 붙은 곳은 직접 읽은 곳이다. 읽지 못했거나 저장소 밖(SDK, 제품 CLI 내부)이라 보이지 않는 것은 "확인 못함"이라고 썼다.

경로 약칭: `AG` = `packages/server/src/server/agent`, `PR` = `AG/providers`.

## 0. 먼저 큰 그림

- paseo의 agent는 PTY에서 TUI를 띄우는 방식이 아니다. 제품마다 "기계가 읽는 통로"를 연다. Claude는 Claude Agent SDK, Codex는 `codex app-server`(JSON-RPC), OpenCode는 `opencode serve`(HTTP + event stream), Pi/OMP는 `--mode rpc`(JSONL), 그 밖은 ACP(Agent Client Protocol) stdio다. (`AG/provider-registry.ts:36-48`, `189-224`)
- PTY는 별개 기능이다. 사용자가 paseo terminal 안에서 TUI를 직접 돌릴 때만 쓰고, 이때는 제품의 hook으로 활동 상태만 받는다(1.6, 2장).
- 모든 제품을 하나의 `AgentSession` 인터페이스와 하나의 `AgentStreamEvent` 집합으로 맞춘다. (`AG/agent-sdk-types.ts:405-461`, `664-714`)

## 1. 띄우는 법

### 1.1 제품별 요약

| 제품 | 띄우는 통로 | 근거 |
|---|---|---|
| Claude Code | `@anthropic-ai/claude-agent-sdk`의 `query()`. SDK가 `claude` process를 spawn하고, paseo는 `spawnClaudeCodeProcess`로 spawn만 가로채 stdio pipe 3개를 쓴다. 입력은 async iterable(`SDKUserMessage`)로 계속 밀어 넣는다. | `PR/claude/query.ts:2,64-108,113-118`, `PR/claude/agent.ts:3282-3299`, `2401-2406` |
| Codex | `codex app-server` child process, stdio JSONL 위의 JSON-RPC(`initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`) | `PR/codex-app-server-agent.ts:7226-7246`, `5289-5290`, `4414`, `5007`, `PR/codex/app-server-transport.ts:185-188` |
| OpenCode | `opencode serve --port N`을 daemon이 한 개 띄워 여러 session이 공유. HTTP SDK(`session.create`, `session.promptAsync`, `permission.reply`)와 server event stream 구독 | `PR/opencode/server-manager.ts:318-349`, `PR/opencode-agent.ts:1469,3688,4020,5034` |
| Pi, OMP | `<cmd> --mode rpc`(JSONL RPC) + `--model`, `--thinking`, `--session` | `PR/pi/runtime.ts:120-142` |
| Copilot, Cursor, Kimi, Kiro, Trae, 일반 ACP | ACP: child process stdio 위에 `ClientSideConnection` (`initialize`, `session/new`, `session/prompt`, `requestPermission`) | `PR/acp-agent.ts:1398-1430`, `2556` |

`codex exec --json`이나 `claude -p --output-format stream-json`을 직접 쓰는 곳은 찾지 못했다. Claude SDK는 내부에서 `claude`를 stream-json 모드로 띄우는 것으로 보이지만, SDK source가 저장소에 없어서 "확인 못함". `AG/agent-sdk-capabilities.md:3-9`는 옛 `@openai/codex-sdk` 기준 메모이고 실제 코드는 app-server를 쓴다.

### 1.2 작업 위치(cwd, worktree)

- `AgentSessionConfig.cwd`가 필수다(`AG/agent-sdk-types.ts:587-589`). Claude는 `options.cwd`(`PR/claude/agent.ts:3445`), Codex는 `thread/start`와 `turn/start`의 `cwd`(`PR/codex-app-server-agent.ts:5322, 4219`), OpenCode는 매 호출의 `directory`(`PR/opencode-agent.ts:3690`), Pi는 spawn cwd(`PR/pi/runtime.ts:96-98`)로 넘긴다. OpenCode server만 사용자 home이 아닌 중립 디렉터리에서 띄운다(`PR/opencode/server-manager.ts:323-327`).
- worktree는 daemon이 session을 만들기 전에 git worktree를 먼저 만들고 그 경로를 cwd로 쓴다. 제품은 worktree를 모른다. (`AG/create-agent/create.ts`의 `createPaseoWorktree`, `worktree` 입력: 47, 114-122)

### 1.3 첫 prompt

- 만들기 요청이 `initialPrompt`를 가지고, daemon이 session을 만든 뒤 `startTurn`으로 보낸다. argv로 넘기지 않는다. (`AG/create-agent/create.ts:64-70`, `AG/tools/paseo-tools.ts:1428-1470`)
- Claude: `SDKUserMessage`를 input stream에 push (`PR/claude/agent.ts:2406`). Codex: `turn/start`의 `input` (`PR/codex-app-server-agent.ts:4195-4414`). OpenCode: `session.promptAsync` (`PR/opencode-agent.ts:4020`).

### 1.4 환경 변수

- 모든 session에 `PASEO_AGENT_ID`, `PASEO_AGENT_CWD`를 넣는다. (`AG/agent-manager.ts:5355-5360`) 그 밖에 설정에서 온 env와 호출자 env를 `createProviderEnv`로 합쳐 child의 env로 준다. (`PR/claude/query.ts:72-81`, `PR/codex-app-server-agent.ts:3323-3331`)
- Claude는 `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`을 추가해 `session_state_changed` event를 받는다 (`PR/claude/agent.ts:3406-3412`).
- OpenCode는 `OPENCODE_CONFIG_CONTENT`에 paseo bridge plugin을 끼워 넣는다 (`PR/opencode/server-manager.ts:329-342`, `PR/opencode/bridge.ts`).

### 1.5 model, mode, system prompt

- model: Claude `options.model` (`PR/claude/agent.ts:3492-3494`), Codex `turn/start`의 `model`/`effort` (`PR/codex-app-server-agent.ts:4220-4228`), Pi `--model` (`PR/pi/runtime.ts:128`), OpenCode `promptAsync`의 `model`/`agent`/`variant` (`PR/opencode-agent.ts:3690-3700`).
- 가능한 model/mode 목록은 제품에서 받아와(`fetchCatalog`, `AG/agent-sdk-types.ts:772`) provider 목록으로 보여준다. `create_agent`는 `provider/model` 형태 문자열을 요구한다 (`AG/tools/paseo-tools.ts:1431-1433`).
- system prompt: 공통 `systemPrompt` + daemon이 덧붙이는 `daemonAppendSystemPrompt`를 제품의 칸에 매핑한다. Claude `systemPrompt.append`(`PR/claude/agent.ts:3458-3462`), Codex `developerInstructions`(`PR/codex-app-server-agent.ts:5316-5319`).
- Claude는 `settingSources: user, project, local`을 읽는다(`PR/claude/agent.ts:153-157, 3463`). 즉 사용자의 CLAUDE.md와 settings가 그대로 적용된다.

### 1.6 PTY 경로(사용자가 TUI를 직접 돌릴 때)

- paseo terminal은 shell을 PTY로 띄우고 `PASEO_TERMINAL_ID`, `PASEO_HOOK_CLI`, `PASEO_ACTIVITY_TOKEN`, `PASEO_TERMINAL_ACTIVITY_URL`을 env로 준다 (`packages/server/src/terminal/terminal.ts:530`, `terminal-manager.ts:339`, `packages/cli/src/commands/hooks.ts:4-8`).
- 그 안에서 사용자가 `claude`, `codex`, `opencode`를 돌리면 제품이 hook을 호출한다. hook은 사용자의 실제 설정 파일에 paseo가 써 넣는다: `~/.claude/settings.json`, `~/.codex/hooks.json`, OpenCode plugin 파일. 설정 `enableTerminalAgentHooks`가 켜졌을 때만 설치하고 끄면 지운다. (`packages/server/src/terminal/agent-hooks/terminal-agent-hook-setting.ts:15-41`, `claude/claude-settings.ts:157-177`, `agent-hook-installer.ts:139-142`)
- 이 경로는 상태(running, idle, needs-input)만 알려 주고, 대화 내용과 권한 응답은 paseo가 다루지 못한다.

## 2. 상태를 아는 근거

paseo 자신의 상태는 5개다: `initializing`, `idle`, `running`, `error`, `closed` (`packages/protocol/src/agent-lifecycle.ts:1-9`). UI용 묶음(bucket)은 여기에 "권한 대기"와 "attention"을 얹어 `needs_input`, `failed`, `running`, `attention`, `done`으로 계산한다 (`packages/protocol/src/agent-state-bucket.ts:22-36`).

제품 event를 `AgentStreamEvent`로 바꿔 상태를 정한다. 바뀐 event를 manager가 받아 lifecycle을 갱신한다 (`AG/agent-manager.ts:4408-4500`).

| 상태 | Claude (SDK) | Codex (app-server) | OpenCode (server) | Pi / ACP | 터미널(PTY) hook |
|---|---|---|---|---|---|
| 시작 | 보낼 때 paseo가 `turn_started`를 만든다(`PR/claude/agent.ts:2392`). 제품 쪽 시작은 `system/init` 메시지(`4036-4047`, `462-464`) | `turn/started` 알림 (`PR/codex-app-server-agent.ts:2676`, `6109-6128`) | `session.status: busy`(`retry`도 running 취급, `PR/opencode-agent.ts:187`) | Pi `agent_start` (`PR/pi/agent.ts:1008`) | Claude `UserPromptSubmit`, Codex `UserPromptSubmit`/`PreToolUse`, OpenCode `session.status.busy` -> running |
| working | stream 메시지(assistant, tool_use, partial) | `item/started`, `item/*/delta` | `message.part.updated`, `message.part.delta` | Pi `message_update`, `tool_execution_*` | running |
| 끝남(정상) | `result` 메시지(subtype success) -> `turn_completed` (`PR/claude/agent.ts:4693-4718`). 백그라운드 일까지 끝났는지는 `session_state_changed: idle`로 닫는다(`4025-4034`) | `turn/completed` status 정상 (`6130-6162`) | `session.idle` 또는 `session.status: idle` -> `turn_completed` (`PR/opencode-agent.ts:2337-2342`, `3166-3170`) | Pi `agent_end`/`agent_settled` (`PR/pi/agent.ts:2133`); ACP는 `session/prompt` 응답의 `stopReason` (`PR/acp-agent.ts:3256`) | Claude `Stop`, Codex `Stop`, OpenCode `session.status.idle` -> idle (`working`에서 idle이 되면 "finished" attention) |
| 실패 | `result` subtype이 success가 아님 -> `turn_failed`; stream 끊김 또는 process 종료 -> `failActiveTurns` (`3823-3833`, `3840-3853`, `3905-3990`) | `turn/completed` status failed; child 종료 -> `handleUnexpectedTermination` (`3703-3719`) | `session.error` (`PR/opencode-agent.ts:3128-3155`) | process_exit event (`PR/pi/agent.ts:1000-1004`) | Claude `StopFailure`, `SessionEnd` -> idle |
| 취소 | `interrupt()` -> `turn_canceled`; 오래된 result는 걸러낸다 (`3999-4015`) | `turn/completed` status interrupted (`6153`) | `session.error`의 `MessageAbortedError` (`3139-3146`) | - | - |
| 권한 대기 | SDK `canUseTool` callback (`PR/claude/agent.ts:4877-4970`) | 서버가 보낸 request `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` (`PR/codex-app-server-agent.ts:3945-3961`) | `permission.asked` event (`PR/opencode-agent.ts:3036-3075`) | ACP `requestPermission` (`PR/acp-agent.ts:2556`) | Claude `Notification`(`idle_prompt`만), Codex `PermissionRequest`, OpenCode `permission.asked` -> needs-input (`claude.ts:80-111`, `codex.ts:4-10`, `opencode.ts:4-10`) |
| 입력 대기(질문) | 권한과 같은 칸: `AskUserQuestion` tool을 `kind: "question"` 권한 요청으로 바꾼다 (`PR/claude/agent.ts:4877-4900`) | `item/tool/requestUserInput` (`3955`) | `question.asked` (`PR/opencode-agent.ts:2316`) | Pi `extension_ui_request` (`PR/pi/agent.ts:941,996`) | Claude `idle_prompt` -> needs-input |
| process 죽음 | `child.once("exit")` -> `handleRuntimeExit` (`PR/claude/agent.ts:3296,3840`) | `child.on("exit")` -> terminationHandler (`PR/codex/app-server-transport.ts:204-212`) | server process exit를 event source가 알림 (`PR/opencode/server-manager.ts:355-380`) | `jsonl-rpc-process`, ACP `spawn` error | 해당 없음(터미널 process는 따로 관리) |

정리:
- 상태의 1차 근거는 제품의 구조화된 event다(SDK 메시지, JSON-RPC 알림, server event). PTY 출력 파싱은 어디에도 없다. (PTY 경로는 hook뿐이다.)
- "turn이 끝났다"는 제품마다 신호가 다르다. Claude는 `result`가 오고, `session_state_changed: idle`이 와야 백그라운드 일까지 끝난 것으로 본다. 그래서 foreground turn과 autonomous turn(사용자 요청 없이 제품이 스스로 시작한 turn)을 따로 추적한다 (`PR/claude/agent.ts:4025-4095`). 이 부분이 복잡한 이유는 제품 event가 서로 어긋나게 도착하기 때문이다(늦게 온 idle, 중단 뒤의 result).
- starting은 제품 신호가 아니라 paseo의 `initializing`이다 (`AG/agent-manager.ts:3763` 근처, 등록 직후 idle로 전환).

## 3. event 모델

### 3.1 session event (`AgentStreamEvent`, `AG/agent-sdk-types.ts:405-461`)

| event | 칸 |
|---|---|
| `thread_started` | `sessionId`, `provider` (제품 session/thread ID를 알린다) |
| `turn_started` | `turnId?` |
| `turn_completed` | `usage?`, `turnId?` |
| `turn_failed` | `error`, `code?`, `diagnostic?`, `turnId?` |
| `turn_canceled` | `reason`, `turnId?` |
| `timeline` | `item`(아래 3.2), `turnId?`, `timestamp?` |
| `usage_updated` | `usage` |
| `permission_requested` | `request` (3.3) |
| `permission_resolved` | `requestId`, `resolution` |
| `mode_changed`, `model_changed`, `thinking_option_changed` | 현재 값과 목록 |
| `attention_required` | `reason`: finished, error, permission |
| `provider_subagent` | 제품 안의 하위 agent 관찰 |

### 3.2 timeline item (`AgentTimelineItem`, `AG/agent-sdk-types.ts:390-403`)

`user_message`, `assistant_message`, `reasoning`, `tool_call`, `todo`, `error`, `notification`, `compaction`, `plugin`.

- `tool_call`은 `callId`, `name`, `status`(running, completed, failed, canceled), `detail`, `error`를 가진다 (`338-371`). `detail`은 종류별 union이다: `shell`(command, cwd, output, exitCode), `read`, `edit`(unifiedDiff), `write`, `search`, `fetch`, `worktree_setup`, `sub_agent`, `plan`, `plain_text`, `unknown` (`239-336`). 제품마다 다른 tool 모양을 이 union으로 맞추는 mapper가 따로 있다(예: `PR/claude/tool-call-mapper.ts`, `PR/codex/tool-call-mapper.ts`).
- `usage`: `inputTokens`, `cachedInputTokens`, `outputTokens`, `totalCostUsd`, `contextWindowMaxTokens`, `contextWindowUsedTokens` (`216-223`).

### 3.3 manager 단계의 상태와 알림

- manager가 들고 있는 snapshot: `lifecycle`, `activeForegroundTurnId`, `pendingPermissions`, `lastUsage`, `lastError`, `attention`(`requiresAttention`, `attentionReason`, 시각), `persistence`(제품 session 핸들) (`AG/agent-manager.ts:355-480`).
- 상태 변화는 `agent_state` event, stream은 `agent_stream` event로 나간다. attention은 `running -> idle`이면 "finished", `error`로 들어가면 "error", 권한 요청이면 "permission" (`AG/agent-manager.ts:4975-5013`).
- 기다리는 쪽 API: `waitForAgentEvent`는 상태가 idle이나 error가 되거나 권한 요청이 나오면 돌려준다. 돌려주는 값은 `{status, permission, lastMessage}`이다 (`AG/agent-manager.ts:3385-3552`).

### 3.4 저장

- agent record(설정, 제품 session 핸들, lastStatus, attention, 제목)는 agent당 JSON 파일 하나로 저장한다: `<agentStoragePath>/<projectDir>/<id>.json` (`AG/agent-storage.ts:50-80`, `383`). `agent_state`가 올 때마다 쓴다(`closed` 제외) (`packages/server/src/server/persistence-hooks.ts:45-62`).
- timeline은 daemon 메모리에만 둔다 (`InMemoryAgentTimelineStore`, `AG/agent-manager.ts:744`). 영속 store 인터페이스(`durableTimelineStore`, `AG/agent-timeline-store-types.ts:50`)는 있지만 운영 bootstrap이 넘기지 않는다(`packages/server/src/server/bootstrap.ts:949-962`). 오히려 시작할 때 옛 `agent-timelines` 디렉터리를 지운다(`bootstrap.ts:587-594`). 다시 시작한 뒤에는 제품 자신의 기록에서 timeline을 다시 읽는다(5장).
- 각 timeline row는 `seq`와 `epoch`를 가져 client가 cursor로 이어 받을 수 있다 (`AG/agent-timeline-store-types.ts:4-21`, `packages/protocol/src/messages.ts:4116-4127`).

### 3.5 desktop, mobile로 흘리는 법

- daemon이 WebSocket 서버다. client(desktop, mobile, CLI)는 이 WebSocket으로 붙는다. 원격이면 relay를 거치되 end-to-end 암호화다 (`packages/server/src/server/relay-transport.ts:1-30`, `packages/relay/src/e2ee.ts`).
- outbound message: `agent_update`(snapshot 갱신/제거), `agent_stream`(`event`, `seq`, `epoch`), `agent_permission_request`, `agent_permission_resolved`, `agent_attention_required`(알림 title/body 포함), `fetch_agent_timeline_response` (`packages/protocol/src/messages.ts:4095, 4116, 5149, 5158, 4811, 4626`).
- inbound: `create_agent_request`, `send_agent_message_request`, `cancel_agent_request`, `agent_permission_response`, `wait_for_finish_request`, `fetch_agent_timeline_request` (`messages.ts:1709, 1364, 1844, 2164, 1378, 1871`).
- 전송 전에 짧은 간격(60ms)으로 text/tool_call delta를 묶는다 (`AG/agent-stream-coalescer.ts:6`). client가 보고 있는 agent의 timeline만 받도록 구독을 고를 수 있다 (`agent.timeline.set_subscription.request`, `packages/server/src/server/session.ts:2700`).
- 알림은 client가 화면을 보고 있는지(presence)를 계산해 앱 안 알림과 push 중에서 정한다 (`packages/server/src/server/agent-attention-policy.ts`).

## 4. 권한 요청

### 4.1 두 갈래

1. 사람에게 전달해 답을 받는다(기본). 제품이 묻는 즉시 paseo가 `permission_requested`를 만들고 제품의 대기를 그대로 붙잡아 둔다. Claude는 `canUseTool`이 반환할 Promise를 `pendingPermissions`에 넣어 두고 (`PR/claude/agent.ts:4950-4966`), Codex는 JSON-RPC request의 응답을 늦춘다 (`PR/codex-app-server-agent.ts:6960-7011`). 응답이 오면 `respondToPermission`이 그 Promise를 푼다(Claude `2727-2780`, Codex `4704`, OpenCode `permission.reply` `PR/opencode-agent.ts:5034`).
2. 미리 허락 모드로 띄운다. 제품의 "묻지 않음" mode로 session을 만든다. 이런 mode에 `isUnattended: true` 표시가 있다 (`packages/protocol/src/provider-manifest.ts:68-73` Claude `bypassPermissions`, `94-99` Codex `full-access`, Copilot `allow-all`, OMP `full`). 예약 실행(schedule)은 `unattended: true`로 만들어 이 mode를 고른다 (`packages/server/src/server/schedule/service.ts:990`, 고르는 규칙 `AG/create-agent-mode.ts:43-82`). 제품에 unattended mode가 없으면 mode를 정하지 않는다.

### 4.2 전달 형태

- 요청: `AgentPermissionRequest` = `id`, `name`, `kind`(tool, plan, question, mode, other), `title`, `description`, `input`, `detail`(위 `ToolCallDetail`), `suggestions`, `actions` (`AG/agent-sdk-types.ts:467-491`).
- 응답: `allow`(+ `updatedInput`, `updatedPermissions`) 또는 `deny`(+ `message`, `interrupt`) (`493-505`). Claude의 "앞으로 허락" 규칙은 `suggestions`와 `updatedPermissions`로 오간다.
- 사람이 아닌 쪽이 답할 길도 있다. 다른 agent가 쓰는 MCP tool `list_pending_permissions`와 `respond_to_permission` (`AG/tools/paseo-tools.ts:3077, 3111`), CLI `paseo permit ls|allow|deny` (`packages/cli/src/commands/permit/index.ts:9-28`).
- 미리 허락하는 작은 길: 설정 `toolPolicy.preapproved`로 특정 MCP tool을 허락 목록에 넣는다. Claude는 `allowedTools: mcp__<server>__<tool>`로 바꾼다 (`PR/claude/options.ts:93-103`). paseo가 agent에게 주는 자기 tool을 묻지 않게 하려는 장치다.
- ACP는 `autoAccept` feature가 켜져 있으면 허락 option을 골라 바로 답한다 (`PR/acp-agent.ts:2557-2572`).

### 4.3 관찰

- 권한 대기에는 시간 제한이 없다. turn이 취소되거나 실패하면 대기 중인 요청이 모두 deny로 풀린다 (`AG/agent-manager.ts` `resolvePendingPermissionsForAgent`, `onStreamTurnFailed`; Claude `PR/claude/agent.ts:2370-2390`의 `rejectAllPendingPermissions`). 시간 제한 같은 것은 찾지 못했다("확인 못함").
- 사람이 아무 때나 답할 수 있도록 request가 snapshot에 남는다 (`pendingPermissions`). client가 늦게 붙어도 보인다.

## 5. 끝남과 실패, process 죽음, daemon 재시작

### 5.1 끝났다는 것을 아는 법

- turn 단위: `turn_completed`/`turn_failed`/`turn_canceled` 중 하나가 정확히 하나 온다 (2장 표). 이후 lifecycle이 `idle`이나 `error`가 된다.
- agent 단위로 "일이 끝났다"는 별도 event가 없다. 사람/다른 agent는 `idle`로 돌아온 것을 끝남으로 읽고, 내용은 마지막 assistant message를 본다 (`waitForAgentEvent`의 `lastMessage`, `AG/agent-manager.ts:3399-3403`). 즉 "끝났는지"는 제품이 turn을 닫았는가이고 "일을 해냈는가"는 paseo가 판단하지 않는다.
- 다른 agent가 만든 agent는 `notifyOnFinish`로 끝남/오류/권한 요청을 알림으로 받는다 (`AG/tools/paseo-tools.ts:1495-1500`, `AG/create-agent/create.ts:98,201`).

### 5.2 process가 죽었을 때

- Claude: process exit -> `handleRuntimeExit`, 진행 중이던 turn은 `turn_failed`로 닫고, 백그라운드 shell/subagent도 실패 처리한다 (`PR/claude/agent.ts:3823-3860`). 다음 메시지를 보내면 새 process를 띄우고 `resume: claudeSessionId`로 대화를 이어 간다(`3278-3299`, `3438-3443`).
- Codex: child exit -> `handleUnexpectedTermination`이 진행 중 turn을 `turn_failed`로 닫고 대기 권한을 지운다 (`PR/codex-app-server-agent.ts:3703-3719`). `ensureThreadLoaded`가 `thread/loaded/list`로 확인하고 없으면 `thread/resume`한다 (`4067-4095`).
- OpenCode: server가 죽으면 다른 generation으로 다시 띄운다 (`PR/opencode/server-manager.ts` `acquire*`). session 상태는 `session.status` 조회로 맞춘다 (`PR/opencode-agent.ts:3836-3860`).
- 제품 쪽에서 resume할 대상이 없어졌으면 persistence를 지우고 새로 시작한다 (Claude `handleMissingResumedConversation`, `PR/claude/agent.ts:4165-4215`).

### 5.3 제품 session ID 연결

- 제품이 session ID를 알려 주면 (`thread_started`, Claude `system/init`의 `session_id`) manager가 `describePersistence()`로 `AgentPersistenceHandle { provider, sessionId, nativeHandle, metadata }`를 받아 record에 저장한다 (`AG/agent-sdk-types.ts:183-189`, `AG/agent-manager.ts:4420-4440`, `PR/claude/agent.ts:2782-2797`). paseo의 `agentId`와 제품의 session ID는 별개이고 이 record로 연결된다.

### 5.4 daemon을 다시 시작하면

- 시작할 때 record 파일만 읽고 agent는 살리지 않는다: "agents will initialize on demand" (`packages/server/src/server/bootstrap.ts:1382-1386`). 처음 접근할 때 `ensureAgentLoaded`가 record의 persistence 핸들로 `resumeAgentFromPersistence`를 부르고, 핸들이 없으면 저장된 설정으로 새로 만든다. 그다음 `hydrateTimelineFromProvider`로 제품의 기록을 읽어 timeline을 채운다 (`AG/agent-loading.ts:81-140`).
- 따라서 재시작 때 진행 중이던 turn은 이어지지 않는다. child process가 죽으며 turn은 이미 실패 처리되거나 그 상태가 record에 `lastStatus`로 남는다. "죽었던 turn을 자동으로 다시 시작"하는 코드는 찾지 못했다("확인 못함").
- shutdown: 각 provider client에 `shutdown()`을 부르고 agent storage를 flush한다 (`AG/agent-sdk-types.ts:806-811`, `bootstrap.ts:1834`).

## 6. lophn에 주는 시사점

lophn은 사람이 coding agent와 이야기하지 않고, App Engineer가 ticket을 맡기고, coding agent는 lophn CLI로 claim, 작업, 완료 보고를 한다. App Engineer는 진행을 알아야 한다.

1. **띄우는 법은 비대화 통로 하나만 고른다.** paseo도 PTY 파싱을 쓰지 않는다. 제품마다 구조화된 통로(Claude Agent SDK, Codex app-server, OpenCode serve)를 열고, 그 위에 `createSession`, `startTurn`, `interrupt`, `resume` 정도의 얇은 공통 인터페이스를 둔다(`AG/agent-sdk-types.ts:664-714`, `746-812`). 첫 prompt는 argv가 아니라 session을 만든 뒤 turn 시작 메시지로 보내고, cwd(worktree)와 `LOPHN_*` env는 spawn 때 넣는다(paseo의 `PASEO_AGENT_ID`, `PASEO_AGENT_CWD`와 같은 모양, `AG/agent-manager.ts:5355-5360`).
2. **최소 session event는 이 정도로 줄인다.** `thread_started`(제품 session ID 확보), `turn_started`, `turn_completed`, `turn_failed`, `turn_canceled`, `permission_requested`/`permission_resolved`. timeline(message, tool_call, usage)은 App Engineer가 진행을 알려면 필수가 아니고, 로그나 디버깅용으로 남기면 된다. paseo 수준의 tool_call detail union과 coalescer는 가져오지 않는다.
3. **"끝남"은 turn 종료가 아니라 lophn의 claim event로 정한다.** paseo는 turn이 닫히면 `idle`이라고 말할 뿐 일을 해냈는지는 모른다. lophn에서는 coding agent가 CLI로 보고한 완료 event가 끝남의 근거이고, turn 종료(`turn_completed`)는 "agent가 멈췄다"는 보조 신호다. 완료 보고 없이 turn이 끝나면 App Engineer가 보고 없는 종료로 다룬다(재개 또는 반납).
4. **권한은 미리 허락 모드로 띄우는 쪽이 lophn에 맞다.** 사람이 없으므로 paseo의 `isUnattended` mode(Claude `bypassPermissions`, Codex `full-access`)를 쓰되 격리된 worktree 안에서만 쓰고, 그래도 올라온 `permission_requested`는 event로 App Engineer에게 올려 둔다. paseo는 대기에 시간 제한이 없으므로, lophn은 permission 대기를 claim 기한과 묶어 만료로 정리한다.
5. **죽음과 재시작은 제품 session ID + resume으로 푼다.** `thread_started`에서 받은 제품 session ID를 claim 또는 ticket 실행 기록에 저장하고, 죽으면 같은 ID로 resume한다(Claude `resume`, Codex `thread/resume`). paseo처럼 daemon 재시작 때 agent를 미리 살리지 않고 필요할 때 살리는 방식(on demand)이 단순하다. process 종료는 `turn_failed`로 바꿔 한 가지 실패 경로로 합친다(`PR/claude/agent.ts:3823-3853`, `PR/codex-app-server-agent.ts:3703-3719`).
6. **가져오지 않을 것.** 터미널 hook 설치(사용자의 `~/.claude/settings.json`을 고치는 방식, 위 1.6)는 lophn의 비대화 모양에 필요 없고 사용자 설정을 건드리는 부작용이 커서 가져오지 않는다. 그리고 agent가 스스로 시작하는 autonomous turn 추적, 하위 agent(`provider_subagent`) 모델도 MVP에는 과하다.
