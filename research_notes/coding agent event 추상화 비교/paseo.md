# paseo: how it abstracts events and state from coding agents

Source: https://github.com/getpaseo/paseo at commit `033b2cdfc2b85e4e67a7f9d22b3af25200cf54a0` (2026-10-26), root package version 0.13.1. Paths are relative to the repo root. "(V)" = verified in source. "(D)" = docs only or inferred. Research run 2026-10-26 (read only, nothing installed or run).

## 1. What it is

- **Repo:** https://github.com/getpaseo/paseo. Other search hits were forks and mirrors of the same README. It orchestrates coding agents: a daemon plus mobile, desktop, web and CLI clients.
- **License:** Apache-2.0 (`LICENSE:1-12`). A web article claimed AGPL, which the source contradicts. (V)
- **Stack:** TypeScript monorepo (`packages/{server,protocol,client,app,cli,relay,desktop,plugin,website}`). The daemon is Node.js with express and ws. The app is Expo; desktop is an Electron wrapper. Wire schemas are zod in `packages/protocol/src/messages.ts`. (V)
- **Agents supported** (all under `packages/server/src/server/agent/providers/`) (V):
  - Claude, via `@anthropic-ai/claude-agent-sdk` (`claude/agent.ts`, 6831 lines).
  - Codex, via `codex app-server` JSON-RPC (`codex-app-server-agent.ts`, 7670 lines).
  - OpenCode, via HTTP plus SSE (`opencode-agent.ts`).
  - Pi and omp, spawned in `--mode rpc` / `rpc-ui` (`pi/runtime.ts:92-123`).
  - A generic ACP client (`acp-agent.ts`) with subclasses for Copilot, Cursor, Kimi, Kiro and Trae.
  - Plugin-defined providers.

### Headline: two separate signal systems

1. **Chat agents (the main product).** The daemon owns the agent process and talks a structured protocol: SDK stream, JSON-RPC, ACP, or HTTP/SSE. No PTY parsing, no hooks and no transcript tailing for live status. Everything funnels into one `AgentStreamEvent` union.
2. **Terminal agents.** The user runs `claude` or `codex` in a Paseo terminal tab. Paseo gets only a coarse 3-state activity (running, idle, needs-input) from opt-in hooks that POST to a local endpoint. No messages, tool calls or transcript. Status is not scraped from PTY output. OSC 633 is used only for shell command finish.

## 2. Signal sources

- **Claude SDK `query()` stream.** The SDK spawns the `claude` CLI with pipes (`claude/query.ts:64-119`). Message types read: `system/init`, `system/status`, `system/compact_boundary`, `system/task_*`, `system/session_state_changed`, `assistant`, `user`, `stream_event`, `result`. Pump and router: `claude/agent.ts:4062-4380`. (V)
- **Claude `canUseTool` callback** for permissions (`agent.ts:3611`, `:5050-5130`). (V)
- **Claude SDK in-process `hooks`** (PreToolUse, PostToolUse, SubagentStop). Observation-only, return `{}`; only used to read subagent "effort", which is not on the stream (`agent.ts:5195-5226`). User hooks are merged, not replaced (`claude/hooks.ts`). (V)
- **Codex app-server JSON-RPC over stdio.**
  - Notifications: `thread/started`, `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `turn/plan/updated`, `turn/diff/updated`, `thread/tokenUsage/updated`, `thread/compacted`, and legacy `codex/event/*`.
  - Server requests: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`.
  - Schemas `codex-app-server-agent.ts:2662-3170`, dispatch `:5438-5600`, handlers `:3952-3958`, spawn `:7265`. (V)
- **OpenCode.** SSE events `session.created/updated/deleted`, `message.updated`, `message.part.updated/delta`, `permission.asked`, `question.asked`, `todo.updated`, `session.compacted`, `session.idle`, `session.error`, `session.status` (`opencode-agent.ts:2291-2350`). Control: `session.promptAsync`, `session.abort` (`:3688`, `:3757`). A bridge plugin (`opencode/bridge-plugin.mjs`) exposes Paseo tools. (V)
- **ACP.** `session/update` kinds `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `current_mode_update`, `usage_update`; also `requestPermission`, `prompt()` with `stopReason`, and `cancel` (`acp-agent.ts:2623-2670`, `:3088-3150`, `:3315-3345`). (V)
- **Pi and omp RPC events:** `agent_start`, `turn_start`, `message_*`, `tool_execution_*`, `compaction_*`, `agent_end`, `agent_settled`, `auto_retry_start` (`pi/agent.ts:2157-2260`). (V)
- **Provider transcript files, read once** — for history replay on resume and import, not live tailing. Claude: `~/.claude/projects/<cwd>/<sessionId>.jsonl` (`claude/project-dir.ts:38-70`, `agent.ts:5275`). Codex: `thread/read`, `thread/list`. (V)
- **Process exit and stderr** produce `turn_failed` with a diagnostic (`agent.ts:3807-3845`, `:3985-4030`). (V)
- **Terminal-agent hooks.** Claude: `UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`, `Notification`. Codex: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`. OpenCode: plugin on `session.status` and `permission.asked/replied`. Path: `paseo hooks <agent> <event>` CLI → `POST /api/terminal-activity` (`terminal/agent-hooks/claude/claude.ts`, `codex/codex.ts`, `packages/cli/src/commands/hooks.ts`, `server/bootstrap.ts:285-345`, `docs/terminal-activity.md`). (V for code, D for the OpenCode table.)
- **OSC 633 `D;<exit>`** from a zsh integration script; marks command finished only (`terminal/terminal.ts:127-142`). (V)
- **Standalone Ctrl-C or Esc while a terminal is "working"** clears the activity, because Claude emits no `Stop` on interrupt (docs, `terminal-activity-tracker.ts`).
- **Client presence heartbeats** — notification routing only (`agent-attention-policy.ts`, `docs/timeline-sync.md:20-32`). (V)
- **Not used:** PTY scraping for agent state, OSC titles for status, live transcript tailing.

## 3. Normalized model

One schema for all providers in `packages/server/src/server/agent/agent-sdk-types.ts`; wire mirror in `packages/protocol/src/messages.ts`. (V)

**`AgentStreamEvent`** (`agent-sdk-types.ts:408-465`), every event also carries `provider`:

```
thread_started {sessionId}
turn_started {turnId?}
turn_completed {usage?, turnId?}
turn_failed {error, code?, diagnostic?, turnId?}
turn_canceled {reason, turnId?}
usage_updated {usage}
mode_changed / model_changed / thinking_option_changed
timeline {item, turnId?, timestamp?}
permission_requested {request}
permission_resolved {requestId, resolution}
attention_required {reason: finished|error|permission}
provider_subagent {upsert | timeline | remove}
```

**`AgentTimelineItem`** (`:393`): `user_message{text,messageId?,clientMessageId?}`, `assistant_message{text,messageId?}`, `reasoning{text}`, `tool_call`, `todo{items}`, `error`, `notification{level,message}`, `compaction{status loading|completed, trigger?, preTokens?}`, `plugin`. `tool_call` is `{callId, name, status running|completed|failed|canceled, error, detail, metadata?}`. `ToolCallDetail` (`:240`) is a normalized union: `shell`, `read`, `edit`, `write`, `search`, `fetch`, `worktree_setup`, `sub_agent`, `plain_text`, `plan`, `unknown{input,output}`; per-provider `tool-call-mapper.ts` files map native tools onto it.

**Streaming deltas.** No delta event type. Providers emit repeated `assistant_message`/`reasoning` chunk items; the manager coalesces them in a 60 ms window (`agent-stream-coalescer.ts:5`); the stored timeline projects adjacent chunks into one item (`timeline-projection.ts:14-19`).

**State.**
- `AgentLifecycleStatus = initializing | idle | running | error | closed` (`packages/protocol/src/agent-lifecycle.ts`). `ManagedAgent` is a discriminated union on `lifecycle` (`agent-manager.ts:482`).
- Edge-triggered `AttentionState{requiresAttention, attentionReason finished|error|permission}` (`:374`): running→idle sets "finished", entering error sets "error", a permission request sets "permission" (`checkAndSetAttention`, `:5066-5105`).
- Derived UI bucket: `needs_input > failed > running > attention > done` (`protocol/src/agent-state-bucket.ts`).
- Terminal activity is separate: `working | idle` plus `attentionReason finished | needs_input`; hook state `running | idle | needs-input` mapped at `bootstrap.ts:296-300`. Unknown (`null`) is distinct from idle.

**Provider interface.** `AgentSession` (`:667`): `startTurn`, `steerActiveTurn?`, `subscribe(cb)`, `streamHistory()`, `interrupt()`, `getPendingPermissions()`, `respondToPermission()`, `describePersistence()`, `close()`. `AgentClient` (`:753`): `createSession`, `resumeSession`, `listImportableSessions`, …

## 4. Per-agent mapping

### Claude (`claude/agent.ts`) (V)

| Native | Normalized | Lines |
|---|---|---|
| `system/init` (opens every main-session turn) | `thread_started`; marks `mainTurnInFlight`; opens an autonomous turn if no foreground turn | `:507`, `:4198-4225` |
| `system/status` "compacting" | `compaction{loading}`, deduped (CLI repeats every 30 s) | `:4672` |
| `system/compact_boundary` | `compaction{completed, trigger, preTokens}` + `usage_updated` | `:4691` |
| `system/status.permissionMode` | `mode_changed` | `:4660` |
| `system/session_state_changed` idle | closes an autonomous turn only; "running" ignored | `:4186` |
| `system/task_*`, frames with `parent_tool_use_id` | `provider_subagent` + synthetic parent tool card | `:4538`, `subagents/live-source.ts:257` |
| `stream_event`, `assistant` blocks | `timeline` assistant_message / reasoning / tool_call via `TimelineAssembler` | `:1203-1480` |
| `user` | `timeline user_message`, deduped by uuid | `:4750` |
| `result` success | `turn_completed{usage}` | `:4829` |
| `result` non-success | `turn_failed{error, code, diagnostic=stderr}`; abort results after interrupt suppressed | `:4156` |
| `canUseTool` | `permission_requested`, kind `tool|plan|question` | `:5050`, `:1110` |
| process exit / pump error | `turn_failed` | `:3985`, `:4062` |

Turn ids are minted by Paseo: `foreground-turn-N`, `autonomous-turn-N` (`:3845`).

### Codex (`codex-app-server-agent.ts`) (V)
- `thread/started` → `thread_started` (`:6137`); `turn/started` → `turn_started` (`:6148`); child-thread turns become `sub_agent` tool updates.
- `turn/completed` → `turn_failed` / `turn_canceled` / `turn_completed{usage}` by status (`:6169-6205`).
- `item/*` → timeline items (`:1395-1430`); `*Delta` → text chunks and tool output append; `turn/plan/updated` → `todo` (`:6254`); `thread/tokenUsage/updated` → `usage_updated`; `turn/diff/updated` ignored (`:5534`).
- `requestApproval` → `permission_requested` (`CodexBash`, `CodexFileChange`, kind `tool`) (`:6999-7090`); a finished plan-mode turn emits a synthetic plan-approval request (`:6190`).

### OpenCode (`opencode-agent.ts:2291-2350`) (V)
`session.idle` → `turn_completed`; `session.error` → `turn_failed`; `permission.asked` → `permission_requested`; `question.asked` → question request; `message.part.*` → timeline; `todo.updated` → `todo`; `session.compacted` → compaction; child sessions (`parentID`) → `provider_subagent`. Terminal condition: runner status idle (`:3283`).

### ACP (`acp-agent.ts`) (V)
Chunks → `assistant_message`/`reasoning`; `tool_call`/`tool_call_update` → `tool_call` (merged snapshot); `plan` → todo; `prompt()` stopReason "cancelled" → `turn_canceled`, other → `turn_completed`, rejected → `turn_failed` (`:3315`); `requestPermission` → `permission_requested`, auto-accept mode exists (`:2623`). Turn id is a Paseo `randomUUID`.

### Pi and omp
`pi/agent.ts:2157-2260` (partly V).

## 5. Turn end vs session end

- **Turn end:** exactly one terminal event per turn (`turn_completed` / `turn_failed` / `turn_canceled`). Claude: SDK `result`; Codex: `turn/completed`; OpenCode: `session.idle`; ACP: `prompt()` response; Pi: `agent_end` / `agent_settled`.
- Manager (`agent-manager.ts:4659-4774`): completed → `idle`; failed → `error` + system error message; canceled → `idle`, pending permissions resolved "Interrupted". Terminal events for finalized turn ids dropped (`:4388`). "Done" = `running → idle`, sets `attention{finished}` (`:5083`).
- Claude Code 2.1.280 reports "running" while any background subagent is alive, so Paseo ignores `session_state_changed running` and only uses `idle` to close autonomous turns (`agent.ts:4165-4196`). Issues #7460, #7095, #7019, #6890, #7586.
- **Session end:** no session-ended event; a session is a durable provider id. Runtime goes to `closed` (resumable) by user action, idle collection after 1 h, or daemon restart. Archive is a soft-delete flag. On start, `closeStaleAgentRecords` rewrites persisted `running`/`initializing` to `closed` (`bootstrap.ts:1997`). (V)
- **Terminal agents:** `Stop`, `SessionEnd`, `StopFailure` → idle; `working → idle` records `finished` attention; a terminal that exits while working sends no turn-end notification. (D)

## 6. Permission and approval prompts

- Detection is structural for chat agents: Claude `canUseTool`, Codex `requestApproval`, OpenCode `permission.asked`, ACP `requestPermission`. Never parses screen text. (V)
- `AgentPermissionRequest{id, provider, name, kind tool|plan|question|mode|other, title?, description?, input?, detail?: ToolCallDetail, suggestions?, actions?, metadata?}` (`agent-sdk-types.ts:482`). `AgentPermissionResponse` = `{behavior:"allow", selectedActionId?, updatedInput?, updatedPermissions?}` | `{behavior:"deny", message?, interrupt?}` (`:496`).
- Answer path: provider emits `permission_requested` → manager stores it in `agent.pendingPermissions`, sets attention "permission" (`agent-manager.ts:4808`) → client gets WS `agent_permission_request` + push notification → user answers in app or CLI → `agent_permission_response{agentId, requestId, response}` (`messages.ts:2206`, `session.ts:2898`) → `AgentManager.respondToPermission` (`:3185`) → `session.respondToPermission` resolves the SDK/JSON-RPC promise (Claude `agent.ts:2859-2918`, Codex `:4677`). The answer returns through the SDK callback or RPC reply, not keystrokes. (V)
- Who can answer: the app, the CLI (`paseo permit allow/deny/ls`), other agents via MCP `respond_to_permission` (broken across hosts, #7820).
- Guards: double-submit guard (`inFlightPermissionResponses`); pending auto-denied on cancel and `turn_failed`; a steering message can auto-deny pending via `clearPendingPermissions` (#7602).
- Terminal agents: only coarse "needs-input" (Claude `Notification` with `notification_type=idle_prompt`, Codex `PermissionRequest`, OpenCode `permission.asked`); answered in the terminal.

## 7. Session identity and resume

- Own `agentId` (UUID), separate from the provider session id. Persisted `AgentPersistenceHandle{provider, sessionId, nativeHandle?, metadata?}` (`agent-sdk-types.ts:184`).
- Claude: session id from the first SDK message (`claude/agent.ts:4906`); if it changes mid-stream (`/clear`, hook-driven restart) Paseo accepts it, adds a notice "Claude switched to a new session: A -> B", emits a new `thread_started` (`:4937`, `:3241`). Codex: from `thread/started`.
- Resume: `AgentClient.resumeSession(handle)`; Claude passes `resume: sessionId` (`agent.ts:3593`). Stale resume invalidates the persisted session (`handleMissingResumedConversation`, `:4313`; #7502). Reload, idle collection and daemon restart all resume under the same agent id (`docs/agent-lifecycle.md`). External sessions can be imported (`listImportableSessions`, `importSession`). (V)

## 8. Transport and auth

- **Agent → daemon:** adapters run in-process and own the child process (stdio pipes; OpenCode local HTTP + SSE). Paseo tools reach agents through MCP at `/mcp/agents` with a per-run capability token (`auth.ts:106-140`). (V)
- **Terminal hook → daemon:** `POST http://127.0.0.1:<port>/api/terminal-activity` with `{terminalId, token, state}`; loopback-only, per-terminal token (`PASEO_ACTIVITY_TOKEN`), deliberately skips daemon password auth (`bootstrap.ts:308-345`, `:812`). Env injected into terminal shells: `PASEO_TERMINAL_ID`, `PASEO_ACTIVITY_TOKEN`, `PASEO_TERMINAL_ACTIVITY_URL`, `PASEO_HOOK_CLI`. (V)
- **Daemon → clients:** one WebSocket protocol (zod JSON + binary terminal frames). Handshake `hello{clientId, clientType mobile|browser|cli|mcp|hub, protocolVersion, auth?, capabilities}` (`messages.ts:7657`), `hello.rejected`, no data before admission (`websocket-server.ts:1665-1850`). Outbound: `agent_update`, `agent_stream` (event + seq + epoch), `agent_permission_request/resolved`.
- **Auth:** optional shared password (bcrypt or `PASEO_PASSWORD`); binds 127.0.0.1 by default (no password = anything reaching the socket controls it); per-run `$PASEO_HOME/local-credential` (0600); Host-header allowlist + CORS against DNS rebinding (V, `SECURITY.md`, `auth.ts`). Semantic grants, principals, pairing invitations in `server/authorization/` (D, `docs/permissions.md`).
- **Remote/mobile:** daemon connects outbound to a relay, E2E Noise NK over Curve25519 (legacy NaCl box fallback). Pairing QR/link `https://app.paseo.sh/#offer=<base64url>` with `{v:2, serverId, daemonPublicKeyB64, relay}` in the fragment (`connection-offer.ts:1-60`, V). Keypair `$PASEO_HOME/daemon-keypair.json` (0600).

## 9. Hook and config installation

- **Chat agents:** no global install. Claude configured per process via SDK options: `settingSources`, in-process `hooks`, merged `settings` (`disableAllHooks: true` for internal daemon agents), `mcpServers` (`claude/agent.ts:3573-3684`). User hooks preserved. (V)
- **Terminal agents:** global user config, opt-in only. Setting `enableTerminalAgentHooks` (documented default `false`, UI says "This installs hooks in your agent config files"). Targets `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`), `~/.codex/hooks.json` (or `CODEX_HOME`), `~/.config/opencode/plugins/paseo-terminal-activity.js`. Marker-based idempotent install (`hookMarker "hooks claude"`), atomic private writes (`agent-hook-installer.ts`); user hooks preserved, Paseo's removed on disable. Hooks stay after daemon shutdown but are inert outside a Paseo terminal: `[ -n "$PASEO_TERMINAL_ID" ] && "${PASEO_HOOK_CLI:-paseo}" hooks claude <event>`. Codex may show its own hook trust-review prompt. (Code V, default D.)

## 10. Persistence

- Source of truth for the conversation is the provider's own transcript. Daemon keeps an in-memory timeline (`InMemoryAgentTimelineStore`, `agent-timeline-store.ts:33`), rebuilt from provider history on resume (`docs/timeline-sync.md:8-12`). `durableTimelineStore` exists but `bootstrap.ts:996-1012` doesn't pass one → no daemon-side event log in production (inferred).
- Per-agent JSON record `$PASEO_HOME/agents/{sanitized-cwd}/{agentId}.json` (`lastStatus`, `config`, `runtimeInfo`, `persistence`, attention, `labels`, `archivedAt`; `docs/data-model.md:40-130`), written atomically on each `emitState`. (V)
- Timeline rows get per-agent `seq` and an `epoch` UUID (`AgentTimelineRow{seq,timestamp,item,turnId?,providerMessageId?}`); `agent_stream` carries seq/epoch for timeline events only (`messages.ts:4206`). (V)
- Late join / reconnect: `fetch_agent_timeline_request{direction tail|before|after, cursor{epoch,seq}, limit, projection}` → `epoch, reset, staleCursor, gap, window{minSeq,maxSeq,nextSeq}, hasOlder, hasNewer, rows`. Stale epoch or gap → `reset`. Live stream for immediacy, fetch authoritative; client pages `after` with 1–30 s backoff. Client cache IndexedDB / expo-sqlite. `timeline_replacement` invalidates caches.
- Directory state (agents/projects/workspaces): per-entity seq + generation, latest projection + bounded tombstones, full snapshot for stale cursors. Tool output cut to 64 KiB.
- Fallout: reload during a turn duplicates/truncates replies (#7917); Monitor notifications missing live (#7763); Pi compaction replay loses messages (#7706).

## 11. Message injection and steering

- `send_agent_message_request{agentId, text, messageId, activeTurnBehavior "interrupt"|"steer", images, attachments, sourceAgentId?}` (`messages.ts:1244`, `:1400`). Human default `interrupt`; agent-to-agent default `steer` via a batching delivery queue (`agent-messages/delivery.ts`) with `clearPendingPermissions: true` (`session.ts:8227-8330`).
- Dispatch (`agent-prompt.ts:25-120`, `agent-manager.ts:2880-3000`): out-of-band commands first (`tryHandleOutOfBand`); `steer` → `steerOrReplaceActiveTurn` (provider `steerActiveTurn(prompt,{expectedTurnId})` → `accepted`|`unavailable`, else replace); `interrupt` → `replaceAgentRun`; idle → `startTurn`. `expectedTurnId` guards; steer admission barrier (`runSteerAdmission`, `:3010`).
- Provider mechanics: Claude pushes `SDKUserMessage{priority:"next"}` into the live input (`agent.ts:2560-2590`), refuses steering for slash commands and while compacting, interrupt = `query.interrupt()` + withdraw unstarted messages (`:4382-4520`). Codex `turn/steer{threadId, expectedTurnId, input}` (`:4433`), `turn/interrupt` (`:5013`). ACP `cancel` + new `prompt`. OpenCode `session.abort` + `promptAsync`.
- No general daemon-side queue for human messages (client composer queue, `packages/app/src/composer/actions.ts:235-300`). Dedupe by `messageId`, echo `clientMessageId` (`reconcileSubmittedPromptEcho`, `agent-manager.ts:4960`).
- Open: #7059 (prompt at turn start sent immediately), #7920/#7846 (message during `/compact`), #7002 (Claude stays running after "aborted" error).
- Terminal agents: raw PTY keystrokes (`paseo terminal send-keys`).

## 12. Edge cases

- **Subagents:** first-class `provider_subagent` (`upsert{id, title, status, toolCallId, parentSubagentId}`, `timeline`, `remove`; `provider-subagents/store.ts`). Claude reads the task protocol (`claude/subagents/live-source.ts`); Codex maps child threads to a parent `sub_agent` tool call. Many open bugs about children stuck "running".
- **Compaction:** `compaction` timeline item; loading marker deduped (`compactionMarkerOpen`, `:4672`); steering refused while compacting (`:2568`). Issues #7118, #7147, #7706, #6855.
- **/clear:** root-only command (`CLAUDE_ROOT_ONLY_COMMANDS`, `agent.ts:411`); new session id accepted with a notice (`rebindConversationSession`, `:3241`).
- **Concurrency/worktrees:** no cap; `workspaceId` hierarchy; #7845 (archiving one agent fails others sharing a provider server), #7197 (removed worktree leaves dead cwd).
- **Daemon restart:** runtimes lost, `running` → `closed`, resume on next open; mid-turn state unrecoverable.
- **Client disconnect:** agents keep running; cursor-based reconcile; relay sessions resumable (`websocket-server.ts:1877`); presence decides push vs in-app (`PRESENCE_THRESHOLD_MS = 180_000`).
- **Turn attribution:** managed turn identity attached to events; terminal events for finalized turns dropped; stale Claude `result` after interrupt suppressed (`:4156`) — a lot of patching.
- Idle runtimes closed after 1 h (`idleRuntimeCleanup`). Plugins can observe `agent_stream` (`publishAgentStream`, `agent-manager.ts:5240`).

## 13. Weaknesses and open issues (titles only, ~300 open issues filtered)

- Status: #7460, #7095, #7019, #6890, #7586, #7501 (subagent/background status), #7636 (session-limit turn completes as a normal reply), #7002, #7070 (ACP prompts stay running after disconnect), #7078 (permission tab shows running after reload), #7202 (spawn failure stuck 60 s).
- Permissions: #7452, #7664, #7602, #7104.
- Sync: #7917, #7763, #7874, #7694, #7811.
- Interrupt: #7521, #7522 (background shells keep running).
- Reading (not project claims): idle detection relies on per-CLI-version heuristics; provider transcript as source of truth means rewind/compaction/clear change Paseo's view; terminal-agent support deliberately minimal and opt-in; long wire-compat tail (`COMPAT(...)`, `docs/protocol-compatibility.md`).

## Key files

- Types: `packages/server/src/server/agent/agent-sdk-types.ts`, `packages/protocol/src/messages.ts`, `packages/protocol/src/agent-lifecycle.ts`, `agent-state-bucket.ts`
- Manager: `packages/server/src/server/agent/agent-manager.ts`
- Timeline: `agent-timeline-store.ts`, `timeline-projection.ts`, `agent-stream-coalescer.ts`
- Providers: `packages/server/src/server/agent/providers/{claude/agent.ts, codex-app-server-agent.ts, opencode-agent.ts, acp-agent.ts, pi/agent.ts}`
- Terminal hooks: `packages/server/src/terminal/agent-hooks/`, `packages/cli/src/commands/hooks.ts`, `packages/server/src/server/bootstrap.ts:285-345`
- Docs: `docs/{architecture,agent-lifecycle,timeline-sync,terminal-activity,data-model,permissions}.md`, `SECURITY.md`
