# herdr: how it abstracts events and state from coding agents

Source: https://github.com/herdrdev/herdr at commit `5608de0608918aba2f9d501e7793b984a0ca9cfa` (2026-10-24, v0.9.5). Paths below are relative to that repo root. "V" = verified in source. "D" = docs only / inferred. Research run 2026-10-26.

## 1. What it is

- **herdr** = "terminal workspace manager for AI coding agents" / "the runtime your coding agents live on" (Cargo.toml:5, GH description). Terminal multiplexer (workspaces/tabs/panes, detach/reattach, SSH remote) that recognizes which pane runs an agent and tracks `idle/working/blocked/done`.
- Canonical repo: https://github.com/herdrdev/herdr (ogulcancelik/herdr redirects to it; `gh repo view` confirms same repo, Apache-2.0, ~45.9k stars). Several blog posts disagree on license/owner; Cargo.toml:6 says Apache-2.0. No other project of that name orchestrating agents was found.
- Commit: `5608de0608918aba2f9d501e7793b984a0ca9cfa` (2026-10-24), version 0.9.5 (Cargo.toml:3). ~330k lines Rust (incl. tests).
- Stack: Rust, tokio, ratatui-style TUI, `portable-pty`, vendored libghostty-vt (`crates/ghostty-vt`) as the terminal emulator, own client/server split (server owns PTYs, TUI is a client). Hook scripts are bash+python3 (Unix) / PowerShell (Windows); some agents get JS/TS plugins.
- Supported agents (24; src/detect/mod.rs:51-76 `enum Agent`): pi, claude, codex, gemini, cursor, devin, antigravity(agy), cline, omp, mastracode, opencode, github-copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qwen, letta, maki, muse. 22 have screen manifests (mod.rs:79-102 `SCREEN_MANIFEST_AGENTS`; omp and mastracode do not).
- Design principle (AGENTS.md "Principles"): "Detection is decoupled. The detector reads a screen snapshot, never touches the parser or viewport state." (V)

## 2. Signal sources (every one)

herdr has **two independent signal families** that are arbitrated per terminal: (A) screen/process detection (default, works with zero setup), and (B) agent-reported state/session over a local socket API ("hook authority").

| # | Source | What it yields | Where (V) |
|---|---|---|---|
| 1 | **Foreground process probing**: foreground process group of the pane's PTY, matched by process name/argv0/wrapper argv (node/bun/python/sh -c scripts) to the `Agent` enum. Env `HERDR_AGENT=<agent>` overrides for wrappers. Ticks every 300 ms (identified) / 500 ms (unidentified) / 50 ms (pending release). Re-probe 5 s when identified, fast acquisition window 1.5 s/500 ms, 8 s window. | agent identity (which agent), process exit, ctrl-z background job (AgentJobTracker) | src/pane.rs:2848-3120, 384-420; src/detect/mod.rs:197-250, 381-470; src/pane/background_agent.rs:1-40; docs agents.mdx:70 |
| 2 | **Screen scraping of the live bottom buffer** (not the user's scrolled viewport): a text snapshot of the ghostty terminal core is matched against per-agent TOML "manifest" rules with regions, priorities, `contains`/`regex`/`line_regex`, nested `all/any/not` gates. Outputs `state` + flags `visible_idle/visible_blocker/visible_working/skip_state_update`. | `AgentDetection` | src/detect/manifest.rs:136-190 (schema), src/detect/manifests/*.toml, src/pane.rs:3170-3260 |
| 3 | **OSC 0/2 terminal title** (spinner glyphs, "Action Required") and **OSC 9;4 progress** retained per pane, fed to the same manifest engine as rule regions `osc_title` / `osc_progress`. | working/idle/blocked evidence | src/pane/osc.rs:485-560; src/pane/terminal.rs:619-630,1329-1351; claude.toml:7-14,229-242; codex.toml:7-27 |
| 4 | **Hooks / plugins that call herdr's socket API** (`pane.report_agent`, `pane.report_agent_session`, `pane.release_agent`, `pane.report_metadata`, `pane.clear_agent_authority`). Per-agent hook is a shell+python3 script, a JS plugin (opencode, kilo, hermes py), or a TS extension (pi, omp). | session id (all officially integrated agents); lifecycle state (only 6: pi, omp, opencode, kilo, kimi, mastracode) | src/integration/assets/*; src/detect/mod.rs:330-350 |
| 5 | **Self-reported custom agents**: any program can call `herdr pane report-agent ...` (CLI) or the socket directly with `--source custom:x`. Includes optional `resume_argv`. | state + resume cmd + release | docs add-herdr-support.mdx:17-110; src/api/schema/panes.rs:405-444 |
| 6 | **PTY child exit** (`AppEvent::PaneDied`) and "pane back at idle shell prompt" check (1 s recheck) as a safety net clearing self-reported agents | process exit / release | src/events.rs:80-83,131-135; src/pane.rs:384,400 |
| 7 | **OSC 7 cwd / BEL / OSC 52** events (not agent state, but surfaced) | cwd, bell, clipboard | src/events.rs:176-187 |
| 8 | **User focus/seen tracking** (derives `done`) | `seen` bool per pane | src/pane/state.rs:6-12; src/app/actions.rs:1844-1848 |

NOT used (V by absence in docs/code surveyed): no transcript/JSONL tailing (the transcript path is received from Claude's hook but ignored, see 7), no JSON-stream/SDK/ACP mode, no HTTP. herdr only wraps the **interactive TUI** in a PTY. Pi's hook explicitly refuses non-TUI modes (`ctx.mode !== "tui"`, src/integration/assets/pi/herdr-agent-state.ts:229-233).

Important historical finding (V, CHANGELOG.md:712, 11, 684): herdr **used to** register state hooks for Claude Code (PreToolUse/PostToolUse/PermissionRequest/Stop/SessionEnd/Subagent*), then **removed them**. Claude, Codex, Copilot, Droid, Kimi (earlier; Kimi >=0.14 later re-added full lifecycle), Qoder integrations now report **session identity only**; state comes from screen detection. The installer still carries a `HOOK_REMOVALS` table that strips the old hook entries during upgrade (src/integration/claude_settings.rs:26-59). Stated reason in docs: hooks "do not cover every lifecycle transition" (integrations.mdx:152,180,238; CHANGELOG.md:618 "Devin hooks do not cover every permission cancellation and user interrupt transition"). Codex: "no longer installs Codex turn hooks ... a clamping Interrupt hook timeout warning" (CHANGELOG.md:11).

## 3. Normalized model

There is **one common schema across agents**; per-agent specifics live only in (a) the manifest rules and (b) the hook scripts. Layers:

1. `detect::AgentState` (src/detect/mod.rs:9-19, V): `Idle | Working | Blocked | Unknown`. Doc comments: Idle = "Agent finished, prompt visible"; Working = "actively working"; Blocked = "needs human input"; Unknown = "plain shell or unrecognized program".
2. `detect::AgentDetection` (mod.rs:22-38, V): `{state, skip_state_update, visible_idle, visible_blocker, visible_working}`. `skip_state_update` = agent-owned transcript/history viewer on screen (state frozen).
3. API enums (src/api/schema/common.rs:235-257, V):
   - `PaneAgentState {Idle, Working, Blocked, Unknown}` = what a reporter may send.
   - `AgentStatus {Idle, Working, Blocked, Done, Unknown}` = what the API/UI exposes. **`Done` is derived**, not reported: `pane_agent_status(state, seen)` maps `(Idle, seen=false) -> Done` (src/app/api_helpers.rs:98-107).
4. `HookAuthority` (src/terminal/state.rs:18-26, V): `{source, agent_label, state, message, reported_at, session_ref}`; this is the stored form of an agent-reported state.
5. `AgentSessionRef {kind: Id|Path, value}` (src/agent_resume.rs:11-21, V) and `PersistedAgentSession {source, agent, session_ref}` (agent_resume.rs:~90-96).
6. Internal event channel `AppEvent` (src/events.rs:76-220, V) with agent-relevant variants:
   - `AgentProcessDetected{pane_id, agent, observed_at}`
   - `StateChanged{pane_id, agent: Option<Agent>, state, visible_blocker, visible_working, process_exited, observed_at}` (screen/fallback)
   - `HookStateReported{pane_id, source, agent_label, state, message, seq, session_ref}`
   - `AgentSessionReported{..., session_ref, session_start_source}`
   - `AgentResumeReported{..., argv}`
   - `HookMetadataReported{... title, display_agent, state_labels, ttl ...}` (display only)
   - `HookAuthorityCleared`, `HookAgentReleased`, `ReportedAgentShellReturned`, `PaneDied`
7. Public API events (src/api/schema/events.rs): `pane.agent_detected`, `pane.agent_status_changed {pane_id, workspace_id, agent_status, agent, ...}`, `pane.exited`, `pane.output_matched`, ... plus a retained ring in `EventHub` (MAX_EVENTS = 512; src/api/event_hub.rs:14).
8. The result of arbitration is `TerminalState {state, hook_authority, fallback_state, detected_agent, persisted_agent_session, ...}` (src/terminal/state.rs:129-166). `TerminalState` is "pure state for a server-owned terminal"; `PaneState` is viewport only (`seen`). There is no event log as source of truth: the current-state struct is.

Note the model has **no "turn" or "session end" event type**: only a level-triggered 4-value state + session identity + release. Completion is a transition `Working|Blocked -> Idle` (src/app/actions.rs:22-29).

## 4. Per-agent mapping

### 4a. Screen-manifest agents (state authority for 18 of 24)
Manifest format (V, src/detect/manifest.rs:136-190): `[[rules]] id, state(idle|working|blocked|unknown), priority, region, visible_{idle,blocker,working}, skip_state_update, contains, regex, line_regex, all/any/not`. Highest priority match wins; if none matches a known agent -> Idle with reason `default_known_agent_idle_fallback` (docs agents.mdx:76). Engine version `MANIFEST_ENGINE_VERSION = 3` (manifest_update.rs:13). Limits: 128 rules, gate depth 8, etc. (manifest.rs:~228-234).

Claude manifest (src/detect/manifests/claude.toml, V) - rule id: state @ priority, evidence:
- `osc_title_working` working@1100: OSC title begins with braille spinner or half-circle glyph (line 7-14)
- `transcript_viewer` unknown (skip update)@1000: "showing detailed transcript" + hints (65-77)
- `live_blocked_form` blocked@980: after last horizontal rule `esc to cancel` + (`enter to confirm` | `enter to select` + navigation hint) (80-95); also named-session variant (97-107), `dynamic_workflow_prompt`, `mcp_elicitation_prompt` (Accept/Decline)
- `live_turn_working` working@970: `esc to interrupt` footer or `<spinner glyph> Verb…  (12s` line in bottom 12 non-empty lines (16-25)
- `background_agents_working`/`background_mcp_task_working` working@965 (27-51)
- `live_prompt_box` idle@950: `❯` in prompt box body, not a selection menu (136-149)
- `bash_permission_prompt` blocked@850 / `generic_permission_prompt` blocked@840: "do you want to proceed?" + numbered Yes/No options (163-207)
- `legacy_no_prompt_blocker` blocked@300 (209-227), `osc_title_idle` idle@250 (`✳ ` title), `osc_progress_idle` idle@250 (`4;0`) (229-242)

Codex manifest (codex.toml, V): `osc_title_blocked` ("Action Required")@1100, `osc_title_working` (braille spinner in title)@1050, `trust_directory` blocked, `startup_update` blocked, `live_strong_blocker` ("allow command?", "enter to submit answer", ...) blocked@900, `weak_blocker` ([y/n], "do you want to ...yes") blocked@600, `screen_working_fallback` working@500 (`(12s • esc to interrupt)` timer line), `osc_title_idle`...

Other manifests exist for: amp, antigravity, cline, cursor, devin, droid, gemini, github-copilot, grok, hermes, kilo, kimi, kiro, letta, maki, muse, opencode, pi, qodercli, qwen (src/detect/manifests/). Manifests are **auto-updated from the internet**: bundled in the binary, but herdr fetches `https://herdr.dev/agent-detection/index.toml` with curl, max 256 KiB, applies per-agent updates without restart; local override dir wins; `[update] manifest_check = false` disables (manifest_update.rs:13-16, 511-552; docs agents.mdx:84-98). Debug tools: `herdr agent explain` shows matched rule, evaluated rules, region previews; `pane read --source detection` shows exactly the text the engine sees.

Debounce (V, src/pane/agent_detection.rs:3-40, 282-340): a plain `Working -> Idle` flip with no visible-idle/blocked evidence is held and rechecked every 100 ms, published only after 3 consecutive confirmations or 700 ms cap. A 3 s `AGENT_STARTUP_GRACE_WINDOW` suppresses state after a new agent process is found (pane.rs:3135-3150).

### 4b. Hook-reported lifecycle (only these, "full lifecycle hook authority": src/detect/mod.rs:330-340)
`herdr:pi, herdr:omp, herdr:mastracode, herdr:opencode, herdr:kilo, herdr:kimi`. While live these **skip screen detection entirely** (pane.rs:3165-3170 `if lifecycle_authority_active ... continue`) and a visible blocker on screen does NOT override them (state.rs:2078-2089).

**Pi** (src/integration/assets/pi/herdr-agent-state.ts, V): events -> state
- `session_start` (TUI mode only) -> report session (`pane.report_agent_session`), recompute from `ctx.isIdle()`
- `agent_start` -> working; `agent_settled` (only if `ctx.isIdle()`) -> idle
- custom event `herdr:blocked {active,label}` -> blocked while counter > 0 (lines 211-227)
- desiredState: blocked if blockedCount>0 > working if agentActive > idle (lines ~192-205)
- seq = monotonic `Date.now()*1000+n`; latest-wins queue (no backlog), 500 ms then 1500 ms socket attempts

**OMP** (assets/omp/herdr-agent-state.ts): `session_start`, `session_switch`, `agent_start`, `tool_approval_requested`->blocked, `tool_approval_resolved`->working, `tool_execution_start/end`, `agent_end`, `session_shutdown` (lines 363-466).

**OpenCode** (assets/opencode/herdr-agent-state.js, V lines 9-23, 150-211): 
| native event | state |
|---|---|
| `chat.message` hook | working |
| `session.status` {idle} | idle |
| `session.status` {active, busy, pending, retry, running, streaming, working} | working |
| `tool.execute.before/after`, `permission.replied`, `question.replied`, `question.rejected`, `session.compacted` | working |
| `permission.asked`, `question.asked`, `session.error` | blocked |
| `session.idle` | idle |
| `session.created/updated/deleted` | session identity only (not idle signal; CHANGELOG.md:743) |
Child sessions (parentID) only forward `permission/question.asked/replied` to the root session. A separate pane-local TUI plugin (`herdr-tui-session.js`) owns lifecycle for OpenCode V1/V2 TUI.

**Kilo**: same shape as OpenCode (assets/kilo/herdr-agent-state.js, not read in detail).

**Kimi (>= 0.14.0)** installer table (src/integration/mod.rs:80-93, V), written as `[[hooks]]` blocks in `~/.kimi-code/config.toml`:
| Kimi event | matcher | action |
|---|---|---|
| SessionStart | - | session |
| UserPromptSubmit | - | working |
| PreToolUse | not AskUserQuestion | working |
| PreToolUse | `^AskUserQuestion$` | blocked |
| PostToolUse / PostToolUseFailure | AskUserQuestion | working |
| SubagentStart, PreCompact | - | working |
| PermissionRequest | - | blocked |
| PermissionResult | - | working |
| Stop, Interrupt | - | idle |

**MastraCode** (mod.rs:298-310, V): SessionStart->session; UserPromptSubmit, AgentStart, PreToolUse, PermissionResult, SubagentStart, SubagentEnd -> working; PermissionRequest -> blocked; Interrupt, AgentEnd, Stop -> idle. No screen manifest fallback exists for it.

### 4c. Session-identity-only hooks (state = screen detection)
Claude: `SessionStart` with matcher `^(startup|resume|clear|compact|fork)$` (claude_settings.rs:19). Codex: `SessionStart` in `hooks.json` (targets.rs:160-223). Copilot: `SessionStart` (mod.rs:117). Droid, Qoder, Qwen, Letta, Cursor (`sessionStart`), Grok (`SessionStart`, via `hooks/herdr.json`), Antigravity (`PreInvocation`), Hermes (python plugin), Devin (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop all mapped to action `session` only; mod.rs:140-147).

Claude hook script (src/integration/assets/claude/herdr-agent-state.sh, V): reads hook JSON on stdin; requires `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`, python3; exits for Cursor-originated events (line ~46), for non-`SessionStart`, and for **subagent** events (`agent_id` present, line 56). Sends `pane.report_agent_session {pane_id, source:"herdr:claude", agent:"claude", seq: time_ns, agent_session_id: session_id, agent_session_path: transcript_path, session_start_source: hook.source}`.

### 4d. Reported state -> internal state
`detect_state_from_api`: `idle/working/blocked/unknown` 1:1 (src/app/api_helpers.rs:85-94). `Done` never comes in; it is `Idle && !seen`.

## 5. Turn end vs session end

- **There is no explicit turn-end or session-end event in the normalized model.** "Turn done" = effective state transition `Working|Blocked -> Idle` (src/app/actions.rs:22-25 `is_background_completion_transition`). `agent wait --until done/idle` observes this.
- How it is detected per family:
  - Screen agents: prompt box visible (`visible_idle`) or no working/blocked rule matches -> idle, after the 3-confirmation / 700 ms debounce (agent_detection.rs:3-60).
  - Hook agents: Pi `agent_settled` with `isIdle()`; OpenCode `session.idle`/`session.status idle`; Kimi `Stop`/`Interrupt`; Mastra `AgentEnd`/`Stop`/`Interrupt`.
- **`Done`** = idle and "unseen": `apply_pane_state_change` sets `pane.seen = true` for any non-idle state; on a completion transition sets `pane.seen = suppress_active_tab_notifications` (i.e. seen only if the pane is in the active tab of a focused client) (src/app/actions.rs:1844-1848). Switching tab marks seen (src/workspace.rs:451-457). Docs: "`idle` and `done` both mean the agent is ready for input ... Each TUI client tracks viewed completions independently" (agent-automation.mdx). CHANGELOG 103: "An agent's first task now counts as done ... Startup, restored sessions ... no longer fire false done notifications"; `completion_seq` field on agent info marks real completions.
- **Session end / agent exit**: process exit detected by foreground-process probing (`process_exited` -> forces `Idle` detection, pane.rs:3130-3250, agent_detection.rs:352-362) -> clears hook authority, persisted session, reported resume, metadata (state.rs:~440-540). A graceful `pane.release_agent` (hook `SessionEnd` in old versions) clears immediately and suppresses re-acquisition for 1 s (`RELEASE_REACQUIRE_SUPPRESSION`, pane.rs:69). Note the official hooks no longer send release (Claude `SessionEnd` was removed). Self-reported agents are cleared when the pane returns to an idle shell (1 s poll).
- `/clear`, `/compact`, `/resume` in Claude are **not** session ends: they arrive as `SessionStart` with `source` = clear/compact/resume and replace the stored session id (CHANGELOG.md:630).

## 6. Permission / approval prompts

- **Detected: yes, as state `Blocked`**, almost entirely by screen manifests (regex over the visible approval UI) for Claude/Codex/Gemini/etc.; by hook events for pi (`herdr:blocked`), omp (`tool_approval_requested`), opencode (`permission.asked`, `question.asked`), kimi (`PermissionRequest`, AskUserQuestion), mastracode (`PermissionRequest`). Strict by design: "Herdr only marks blocked when the live bottom-buffer snapshot matches known visible approval, question, or permission UI" (agents.mdx:76).
- Claude example rules: `bash_permission_prompt`, `generic_permission_prompt`, `live_blocked_form`, `mcp_elicitation_prompt` (claude.toml:80-207).
- **UI**: blocked shows in sidebar/session navigator, fires a "needs attention" toast + sound (`ToastKind::NeedsAttention`, actions.rs:82-93, 130-142), terminal-notification backends (ghostty/iterm2/kitty/wezterm OSC, src/terminal_notify.rs). Workspace rollups prioritize blocked.
- **Answering**: there is **no approve/deny widget in herdr**. The user answers by focusing the pane and typing in the agent's own TUI (the pane *is* the agent). Programmatic answering: `herdr agent send-keys <agent> enter|esc|...` (deliberate), while `agent prompt` is **refused with `agent_blocked`** when state is Blocked (src/app/api/agents.rs:166-174). Known hole: if blocked is not detected (hook still running, picker misclassified idle) `agent prompt` types into the dialog (issues #5263, #4647).

## 7. Session identity

- External session id captured **only via hooks/plugins** (screen detection cannot get it). Sent as `agent_session_id` (+ `agent_session_path` for Pi/OMP, whose resume key is the session file path; src/agent_resume.rs:116-133). Claude's `transcript_path` is sent but dropped for Claude (only pi/omp honor path).
- Accepted only from **official sources** `herdr:<agent>` with matching agent label (`is_official_agent_source`, agent_resume.rs:328-350); custom sources get no `session_ref` (session_ref_from_report returns None), they must instead send `resume_argv`.
- Validation: id non-empty, <= `MAX_SESSION_ID_LEN`, no control chars; path must be absolute (agent_resume.rs:352-361). `session_start_source` normalized to startup|resume|clear|compact|branch|new|fork|select (agent_resume.rs:153-163).
- Stored in `TerminalState.hook_authority.session_ref` / `persisted_agent_session` (state.rs:129-166; set_agent_session_ref_for_session_start at 1461 with a lot of generation/suppression logic for full-lifecycle sources).
- **Resume** (native session restore, default on, `[session] resume_agents_on_restore`): after a server restart the pane is respawned in its saved cwd and the resume command is typed (agent_resume.rs:199-311, V): claude `--resume <id>`, codex `resume <id>`, copilot `--resume=<id>`, devin/droid/qodercli/qwen/hermes/grok/cursor-agent `--resume <id>`, kimi/opencode/kilo/pi `--session <id>`, omp `--resume=<path|id>`, mastracode `--thread <id>`, agy `--conversation <id>`, letta `--conversation <id>` (default conv = `default:<agent-id>`). Custom agents give `resume_argv` (<= 64 args, 8 KiB, first element a bare command name, no apostrophes/control chars; rejected with `invalid_resume_argv`/`resume_not_accepted`).
- Persisted in `session.json` as `agent_session: PaneAgentSessionSnapshot` per pane (src/persist/snapshot.rs:109, 353-388). **Agent state itself is not persisted**; only identity. Restored agents start staggered 100 ms apart (CHANGELOG.md:88).

## 8. Transport and auth

- **Transport**: newline-delimited JSON over a local socket (Unix domain socket; Windows named pipe). `{"id","method","params"}` -> `{"id","result"|"error"}` (docs socket-api.mdx:608-630). Hook scripts open the socket directly in python (`socket.AF_UNIX`, 0.5 s timeout, fire-and-forget, errors swallowed), JS plugins use `node:net` (500 ms then 1500 ms retry). Custom agents are told to prefer the CLI `"$HERDR_BIN_PATH" pane report-agent ...`. Hooks run `bash <hook>` (Unix) or `powershell -NoProfile -ExecutionPolicy Bypass` (Windows) (src/integration/command.rs:12-33). No HTTP.
- **Env vars injected into every pane** (src/pane.rs:183-216; docs add-herdr-support.mdx:19-26): `HERDR_ENV=1`, `HERDR_PANE_ID`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `TERM_PROGRAM=herdr`. Pane launch **strips** `CODEX_THREAD_ID`, `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_MESSAGING_TOKEN`, `OMPCODE` so new panes are not mistaken for child sessions of whatever started the server (pane.rs:186-196).
- **Auth**: filesystem permissions only. Socket chmod `0600` (src/api/server.rs:29,305; src/ipc.rs:362-366). **No tokens, no per-pane secret**: any same-user process can send `pane.report_agent` for any `pane_id` (the id is just a request parameter; V by reading handler src/app/api/panes.rs:1554-1597, no caller verification). Windows: named pipe; elevated server only accepts admin clients by default (CHANGELOG.md:24). Scoping is by (a) `source` string (`herdr:*` prefix reserved for official integrations; `source` charset/length checks, 80 chars) and (b) monotonic `seq` per `source` (see below). The `herdr:` namespace is guarded by `is_official_agent_source` rather than any credential.
- **Ordering/dedup**: per-source `seq` must be strictly greater than the last accepted (`hook_report_is_newer`, src/terminal/state.rs:1946-1952); late reports are acknowledged but ignored ("accepted by the API but ignored by the pane state", socket-api.mdx). Hooks use `time.time_ns()` / `Date.now()*1000` as seq. Pi/OpenCode hooks keep only the latest queued state.
- **Arbitration order** (centralized, src/terminal/state.rs:1-8, 2404-2445 `recompute_effective_state`): effective state = (1) if a *non-full-lifecycle* hook state exists and the screen shows a *visible blocker* newer than the hook -> Blocked; else (2) live hook authority state, if effective; else (3) screen `fallback_state`. Full-lifecycle authority is only "effective" while the detected process is that agent and no recent process exit is recorded (`hook_authority_is_effective`, state.rs:2032-2037). Session-identity-only integrations hard-reject state: `set_hook_authority_at` returns early for `session_identity_only_integration` = hermes, qwen, letta, agy (state.rs:~701-715; detect/mod.rs:342-350). For Claude/Codex etc., issue #5007 (open) reports that `pane.report_agent` for the same agent label is acknowledged `ok` but has no effect while the real process runs (even with `custom:x`); I did not trace the exact guard (candidates: `known_agent_label_conflicts_with_detected_agent`, `current_session_owner_conflicts`, state.rs:~730-745). `is_reserved_native_state_source` (agent_resume.rs:~165) exists but only referenced in tests (dead or test-only).

## 9. Hook installation

- **Global, per-user, not per-project/worktree.** Files under the agent's config dir: `~/.claude/hooks/herdr-agent-state.sh` + entry in `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`); `~/.codex/{herdr-agent-state.sh,hooks.json,config.toml [features] hooks = true}`; `~/.kimi-code/config.toml` marker block; `~/.config/opencode/plugins/...` + `tui.jsonc`/`cli.json`; `~/.pi/agent/extensions/...`; etc. (docs integrations.mdx:70-300; targets.rs:124-160). The same hook fires for every project; scoping to herdr is done at runtime by the script exiting unless `HERDR_ENV=1 && HERDR_SOCKET_PATH && HERDR_PANE_ID` (claude hook lines ~19-23). Worktree/project settings are never touched.
- **Preserves existing config**: edits JSON via a CST-preserving parser (`jsonc-parser` cst mode, claude_settings.rs:1-10), adds only its own command entry next to the user's, dedupes by command path variants; for Kimi it owns a delimited block (`# >>> herdr kimi integration` ... `# <<<`, config_edit.rs:855-889); for Grok/Antigravity writes its own file/named block so other hooks are untouched; OpenCode registers plugin in TUI config "preserving other preferences". Writes are atomic temp+rename with hard-link/permission checks (`write_config`, src/integration/config_file.rs:72-110); Windows uses backup-first in-place update. Script files carry a header `HERDR_INTEGRATION_ID` + `HERDR_INTEGRATION_VERSION`; "reinstalling overwrites this file, add custom hooks beside it".
- **Asks the user first? Not automatic.** Detection works with zero install. Integrations are installed by explicit `herdr integration install <agent>` or the Settings -> Integrations tab ("install recommended integrations for agents found on your PATH"); the app computes `integration_recommendations` and flags "updates available" for outdated versions (src/app/state.rs:915-921, src/client/shell/settings.rs:247-275). The config dir must already exist (installer refuses otherwise; targets.rs:127-132) except MastraCode/Grok which create theirs.
- **Versioning**: per-integration version number, `herdr integration status` reports NotInstalled/Current/Outdated (src/integration/types.rs:~150-170). 
- **Uninstall**: `herdr integration uninstall <agent>` removes only entries matching herdr's hook path/marker and deletes the script (claude_settings.rs:97-130); Codex leaves `config.toml` flag.
- Installed hooks also have a `HOOK_REMOVALS` migration list for retired entries (V) - evidence of how much churn there was.

## 10. Persistence

- Server is the **source of truth** (`TerminalState` in memory). Clients (TUI, API clients, `--remote` over SSH) are views. Late-joining UI/clients: `session.snapshot` API ("bootstrap client runtime state in one socket response before subscribing", CHANGELOG.md:522) and `agent.list/get`, `pane.list/get`.
- **Events are NOT durable**: `EventHub` ring of 512 events, no replay across restart. Subscribers that fall behind get `events_lost` and must re-snapshot; docs explicitly say snapshots and events share no sequence boundary, treat events as invalidation signals (socket-api.mdx "Event subscriptions"; event_hub.rs:14-60).
- **On disk** (session-state.mdx): `session.json` (layout, cwd, per-pane agent session ref), atomic writes, `session-backups/` (3 failed-load copies), `session-snapshots/` (up to 48 layout snapshots, at most 1 per 15 min), optional `session-history.json` (pane screen replay, off by default because of secrets). Agent *state* (idle/working/blocked) is NOT saved; after restart panes come back as shells, then a native resume command is typed, then detection/hooks re-establish state. Live handoff (`herdr update --handoff`) serializes `HandoffAgentState{authority, sequence, acquisition_pending}` (src/terminal/state.rs:29-34) so hook-reported state survives a server binary swap (CHANGELOG.md:103).
- Token metadata (`pane.report_metadata`) is not restored after a restart (socket-api.mdx).

## 11. Message injection

- Yes, via the control API/CLI, **not** via any agent-native API: everything is PTY writes.
  - `pane send-text` (literal), `pane send-keys` (encoded keys), `pane run` (text+Enter) work on any terminal regardless of occupant.
  - `agent prompt <name|pane> "text" [--wait]`: validates (src/app/api/agents.rs:140-205) non-empty text; target resolves to a live agent; **rejects `agent_blocked` if state==Blocked**; rejects `agent_not_ready` if the effective known agent is absent, managed launch is pending, or the agent is no longer the pane foreground process. It does **not** require idle: docs say "It can prompt an agent that is already working" (agent-automation.mdx). Encoding: `encode_api_submission_parts` honors the terminal's **live bracketed-paste mode**, then Enter after `AGENT_PROMPT_SUBMIT_DELAY = 300 ms` (agents.rs:11,231-233). Copilot gets a synthetic focus-gained first; on Windows Codex gets an extra key after the paste ("paste boundary") (agents.rs:15-35). No queue inside herdr; the agent's own TUI queues input.
  - `--wait` writes then waits for state to leave the starting state (up to 5 s to observe working/blocked, else `agent_prompt_stalled`), then waits for idle/done/blocked; "It does not track individual turns" (docs).
  - `agent send-keys` for deliberate answers to dialogs (esc, enter, ctrl+c).
  - `agent start <name> --kind <agent> --pane <p> -- <args>` launches in an existing shell pane and returns after the agent is detected and ready; `agent_not_ready` if blocked during startup (Codex has a `CodexPromptObserved` readiness probe, events.rs:92).
- Race: prompt by name can reach a new occupant during detection lag after an agent exits (issue #4764).

## 12. Edge cases

- **Subagents**: Claude hook drops subagent events (`agent_id` present -> exit); Claude manifest has `background_agents_working` rules for "Waiting for N background agents" (claude.toml:27-51); OpenCode plugin maps child sessions to root session and only propagates permission/question blocking (opencode js:140-170); Pi/OMP only report from the root session; "Root agent session restore now ignores child process reports" (CHANGELOG.md:600, 665). Weak: many open issues about background subagents reading idle (#5004, #4511, #4664, #4329).
- **Compaction**: Claude `SessionStart` source `compact` replaces session id; OpenCode `session.compacted` -> working; Kimi `PreCompact` -> working.
- **/clear, /new, /resume**: new session id via `SessionStart` source; Pi `/new` fixed so it does not produce a false done (CHANGELOG.md:103); Grok `/new`; reconcile logic with "suppressed full-lifecycle hook reports", "stale sessions", generation gating (state.rs:~60-100, 1461-1700) to avoid a nested `claude -p` or a replaced process overwriting the pane's session.
- **Concurrent sessions / worktrees**: identity is **per pane/terminal** (`HERDR_PANE_ID`), so any number of agents in any number of panes/worktrees work independently; workspaces can be git-worktree groups (`src/worktree.rs`, `app/api/worktrees*`), but agent state is not worktree-keyed. Multiple agents in one pane (nesting) are handled by process-based generation tracking and "nested/ephemeral sessions no longer replace the owning pane's session" (CHANGELOG.md:389).
- **ctrl-z / background jobs**: `AgentJobTracker` retains agent identity while stopped/backgrounded and skips screen reads (pane/background_agent.rs:1-40; pane.rs:3164-3170).
- **Crash/restart of herdr**: panes die with the server; restore = shell + native resume; `herdr` TUI crash is harmless (client/server split); `detach` keeps everything running. System shutdown hooks (logind, macOS) save before exit (CHANGELOG.md:31, session-state.mdx).
- **Agent crash**: detected as process exit -> state Idle + release.
- **Wrapped agents** (`fence`, `nono`, nix wrappers): need `HERDR_AGENT=<agent>` (agents.mdx:70; issue #803).

## 13. Known weaknesses / open issues (V from `gh issue list`, 400 open; titles; none read exhaustively)

Structural weakness: **status accuracy depends on scraping each agent's TUI strings and hooks cover only parts of lifecycles**, so there is constant churn: every agent release can break a rule. ~40 of the first 400 open issues are status-misdetection bugs. Examples:
- Blocked misdetected as idle: #5548, #5546, #5499 (grok trust prompt), #5490 (Codex "Implement this plan?"), #5221 (Claude dialog), #4841, #4700, #4668, #4647 (Codex picker idle so `agent prompt` answers it), #4275.
- Working misdetected / stuck: #5466 (Claude flips idle while PreToolUse hooks run), #5365 (opencode "esc interrupt"), #5358 (Codex spinner frame left in OSC title keeps pane working for hours), #4819, #4376, #3005 (Claude stops refreshing OSC title), #4564 (generic patterns from non-agent commands).
- Hook problems: #5007 (report_agent silently ignored for a live Claude process, no error), #5418 (omp never reports working, `agent prompt --wait` stalls), #5014 (omp aborted approval leaves blocked forever), #4214 (OpenCode latches blocked), #4557 (OpenCode blocked overwritten by working), #5333 (opencode integration lost -> manifest mismatch), #5373 (Hermes gateway hook has no HERDR_* env), #4851 (closing a pane kills Claude before SessionEnd hooks), #5385 (Claude hook python3 without `-I`: cwd modules can shadow stdlib - same class of issue as the untrusted-dir note in our env), #5157 (duplicate hook entries).
- Messaging safety: #5263 (`agent prompt` approves a Claude permission dialog while a PermissionRequest hook is running), #4764 (prompt reaches new occupant), #4641 (prompt accepted while state unknown), #4537.
- Done semantics: #5222 (no attached client -> idle instead of done), #5377 (two completion notifications), #4473 (`agent wait --until idle` never wakes after focus flips done to idle), #4418, #5146.
- Perf: #5289, #5194 (idle CPU grows with subscribers), #5211.
- Complexity smell (V): the arbitration code in src/terminal/state.rs is >2.4k lines of non-test code with suppress/generation/stale-session maps (`suppressed_full_lifecycle_hook_reports`, `stale_full_lifecycle_hook_sessions`, `hook_report_sequences`) added to repair real ordering bugs (CHANGELOG.md:595, 589).
- Remote-fetched detection rules from herdr.dev (curl, 256 KiB cap, no signature check found in manifest_update.rs; I only grepped, did not read the whole fetch/verify path) is a supply-chain surface; can be disabled.

## Takeaways relevant to a comparison (my reading)
1. herdr treats **the PTY screen as the universal, always-available signal** and hooks as an optional upgrade, and it actively *demoted* hooks for 9+ agents because hooks were incomplete (cancel/interrupt/permission-cancel paths). Hooks are kept for session identity (needed for resume).
2. Normalized state is tiny (4 values, +`done` derived from per-client seen), level-triggered, and has no turn/session ids in the state. Events are best-effort invalidations with a 512-entry ring.
3. Trust model is "same user + 0600 socket"; no per-pane tokens; `source`+`seq` give ordering and namespace separation, not authentication.
4. Hooks are global per-user installs gated at runtime by env vars (`HERDR_ENV/PANE_ID/SOCKET_PATH`), installed only on explicit user action, with careful in-place merge/uninstall.
5. Injection is raw PTY writes with a blocked-state guard but no idle guard; it is the source of several open races.
