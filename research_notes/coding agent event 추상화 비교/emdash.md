# emdash: how it abstracts events and state from coding agents

Source: https://github.com/generalaction/emdash at commit `e21cd3d84fd025546bdd4c4aef879336c7a91a20` (2026-10-23). Paths are relative to the repo root. **V** = verified in source. **D** = docs/comments only, or inferred. Research run 2026-10-26 (read only, nothing built or run).

## 1. What it is

- **Repo:** https://github.com/generalaction/emdash (Apache-2.0, ~6.1k stars, "Open-Source Agentic Development Environment, YC W26"). Chosen over the unrelated emdash CMS because AGENTS.md:1-5 describes "a local-first, cross-platform Electron app for running multiple AI coding agents in parallel... each task in its own Git worktree, local or over SSH" (V).
- **Stack (V):** TypeScript, Electron app (`apps/emdash-desktop`), pnpm/nx monorepo, SQLite via drizzle, zod contracts, React renderer. A remote daemon (`apps/workspace-server`) runs the same runtimes on an SSH host. RPC/state lib `@emdash/wire`.
- **Two planes, both keyed by `conversationId`:**
  1. **TUI/PTY plane.** Spawns the provider's CLI in a PTY. Status from hooks/plugins installed into the agent's config (`packages/core/src/runtimes/tui-agents/`).
  2. **ACP chat plane.** Agent Client Protocol (JSON-RPC over stdio). Status from session updates, permission requests and prompt stop reasons (`packages/core/src/runtimes/acp/`).
- **Providers:** 37 plugins (`agents/integrations/providers.md:10-16`, registry `packages/plugins/src/agents/registry.ts`): codex, claude, grok, devin, qwen, qoder, droid, antigravity, cursor, copilot, amp, commandcode, opencode, hermes, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, codebuddy, continue, codebuff, freebuff, mistral, muse, jules, junie, oh-my-pi, pi, prime-agent, autohand, letta, mimocode, zero. No `gemini` plugin (Google's is `antigravity`). 23 are ACP-capable.
- **First-class TUI status (V):** 25 providers declare a `hooks` capability: amp, antigravity, auggie, claude, codebuddy, codex, commandcode, copilot, cursor, devin, droid, goose, grok, kilocode, kimi, kiro, mimocode, mistral, muse, oh-my-pi, opencode, pi, prime-agent, qoder, qwen. The other 12 have none (autohand, charm, cline, codebuff, continue, freebuff, hermes, jules, junie, letta, rovo, zero); cline, hermes and junie still get status through ACP.

## 2. Signal sources

Docs policy: "Emdash does not infer agent status from terminal output" (providers.md:25-30, D). No PTY screen-pattern parsing for status (V). The only PTY escape handling is `packages/core/src/services/pty/api/terminal-capability-responder.ts` (answers terminal capability queries). No transcript tailing, no OSC-based status, no status polling.

| Source | Plane | Used for | Where (V) |
|---|---|---|---|
| Agent-native lifecycle hooks (shell commands in agent config) that `curl` a local HTTP endpoint | TUI | start/stop/error/notification/session id | `packages/core/src/services/agent-plugins/api/plugins/helpers/hooks.ts:12-41`; per-provider `impl/*/hooks.ts` |
| Agent-native plugin/extension files that `fetch()` the same endpoint | TUI (opencode, pi, oh-my-pi, prime-agent, amp, kilocode, mimocode) | same | `impl/opencode/plugin-file.ts:1-140`, `impl/pi/plugin-file.ts:37-70`, `impl/amp/plugin-file.ts:30-45` |
| Input heuristic: Enter (`\r`) written to the PTY, or an initial prompt at spawn, means "working" (only when no `start` hook) | TUI | working | `tui-agents/node/runtime/agent-state.ts:111-144`, `runtime.ts:407-419, 660-668` |
| PTY exit | TUI | reset to idle, one respawn, resume fallback | `runtime.ts:581-609` |
| ACP `session/update`, `session/request_permission`, `session/prompt` response (stopReason), process close | ACP | everything | `acp/node/agent-ports/agent-client.ts:47-91`, `acp/node/session/cell.ts:357-373, 545-590` |
| 250 ms silence timer for agent-initiated activity outside a user turn | ACP | settle `agentTurnActive` | `acp/node/session/cell.ts:645-657` |
| tmux activity listing | TUI restart reconcile | resume vs suspend | `runtime.ts:885-902, 1079-1090` |
| PTY in/out timestamps, 60 s "busy" window | TUI | idle eviction only | `runtime.ts:72, 898-901` |

- Claude TUI hooks installed: `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop` only (`impl/claude/hooks.ts:50-61`). No PreToolUse, PermissionRequest, SubagentStop or SessionEnd.
- Claude ACP: `@agentclientprotocol/claude-agent-acp` as a Node child using the host `claude` binary (`impl/claude/index.ts:146-157`). Codex ACP: `@agentclientprotocol/codex-acp`. Others use their CLI's native ACP mode.

## 3. Normalized model

No single event enum; layers with one shared status enum on top.

**3a. Hook layer** — `CanonicalHookEvent` (`packages/core/src/services/agent-plugins/api/plugins/capabilities/hooks-types.ts:1-44`, V):
```ts
HOOK_EVENTS = ['notification','stop','session','start','tool-use','tool-use-failure']  // capability labels only
NotificationType = 'permission_prompt'|'idle_prompt'|'auth_success'|'elicitation_dialog'
CanonicalHookEvent =
  | { kind:'status'; type:'start'|'stop'|'error'|'notification'; notificationType?; title?; message?; lastAssistantMessage?; providerSessionId? }
  | { kind:'session'; providerSessionId:string }
  | { kind:'ignore' }
```
Wire form: headers `X-Emdash-Event-Type`, `X-Emdash-Pty-Id`, `X-Emdash-Token` + raw JSON body. `tool-use` is ignored by the default parser.

**3b. TUI runtime state** (LiveModel; `packages/core/src/runtimes/tui-agents/api/schemas.ts:106-152`, `:75-98`, V):
```ts
TuiAgentStateStatus = 'idle'|'working'|'awaiting-input'|'error'|'completed'
TuiAgentState = { conversationId, providerId?, status, source?:'hook'|'input', notificationType?, title?, message?, lastAssistantMessage?, updatedAt }
TuiSessionState = { conversationId, providerId?, cwd?, sessionId:string|null, status:'starting'|'running'|'exited', pid?, cols, rows,
                    resume:{requested,outcome:'pending'|'resumed'|'fresh-fallback',reason?}|null, startedAt, lastInputAt?, lastOutputAt?, exit? }
```
Reducer `TuiAgentStates.applyCanonicalEvent` (`agent-state.ts:45-109`): start → working, stop → completed, error → error; notification → `awaiting-input` for permission_prompt / idle_prompt / elicitation_dialog (`agent-state.ts:12-16`), else `idle`. Published as a wire `Cell` with diffs (`state/live-models.ts:22-40`, `api/contract.ts:102-118`).

**3c. App-wide event/status** — both planes converge (`apps/emdash-desktop/src/core/primitives/agents/api/agent-events.ts:1-42`, V):
```ts
AgentEventType = 'notification'|'stop'|'error'|'start'
AgentStatus    = 'idle'|'working'|'awaiting-input'|'error'|'completed'
AgentEvent = { type, source?:'hook'|'input', ptyId?, providerId?, projectId, taskId, conversationId, timestamp,
               payload:{ notificationType?, title?, message?, lastAssistantMessage? } }
AgentStatusSignal = Omit<AgentEvent,'projectId'|'taskId'>
```
`AgentStatusService.deriveAgentStatus` (`apps/emdash-desktop/src/main/core/agent-status/agent-status-service.ts:45-55`): start → working, stop → completed, error → error, attention notification → awaiting-input; other notifications no change. Writes `conversations.agent_status`, `agent_status_seen` in SQLite (`:90-109`; schema `core/services/app-db/node/schema.ts:426-428`).

**3d. ACP plane** (`packages/core/src/runtimes/acp/api/models/session.ts:17-73`, V): `SessionLifecycle = starting|replaying|ready|working|cancelling|closed`; `SessionState`/`SessionSummary` carry `isGenerating`, `lastStopReason`, `lastTurnErrored`, `pendingPermissions`/`pendingPermissionCount`, `queuedPrompts`, `agentTurnActive`, `backgroundAgentCount`, `canSubmit`, `canCancel`. Stop reasons `end_turn|max_tokens|max_turn_requests|refusal|cancelled`. Pure state machine `acp/node/machine/machine.ts` (`SessionPhase`, `Command`, `DomainEvent`, `Effect`, `decide`, `evolve`). Transcript content normalized into `NormalizedEvent` (`packages/core/src/primitives/acp-transcript/api/normalized-event.ts:38-154`).

ACP state is projected down to `AgentStatusSignal` by `apps/emdash-desktop/src/main/core/acp/agent-status-transition.ts:1-98`; ACP-derived signals are stamped `source:'input'` (line 14), so `source` is not reliable provenance.

## 4. Per-agent mapping

Default parser `defaultHookEventParser` (`helpers/parse-hook-event.ts:46-82`, V): `session`/`session-start` → `session` if body has `session_id|provider_session_id|providerSessionId|sessionId`; `start|stop|error` → status (with `last_assistant_message`, `title`, `message`); `notification` → status only for the 4 known types; else ignore. Pipeline `tui-agents/node/hooks/hook-pipeline.ts:1-67`: conversation by `X-Emdash-Pty-Id` → provider → parse → validate session id → apply.

| Provider | native hook/event → emdash type |
|---|---|
| Claude (`claude/hooks.ts:50-61`) | SessionStart→`session-start`; UserPromptSubmit→`start`; Notification→`notification`; Stop→`stop`. Notification has no type: `/permission\|approval/i` on `message` → `permission_prompt`, else `idle_prompt` (L36-48). Every status event carries `session_id` (L23-34). |
| Codex (`codex/hooks.ts`, `config.toml [hooks]`) | Stop→`notification {idle_prompt}` (parsed to `stop`); PermissionRequest→`notification {permission_prompt}`; SessionStart→`session-start`. No start hook. |
| Copilot | agentStop→stop; sessionStart→session; permissionRequest→notification(permission_prompt) |
| Cursor (`cursor/hooks.ts:60-93`) | sessionStart→session-start; beforeSubmitPrompt→start; stop→stop (`status:'error'` → error). Commands print `{continue:true}`/`{}` so Cursor doesn't treat curl output as a decision. |
| Qoder | SessionStart→session; UserPromptSubmit, PreToolUse→start; PostToolUse→tool-use; PostToolUseFailure, StopFailure→error; PermissionRequest, Notification→notification; Stop, SessionEnd→stop |
| Goose | SessionStart→session; UserPromptSubmit, PreToolUse→start; PostToolUse→tool-use; PostToolUseFailure→error; Stop, SessionEnd→stop |
| Grok | SessionStart→session; UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure→start; Notification→notification; Stop, StopFailure, SessionEnd→stop |
| Kimi | SessionStart→session; UserPromptSubmit, PostToolUse, PostToolUseFailure→start; Notification→notification; Stop, StopFailure, SessionEnd→stop |
| CodeBuddy | SessionStart→session; UserPromptSubmit, PreToolUse→start; PostToolUseFailure, StopFailure→error; PermissionRequest, Notification→notification; Stop→stop |
| Auggie | SessionStart→session; PromptSubmit, PreToolUse, PostToolUse→start; Stop, SessionEnd→stop; Notification→notification |
| Droid | UserPromptSubmit→start; Notification→notification; Stop→stop; SessionStart→session |
| Qwen | SessionStart→session; PermissionRequest→notification; Stop, SessionEnd→stop |
| Devin | Stop, SessionEnd→stop; PermissionRequest→notification(permission_prompt) |
| Kiro (`kiro/hooks.ts:18-22`) | agentSpawn→session; userPromptSubmit, preToolUse, postToolUse→start; stop→stop |
| Muse | SessionStart→session-start; UserPromptSubmit→start; Stop→stop |
| Command Code | Stop→session AND Stop→stop |
| Antigravity (`antigravity/hooks.ts:15-28`) | PreInvocation→start; Stop→stop |
| OpenCode plugin (`opencode/plugin-file.ts:90-130`) | `session.status` busy/retry or `session.execution.started`→start; `session.error`/`execution.failed`→error; `session.status` idle, `session.idle`, `execution.succeeded`→stop (deduped via `settledSessions`); `execution.interrupted`→notification; `session.*` also posts `session` with the `ses…` id |
| Kilocode, MiMoCode plugins | `session.idle`→notification(idle_prompt); `session.error`→error; session id from `session.*` |
| Pi (`pi/plugin-file.ts:37-70`) | session_start→session (session file path); agent_end→stop; session_shutdown(quit)→stop; uncaught errors→error |
| Oh-My-Pi, Prime Agent | same Pi extension API (Prime also `agent_start`→start) |
| Amp (`amp/plugin-file.ts:30-45`) | session.start→session; agent.start→start; agent.end→stop |

Declaring `start` in `supportedEvents` switches off the Enter heuristic (`runtime.ts:819-858`, `agent-state.ts:119-123`).

**ACP → status** (`main/core/acp/agent-status-transition.ts`, V): `pendingPermissionCount>0` → `notification(permission_prompt)` → awaiting-input; busy w/o pending and not `cancelling` → `start` → working; busy→not busy w/o pending: `lastTurnErrored` → error, `lastStopReason==='cancelled'` → idle, other stop reason → stop (completed); lifecycle `closed`/removed → idle.

ACP transcript: baseline normalizer + per-provider `enrich` (`claude/acp-transform.ts` promotes `_meta.claudeCode.parentToolUseId`, turns `Agent` tool into `subagent` events, parses task-notification envelopes; `codex/acp-enrich.ts`).

## 5. Turn end vs session end

**TUI (V):** turn start = `start` hook → working (or Enter / initial prompt, `source:'input'`). Turn end = `stop` → `completed` (+ `lastAssistantMessage`). Many providers map Stop and SessionEnd both to `stop`, conflating turn and session end. Non-attention notification → `idle`; `resetToIdle` on PTY exit/stop/kill (`runtime.ts:379, 600`). PTY exit → session exited; unexpected non-zero exit gets one respawn resuming the captured session id (`runtime.ts:1001-1040`); a resume that exits within 3 s falls back to fresh (`runtime.ts:69, 584-598`). Inferred: Esc-interrupting Claude may not fire `Stop` (stays working); Claude's later idle `Notification` could flip `completed` to `awaiting-input` via the regex.

**ACP (V):** turn = one `session/prompt` call, ends when `agent.prompt()` resolves with a stopReason or throws (`cell.ts:571-586`) → `settleTurn` → `TurnEnded` (`cell.ts:411-418`, `machine.ts:269-296`). Cancel → `cancelling` until the call returns `cancelled`. Session end = `ProcessClosed` → `closed`, pending permissions cancelled (`machine.ts:364-379`). Busy is wider than a turn: `isGenerating = working|cancelling || agentTurnActive || backgroundAgentCount>0` (`machine.ts:408-427`); background subagents gate queued prompts (`machine.ts:269-277, 313-322`). Agent-initiated updates while idle set `agentTurnActive`, settled by the 250 ms timer (`cell.ts:234, 645-657`).

Design-doc discrepancy (V): `CONTEXT.md` says session quiescence is never inferred from a short silence timer; `cell.ts:645-657` is exactly that.

## 6. Permission / approval prompts

- **TUI:** detection only via provider hooks (Claude message regex; Codex/Copilot/Devin/Qoder/CodeBuddy/Qwen `PermissionRequest`) → `awaiting-input` + `notificationType=permission_prompt` (`idle_prompt` also maps to awaiting-input). Providers without a permission hook produce nothing (Cursor, Kiro, Goose, Grok, Pi, Amp, Droid…). **Answered only in the terminal**; emdash shows a sidebar badge and an OS notification "Your agent is waiting for input" with sound (`apps/emdash-desktop/src/core/services/notifications/node/producers/agent-status-mapping.ts:36-58`, deep-linked).
- **ACP:** fully interactive. `AgentClient.requestPermission` → `SessionCell.requestPermission` (`cell.ts:357-373`) → `AcpPermissionRequest{requestId, toolCall, options[{optionId,name,kind}]}` → `PermissionBroker` holds the JSON-RPC promise until `settle(requestId, optionId)` (`node/session/permission-broker.ts:1-36`). Renderer `PermissionBand` above the composer (`packages/ui/src/react/components/chat-composer/permission-band.tsx`). Never auto-selects; pending cancelled on cancel/close/dispose. TUI auto-approve is a launch flag (Claude `--dangerously-skip-permissions`, `claude/index.ts:166-174`).

## 7. Session identity

- `conversationId` (emdash UUID) is the PTY key, hook routing key (`EMDASH_PTY_ID`), DB key and ACP key. Provider session id is "a last-observed pointer, not its identity" (`CONTEXT.md`, D).
- TUI capture: any hook payload with a session id updates `TuiSessionState.sessionId` (`agent-state.ts:49-59, 146-155`) and persists the intent (`runtime.ts:126-138`). Claude gets `--session-id <conversationId>` on fresh start (`standard-command.ts:114-115`). Per-provider `validateSessionId` (`hook-pipeline.ts:37-47`).
- TUI resume: `--resume <id>` (`helpers/standard-command.ts:77-119`); missing id → fresh spawn reported `fresh-fallback` (`runtime.ts:338-352`).
- ACP: `session/load` if supported, else `session/new` (`acp/node/runtime/session-materializer.ts:93-190`).

## 8. Transport + auth (TUI hooks)

V, `packages/core/src/runtimes/tui-agents/node/hooks/hook-server.ts:1-95`:
- One `http.createServer` per runtime/host, `listen(0,'127.0.0.1')` (L66); only `POST /hook`; body ~1 MB cap.
- Random `crypto.randomUUID()` token per server start (L21), required in `X-Emdash-Token` else 403 (L28-33); `X-Emdash-Pty-Id` and `X-Emdash-Event-Type` required.
- Env injected into the PTY (`runtime.ts:850-859`): `EMDASH_HOOK_PORT`, `EMDASH_PTY_ID` (= conversationId), `EMDASH_HOOK_NONCE`, `EMDASH_HOOK_TOKEN`.
- POSIX hook command (`helpers/hooks.ts:12-41`): version marker; `if [ -z "${EMDASH_HOOK_PORT:-}" ] || ... ; then exit 0; fi`; `curl -sf -X POST -H ... -d @- http://127.0.0.1:$EMDASH_HOOK_PORT/hook || true`. Windows: encoded PowerShell (L43-83). Plugin files use `fetch`.
- SSH: runtime and hook server run in the remote workspace-server on loopback; desktop observes over the wire (`main/core/agent-status/tui-agent-status-bridge.ts`).
- Reading: the token only stops other local processes guessing the port; any process with the agent's env can post.

## 9. Hook installation

- User-global, not per worktree (providers.md:44-48; `packages/core/src/services/agent-plugins/node/hook-installer.ts:105-113`). Older versions wrote into worktrees (#1944, closed); Windows stray `NUL` file (#3011, closed).
- Roots: Claude `$CLAUDE_CONFIG_DIR` or `~/.claude/settings.json`; Codex `$CODEX_HOME` or `~/.codex/config.toml`; Cursor `~/.cursor/hooks.json`; Copilot `$COPILOT_HOME/hooks/emdash.json`; Antigravity `~/.gemini/config/plugins/emdash/`; OpenCode under XDG config.
- Lazily at first session spawn (`runtime.ts:815-860` → `ensureHooksInstalled`, `hook-installer.ts:54-83`): check, per-root lock, recheck, write if missing/stale, memoize. Version marker `EMDASH_HOOK_CONFIG_VERSION=1` in each command.
- Preserving user config: read-modify-write; emdash entries found by substring `EMDASH_HOOK_PORT` (`filterUserHooks`, `hooks.ts:15-19`), removed and re-added (`hook-config.ts:109-128, 213-225`). Unparseable JSON/TOML throws and leaves the file untouched (`hook-config.ts:10-88`); session still starts. Codex: keeps `[hooks.state]`, migrates legacy `hooks.json` and `notify =`.
- **No consent prompt**, no opt-out setting found (#1944 asked; closed). Agent-details UI shows read-only `installed`/`pending-install`.
- **Uninstall:** `deleteHooks` exists per behavior (`hook-config.ts:170, 226, 275, 327`) but nothing outside `impl/` and tests calls it.

## 10. Persistence

- No event log; latest derived state only. In-memory `agentStates` Cell (LiveModel, diffs) is the source of truth; SQLite `conversations.agent_status`/`agent_status_seen` is a "device-local cache" (`agent-status-service.ts:92-93`).
- Late-joining UI: LiveModels give snapshot then diffs. The desktop bridge treats the first snapshot as `bootstrap` (`cacheSignal`, no notifications, preserves "seen"), then resets active DB rows not on the host (`tui-agent-status-bridge.ts:156-176, 228-245`; ACP `main/core/acp/agent-status-bridge.ts:143-168`). PTY output is a `LiveLogSource` ring buffer (1 MiB) with byte offsets.
- Restart: `resetStaleTuiAgentStatuses`/`resetStaleAcpAgentStatuses` set `working|awaiting-input` → `idle`. TUI intents (last provider session id, `lastAgentState`) persisted (`runtime.ts:246-259`); `restore()` demotes input-sourced `working` to idle ("durable lie", `agent-state.ts:171-183`). Only sessions whose tmux session is alive revive; else suspended `process-lost`.
- ACP: per-conversation intent (provider session pointer, cwd, desired config, presentation snapshot); history from provider `session/load`, not an emdash transcript DB.

## 11. Message injection

- **TUI:** `sendInput(conversationId, data)` writes raw bytes to the PTY with no idle or queue gating (`runtime.ts:407-419`). The context bar uses `pastePromptInjection` + optional `'\r'` (`features/tasks/contributions/browser/context-bar.tsx:60-90`); bracketed paste when forced or multiline non-Claude text (`primitives/prompt-injection/api/prompt-injection.ts:1-12`). Initial prompt capability `argv(flag)|stdin-pipe|pty-only|none` (`capabilities/prompt.ts`), long prompts spilled to a file (`runtime/prompt-spill.ts`).
- **ACP:** `sendPrompt` RPC; if `working`/`cancelling`, `agentTurnActive`, or background agents running → queued in the machine, auto-dequeued after settle (`machine.ts:118-131, 394-402`); editable/reorderable queue; idle → `session/prompt` content blocks incl. `<emdash-hidden-context>` (`cell.ts:545-570`). Queue not durable across worker restart.

## 12. Edge cases

- Subagents: TUI installs no SubagentStop for Claude (Muse test ignores `SubagentStop`). ACP: first-class `subagent` events, `background` flag, `backgroundAgentCount` keeps the session generating.
- Compaction and /clear: no explicit handling; a new session id on any hook just replaces the stored one (`agent-state.ts:146-155`); Claude SessionStart `source` ignored.
- Concurrency: keyed by `conversationId`; one hook server per host; `KeyedMutex` launch lock and generation counters (`runtime.ts:736-744`); ACP shares one provider process per (provider, cwd, env fingerprint); `AgentStatusService.enqueue` serializes DB updates.
- Unknown conversation/provider hooks are logged and dropped (`hook-pipeline.ts:11-27`).

## 13. Weaknesses and issues

Verified in source:
1. Docs say no inferred status, but hookless providers and providers without a `start` hook use the Enter heuristic (`agent-state.ts:111-126`; `runtime.ts:407-419, 818-822`), and the UI doesn't gate on `source`. Answering a permission prompt with Enter re-asserts `working`. Related closed issues #1401, #2436.
2. Claude TUI has no permission-specific hook; regex on Notification text; other Notifications become `idle_prompt` → awaiting-input even after `completed`.
3. `stop` conflates turn end and session end for many providers.
4. `HOOK_EVENTS` lists `tool-use`/`tool-use-failure` but the default parser ignores them.
5. `deleteHooks` has no callers; no uninstall/consent flow; no opt-out.
6. ACP-derived signals tagged `source:'input'`.
7. `error` status gets no OS notification (`agent-status-mapping.ts:36-58`).
8. Hook formats drift per provider (OpenCode v2 broke the v1 plugin API, #3220; Codex legacy-notify migration, `codex/hooks.ts:26-67`).
9. `CONTEXT.md` ahead of code (silence-timer claim vs `cell.ts:645-657`).

Issue tracker (closed, relevant): #3220, #2770 (SSH PTY status), #2436, #1401 (stuck spinners), #3011, #1944, #1488, #707, #531. No open issue title matched status/hook/notification; nearest open #1671.

## Key files

- `packages/core/src/runtimes/tui-agents/`: `api/schemas.ts`, `api/contract.ts`, `node/runtime/runtime.ts`, `node/runtime/agent-state.ts`, `node/hooks/hook-server.ts`, `node/hooks/hook-pipeline.ts`
- `packages/core/src/services/agent-plugins/`: `api/plugins/capabilities/hooks-types.ts`, `api/plugins/helpers/{hooks,hook-config,parse-hook-event,standard-command}.ts`, `node/hook-installer.ts`
- `packages/plugins/src/agents/impl/<provider>/{index,hooks,plugin-file}.ts`
- `packages/core/src/runtimes/acp/`: `api/models`, `node/machine/machine.ts`, `node/session/{cell,permission-broker}.ts`, `node/runtime/session-materializer.ts`
- `apps/emdash-desktop/src/main/core/{agent-status,acp}/`, `apps/emdash-desktop/src/core/services/notifications/node/producers/`, `apps/emdash-desktop/src/core/primitives/agents/api/agent-events.ts`
- Docs: `agents/integrations/providers.md`, `agents/architecture/acp-runtime.md`, `CONTEXT.md`
