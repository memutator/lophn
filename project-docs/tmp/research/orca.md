# orca 조사: coding agent를 띄우는 법과 상태를 아는 법

대상: https://github.com/stablyai/orca, commit `25f87544d0b7dc118d5258fdc4c670692fc371d5` (shallow clone).
근거는 README가 아니라 source다. 경로는 저장소 root 기준이다. 확인 못 한 것은 "확인 못함"이라고 적었다.
orca는 Electron 앱이고 main process가 "runtime"이다. desktop 창, mobile, CLI, remote server는 모두 이 runtime의 RPC client다.

## 0. 큰 그림

orca에는 agent를 띄우는 길이 두 개 있다. 같은 launch 요청이 두 길 중 하나로 풀린다.

| 길 | 이름 | 어떻게 | 상태를 아는 근거 |
|---|---|---|---|
| terminal | `terminal` mode | 사용자 shell이 있는 PTY에서 agent의 TUI를 그대로 띄운다 | agent가 hook·plugin·extension으로 orca에 보내는 event |
| structured | `structured` mode (native chat) | agent를 headless child process로 띄우고 provider 프로토콜(SDK, app-server, ACP, RPC)로 대화한다 | 프로토콜 event를 orca가 journal로 옮긴 것 |

- 어느 길을 쓸지는 호출자가 정하지 않는다. 사용자 설정(native chat 기본값)과 가능 여부로 host가 정한다. 안 되면 terminal로 내려가고 receipt에 이유를 적는다. `src/main/agent-launch/agent-launch-mode.ts:139-184`, 내려가는 이유 목록 `:90-100`.
- structured가 되는 agent는 이 다섯이다: Claude, Codex, Pi, 그리고 ACP로 grok·opencode·omp. `src/main/runtime/structured-agent-runtime-registrations.ts:275-` (Pi는 `:277`), ACP 목록 `src/main/acp/acp-launch-specs.ts:190-194`. 나머지 agent(gemini, cursor, droid 등 `src/shared/tui-agent-config.ts`)는 terminal만 된다.
- 호출자가 mode를 넘기는 필드는 없다. `src/shared/agent-launch-intent.ts:1-13`.

## 1. 띄우는 법

### 1.1 terminal mode (PTY)

- 사용자의 shell이 도는 PTY에 launch 명령 한 줄을 "쳐 넣는다". 명령은 `src/shared/tui-agent-launch-command.ts:25-103`가 만든다: agent 명령 + session option(model, effort) flag + 사용자가 설정한 agent 인자.
- 첫 prompt를 넘기는 방식은 agent마다 정해져 있다 (`promptInjectionMode`, `src/shared/tui-agent-config.ts`).
  - `argv`: `claude "<prompt>"`, `codex "<prompt>"`, pi 등 (`:28-35`, `:64-72`)
  - `flag-prompt`: opencode 계열은 `--prompt` 류 flag (`:92-`)
  - `stdin-after-start`: TUI를 먼저 띄우고 나중에 PTY에 bracketed paste (autohand, ante 등)
- 한 줄에 안 들어가면(길거나 여러 줄) PTY에 paste한다. paste 전에 TUI가 준비됐는지 PTY 출력을 읽어 확인한다 (`draftPasteReadySignal`, `submitPasteReadySignal` 등 `tui-agent-config.ts:64-120`). 이게 "PTY 출력 파싱"이 쓰이는 곳이다. 전달 결과는 `handed-to-terminal`로만 보고하고, 내용이 agent에 닿았는지는 모른다고 명시한다. `src/main/agent-launch/agent-launch-prompt-delivery.ts:1-18`, `:128-`.
- 작업 위치: 먼저 worktree를 만들고 거기 PTY를 연다. 시작 directory는 workspace root가 기본이고, root가 아닌 `cwd`를 요구하면 terminal로 내려간다 (structured는 cwd를 못 바꾼다). `agent-launch-intent.ts:81-88`, `agent-launch-mode.ts:166-169`.
- 환경 변수 (agent가 orca에 말을 걸 길): `ORCA_AGENT_HOOK_PORT`, `ORCA_AGENT_HOOK_TOKEN`, `ORCA_AGENT_HOOK_ENV`, `ORCA_AGENT_HOOK_VERSION`, `ORCA_AGENT_HOOK_TRANSPORT`, `ORCA_AGENT_HOOK_ENDPOINT` (`src/main/agent-hooks/server/server-runtime-env.ts:13-24`), `ORCA_PANE_KEY`(`tabId:leafId`), `ORCA_AGENT_LAUNCH_TOKEN` (`src/main/runtime/orca-runtime-create-terminal.ts:78`).
- model·effort: `sessionOptions`(`model`, `effort`)로 받아 CLI flag로 바꾼다 (`agent-launch-intent.ts:66-69`, `tui-agent-launch-command.ts:51-80`). orchestration에서는 `worker-start --model --effort`이고, 사용자가 모델을 말하지 않으면 생략해서 agent 기본값을 쓰게 한다 (`skill-guides/orchestration/references/coordinator-loop.md:27-45`).
- 권한: 기본값이 전부 "허락 모드"다. `DEFAULT_TUI_AGENT_ARGS = YOLO_TUI_AGENT_ARGS` (`src/shared/tui-agent-launch-defaults.ts:17`). claude `--dangerously-skip-permissions`, codex `--dangerously-bypass-approvals-and-sandbox`, gemini·cursor `--yolo` 등 (`src/shared/tui-agent-permissions.ts:6-37`).
- workspace trust 질문은 launch 전에 agent의 trust file에 미리 써서 피한다 (`preflightTrust`, `src/main/agent-workspace-trust.ts`, 세부는 안 읽음).

### 1.2 structured mode (headless)

공통: child process는 orca가 직접 spawn하고 provider supervisor 아래에 둔다. 앱이 죽으면 child도 멈추게 하려는 것이다 (`src/main/claude/claude-agent-sdk-process-spawn.ts:227-236`, POSIX만). 환경은 "봉인"한다: orca의 pane 변수·hook 변수를 지우고 `ORCA_AGENT_SESSION_ID`·spawn token을 넣는다 (`src/main/runtime/structured-session-child-env.ts:1-80`).

| agent | 띄우는 방법 | 근거 |
|---|---|---|
| Claude | **Claude Agent SDK `query()`** 를 쓰되 SDK가 번들한 binary가 아니라 사용자 설치 `claude`를 `pathToClaudeCodeExecutable`로 지정. spawn은 SDK에 맡기지 않고 orca가 `spawnClaudeCodeProcess`로 가로챈다(pid·tree 종료 증명 때문). 입력은 async iterable user message queue. 즉 `claude -p --input-format stream-json --output-format stream-json`을 SDK가 대신 만든 것이다. | `src/main/claude/claude-stream-json-connection.ts:141-165`, `claude-structured-launch-resolution.ts:52-67` |
| Codex | `codex [사용자 인자] app-server` 를 spawn하고 JSON-RPC로 `initialize`, `thread/start` 또는 `thread/resume`, `turn/start`. `CODEX_HOME`을 계정별로 지정. | `src/main/codex/codex-structured-launch-resolution.ts:81-111`, `codex-structured-thread-open.ts:99-131` |
| grok | `grok agent [--always-approve] stdio` (ACP) | `src/main/acp/acp-launch-specs.ts:92-` |
| opencode | `opencode acp` (ACP). env `OPENCODE_CLIENT=acp`, `OPENCODE_ENABLE_QUESTION_TOOL=false` | `acp-launch-specs.ts:134-142` |
| omp | `omp acp` (ACP) | `acp-launch-specs.ts:164-` |
| Pi | `pi --mode rpc` (JSONL RPC). full access만 지원 | `src/main/pi/rpc-launch.ts:53`, `:103-106` |

- OpenCode "server/SDK"로 띄우는 길은 없다. OpenCode는 ACP(`opencode acp`)이고, 2.x에서는 ACP가 내부에서 private `opencode serve --stdio`를 띄운다는 주석이 있다 (`acp-launch-specs.ts`의 `OPENCODE_ACP_RELEASE_LINES` 바로 위 주석).
- cwd: structured는 workspace 안에서만 돈다. `basis.launchDirectory()`로 정한 directory가 spawn cwd/thread cwd다 (`claude-structured-launch-resolution.ts:178`, `codex-structured-thread-open.ts:100-104`).
- 첫 prompt: launch와 따로 간다. session을 먼저 만들고, 그 뒤 `deliverStructuredPrompt`로 transcript(journal)에 넣고 보낸다. 결과는 `journaled` + message id. `agent-launch-prompt-delivery.ts:60-80`.
- model·effort·permissionMode: 저장된 option을 spawn 옵션으로 직접 넣는다. 그래야 initialize 응답을 기다리지 않고 첫 message를 쓸 수 있다. `src/main/claude/claude-structured-spawn-options.ts:84-142`. Codex는 thread/start에 `model`, `approvalPolicy`, `sandbox`.
- 사용자가 설정한 agent 인자는 일부만 허용한다. Claude는 orca가 소유한 flag(`print`, `output-format`, `resume`, `permission-mode`, `session-id`, `system-prompt` 등)를 버린다 (`claude-structured-launch-args.ts:4-33`).

## 2. 상태를 아는 근거

orca 쪽 상태 어휘는 `working | blocked | waiting | done` (`src/shared/agent-status-types.ts:51`). 그 아래 "main agent 자신의 상태"와 "turn 결과 verdict"를 따로 둔다 (`src/shared/main-agent-status.ts:8-22`, `src/shared/agent-turn-outcome.ts:12-30`). verdict는 `success | failure | cancellation | superseded` + 파생값 `interruption | unconfirmed`. **verdict가 없으면 "모름"이지 성공이 아니다**가 원칙이다 (`agent-turn-outcome.ts:1-11`).

### 2.1 terminal mode: hook이 1순위

hook 설치 방식 (Claude 예): orca가 사용자 `~/.claude/settings.json`에 event별 command hook을 쓴다 (`src/main/claude/hook-settings.ts:50`, event 목록 `src/main/claude/claude-managed-hook-events.ts:7-69`). hook script는 stdin JSON을 로컬 HTTP server(`ORCA_AGENT_HOOK_PORT`/`TOKEN`)로 POST한다 (`hook-script.ts:62-99`). 실패하면 spool file에 쌓는다. `ORCA_PANE_KEY`가 없으면(orca 밖에서 돈 claude) 보내지 않는다. script는 항상 `{}`를 stdout에 내 permission hook이 막지 않게 한다 (`hook-script.ts:65`).

event를 state로 바꾸는 규칙 (실제 source):

| agent | working | waiting(권한·질문) | done | 실패/중단 |
|---|---|---|---|---|
| Claude (hook) | `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` | `PermissionRequest`, `PreToolUse`+AskUserQuestion tool | `Stop`, `StopFailure`, manual `PostCompact`, `SessionStart`(idle boundary, `sessionBoundary:true`) | `StopFailure` -> outcome `failure`. 중단은 hook이 안 온다 -> orca가 사용자의 Esc 입력으로 `cancellation`을 추론 (`claude-events.ts:51-92`, `:125-136`) |
| Codex (hook) | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | `PermissionRequest`, `request_user_input`(PreToolUse) | `Stop`, `Interrupt` | `codex-events.ts:171-181` |
| OpenCode (plugin) | `SessionBusy`, `MessagePart` | `PermissionRequest`, `AskUserQuestion` | `SessionIdle`, `SessionStart` | root turn error `MessageAbortedError` -> cancellation, 나머지 -> failure (`opencode-family-events.ts:23-60`) |
| Pi (extension) | 확인 못함(세부) | 있음 | `is_idle` | `pi-family-events.ts:74-111` |

(경로는 `src/shared/agent-hook-listener/providers/` 아래.)

- subagent·teammate는 별도 roster로 추적하고, child가 일하는 동안 lead가 끝나도 pane을 `working`으로 붙잡는다 (`claude-lifecycle-events.ts`, `src/shared/agent-lead-status-fold.ts`).
- 시간 만료: 30분 동안 hook이 없으면 status가 stale (`src/shared/agent-status-freshness.ts:7`). 재시작 후 디스크에서 복원한 non-terminal 상태는 `restoredUnconfirmed`로 표시해 바로 stale 취급.

### 2.2 terminal mode: hook이 없을 때의 보조 근거 (tui-idle-evidence)

"agent가 지금 쉬는가"를 PTY에서 판단할 때 근거에 순위를 둔다 (`src/main/runtime/tui-idle-evidence.ts:25-55`):
0 hook, 0b 화면 tail에 보이는 "사용자 대기" prompt, 1 agent가 title에 낸 명시적 idle 표시, 1b 조용한 ready 화면, 2 OSC 9999 first-party status(`\x1b]9999;`, `src/shared/agent-status-osc.ts:5`), 3 이름만 있는 title. 코드 주석이 이유를 말한다: "생각 중인 TUI와 끝난 TUI는 둘 다 조용하다. working 표시가 없다는 것은 끝났다는 증거가 아니다."
- 사용자의 인터럽트 키 입력을 본 timer가 hook 누락을 메운다 (`src/main/agent-hooks/server/server-status-inference.ts:50-100`).
- process 종료: hook이 agent process 정체(pid, startTime)를 실어 보내고, 다른 process의 hook이 오면 `probeAgentProcessPresence`로 `live | unverifiable | exited`를 확인한다. `exited`일 때만 pane을 닫는다 (`src/shared/agent-process-presence.ts:11-17`, `src/main/agent-hooks/server/server-agent-presence.ts:32-76`).

### 2.3 structured mode: 프로토콜 event를 journal로

| agent | 시작/working | 권한·질문 대기 | 끝남 | 실패 |
|---|---|---|---|---|
| Claude | SDK message stream. CLI가 보내는 `system/session_state_changed` (`CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`, `claude-structured-launch-resolution.ts:32`) | SDK `canUseTool` callback이 불림 -> prompt 등록 (`claude-structured-inbound-control.ts:33-85`) | `result` frame, 그리고 `session_state_changed=idle`이 "turn이 끝났다"의 권위 있는 신호 (`claude-session-state-turn-over.ts`) | `result.is_error` + `terminal_reason`: `aborted_streaming/aborted_tools`는 cancellation, 그 외 failure (`claude-result-outcome.ts:13-34`) |
| Codex | notification `turn/started` | server request `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput` (`codex-prompt-registry.ts:14-16`) | `turn/completed` (정확히 하나) + `turn.status` | `turn.status=failed` + `turn.error.message` (`codex-structured-thread-facts.ts:34-45`). 0.148 이전은 마지막 `error`가 끝 (`codex-structured-turn-end-settlement.ts` 주석) |
| ACP agent | `session/prompt` turn | `session/request_permission` (`src/main/acp/acp-permission-requests.ts`) | `acp-prompt-turns.ts` (세부 확인 못함) | `acp-turn-failures.ts` (세부 확인 못함) |
| Pi | JSONL RPC | extension dialog (`src/main/pi/rpc-dialog-callbacks.ts`) | `rpc-turns.ts` (세부 확인 못함) | 확인 못함 |
| 공통 | process 종료 | | | child 종료는 "예상된 종료"와 "뜻밖의 종료"를 구분. 뜻밖이면 `onFault`/`onExit`로 알리고 session을 recovering으로 둔다 (`claude-stream-json-connection.ts:217-232`, `claude-structured-session-exit-lifecycle.ts`) |

journal에서 session 상태를 뽑는 규칙은 한 곳에 있다 (`src/shared/structured-agent-session-projection.ts:224-233`): pending 상태의 approval/question item이 있으면 `attention`, 일이 남았으면 `working`, 아니면 `idle`. 이게 `blocked | working | done`으로 옮겨진다 (`src/shared/structured-agent-session-agent-status.ts:19-23`). 즉 `blocked`는 structured session에서만 나온다.

## 3. event 모델

orca에는 event가 세 층 있다.

### 3.1 hook status (terminal mode)

`AgentStatusEntry`/`AgentStatusPayload` (`src/shared/agent-status-types.ts`). 한 pane 당 "현재 한 줄"을 갱신하는 모양이다. 로그가 아니라 상태 표다.
- 칸: `state`, `prompt`(사용자 마지막 prompt), `toolName`, `toolInput`(미리보기), `interactivePrompt`(AskUserQuestion JSON 전체), `lastAssistantMessage`, `interrupted`, `sessionBoundary`, `agentType`, `model`, `subagents[]`, `mainAgent{state,outcome,stopping,stateStartedAt}`, `providerSession{key,id,transcriptPath}`, `stateHistory`(최근 이력), `paneKey`, `worktreeId`, `orchestration{taskId,dispatchId,...}`, `updatedAt`, `stateStartedAt`.
- 저장: 마지막 상태만 `last-status.json`에 persist (`src/main/agent-hooks/server/server-runtime-env.ts:63`). terminal은 transcript를 orca가 저장하지 않는다 (`agent-launch-prompt-delivery.ts` 주석: "a terminal keeps no transcript").
- 흘러가는 길: hook server -> main IPC(`agentStatus:set`) -> 창. SSH/WSL remote는 relay가 JSON-RPC `agent.hook` notification으로 보낸다 (`src/shared/agent-hook-relay.ts`). 신뢰 경계에서 payload를 다시 normalize한다. mobile·remote runtime으로 가는 정확한 길은 확인 못함 (fleet snapshot은 `src/main/runtime/orchestration-fleet-agent-status-snapshot.ts`).

### 3.2 journal (structured mode) - 가장 눈여겨볼 모델

session 하나 = append-only journal 하나. SQLite 한 파일 `agent-session-journal.db` (`src/main/native-chat/agent-session-journal/journal-host-database.ts:11-18`). 타입은 `src/shared/agent-session-journal-types.ts`.

- item 종류 (`AgentJournalItemBody`): `message`(role, blocks), `tool-call`(name, input, state `running|completed|failed`, output 앞부분만), `diff`, `approval`, `question`, `status`, `turn`.
- `approval`/`question`은 `resolution {state: pending|resolved|cancelled, selectedOptionId, resolvedBy, resolvedAt}`를 가진다. 두 client가 같은 prompt에 답해도 compare-and-set으로 하나만 이긴다 (`:160-176`, `:227`).
- `turn` item = turn 생애 기록 `{turnId, state: running|completed|interrupted|unverifiable, outcome, startedAt, completedAt, durationMs, contextUsage}` (`:264`). `unverifiable`은 "child를 잃었는데 종료를 못 봤다"이다.
- 한 item은 `itemId`, `revision`(수정될 때마다 증가), `sequence`, `observedAt`, `turnScope`, 그리고 subagent 귀속(`agentId`, `parentAgentId`)을 가진다 (`AgentJournalRenderItem`, `:431`). 공개 stream은 delta가 아니라 "현재 상태"를 싣는다. 두 번 적용해도 같은 결과다 (`agent-session-wire.ts:163-168`).
- 보낸 message는 write-ahead `submission {clientMessageId, dispatchState: pending|accepted|rejected|unknown, fence, payloadFingerprint}` (`:468`). `unknown`은 "보냈는지 모름"이라는 상태로 따로 둔다. 재시도는 `clientOperationId`+fingerprint로 멱등이다 (`agent-session-wire.ts:306-313`).
- 위치는 `cursor {epoch, sequence}`. 못 이어 받으면 `reset` + 이유(`epoch_changed | cursor_ahead | cursor_compacted | journal_gap | schema_unreadable`, `:542`) -> client가 snapshot부터 다시 읽는다.
- 쓰기 권한은 session 하나에 writer 하나: `lease {runtimeFence, ownerProcess, reservedSpawnToken, leaseDeadlineAt, deathEvidence}` (`src/shared/agent-session-record.ts:111-144`). 죽음의 증거 없이 소유자를 바꾸지 않는다.
- 크기 상한: 큰 출력은 head만 저장하고 byteLength+sha256만 남긴다. 나머지는 버린다 (`AgentJournalBoundedPayload`, `:87-95`).

### 3.3 client에게 가는 stream (RPC)

RPC 이름은 `agentSession.*` (`create, attach, send, cancel, history, subscribe, subscribeStatus, subscribeTurnCompletions, respondToApproval, respondToQuestion, hold, release, close, restartResumable, ...`; 목록은 `src/main/runtime/rpc/methods/structured-agent-session*.ts`).
- `subscribe`: `snapshot | batch | reset | end` frame (`agent-session-wire.ts:179-228`). batch = `{cursor, items, removedItemIds, submissions}`.
- `subscribeStatus`: 모든 session의 요약 (`AgentSessionStatusSummary`, `:231-292`): `status(working|attention|idle|null)`, `latestPrompt`, `toolName`, `lastAssistantMessage`, `turnOutcome`, `stopping`, `children`, `providerSession`. 늦게 붙은 client를 위해 snapshot으로 시작한다.
- `subscribeTurnCompletions`: **edge** 전용. turn이 끝날 때 `{sessionId, turnId, outcome, completedAt, awaitingUser?}`, `includePrompts`면 새 approval/question이 생길 때 `{sessionId, promptId, raisedAt}`. snapshot도 replay도 없다. 자리를 비웠으면 놓친 것이고 그게 의도다 (`src/shared/agent-session-turn-completion-wire.ts:1-80`, `src/main/runtime/rpc/methods/structured-agent-session-turn-completion-stream.ts:1-10`). 코드 주석: status는 "상태", completion은 "edge"로 나눠서, 상태를 다시 방송하면 완료가 반복된 것처럼 보이는 문제를 막는다.
- 전송: desktop 창은 IPC, CLI는 runtime metadata를 읽어 RPC(`src/cli/runtime/client.ts:167`), mobile·remote는 WebSocket(wss) + 기기 token + E2EE channel (`src/main/runtime/rpc/ws-transport.ts:1`, `e2ee-channel.ts`). 한 연결에 여러 stream을 얹는다.
- 알림: `agent-task-complete`, `terminal-bell` 두 source (`src/shared/notification-settings-types.ts:29`). 알림 id는 `agent:<worktree>:<paneKey>:<stateStartedAt>` (`src/shared/agent-notification-id.ts`)라 같은 완료에 중복 알림이 안 간다. mobile fan-out은 desktop 조건 검사보다 먼저 한다 (`src/main/notifications/notification-delivery-service.ts` 머리 주석).

## 4. 권한 요청

| 상황 | 동작 |
|---|---|
| 기본 | **사람이 없어도 막히지 않게 미리 허락 모드로 띄운다.** terminal은 YOLO flag가 기본값(1.1). Claude structured는 설정이 bypass면 `--dangerously-skip-permissions`를 extraArgs로 넣는다. SDK의 typed bypass 옵션은 옛 binary가 거부하는 새 flag를 내기 때문이다 (`claude-structured-launch-resolution.ts:69-79`, 설정에서 mode를 읽는 곳 `claude-structured-permission-mode.ts:24`). Codex structured는 `approvalPolicy:'never'` + `sandbox:'danger-full-access'` (`codex-structured-permission-policy.ts:9`). Pi는 full access만 (`rpc-launch.ts:53`). grok은 `--always-approve`, opencode·omp는 "full access면 요청마다 yes로 답"한다 (`acp-launch-specs.ts:92-,134-,164-`). |
| Manual(사람 승인) / terminal | Claude는 `PermissionRequest` hook이 `waiting`으로 바뀐다. hook은 결정을 내지 않고(`{}`) TUI가 그대로 묻는다. 사람이 TUI에서 답한다. orca는 상태 표시와 알림만 한다. Codex가 자동 reviewer(`auto_review`)를 쓰면 사람이 막힌 게 아니므로 `waiting`을 `working`으로 되돌린다 (`codex-events.ts:113-140`). |
| Manual / structured | approval이 journal item(`pending`)이 되고 status가 `attention`(=`blocked`)이 된다. client가 `agentSession.respondToApproval`/`respondToQuestion`으로 답하면 compare-and-set 뒤 SDK의 `canUseTool` promise 또는 Codex의 server request를 푼다. turn이 취소되면 abort signal로 prompt를 `cancelled`로 닫고 응답을 쓰지 않는다. 디코딩 못 하는 요청은 deny (`claude-structured-inbound-control.ts:15-85`). |
| 질문 tool | structured OpenCode는 질문 tool을 끈다(ACP가 답할 수 없어 영원히 기다리므로, `acp-launch-specs.ts:141` 주석). Claude는 `onUserDialog`를 항상 cancelled로 답한다 (`claude-structured-inbound-control.ts:83`). |
| 감독받는 worker (orchestration) | worker preamble이 "AskUserQuestion 대신 `orca orchestration ask`를 쓰라. 로컬 prompt는 coordinator가 볼 수 없다"고 못 박는다 (`src/main/runtime/orchestration/preamble.ts:125-135`). `ask`는 질문을 Run에 durable하게 기록하고 coordinator가 `reply`할 때까지 block한다. timeout이나 끊김이 나도 질문은 남고 message id로 이어서 기다린다. |

## 5. 끝남과 실패

### 5.1 끝났다는 것을 아는 근거

- terminal: 1순위는 `Stop`/`SessionIdle` 같은 hook·plugin event. 보조로 인터럽트 추론, tui-idle 순위(2.2). process가 죽었는지는 위의 presence probe.
- structured: Claude는 `result` + `session_state_changed=idle`, Codex는 `turn/completed`, 모두 journal `turn` item의 `completed|interrupted|unverifiable`로 닫힌다. host가 journal commit 시점에 `completion` edge를 낸다. **host가 끝만 보고 provider 판정을 못 들은 turn은 outcome이 없고, 이 경우 completion event 자체를 내지 않는다** ("absent means UNKNOWN, not success", `agent-session-turn-completion-wire.ts:1-30`).
- orchestration worker: 위 신호는 "agent가 쉰다"일 뿐 "일이 끝났다"가 아니다. 일의 끝은 worker가 CLI로 보낸 `worker_done --outcome succeeded|failed`다. 아래 5.3.

### 5.2 process가 죽거나 앱이 다시 시작할 때

- terminal PTY: PTY는 별도 daemon이 들고 있어 앱 재시작을 견딘다 (`src/main/daemon/`, hook script 주석 "PTYs surviving an Orca restart" `hook-script.ts:83`). 복원된 비종료 상태는 `restoredUnconfirmed`. PTY가 앱 꺼진 사이에 죽었으면 hydrate한 roster가 영원히 pane을 `working`으로 잡는 문제가 있어서, 살아 있는 agent가 없는 pane을 따로 청소하는 경로가 있다 (`src/main/agent-hooks/server/server-reaping.ts:13-80`). 이때 `waiting/blocked` 행을 `done`으로 바꾸지 않고 지운다: 일어나지 않은 완료를 만들지 않으려는 것이다.
- terminal resume: hook이 준 provider session id를 `providerSession {key: session_id|conversation_id, id, transcriptPath}`로 잡아 두었다가 `--resume <id>` argv를 만든다 (`src/shared/agent-session-resume.ts:6-70`, `agent-resume-argv.ts`). 종료 시 `sleeping agent` record로 저장 (`origin: worktree-sleep | quit | live`, `src/shared/workspace-session-sleeping-agents.ts:104`).
- structured: orca session id를 **orca가 만들고** provider id는 그 아래 `providerHandleChain`에 쌓는다. provider id는 `/clear`로 바뀌기 때문이다. Claude의 conversation id는 orca session id에서 결정적으로 만든다 (`sha256("orca-claude:<id>")` -> uuid v4 모양, `src/main/claude/claude-structured-session-id.ts:4-16`). Codex는 `thread/resume`에 id와 rollout path를 준다. resume 못 하면(저장 안 된 thread) 새 thread로 대체 (`codex-structured-thread-open.ts:122-130`).
- 앱이 재시작하면 journal을 다시 열어 crash reconciliation을 한다: 끝을 못 본 turn은 `unverifiable`/`interrupted`, 응답 못 받은 submission은 `unknown`, 이때 쓴 row에는 `recovered` 표시를 단다 (`src/main/native-chat/agent-session-journal/journal-restart-reconciliation.ts`, `agent-session-journal-types.ts`). 자동 이어하기는 기본이 아니다. 사용자가 "재개"를 고르거나 "자동 재개"를 켠 경우에만 고정 문구를 보낸다: "Orca가 재시작해 이전 reply가 잘렸다. 다시 하기 전에 마지막 동작이 끝났는지 확인하고, 끝났으면 반복하지 마라" (`src/shared/agent-session-restart-continuation.ts:1-25`).
- child가 죽으면 lease를 바로 넘기지 않는다. 루트 종료 증거와 하위 process tree 종료 증거를 따로 요구하고(`proveClaudeChildExit`, tree reaper, `claude-stream-json-connection.ts:88-98`), 증거가 없으면 `unverifiable`로 둔다.

### 5.3 orchestration: coordinator가 worker 진행을 아는 법 (lophn과 모양이 같다)

개념 (`skill-guides/orchestration.md` "Authority and safety floor"): **Run**(durable namespace + coordinator inbox) -> **Task**(일) -> **Dispatch**(Task를 한 번 시도한 것, 권위의 단위). 상태 어휘 `DispatchStatus = pending|dispatched|completed|failed|circuit_broken`, `WorkerDispatchState = starting|ready|start_unknown|failed|succeeded|stopping|stop_unknown|stopped|abandoned` (`src/main/runtime/orchestration/types.ts:23`, `:142-151`).

1. coordinator가 `orca orchestration worker-start --spec ... --worktree current --agent codex`를 부른다. worktree/terminal 준비, prompt 주입, 자원 소유를 한 번에 한다 (`src/main/runtime/rpc/methods/orchestration/worker/workers.ts`). coordinator도 일반 agent다.
2. worker는 첫 prompt에 **preamble**을 받는다 (`preamble.ts:70-163`). 내용: 자기 worker handle, Task ID, Dispatch ID, 그리고 복사해 쓸 CLI 명령 다섯 개.
   - `send --type worker_done --outcome succeeded|failed --body "3문장 요약" --task-id --dispatch-id` (정확히 한 번)
   - `send --type heartbeat --phase investigating|implementing|reviewing|waiting` (5분마다, `HEARTBEAT_INTERVAL_MIN = 5`, `preamble.ts:45`)
   - `ask --question --options --timeout-ms` (block, 답을 stdout으로)
   - `send --type escalation --subject "Blocked: ..."`
   - `check --terminal <handle> --json` (coordinator의 후속 지시 읽기. worker가 알아서 읽어야 한다. "아무것도 worker를 끊지 않는다")
3. 메시지 종류는 `status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat` (`types.ts:3-13`).
4. coordinator는 `check --wait --types worker_done,escalation,question --timeout-ms 900000`으로 long poll한다. 반환은 Run inbox의 가장 오래된 FIFO 묶음(최대 50개)이고, `--ack <delivery_id>`를 해야 다음 묶음이 온다. ack 전에는 같은 묶음을 다시 준다 (`skill-guides/orchestration/references/messaging-and-gates.md`).
5. coordinator가 idle일 때 메일이 오면 orca가 PTY에 짧은 "pointer" 한 줄을 타이핑해서 깨운다 (`mailbox-pointer-delivery.ts:37-54`: agent가 idle이고 live로 관찰됐을 때만). structured coordinator는 chat 자체 send로 같은 pointer를 보낸다 (`structured-mailbox-pointer-delivery.ts:1-14`). 문서가 명시한다: "send 성공은 durable enqueue의 증명일 뿐, 읽었다는 증명이 아니다."
6. 완료 판정: 올바른 `worker_done`(task id + dispatch id 일치, 활성 dispatch)이 오면 Task와 Dispatch를 자동으로 settle한다. 늦은 보고가 재시도를 완료시키지 못하도록 dispatch id를 꼭 요구한다 (거절 코드 `unknown_task | unknown_dispatch | task_dispatch_mismatch | inactive_dispatch | stale_dispatch`, `types.ts:27-38`). settle 뒤 coordinator는 worker terminal을 reuse / retain / release 중 하나로 정해야 한다.
7. 멈춘 worker: 10분 동안 heartbeat가 없으면 **경고만** 한다. 자동 실패 처리는 하지 않는다 ("느리지만 맞는 worker를 죽이는 비용이 hung worker가 자리를 잡는 비용보다 크다", `coordinator-task-dispatch.ts:15-25`). 문서 규칙: **process 종료의 양성 증거(`exited`, worker의 종료 관찰, `worker_done` 없이 끝난 transcript)가 있어야만** stop/abandon/retry한다. `unverifiable`은 "없음"이고 stop·retry·release 권한을 주지 않는다 (`skill-guides/orchestration.md` "Safe failure"). liveness는 층이 있다: PTY 생존 여부와 agent 상태는 다른 사실이다. 세 번 연속 빈 wait이면 `worker-list`로 열거하고 각 행의 `projection.attention`/`nextAction`을 따른다.
8. worker가 structured session이면 identity가 `ORCA_AGENT_SESSION_ID`(+`ORCA_USER_DATA_PATH`)이고, CLI가 이를 호출자로 보낸다. 그래서 `orca orchestration check`를 쳐도 형제 terminal을 호출자로 추측하지 않는다 (`structured-session-child-env.ts:1-43`, `agent-session-caller-env.ts:1-18`).
9. 보고 권한 규칙: dispatch가 `stopping`이면 worker 보고를 받지 않고, 그 process가 dispatch를 소유한 process가 아니면 `worker_identity_changed`로 거절한다 (`worker-report-admission.ts:29-48`).
10. 이전 주인이 사라진 worker가 보내는 `check`는 `consumer_fenced`를 돌려받고, 그러면 `worker_done`을 보내지 않고 멈춘다 (`skill-guides/orchestration/references/worker-contract.md:49-55`).

(위 5.3의 경로 중 파일명만 쓴 것은 `src/main/runtime/orchestration/` 아래다.)

## 6. lophn에 주는 시사점

lophn 조건: 사람은 coding agent와 말하지 않는다. App Engineer agent가 ticket을 맡기고, coding agent는 lophn CLI로 claim·작업·완료를 보고한다.

1. **orca의 orchestration(5.3)이 lophn 모양과 같다.** 진행의 권위는 agent의 TUI 상태가 아니라 "활성 Dispatch에 묶인 CLI 보고"로 두는 것을 가져온다. lophn에서는 ticket attempt 하나가 Dispatch다. 보고에는 항상 attempt id를 요구하고, 이전 attempt의 늦은 보고는 거절한다.
2. **최소 event 집합**: `started`(spawn 증명) / `claimed`(CLI claim) / `heartbeat{phase}` / `ask`(질문, block) / `escalation` / `done{outcome: succeeded|failed}` / `exited{verdict: live|unverifiable|exited}` / `permission_pending`(manual 모드를 켤 때만). 출처를 둘로 나눠 기록한다: agent가 CLI로 말한 것(권위 있음)과 host가 본 process 사실(spawn, 종료 증거). 둘을 섞은 파생 상태는 저장하지 않고 읽을 때 만든다.
3. **띄우는 법**: 사람이 터미널에 없으므로 PTY·TUI·hook 설치(사용자 전역 `settings.json`을 고치고 stdin을 POST하는 길)는 가져오지 않는다. orca에서 이득이 가장 큰 쪽은 structured다. Claude는 Agent SDK `query()` + `canUseTool`(또는 `claude -p --output-format stream-json`), Codex는 `codex app-server`. cwd는 ticket의 worktree로 spawn 인자에 고정하고, 첫 prompt는 spawn 뒤 한 번 보낸다. 환경에 lophn session id와 CLI 경로를 넣어 CLI가 호출자를 추측하지 않게 한다(`ORCA_AGENT_SESSION_ID` 방식).
4. **권한**: 사람이 없으면 질문이 곧 정지다. orca의 기본 답을 따라 처음부터 허락 모드(Claude `bypassPermissions`, Codex `approvalPolicy:'never'`)로 띄우고, 질문 tool은 끄거나 `ask` CLI로 돌린다(AskUserQuestion 금지 문구). 안전은 worktree 격리와 CLI의 권한 범위로 가져간다. 사람이 아니라 App Engineer가 답한다면 orca의 approval journal item(`pending -> resolved`, compare-and-set)을 그대로 쓸 수 있다.
5. **끝남과 실패**: orca가 반복해서 지킨 규칙 셋을 가져온다. (a) 종료 증거가 없으면 "모름"(`unverifiable`)이고 실패가 아니다, (b) 성공 outcome은 보고가 있어야만 있고 verdict가 없는 종료를 성공으로 읽지 않는다, (c) 막힘은 경고만 하고 자동으로 죽이지 않는다(heartbeat 미수신 기준 시간 = 간격의 2배). 앱 재시작 때는 자동 재개하지 말고 "잘렸다, 마지막 동작을 확인하고 이어서 하라"는 고정 message로 같은 attempt를 이어가게 하되, 이어가기 여부는 App Engineer가 정한다.
6. **저장은 작게**: orca의 journal 전체(item revision, cursor/epoch, lease, write-ahead submission)는 사람이 chat 화면을 보는 제품에 맞춘 것이라 lophn에는 과하다. lophn은 attempt 단위 event log(위 2번) + 마지막 상태 한 줄이면 된다. 가져올 만한 것은 둘이다: 멱등 키(`clientOperationId`+fingerprint)와 "상태(snapshot)와 edge(완료 알림)를 다른 채널로 나눈다"는 원칙.
