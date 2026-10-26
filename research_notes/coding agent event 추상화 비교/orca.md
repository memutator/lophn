# Orca (stablyai/orca): how it abstracts agent events and state

Source: https://github.com/stablyai/orca at commit `c0714b9ce0d25db5fa40e68d2f14d962a41243f8` (2026-10-26). Paths below are relative to that repo root. "V" means verified in source. "I" means inferred or docs only. Research run 2026-10-26.

## 1. What it is

- Repo: https://github.com/stablyai/orca (MIT, about 106k stars, TypeScript). I chose it because it is the Electron IDE that runs many coding agents in parallel git worktrees. The README says "Run Codex, ClaudeCode, OpenCode or Pi side-by-side, each in its own worktree".
- Commit: `c0714b9ce0d25db5fa40e68d2f14d962a41243f8` (2026-10-26).
- Stack (V): Electron with a React renderer (`src/renderer`), a main process (`src/main`), and `src/shared` (code common to main, renderer and CLI). It also has an `orca` CLI (`src/cli`), a headless server (`orca serve`/orcad), an SSH/WSL relay and a mobile app. Persistence is SQLite for the chat journal and JSON files for hook status.
- Supported agents (V):
  - The hook installers cover 23 targets (`src/shared/agent-hook-types.ts:3-27`, `src/main/agent-hooks/managed-agent-hook-registry.ts:44-68`): claude, openclaude, codex, qoder, qoder-cn, qwen-code, codebuddy, gemini, antigravity, amp, cursor, droid, command-code, grok, copilot, hermes, devin, kimi, muse, zcode, dsh, jcode, kiro.
  - The hook ingest accepts 28 sources, also including opencode, opencode2, mimo-code, pi, omp and prime-agent (`src/shared/agent-hook-relay.ts:15-46`). opencode, pi, omp, hermes and amp use a plugin or extension instead of a settings hook.
  - Any other CLI can be launched, but it gets only title and screen heuristics.
- There are two runtime modes with different signal pipelines (V):
  1. Terminal TUI mode, the default. The real CLI runs in a PTY and Orca watches it from outside. Sections 2 to 12 mostly describe this mode.
  2. Structured chat ("Chat UI"/native chat, experimental). Orca spawns the agent itself and talks a protocol to it. It keeps a SQLite journal. The docs (`docs/site/content/docs/agents/native-chat.mdx`) say it "communicates directly with the agent rather than displaying a terminal session".

## 2. Signal sources

### Your two prior claims

- "Infers state by reading terminal screen output": partly true, but not the main path.
  - The primary source for the roughly 23 hook-integrated agents is hooks.
  - For hookless agents, and as a fallback, it classifies the terminal window title (OSC 0/2: spinner glyphs and keywords). It does not read screen text for this.
  - A separate screen/tail text matcher with per-agent JSON rules exists. It is used only for "is the TUI idle or blocked" waits and send-gating, not for the sidebar row state (2.5).
- "Hooks POST to the app": true. The hook is a shell script that runs `curl` to POST raw JSON to `http://127.0.0.1:<port>/hook/<source>` with a per-launch token header (section 8).

The project's own README (`src/main/agent-hooks/README.md:1-30`) says: "Orca learns what each agent is doing through two channels. Both write into the hook server's status store." Those channels are managed hook/plugin integrations and OSC 7501. "Precedence: hooks win, and OSC 7501 fills in wherever they don't speak."

### 2.1 Hooks, plugins and extensions (primary, V)

- Claude: 12 hook events are installed into `~/.claude/settings.json` (`src/main/claude/claude-managed-hook-events.ts:9-88`):
  - SessionStart, UserPromptSubmit, Stop, StopFailure, SubagentStart, SubagentStop, TeammateIdle.
  - PreToolUse, PostToolUse, PostToolUseFailure and PermissionRequest, all with matcher `*`.
  - PostCompact.
  - Elicitation and ElicitationResult (MCP dialogs) are added when the CLI supports them.
  - SessionEnd is added only for Claude 2.1.261 and later.
  - The list is version-gated by `getClaudeManagedHookPlan` (`:103-121`).
  - Notification and PreCompact are deliberately not installed. The comment at `:57-58` says PreCompact can fire on an aborted compact and would leave the pane stuck "working".
- Codex: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, SubagentStart, SubagentStop, Stop, Interrupt. Interrupt needs Codex 0.150 or later (`src/main/codex/codex-hook-definition.ts:16-26`).
- Others: each agent has its own event table (section 4).
  - opencode, opencode2 and mimo use a JS plugin (`src/main/opencode/status-plugin-post-source.ts`).
  - pi, omp and prime-agent use an extension (`src/main/pi/agent-status-extension-source.ts`).
  - hermes and amp use plugins.
  - All of them POST with the same token header.
- Claude also gets a statusline script that POSTs to `CLAUDE_STATUSLINE_PATHNAME`. It carries rate-limit and usage data, not turn state (`src/main/agent-hooks/server/server-lifecycle.ts:119-127`).

### 2.2 OSC 7501 "Program Status Protocol" (fallback, V)

- The agent writes `ESC ] 7501 ; ... ST` into its own output (`src/shared/program-status/protocol.ts:1-30`).
  - States: idle, working, done, blocked, error.
  - Block kinds: permission, question, auth.
  - Optional fields: progress, app, title, msg, and child ids.
  - Orca answers the agent's `OSC 7501 ; ?` probe. Answering changes how the agent renders. For example Claude drops its title glyph.
- The README support matrix says Claude 2.1.295+, Grok, pi, omp and Codex send it. OpenCode, Cursor, Gemini and others do not.
- It is projected onto the same `AgentStatusPayload` (`src/shared/program-status/agent-status-projector.ts:93-140`).
- It is not a replacement for hooks. The README says it has no field for the prompt, tool input, assistant reply, model or provider session id.
- Yield rule (`src/main/agent-hooks/server/program-status/hook-precedence.ts:5-47`):
  - The hook row owns the pane.
  - OSC 7501 takes over only if hooks are off or absent, or if the hook lane has been silent for 2 minutes (`HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS`) while disagreeing.
  - A hook `done` is not overridden by an OSC `working`.
  - The next hook event takes the pane back.
- A "facet" (progress and a one-line message) rides along but never decides state (`src/shared/program-status/facet.ts`).
- Orca also has its own OSC 9999 channel carrying a JSON `AgentStatusPayload` (`src/shared/agent-status-osc.ts:7,129`). `src/shared/terminal-agent-status-processor.ts:44-93` merges 9999 and 7501 by byte offset. I found no documentation of who emits 9999 (I).

### 2.3 Terminal title classification (hookless fallback, V)

- Input is the OSC window title taken from PTY output.
- `detectAgentStatusFromTitle` (`src/shared/agent-title-status.ts:224-317`) returns `'working' | 'permission' | 'idle' | null` (`AgentStatus`, `src/shared/agent-title-core.ts:38`). Note this is a different vocabulary from the row state: `permission` versus `waiting`, `idle` versus `done`.
- Rules, in order:
  - Claude `✳ ` prefix means idle (`agent-title-glyphs.ts:1`). The ASCII forms are `* ` (idle) and `. ` (working).
  - Any braille spinner (U+2800-28FF) or quarter-circle (U+25D0-25D3) means working (`agent-title-glyphs.ts:7-35`). The quarter circle came with Claude 2.1.228 and caused issue #13889.
  - Gemini glyphs: ✋ is permission, ✦ and ⏲ are working, ◇ is idle.
  - Special cases for Pi/OMP markers, OpenCode, Qoder, DeepSeek and DSH.
  - Otherwise, only if the title contains a known agent name: `action required|permission|waiting` means permission (`agent-title-core.ts:64-65`), `ready|idle|done` means idle, and `working|thinking|running` means working (`:46-59`).
- `createAgentStatusTracker` (`agent-title-status.ts:72-154`) turns this into edges. working to idle or permission fires `onBecameIdle`. idle to a shell title fires `onAgentExited`.
- For hook agents Orca writes a synthetic title from hook state (`src/shared/synthetic-agent-title.ts`).
- For hookless panes, `titleAgentPhase` maps permission to `needs-you`, working to `working`, idle to `done` and null to `rest` (`src/shared/agent-transitions.ts:33-44`). `AgentTransitionDetector` prefers hook rows over titles (`src/main/agent-hooks/agent-transition-detector.ts:68`).

### 2.4 Keystroke-based inference of "done" (V)

- Several agents emit no hook when the user presses Esc or Ctrl-C. Orca watches the user's input to the PTY and synthesizes `done/interrupted`.
- The pieces are:
  - `AgentInterruptInputIntent = 'plain-escape' | 'ctrl-c'` (`src/shared/agent-interrupt-intent.ts:3`).
  - `applyInterruptInference` (`src/main/agent-hooks/server/server-status-inference.ts:67-120`).
  - Claude's `ClaudeTerminalInterruptTracker` (`src/shared/claude-terminal-interrupt.ts:1-60`).
- The Claude tracker correlates an Escape press with the title glyph (or OSC 7501 activity) flipping to idle within 5 s (1.5 s for OSC activity). A guard requires the baseline `receivedAt` and `stateStartedAt` to still match.
- Per-agent caveats:
  - Escape also navigates menus in claude, codex, omp and pi, so those need provider evidence.
  - OpenCode and Copilot need a double Escape (`agent-interrupt-intent.ts:32-72`).
- A similar "question answered" inference exists for Claude AskUserQuestion (`src/shared/agent-question-answered-intent.ts`).
- Known gap (open issue #31786): the chat Stop button writes Esc straight to the PTY and bypasses this inference.

### 2.5 Screen/tail text rules (idle and blocked detection for `wait` and send, V)

- Per-agent JSON rule files live in `src/main/runtime/agent-state-rules/` (claude, codex, cursor, gemini, hermes, omp, opencode, opencode2, pi, prime-agent, cline, dsh, antigravity, unknown-pane). The engine is `agent-state-rules-engine.ts`. The regions are `title`, `text` (tail) and `screen` (rendered grid).
- Examples:
  - `claude.json`: title regex `^✳` means idle.
  - `codex.json`: the text anchor `implement this plan?` plus `no, stay in plan mode` means `blocked/agent-interactive-prompt`. `openai codex` with `model:` and `directory:` means idle. `model: loading` means hold. It also has the screen predicates `codex-header-ready` and `codex-composer-ready`.
  - A generic blocked-sentinel regex over the last 12 non-blank lines matches `update available|do you trust|trust this|press enter to (confirm|continue|view|insert)|permission required|allow once|allow always|hooks need review` (`blocked-text-layer.ts:11-30`).
- The evidence ranking is in `src/main/runtime/tui-idle-evidence.ts:~130-210`. The order is hook turn lane, blocked tail text, explicit idle title or positive body evidence, first-party done, first-party working, quiet-ready screen, title working, rules-engine weak verdict, sustained title idle. A screen "input veto" can downgrade any ready verdict.
- Consumers are `orca terminal wait --for tui-idle` and send-readiness checks.
- The rules are hot-updatable. A bundle is downloaded from a GitHub release every 4 hours (`agent-state-rules-live-update.ts:22-39`).
- From reading the consumers, this layer does not feed `AgentStatusEntry.state` (I).

### 2.6 Process presence and exit (V)

- The hook script captures the agent PID (the hook's `$PPID`) plus an OS start-time stamp: `/proc/<pid>/stat` field 20 plus boot_id on Linux, `ps -o lstart` on macOS. It sends this as `X-Orca-Agent-Process` (`src/main/agent-hooks/hook-process-capture.ts:1-30`).
- Main later probes that PID (`probeAgentProcessPresence`, `server-agent-presence.ts:94-140`). On `exited` it calls `reconcileEndedProcessForPaneKeys` and keeps the resume identity (`server-cleanup.ts:112-160`).
- A shell-title edge also triggers a recheck (`src/main/runtime/terminal/output/terminal-title-tracker.ts:~85`).
- A `SessionEnd` hook with reason in {prompt_input_exit, logout, other, bypass_permissions_disabled}, from the main agent with a captured process, yields `agentPresence.ended` (`src/shared/agent-hook-listener.ts:33-38,212-239`). `/clear` and `/resume` reasons are explicitly not treated as exit.

### 2.7 Transcript tailing (supplement only, V)

- It is used to enrich or settle:
  - The last assistant message after Stop (`ASSISTANT_MESSAGE_RETRY_ATTEMPTS = 5`, `server-constants.ts:4-5`).
  - Codex rollout turn-end and subagent state (`codex-events.ts:255-261`).
  - The Muse session log.
- The poll policy covers only Codex and Muse (`src/shared/agent-hook-listener/transcript-poll-policy.ts:8-26`).
- The hook-supplied `transcript_path` is stored in the provider session metadata.
- Open issue #27672: Claude helpers killed with Ctrl-C can still show "working", because no Claude kill-record reader exists.

### 2.8 Polling and timers (V)

- A non-done row older than 30 minutes is no longer "fresh" (`AGENT_STATUS_STALE_AFTER_MS`, `src/shared/agent-status-freshness.ts:4`). Hydrated rows live 7 days (`:7`).
- A 2-minute hook-silence recheck feeds the OSC precedence.
- A `done` followed by a brief `working` is quiet-gated by `AGENT_DONE_QUIET_MS = 1500` before it counts as finished (`agent-transitions.ts:11`).

### 2.9 Structured chat protocols (client types V; per-event tables I)

- Claude: `@anthropic-ai/claude-agent-sdk`, which drives `claude` with `--print --input-format/--output-format stream-json` and an Orca-owned permission prompt tool (`src/main/claude/claude-stream-json-connection.ts:1-40`, `claude-structured-launch-args.ts:3-28`).
- Codex: `codex app-server` JSON-RPC (`src/main/codex/codex-app-server-connection.ts`).
- grok, opencode, opencode2, omp, antigravity: ACP (Agent Client Protocol) over stdio (`src/main/acp/acp-launch-specs.ts:144,205,222,229,263`, `acp-session-update.ts`, `acp-permission-requests.ts`). The ACP capability block has `steering: 'queue'` and `approvalEnforcement: 'orca'` (`acp-structured-agent-definitions.ts:~30-40`).
- All three are translated into a SQLite-backed append-only journal (3.4). The sidebar row is projected from the journal (`src/shared/structured-agent-session-agent-status.ts:1-40`).

### How the sources are combined

1. Hooks and plugins have authority. Each provider has its own state machine (section 4), with child and subagent folding (`src/shared/agent-lead-status-fold.ts`).
2. OSC 7501 and 9999 are projected into the same payload and yield to a fresh hook row.
3. Titles drive hookless panes and the synthetic-title UI. Keystroke inference fills "no stop hook" gaps. Process presence confirms exits. The screen-rule layer answers "is it safe to type now".
4. Structured sessions have their own authority (the journal). They are marked `structuredHost: 'owned' | 'held'` so they stay fresh past the 30-minute window (`listener-event.ts:70-71`).

## 3. Normalized model

### 3.1 Row state (V)

`src/shared/agent-status-types.ts:50-51`:

```ts
export const AGENT_STATUS_STATES = ['working', 'blocked', 'waiting', 'done'] as const
```

How each is used in code:
- `working`: a turn is running.
- `waiting`: a turn-scoped human need such as a tool approval, AskUserQuestion or MCP elicitation. The projector comment (`agent-status-projector.ts:55-58`) says "Orca's hooks report approvals and questions as `waiting`".
- `blocked`: a non-turn block (auth or an unnamed OSC block) or an agent-specific block. Copilot permission and elicitation notifications, Pi UI prompts, OMP prompts, and structured-chat "attention" all map to `blocked` (`structured-agent-session-agent-status.ts:19-21`).
- `done`: the turn ended or the pane is at rest. It is not a session-end state.
- There is no `idle`, `error` or `ended` row state.
  - Errors are `done` plus `outcome:'failure'`.
  - A session boundary is `done` plus `sessionBoundary:true`.
  - Process exit is the separate `agentPresence.ended`.
- UI phases: `AgentPhase = 'needs-you'|'done'|'working'|'rest'`. `blocked` and `waiting` fold to `needs-you`. `AgentTransition = 'prompt-submitted'|'turn-finished'|'errored'|'needs-input'` (`agent-transitions.ts:14-30`).

### 3.2 Payload and row (V)

- `AgentStatusPayload` (`agent-status-types.ts:161-191`): `state`, `workingMode?:'monitoring'`, `prompt`, `agentType`, `model`, `toolName`, `toolInput`, `interactivePrompt`, `lastAssistantMessage`, `lastAssistantMessageIsToolOutput`, `interrupted`, `sessionBoundary`, `turnCompletedAt`, `subagents[]`, `mainAgent`, `claudeTaskWakeupPending`.
- `AgentMainAgentStatus` (`src/shared/main-agent-status.ts:6-15`): `{state, outcome?, stopping?, stateStartedAt}`. It keeps the main agent's own state separate from the child-folded row state. A settled main agent with live children reads `working`.
- `AgentTurnOutcome` (`src/shared/agent-turn-outcome.ts:4-18`): `success|failure|cancellation|superseded|interruption|unconfirmed`. The last two are derived, not journaled. Absence means unknown: "never infer success from plain Stop".
- Row envelope `AgentStatusIpcPayload` (`src/shared/agent-status-ipc-payload.ts:46-80`) adds `paneKey`, `launchToken`, `terminalHandle`, `tabId`, `worktreeId`, `connectionId`, `receivedAt`, `evidenceObservedAt`, `stateStartedAt`, `turnStartedAt`, `turnEndedAt`, `turnEndDisposition ('identified'|'ambiguous')`, `orchestration`, `providerSession`, `providerSessionOnly`, `programStatus`, `restoredUnconfirmed`, `isReplay`, `structuredHost`, plus an observation record.

### 3.3 Transport event (V)

`AgentHookEventPayload` (`src/shared/agent-hook-listener/listener-event.ts:15-77`) wraps a `ParsedAgentStatusPayload`. Extra fields: `paneKey`, `agentPresence`, `source`, `launchToken`, `hostTurnRevision`, `hasExplicitPrompt`, `promptInteractionKey`, `hookEventName` (the raw provider event name, kept for provider-specific guards), `providerPromptId`, `compactTrigger`, `toolUseId`, `toolAgentId`, `toolAgentType`, `providerSession`, `isReplay`, `turnEndedAt`, `stopHookActive`, `claudeRunningNonAgentTask`, `structuredHost`.

### 3.4 One schema across agents? (V)

- For the row, yes. Every provider normalizer returns the same `ParsedAgentStatusPayload`.
- The per-agent state is hidden behind the normalizers. `HookListenerState` (`src/shared/agent-hook-listener/listener-state.ts`) holds per-pane caches such as `claudeLeadStateByPaneKey`, `claudeSubagentRosterByPaneKey`, `codexLeadStateByPaneKey`, `codexSubagentTranscriptByPaneKey`, `grokActiveTurnByPaneKey`, `lastToolByPaneKey` and `lastPromptByPaneKey`.
- Structured chat has a richer schema (`src/shared/agent-session-journal-types.ts:101-349`):
  - Item kinds: `message | tool-call | diff | plan | approval | question | status | turn`.
  - Turn lifecycle: `running | completed | interrupted | unverifiable`, with a separate outcome.
  - It is projected down to the 4-state row.

## 4. Per-agent mapping (V, reproduced from code)

The dispatcher is `src/shared/agent-hook-listener/provider-dispatch.ts`. New-turn events are in `isNewTurnEvent` (`provider-event-routing.ts:26-93`). Turn-end events are in `isTurnEndEvent` (`:96-141`).

### Claude (`providers/claude-events.ts:129-139`)

| Native hook | Row state | Notes |
|---|---|---|
| UserPromptSubmit | working | new turn, prompt text captured |
| PreToolUse (not AskUserQuestion) | working | tool name and input preview |
| PreToolUse with AskUserQuestion | **waiting** | `interactivePrompt` is the full question JSON |
| PostToolUse, PostToolUseFailure | working | clears a wait |
| PermissionRequest | **waiting** | `interactivePrompt = {approval:{tool,summary}}` |
| Elicitation | waiting | restored on ElicitationResult |
| Stop | done | outcome unknown unless `is_interrupt` or inferred cancel |
| StopFailure | done | `outcome:'failure'` |
| PostCompact (manual) | done + sessionBoundary | auto compact stays in-turn |
| SessionStart (startup/resume/clear) | done + sessionBoundary | resets rosters; `compact` and child sources are ignored (`:54-78`) |
| SessionEnd (exit reasons) | `agentPresence.ended` | not a state (`agent-hook-listener.ts:212-239`) |
| SubagentStart, SubagentStop, TeammateIdle | roster update; re-emits cached lead state | `claude-lifecycle-events.ts:26-131` |

Events with an `agent_id` (from subagents) never change the lead state, except a child-induced wait.

### Codex (`providers/codex-events.ts:163-177`)

| Native hook | Row state |
|---|---|
| SessionStart, UserPromptSubmit, PostToolUse | working |
| PreToolUse | working (waiting if the tool is `request_user_input`) |
| PermissionRequest | waiting (downgraded to working if the transcript shows an auto-reviewer owns the approval) |
| Stop, Interrupt | done |

Codex fires no Stop for a failed turn. Orca reads the rollout transcript and sets `outcome:'failure'` if the turn ended failed (`:256-261`). Subagents use a separate roster.

### Others (state mapping)

| Agent | working | waiting/blocked | done | File:lines |
|---|---|---|---|---|
| Gemini | BeforeAgent, BeforeTool, AfterTool, Pre/PostToolUse | none via hooks; title glyph ✋ gives `permission` | AfterAgent | `gemini-events.ts:17-26` |
| Cursor | beforeSubmitPrompt, sessionStart, pre/postToolUse(+Failure), beforeShellExecution, beforeMCPExecution, afterAgentResponse | none | stop, sessionEnd (status != completed means interrupted) | `cursor-events.ts:18-52` |
| Copilot | SessionStart, UserPromptSubmit, PostToolUse(+Failure), PreToolUse, PermissionRequest | blocked: Notification permission_prompt or elicitation_dialog, ask-user tool | Stop, SessionEnd, non-recoverable ErrorOccurred | `copilot-events.ts:35-49` |
| Droid | UserPromptSubmit, Pre/PostToolUse | waiting: PermissionRequest, permission Notification, ask tool | Stop, idle Notification | `droid-events.ts:31-52` |
| OpenCode family | SessionBusy, MessagePart | waiting: PermissionRequest, AskUserQuestion | SessionIdle, SessionStart | `opencode-family-events.ts:22-31` |
| Pi/OMP/prime | before_agent_start, agent_start, tool_*, message_end | blocked: UI prompt, OMP approval or plan review | agent_end | `pi-family-events.ts:70-90` |
| Amp | agent.start, tool.call, tool.result | none | agent.end (cancelled means interrupted) | `amp-events.ts:29-56` |
| Antigravity | Pre/PostInvocation, Pre/PostToolUse | waiting: PreToolUse of a feedback tool | Stop (unless still busy) | `antigravity-events.ts:57-69` |
| Kiro | userPromptSubmit, pre/postToolUse | none | agentSpawn, stop, SessionEnd | `kiro-events.ts:17-31` |
| Devin | UserPromptSubmit, Pre/PostToolUse, PostCompaction | waiting: PermissionRequest | Stop, SessionEnd | `devin-events.ts:24-32` |
| Claude-compatible (qoder, qwen, codebuddy, kimi, muse, dsh, zcode) | UserPromptSubmit, PostToolUse, PreToolUse | waiting: PermissionRequest, AskUser tool, Notification | Stop, StopFailure, SessionEnd, manual PostCompact | `compatible-lifecycle-events.ts:18-44` |
| Hermes | pre_llm_call, pre/post_tool_call, post_approval_response | waiting: pre_approval_request | post_llm_call, on_session_* | `hermes-events.ts:10-20` |
| jcode | turn_start, pre_tool, post_tool | waiting: pre_tool of a user-input tool | turn_end, session_end | `jcode-events.ts:14-36` |
| Command Code | PreToolUse, PostToolUse | none | Stop | `command-code-events.ts:17-20` |
| Grok | stateful, with prompt ids and cancel handling | waiting | stop, stop_failure, stop_cancelled | `grok-events.ts:180-231` |

The table is not exhaustive. Grok in particular has extra replay and cancel machinery (`server-grok-status-rules.ts`, `grok-replay-guard.ts`).

### OSC 7501 to row (`agent-status-projector.ts:93-140`)

| OSC 7501 root state | Row |
|---|---|
| working | working |
| blocked, kind permission or question | waiting |
| blocked, kind auth or none | blocked |
| done | done + outcome success |
| error | done + outcome failure |
| idle | done + sessionBoundary |
| record vanishes | done + sessionBoundary |

Child records become subagent snapshots.

### Title to status

See 2.3. The title statuses `working`, `permission` and `idle` map to the phases `working`, `needs-you` and `done`.

## 5. Turn end vs session end

- Turn end (V):
  - `isTurnEndEvent` is a per-provider list (`provider-event-routing.ts:96-141`). Claude, Qoder, Qwen, Codebuddy, Kimi and Muse use `Stop|StopFailure`. Codex, Droid, Devin, Antigravity, DSH and ZCode use `Stop`. Gemini uses `AfterAgent`, Amp `agent.end`, Cursor and Kiro `stop`, Hermes `post_llm_call`, jcode `turn_end`.
  - opencode, pi, omp and mimo return false, because their done events are snapshots that can repeat within a turn.
  - The row becomes `state:'done'` with an `outcome` verdict. Done does not mean success (`main-agent-status.ts:8-9`).
  - The host stamps `turnStartedAt` and `turnEndedAt` with `turnEndDisposition`: `identified` proves a new, continued or repeated turn, `ambiguous` cannot tell repeats from missed openings (`agent-status-types.ts:247-250`, `src/shared/agent-hook-turn-end-timing.ts`). Duplicate Stops are folded through a host turn record keyed by Codex `turn_id` or a prompt key (`readHostTurnSignals`, `:19-40`).
- A done held open by child work: the folded row stays `working` while the main agent is settled (`agent-lead-status-fold.ts`). Claude records `turnCompletedAt` and `claudeTaskWakeupPending` when a Stop happens with background tasks still owing notifications.
- Interrupted turns with no hook: keystroke inference (2.4) marks `done` with `interrupted:true` and a cancellation verdict. A user-stopped turn is not "news": phase `rest`, no notification (`agent-transitions.ts:28`).
- Session boundaries (SessionStart, `/clear`, manual compact) produce `done` with `sessionBoundary:true`. Notifications, automations and badges must ignore these (`agent-status-types.ts:178`, `agent-transitions.ts:68-81`).
- Session end (V) is separate from the state. The triggers are a Claude `SessionEnd` with an exit reason, a PID probe returning exited (2.6), a PTY exit, or the tab closing. These clear or retain the row and keep the resume identity (`server-cleanup.ts:112-160`).

## 6. Permission and approval prompts

- Detection (V):
  - `PermissionRequest` events (Claude, Codex, Devin, Droid, OpenCode, OMP) and AskUserQuestion-type tools map to `waiting`.
  - Hermes uses `pre_approval_request`.
  - OSC 7501 `blocked kind=permission|question` maps to `waiting`.
  - Hookless agents get title keywords or glyphs, giving `permission` and phase `needs-you`.
  - The screen/tail layer detects trust dialogs, "press enter to...", "allow once/always" and Codex plan menus, so `terminal wait` and send are not fooled (2.5).
- In the UI (V):
  - It shows as `needs-you` in the sidebar, with a `needs-input` transition and notification.
  - The hook payload stores `interactivePrompt` as `{approval:{tool,summary}}` for PermissionRequest (`src/shared/agent-hook-listener/interactive-tool.ts:38-70`) or the full AskUserQuestion JSON.
  - The terminal-backed chat renders a card from it (`renderer/.../native-chat-interactive-prompt.ts:49-114`, `NativeChatApprovalCard.tsx`).
- Answering from Orca's UI (V):
  - Terminal mode: the card's Allow and Deny type keys into the PTY. Allow is `'1'`, or `'\r'` for OpenCode (`src/shared/native-chat-agent-support.ts:61-63`). Deny is ESC (`src/shared/native-chat-approval-envelope.ts:6-45`).
  - There is no programmatic answer in terminal mode. The Claude hook script first prints `{}` and always lets the TUI prompt run (`src/main/claude/hook-script.ts:64-67`, comment "Permission hooks fail closed on empty stdout"). The user can equally answer in the terminal.
  - Structured chat: Orca is the permission authority. ACP uses `approvalEnforcement:'orca'`, the Claude SDK uses a can-use-tool callback, and journal `approval` and `question` items carry a `resolution`.
- A guarded send refuses while the status is `permission` (`renderer/src/lib/active-agent-terminal-send-readiness.ts:25-45`).
- Resolution and edge handling:
  - The next PostToolUse or PostToolUseFailure restores `working`.
  - Claude permission requests that ended while no receiver was listening are tracked (`claude-settled-permission-requests.ts`, max 16).
  - An AskUserQuestion dismissed with Escape sends no hook, so "question answered" inference settles it (`server-status-inference.ts:107-113`).

## 7. Session identity and resume

- Capture (V): `extractAgentProviderSession` (`src/shared/agent-session-resume.ts:~233-300`).
  - `session_id` plus `transcript_path` for claude, codex, qoder, qwen, codebuddy and muse.
  - `session_id` for gemini, droid, kimi, zcode, hermes, kiro, dsh, devin, jcode, copilot and grok.
  - `conversationId` for antigravity, `conversation_id` for cursor, `sessionID` for opencode, `session_file` for pi and omp.
  - Amp and command-code have none.
  - Claude `effort` and `cwd` are also tracked (`pane-provider-session.ts:~40-94`).
  - Ids are validated: no control characters, not starting with `-`, at most 512 characters.
  - A hook continues the previous session after `/clear` or compact (`pane-provider-session.ts:55-72`).
  - A Claude session-continuation tracker rebinds a pane when Claude forks into a daemon job (`server-agent-presence.ts:172-189`).
- Resume (V): `getAgentResumeArgv` (`src/shared/agent-resume-argv.ts:5-82`) builds the CLI line, for example `claude [--effort X] --resume <id>`, `codex resume <id>`, `cursor-agent --resume`, `gemini --resume`, `agy --conversation`, `opencode --session`, `grok --resume`, `kiro-cli --resume-id`, `hermes --resume`.
  - Forks: `claude --resume id --fork-session`, `codex fork`, `grok ... --fork-session`, `pi --fork` (`:85-110`).
  - Resume happens on worktree sleep (`SleepingAgentSessionRecord`, `agent-session-resume.ts:55-80`) and on cold restore after an app restart (`pty-connection-cold-restore-agent-resume.spec.ts`).
  - It is refused if a structured chat owns the same conversation (`agentResumeRefused: 'chat-home'|'chat-writing'|'unverifiable'`).
- Orca's own identity is separate:
  - `paneKey = ${tabId}:${leafUuid}` (`agent-status-types.ts:102`). The code says Orca ids are "not agent-session ids" (`:144-146`).
  - A per-launch `ORCA_AGENT_LAUNCH_TOKEN` UUID fences authority, so a reused pane or replayed spool cannot adopt another launch's status.

## 8. Transport and authentication

- Transport (V):
  - Local hook script runs `curl` to `http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/<source>` (`src/main/agent-hooks/hook-post-command.ts:9-43`).
  - The body is raw hook JSON (`Content-Type: application/json`, `--data-binary @-`).
  - Metadata travels in headers. `X-Orca-Agent-Hook-Meta` is base64 of 6 unit-separator-joined fields (paneKey, tabId, launchToken, worktreeId, env, version). `X-Orca-Agent-Process` carries the PID info.
  - Raw-JSON mode is negotiated by `ORCA_AGENT_HOOK_TRANSPORT=raw-json-v1`. The fallback is urlencoded form posts.
  - Timeouts are `--connect-timeout 0.5 --max-time 1.5`, with `--noproxy 127.0.0.1`.
  - The server is plain Node `http`, bound to 127.0.0.1 on an ephemeral port (`src/shared/agent-hook-startup.ts:78`, `server-lifecycle.ts:213-238`). Only POST is accepted. The route `/hook/<source>` is resolved by `resolveHookSource` (`src/shared/agent-hook-listener/source-routing.ts`).
  - Body cap is 1,000,000 bytes (`request-body.ts:6`). A 5 s slowloris timeout applies (`listener-limits.ts:9`).
  - It always fails open: malformed or failed requests return 204 so the agent is never blocked (`server-lifecycle.ts:207-210`).
  - Plugin and extension agents POST the same way, with the same header.
  - Remote: SSH and WSL use a relay that normalizes remotely and forwards an `AgentHookRelayEnvelope` over the mux. Main revalidates and stamps `connectionId` (`src/shared/agent-hook-relay.ts:3-80`, `server-ingest-remote.ts`). tmux has its own path (`ingestTmuxHook`).
  - OSC channels travel inside the PTY output stream, not over HTTP.
- Port and token discovery (V):
  - The PTY env gets `ORCA_AGENT_HOOK_PORT`, `_TOKEN`, `_ENV`, `_VERSION`, `_TRANSPORT`, `_ENDPOINT` (`server-runtime-env.ts:13-30`). It also gets per-pane `ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_WORKTREE_ID`, `ORCA_AGENT_LAUNCH_TOKEN`.
  - Because a PTY can outlive an Orca restart, the script re-sources an endpoint file on every invocation: `{userData}/agent-hooks/endpoint.env`, or `endpoint.cmd` on Windows. It is written atomically with mode 0600 in a 0700 dir (`src/shared/agent-hook-listener/endpoint-publication.ts:7-85`; `claude/hook-script.ts:88-91`).
- Auth (V):
  - One shared secret. `this.token = randomUUID()` per server start (`server-lifecycle.ts:55`), and every request must carry `x-orca-agent-hook-token` equal to it, else 403 (`:70-74`).
  - There is no per-agent or per-pane token scoping.
  - Scoping is done by metadata checks: pane key format, `tabId` against the pane key, and the launch token against the stored authority (`hook-envelope.ts:109-163`; `server-authority-*.ts`; persisted as sha256 hashes, `server-persistence.ts:59-61`).
  - The real protections are loopback binding and 0600 files.
  - The token sits in the environment of every agent and its tool subprocesses.

## 9. Hook installation

- Global and user-level, not per-repo or per-worktree (V).
  - Claude hooks go into `~/.claude/settings.json` (`src/main/claude/hook-settings.ts:~47-49`).
  - The script lives at `~/.orca/agent-hooks/claude-hook.sh` (`.cmd` on Windows) (`:82-84`).
  - Open issues complain: #24873 (`CLAUDE_CONFIG_DIR` ignored), #15496 (wants a plugin instead of editing settings.json), #23434, #26718 (synchronous hooks slow every tool call).
- Codex uses an Orca-managed `CODEX_HOME` at `{userData}/codex-runtime-home/home`. It mirrors `~/.codex` resources and has its own `hooks.json` and `config.toml` trust entries (`src/main/codex/codex-home-paths.ts:~30-45`, `codex-hook-definition.ts:28-45`, `codex-hook-local-install.ts`). It promotes in-Orca hook approvals to the system config. Issue #10947 notes dual representations.
- Preserving user config (V):
  - `applyManagedHooks` (`hook-settings.ts:230-`) strips only entries whose command matches the managed script file name (`createManagedCommandMatcher`), then appends Orca's definition. Other hooks are untouched. Retired events are removed the same way.
  - The writer (`src/main/agent-hooks/installer-utils.ts:291-340`) is atomic (temp file plus rename), preserves file mode, skips unchanged content, and keeps one rolling `.bak`.
  - If `settings.json` cannot be parsed, install returns `state:'error'` and writes nothing (`claude/hook-service.ts:191-199`).
  - User edits to Orca's own entries are overwritten at every start (#26718).
- Consent (V):
  - There is no per-install prompt. `agentStatusHooksEnabled` defaults to on (`src/shared/agent-status-hooks-setting.ts:12-17`).
  - `reconcileStartupManagedAgentHooks` installs on every app start for each enabled agent whose CLI is on PATH (`managed-agent-hook-startup.ts`, `managed-agent-hook-controls.ts:55-62,141-200`).
  - Skip reasons: `agent_disabled | cli_not_found | cli_presence_unknown | hooks_disabled`.
  - A CLI installed after startup gets no hooks until restart (#28076).
  - I did not verify whether first-run onboarding mentions it.
- Uninstall (V):
  - The setting is Settings → Agents → "Agent status hooks", or CLI `orca agent hooks status|on|off --json` (`docs/site/content/docs/agents/hooks-memory.mdx`).
  - Off removes managed hooks, the statusline entry and the agent-view plugin (`ClaudeHookService.remove`, `hook-service.ts:262-300`).
  - Startup does not auto-remove when off, because "settings are per profile but hooks are user-global; startup removal would break other instances" (`managed-agent-hook-controls.ts:55-57`).
- Managed scripts are refreshed on startup even for removed CLIs (`refreshExistingManagedScripts`).
- SSH and WSL: installed remotely over SFTP (`installRemote`, `hook-service.ts:~218-260`) or through the WSL guest installer.

## 10. Persistence and source of truth

- Terminal mode (V): there is no event log.
  - The source of truth is the in-memory map `state.lastStatusByPaneKey` (latest event per pane) in the main-process `AgentHookServer`.
  - It is persisted by `AtomicSnapshotWriter` to `{userData}/agent-hooks/last-status.json`. File version 2, mode 0600, throttled to 5 s, written immediately when authority changes, flushed synchronously on quit (`server-persistence.ts:25-124`, `server-constants.ts:9-16`).
  - The file stores per-pane payloads, `launchTokenHash` (sha256), `authorityCommitments` and `agentExits`. It excludes runtime-only fields (`restoredUnconfirmed`, `observation`, `isReplay`, `terminalHandle`, `programStatus`) and `structuredHost` rows.
  - On startup `hydrateLastStatusFromDisk` (`server-hydration.ts:23-80`) drops entries older than 7 days and marks nonterminal rows `restoredUnconfirmed`, so they are never "fresh" until a live event confirms them.
- Spool and replay (V):
  - If the POST fails or port/token are unknown, the shell script appends a JSON line to `{endpointDir}/spool/pane-<id>.jsonl`. It skips Pre/PostToolUse events, caps files at 5 MiB, and truncates files older than 7 days (`hook-stdin-contract.ts:94-133`).
  - The server drains and replays them at start (`server-status-hook-lifecycle.ts`, `src/shared/agent-hook-spool.ts`: `AGENT_HOOK_SPOOL_MAX_FILES = 1024`, 7-day age). Replay is filtered against recorded agent exits and the launch-token hash so it does not resurrect finished work (`server-ingest-normalization.ts:~100-130`).
- Late-joining UI (V):
  - Renderers pull `agentStatus:getSnapshot` over IPC (`src/main/ipc/agent-hooks.ts:41`), then receive pushes. The mobile and runtime projection also reads `getStatusSnapshot()` (`runtime-mobile-session-projection.ts:66`).
  - Reconnect replays are flagged `isReplay` and restamped. `evidenceObservedAt` keeps the original clock so staleness is not extended (`agent-status-freshness.ts:9-40`).
- Structured mode (V):
  - It uses an append-only per-session SQLite journal (`src/main/native-chat/agent-session-journal/journal-database.ts`). It has `synchronous=FULL`, a 32 MiB cap, schema version 4, and epoch plus sequence cursors.
  - Rows are upcast on read and writes are refused rather than skipping unreadable kinds.
  - It also holds session records, queued messages and command receipts. This is a real, replayable event log.
- Remote hosts hold their own copy and clients mirror it (`mirroredEvidenceReceivedAt`).

## 11. Message injection

- Terminal mode, PTY write (V): `src/shared/agent-prompt-injection.ts`.
  - The prompt is sent as a bracketed paste (`ESC[200~ ... ESC[201~`), then a separate `\r` after a delay (`AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS = 50`, `AGENT_PROMPT_SUBMIT_SETTLE_MS = 500`, plus a size-based ingest wait; `:5-9,18-80`).
  - Pacing is per agent via `TUI_AGENT_CONFIG`. Codex drops typed text that shares the paste write. OMP needs Enter in the same write. Windows ConPTY needs a bytes-per-ms budget.
  - After writing, Orca can verify the paste still sits as an unsent draft (`isHeldAgentPromptDraft`, which understands Codex `[Pasted Content N chars]` placeholders) and retry the Enter.
- When (mechanism V, policy partly I):
  - It is gated by readiness evidence, not a hard "only when idle" rule.
  - `orca terminal wait --for tui-idle` uses the tiered evidence in `tui-idle-evidence.ts`.
  - Guarded UI sends call `terminal.agentStatus` and refuse when the status is `permission` or no agent is running (`active-agent-terminal-send-readiness.ts:25-45`).
  - The documented orchestration flow does `terminal wait --for tui-idle`, then `dispatch --inject` (`docs/site/content/docs/cli/orchestration.mdx`).
  - I found no Orca-level queue for direct `orca terminal send`. Whether a send while `working` is allowed is left to the caller.
- Orchestration (V from docs):
  - Workers get a preamble and send `worker_done`, `heartbeat` and `question` back via the `orca orchestration` CLI to the runtime. It has tasks, dispatches and decision gates.
  - This is a second, explicit, agent-initiated status channel. `AgentStatusOrchestrationContext` ties it to a pane row (`agent-status-types.ts:58-71`).
- Structured mode (existence V, details I):
  - It uses API calls, not PTY: the Claude SDK user-message queue (`claude-agent-sdk-user-message-queue.ts`), ACP `session/prompt`, and Codex app-server.
  - ACP advertises `steering:'queue'`, and the journal has `queued_messages`, so sending while a turn runs is supported (`journal-queued-messages.ts`).

## 12. Edge cases

- Subagents (V):
  - Claude: roster from SubagentStart and SubagentStop, teammates parked by TeammateIdle, `background_tasks` inventory in hook payloads, and owed task-notification tracking (`claude-subagent-roster.ts`, `claude-owed-task-notifications.ts`, `claude-lifecycle-events.ts`).
  - Codex: roster plus rollout transcript reconciliation and reviewer detection (`codex-subagent-transcript.ts`, `codex-subagent-reviewer.ts`).
  - The row exposes `subagents[]`, and `mainAgent` is kept apart from the folded state. A settled lead with live children stays `working`.
  - A child-origin PermissionRequest makes the lead `waiting`, with the displaced state stashed in `stateBeforeWait` (`claude-events.ts:240-259`).
  - Child hooks never name their own session, so `readPaneProviderSession` ignores Codex `agent_id` events (`pane-provider-session.ts:19-21`).
  - Open: #27942 (DSH subagent hooks take over the pane) and #27672.
- Compaction (V):
  - Manual `/compact` ends at idle without Stop, so `PostCompact(manual)` gives `done + sessionBoundary`. It is consumed once per prompt id (`agent-hook-listener.ts:176-207`).
  - Auto compaction stays in-turn. PreCompact is not installed.
  - Codex `SessionStart source=compact` keeps a running turn (`codex-events.ts:262-269`).
  - The compaction continuation prompt is ignored (`claude-events.ts:102-104`).
- /clear (V): Claude `SessionStart source=clear` resets rosters and caches, gives `done + sessionBoundary`, and continues the same provider session metadata. A `SessionEnd` with reason `clear` or `resume` is not an exit.
- Multiple sessions and worktrees (V):
  - The keying unit is the pane (`tabId:leafUuid`). Each PTY gets its own env, and the status map is keyed by pane.
  - All panes share one HTTP server and one global hooks file. The script is a no-op outside Orca because it prints `{}` and spools or exits when `ORCA_PANE_KEY` is missing.
  - Daemon or forked workers that inherit a pane key are suppressed by a `CLAUDE_JOB_DIR` guard (`claude/hook-script.ts:83-85`).
  - A replacement owner is detected by PID (`checkAgentPresenceAfterHook`).
  - Shared OpenCode servers are re-attributed by session id and launch token (`opencode-session-registry.ts`).
- App crash or restart (V):
  - PTYs may survive via a daemon, and the endpoint file lets old agents find the new server.
  - `last-status.json` plus the spool restore state. Restored nonterminal rows are `restoredUnconfirmed` until a live event or process probe confirms them. `restored-status-dead-terminal-sweep.ts` removes dead ones.
  - Cold restore re-runs `--resume <id>`.
  - `stop()` flushes the status file synchronously (`server-lifecycle.ts:249-256`).
- Hooks off or missing (V): the pane falls back to title and OSC. This is why approvals show as "working" in #28076.
- Closed tabs and removed worktrees: retired-pane fences and closed-tab sets (max 1024 each) stop late events from resurrecting rows (`server-status-disposition.ts:~20-45`, `server-constants.ts:19-22`).
- Harness-injected user turns do not count as a user submit (`isKnownHarnessInjectedUserTurnText`, `provider-event-routing.ts:188`).

## 13. Known weaknesses and open issues (V via `gh issue list -R stablyai/orca`, 2026-10-26)

- Complexity: `src/main/agent-hooks/` has about 190 files, with heavy evidence-clock, authority-fence, replay and observation machinery, and provider-specific guards. Comments cite many issue numbers, which suggests many fix-ups (I).
- Hook gaps:
  - Killed Claude helpers still "Working" (#27672).
  - Grok "cancelled" while still working (#27673).
  - Cursor panes stuck Working after stop (#12686).
  - Sidebar stays "Working" after Stop in Chat UI when no interrupt hook fires (#31786).
  - Claude misses updates with a custom config dir (#27660, #24873).
- Install gaps:
  - A CLI installed after Orca starts gets no hooks (#28076).
  - Hermes `--profile` panes get none (#18259).
  - Antigravity bundle wiped on Windows (#17672).
  - DSH hooks reported installed while the plugin cannot load (#30173).
- Transport:
  - The 1 MB body cap silently drops large PostToolUse events (#15791).
  - Synchronous hooks add latency to every tool call, especially on Windows (Git Bash to cmd to curl) (#26718). #33451 proposes Claude `type:"http"` hooks.
  - Windows payload bugs (#17977, #16356).
  - Wrong shell PATH (#27832).
  - `orca agent hooks status` does not work over SSH (#27399).
- Protocol drift: Claude 2.1.228 changed its title spinner (#13889). Prime Agent 0.10 removed its bridge (#27282). The screen-rule JSON is hot-updated from GitHub every 4 hours to chase CLI UI changes, which shows that title and screen matching is brittle.
- Security and privacy:
  - Hook scripts persist raw payloads to the spool (#23854).
  - One app-wide token is visible in the agent environment.
  - Hooks are written into global user config.
- Docs: "no reference for the agent hook wire protocol" (#22064).
- Not verified: how often the title lane is the only signal in practice, the first-run consent UI, and which programs actually emit OSC 9999.

## Key file index

- Overview and precedence: `src/main/agent-hooks/README.md`
- Server and ingest: `src/main/agent-hooks/server/server-{lifecycle,ingest-normalization,status-update,persistence,hydration,agent-presence,status-inference}.ts`
- Normalization: `src/shared/agent-hook-listener.ts`, `src/shared/agent-hook-listener/{hook-envelope,provider-dispatch,provider-event-routing,listener-state,listener-event}.ts`, `.../providers/*-events.ts`
- Types: `src/shared/{agent-status-types,main-agent-status,agent-turn-outcome,agent-status-ipc-payload,agent-hook-relay}.ts`
- Title and OSC: `src/shared/agent-title-*.ts`, `agent-status-osc.ts`, `program-status/*`, `terminal-agent-status-processor.ts`
- Screen rules: `src/main/runtime/agent-state-rules/*`, `src/main/runtime/tui-idle-evidence.ts`
- Install: `src/main/agent-hooks/managed-agent-hook-{registry,controls,startup}.ts`, `src/main/claude/{hook-service,hook-settings,hook-script,claude-managed-hook-events}.ts`, `src/main/codex/codex-hook-*.ts`, `src/main/agent-hooks/installer-utils.ts`
- Injection: `src/shared/agent-prompt-injection.ts`, `src/shared/tui-agent-config.ts`
- Structured chat: `src/main/claude/claude-stream-json-connection.ts`, `src/main/codex/codex-app-server-*.ts`, `src/main/acp/*`, `src/main/native-chat/agent-session-journal/*`, `src/shared/agent-session-journal-types.ts`

## Summary for items 2-6, 8, 10, 11

- Signals (item 2): hooks are primary for 23 agents. Plugins or extensions cover opencode, pi, omp, hermes and amp. OSC 7501 is the fallback and yields to hooks unless hooks are silent for 2 minutes. Title classification (OSC 0/2 glyphs and keywords) is the hookless fallback. Keystroke inference synthesizes done on Esc or Ctrl-C. PID probes confirm exit. Transcript tailing is used only for Codex, Muse and last-message enrichment.
- Screen text is used only by a separate rule engine for idle/blocked waits and send gating. Those JSON rules are hot-updated from GitHub every 4 hours.
- Structured chat is a different pipeline: Claude Agent SDK stream-json, Codex app-server, ACP for grok/opencode/omp/antigravity, all into a SQLite journal.
- Model (item 3): the row state enum is `working|blocked|waiting|done` (`agent-status-types.ts:50`). Turn verdicts live in `mainAgent.outcome`: `success|failure|cancellation|superseded|interruption|unconfirmed`. `sessionBoundary` is a flag on `done`. One schema is shared across agents. The raw event name is kept for guards.
- Mapping (item 4): see the tables in section 4. Claude PermissionRequest, AskUserQuestion and Elicitation map to waiting. Stop maps to done. StopFailure maps to done with failure. SessionStart and manual PostCompact map to done with a boundary. Codex works similarly, with Interrupt added. Gemini, Cursor and Kiro have no waiting hook, so they depend on titles.
- Turn vs session (item 5): turn end is a per-provider event list (`isTurnEndEvent`). The row is `done` with an outcome, and absent outcome means unknown, never success. Session end is separate: SessionEnd with an exit reason, a PID probe, or PTY exit. `/clear` and compact are boundaries, not session ends.
- Transport and auth (item 8): `curl` POST to `127.0.0.1:<ephemeral port>/hook/<source>` with raw JSON and metadata headers. It requires header `x-orca-agent-hook-token`, a per-launch `randomUUID` shared by all agents, else 403. The port and token come from the PTY env plus an endpoint file re-sourced on every hook call, so surviving PTYs reach a restarted app. Scoping is by pane key, tab id and launch-token hash. It fails open with 204. Body cap is 1 MB.
- Persistence (item 10): in terminal mode only the latest event per pane is kept, in memory and in `last-status.json`. Hydration drops rows older than 7 days and marks restored rows unconfirmed. Missed hooks go to a spool file and are replayed with exit and token filtering. A late UI pulls `agentStatus:getSnapshot` over IPC. Structured chat has a real append-only SQLite journal.
- Injection (item 11): in terminal mode, a bracketed paste plus a delayed `\r` through PTY write, with per-agent pacing and a retry if the draft is still held. It is gated by tui-idle evidence and refuses on `permission`, but there is no Orca-side queue for terminal send. Structured chat uses SDK, ACP or app-server calls with a queued-steering capability.
- Not found or unverified: first-run consent UI for hook install, who emits OSC 9999, and whether a send while `working` is blocked in every path.
