# 조사 4: qwen, qoder, muse, codebuddy, command-code와 claude·codex·opencode 재점검

worker 보고 원문(영문)이다. O = orca, E = emdash, H = herdr(`scratchpad/peers-src/...`, 계획 README의 재료). 공식 문서: Qwen, Qoder, CodeBuddy, Command Code, Claude Code, Codex(learn.chatgpt.com/docs/hooks) hooks 페이지, Muse는 Arcjet 문서(docs.arcjet.com/coding-agents/muse-code).

## Cross-cutting

1. Qwen, Qoder, CodeBuddy, Muse are Claude-shaped: settings `{"hooks":{"<Event>":[{"matcher"?, "hooks":[{"type":"command","command":"...","timeout":<seconds>}]}]}}`; stdin `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`; events SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Stop, StopFailure, Notification, PostCompact. Exit 0 + empty stdout = success (lophn's silent hook is fine; O prints `{}` only because its script is shared with Cursor). `Stop` is main-agent only.
2. Differences vs Claude: config dirs `~/.qwen`, `~/.qoder`, `~/.codebuddy`, Muse `~/.config/muse` (managed-hooks file + env allowlist). Command Code has no UserPromptSubmit, no permission event, no SessionEnd. Subagent marker `agent_id` for Qwen/Qoder; CodeBuddy documents none; Muse children carry no `agent_id`. O reads `Stop.is_interrupt === true` as interrupt for qoder/codebuddy/muse (`compatible-lifecycle-events.ts:98`, `muse-events.ts:190`) — lophn's `hookSignalOf` should map Stop with `is_interrupt === true` to TurnEnded(interrupted). SessionStart sources: Qoder adds `new`, Claude adds `fork`; lophn already drops `compact`.
3. Permission double count: the tracker counts +1/-1 (`packages/shell/main/terminal/agent/tracker.ts:185-191`). Where PermissionRequest and Notification(permission_prompt) both fire for one prompt, map only one.
4. Foreground: npm bin + shebang gives argv[1] = bin name. Native launchers exec versioned binaries: `qodercli-<ver>`, `muse-bin-<ver>`.

## qwen
- label: Qwen Code. executables: `qwen` (H also `qwen-code`); npm `@qwen-code/qwen-code` (node script; shebang → basename `qwen`).
- hook: json-settings `.qwen/settings.json` (peers honor `QWEN_HOME`, not in official docs). Entry Claude shape, no matcher, `timeout: 10` (seconds; ≥1000 is read as ms).
- events: SessionStart→SessionStarted (ignore source compact); UserPromptSubmit→TurnStarted; Stop→TurnEnded(completed); StopFailure→TurnEnded(failed); PermissionRequest→PermissionRequested (`tool_name`); PostToolUse, PostToolUseFailure→PermissionResolved; SessionEnd→SessionEnded (ignore reason clear). Don't install Notification (double count). session id `session_id`; subagent `agent_id`.
- trust: user hooks need none; `/hooks` reload for live edits. Shared server: none. Interrupt: unknown.
- peers: O `main/qwen-code/hook-service.ts:5-37`; E `qwen/hooks.ts:29-40`; H SessionStart only (`src/integration/targets.rs:991-1031`).

## qoder
- label: Qoder CLI. executables: `qodercli` (and `qoder` dispatcher; China build `qoderclicn`/`qodercn` with `.qoder-cn`); native launcher → `qodercli-<ver>` (match `^qodercli-\d`, O `shared/agent-process-recognition.ts:77-83`).
- hook: json-settings `.qoder/settings.json` (H: `QODER_CONFIG_DIR`). Claude shape, no matcher, timeout 10.
- events: like qwen; SessionStart sources include `new`; StopFailure `error_type`; SessionEnd reasons incl. resume (ignore clear). Don't map Notification. subagent `agent_id`/`agent_type`.
- trust: none for hooks; folder trust writes `permissions.trustDirectories`. Shared server: none. Interrupt: O reads `Stop.is_interrupt`.
- peers: O `main/qoder/hook-service.ts:5-17`; E `qoder/hooks.ts:31-47`; H SessionStart only, says hooks don't cover every transition (`integrations.mdx:238`).

## muse
- label: Muse (Muse Code). executables: `muse` launcher execs `muse-bin-<version>` (match prefix `muse-bin-` + digit; aliases `muse-code`, `muse-cli`). `muse exec` is headless.
- hook: Muse runs hooks with a cleared env (allowlist), so inline user hooks lose `LPN_TERMINAL_HOOK`. Use `~/.config/muse/settings.json` (honor `$XDG_CONFIG_HOME/muse`, must keep `"schema_version": 1`) with `"managed_hooks_path": "<file>"` and `"managed_hooks_env_vars": ["LPN_TERMINAL_HOOK"]` (union, don't clobber); the managed file holds `{"hooks":{"<Event>":[{"hooks":[{"type":"command","command":"...","timeout":10}]}]}}`. Handler keys only `type`, `command`, `commandWindows`, `timeout` (unknown key → event skipped). O absolute path (`main/muse/hook-settings.ts:53-55`), E relative `emdash-hooks.json` (`muse/hooks.ts:204`).
- events: SessionStart→SessionStarted; UserPromptSubmit→TurnStarted; Stop→TurnEnded(completed, `is_interrupt` → interrupted); StopFailure→TurnEnded(failed); PostToolUse, PostToolUseFailure→PermissionResolved; SessionEnd→SessionEnded; permission: use Notification with `notification_type === "permission_prompt"` only (O ignores PermissionRequest, `muse-events.ts:145-159`). Subagent marker: `turn_id === session_id` (O `muse-events.ts:89-96`).
- trust: user/managed hooks skip folder trust; first launch asks workspace trust. Hooks are read at session start. Shared server: none.
- peers: O full (`main/muse/*`, `providers/muse-events.ts:102-207`); E SessionStart/UserPromptSubmit/Stop (`muse/hooks.ts:237-243`); H screen only.
- unknowns: `managed_hooks_*` keys are in O and E but not in official docs reached; behavior differs by version.

## codebuddy
- label: CodeBuddy Code. executables: `codebuddy`, `cbc`; npm `@tencent-ai/codebuddy-code` (node).
- hook: json-settings `.codebuddy/settings.json`. Claude shape, no matcher, timeout 10. Settings snapshotted at startup; edits need `/hooks` review.
- events: UserPromptSubmit→TurnStarted; Stop→TurnEnded(completed); StopFailure→TurnEnded(failed); Notification(`notification_type === "permission_prompt"`)→PermissionRequested (AskUserQuestion also arrives this way, O `compatible-lifecycle-events.ts:74-81`) — pick Notification, not PermissionRequest too; PostToolUse, PostToolUseFailure→PermissionResolved; SessionEnd→SessionEnded (ignore clear). SessionStart arrives after UserPromptSubmit (harmless). Subagent marker: none documented (Stop is main-only).
- shared server: none. Interrupt: undocumented.
- peers: O `main/codebuddy/hook-service.ts:5-34`; E `codebuddy/hooks.ts:64-74`; H none.

## command-code
- label: Command Code. executables: `command-code`, `cmd` (docs alias; unconfirmed on Linux), `cmdc` (Windows), `commandcode` (E). npm `command-code` (node).
- hook: json-settings `.commandcode/settings.json`. `{"hooks":{"<Event>":[{"hooks":[{"type":"command","command":"...","timeout":10}]}]}}`; matcher only for Pre/PostToolUse (`shell|read|write|edit`), omit for Stop/SessionStart. Never exit 2 (Stop retries the turn).
- events (official list only PreToolUse, PostToolUse, Stop, SessionStart): SessionStart→SessionStarted; PreToolUse→TurnStarted (coarse); Stop→TurnEnded(completed). No UserPromptSubmit, no permission, no SessionEnd → tool-less turns never show running; permission prompts invisible.
- env: docs say "sensitive" vars are stripped (undefined which); O recovers env from ancestor `/proc/<pid>/environ` (`main/command-code/command-code-managed-script.ts:42-125`) — `LPN_TERMINAL_HOOK` may not arrive; test before relying.
- peers: O `main/command-code/*`, `providers/command-code-events.ts:1-45`; E Stop only (`commandcode/hooks.ts:12-15`); H none.

## Part B: claude, codex, opencode gaps that make lophn's state wrong (recommended order)

1. Claude manual `/compact` fires UserPromptSubmit and no Stop → tab stays running. O installs PostCompact and maps `trigger === "manual"` to done (`main/claude/claude-managed-hook-events.ts:57-62`, `providers/claude-events.ts:112-113,137-139`). Fix: PostCompact(manual) → TurnEnded without notification (compact is not notified).
2. Subagent permission prompts dropped: `commandHookSignal` returns null for any `agent_id` (`hook-signal.ts:115`). O treats a child's waiting-inducing event as the lead waiting (`claude-events.ts:172-190,241-259`; `codex-events.ts:214-239`). Fix: let PermissionRequested/PermissionResolved (and the child's PostToolUse/PostToolUseFailure that resolves it) through when `agent_id` is set; keep dropping the rest. OpenCode child-session permission/question → root too (H `assets/opencode/herdr-agent-state.js:156-170`, O `status-plugin-session-lineage-source.ts`).
3. Codex `request_user_input` (plan-mode question) blocks in PreToolUse with no PermissionRequest (O `codex-events.ts:163-176`, H `CHANGELOG.md:829`). Fix: install Codex PreToolUse with a narrow matcher for `request_user_input` → PermissionRequested (resolution via PostToolUse). Verify matcher syntax on the installed Codex.
4. OpenCode `question.asked` → PermissionRequested, `question.replied`/`question.rejected` → PermissionResolved (O `main/opencode/status-plugin-lifecycle-source.ts:8-18`, H `herdr-agent-state.js:19-23`); and outcome: 2.x `session.execution.failed`/`session.error` → TurnEnded(failed), `session.execution.interrupted` (1.x `MessageAbortedError`) → TurnEnded(interrupted) — today both become completed (`install.ts:167-171`).
5. Claude AskUserQuestion: O says it blocks on PreToolUse as well as PermissionRequest (`claude-events.ts:106-111`). Verify on the real claude; if PermissionRequest doesn't fire, add PreToolUse matcher `AskUserQuestion` → PermissionRequested.
6. Claude Elicitation/ElicitationResult (MCP dialogs) → PermissionRequested/Resolved — only if cheap.
- Known limit, not fixed: Codex failed turns have no hook (O reads the rollout transcript, `codex-events.ts:256-261,287-308`).
- Risk: old Claude rejects the whole settings file on unknown hook events (O `main/claude/claude-hook-event-versions.ts:6-7`; floors PermissionRequest 2.0.45, PostToolUseFailure 2.0.56, StopFailure 2.1.78, PostCompact 2.1.76, Elicitation 2.1.63). No gating unless users hit it.
- Nice-to-have: Codex SessionEnd now exists (main thread end, `reason` always `other`) — would give the Codex tab a real session end.
