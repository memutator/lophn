# 조사 3: cursor, copilot, kimi, kiro, droid, amp (설치 안 됨)

worker 보고 요약. O = orca `src/`, E = emdash `packages/plugins/src/agents/impl/`, H = herdr, HDOC = herdr `docs/versions/0.9.5/website/src/content/docs/integrations.mdx`. 공식 문서 URL은 항목마다 적었다.

## Cross-cutting
1. **`agent`는 이 컴퓨터에서 Cursor가 아니다**(`~/.local/bin/agent -> ~/.grok/bin/agent`). cursor의 실행 파일은 `cursor-agent`만 본다(H도 `agent`는 안 띄운다, HDOC:288).
2. **Cursor도 Claude hook을 같이 읽는다.** O는 `CURSOR_VERSION`·`CURSOR_PROJECT_DIR`이 있으면 Claude hook을 무시한다(`main/agent-hooks/cursor-replay-guard.ts:1-3`, grok도 `grok-replay-guard.ts`).
3. **stdout**: Cursor는 `beforeSubmitPrompt` → `{"continue":true}`, `stop`·`sessionStart`·`sessionEnd` → `{}`(`stop`의 `followup_message`는 다음 입력으로 들어간다). permission gate event(`preToolUse`, `beforeShellExecution`, `beforeMCPExecution`)는 빈 출력이면 막는다 — 쓰지 않는다. Copilot은 빈 출력이 기본 동작. Kiro는 stdout이 model context에 들어간다 → 아무것도 출력하지 않는다. Kimi, Droid도 출력하지 않는다.
4. **package script 이름**: Kimi npm은 `node .../@moonshot-ai/kimi-code/dist/main.mjs`(basename `main.mjs`, H `src/detect/mod.rs:739-750`). Cursor Windows는 `cursor-agent/versions/<ver>/index.js`(H `mod.rs:513-531`); Linux 꼴은 미확인.

## cursor
- label Cursor; executables `cursor-agent`.
- hook: `~/.cursor/hooks.json`(H는 `CURSOR_CONFIG_DIR`, Cursor 자신은 미확인). **flat 꼴, `version: 1` 필요**: `{"version":1,"hooks":{"stop":[{"type":"command","command":"...","timeout":10}]}}`(cursor.com/docs/hooks; O `installer-utils.ts:60-62`, E `cursor/hooks.ts:80-89`).
- events: `sessionStart`→SessionStarted(`session_id`, `conversation_id`); `beforeSubmitPrompt`→TurnStarted(출력 `{"continue":true}`); `stop`→TurnEnded(`status` completed→completed, error→failed, aborted→interrupted); `sessionEnd`→SessionEnded. 권한 대기 event 없음(승인 중에도 running). subagent는 `subagentStart`/`subagentStop` 따로(구독 안 함).
- **미확인**: Cursor 포럼에서 staff가 non-interactive(`-p`)에서는 `beforeSubmitPrompt`·`stop`이 안 온다고 했다(CLI 2026.08.11). interactive TUI는 와야 하지만 실제 확인 필요.
- peers: O `cursor/hook-events.ts:2-11`(sessionStart/End는 일부러 안 씀), E sessionStart·beforeSubmitPrompt·stop, H sessionStart만.

## copilot
- label GitHub Copilot CLI; executables `copilot`(aliases `github-copilot`, `ghcs`; npm `@github/copilot`, foreground 이름 미확인).
- hook: **전용 file** `~/.copilot/hooks/lophn.json`(override `COPILOT_HOME`; inline `settings.json`은 한 항목만 틀려도 전체 hook을 버린다 — docs.github.com/en/copilot/reference/hooks-configuration). `{"version":1,"hooks":{"<Event>":[{"type":"command","bash":"<cmd>","timeoutSec":10}]}}`(O `copilot-managed-hook-definitions.ts:39-43`). **PascalCase event key**를 쓴다(PascalCase면 payload가 `hook_event_name`, `session_id`, `tool_name`, `agent_id` snake).
- events: `SessionStart`→SessionStarted; `UserPromptSubmit`→TurnStarted; `Stop`→TurnEnded(completed); `ErrorOccurred`(`recoverable === false`)→TurnEnded(failed); `SessionEnd`→SessionEnded; `Notification`(`notification_type` permission_prompt|elicitation_dialog)→PermissionRequested(tool null, summary=`message`); `PostToolUse`/`PostToolUseFailure`→PermissionResolved. `PermissionRequest`는 쓰지 않는다(O: "allow/ask/deny 전에 온다", `copilot-events.ts:15`). subagent `agent_id`.
- peers: O 13 events(`hooks/orca.json`), E 3 events(camelCase), H SessionStart만("lifecycle coverage가 완전하지 않다", CHANGELOG.md:708).

## kimi
- label Kimi Code; executables `kimi`, `kimi-code`, npm `node .../@moonshot-ai/kimi-code/dist/main.mjs`.
- hook: TOML `~/.kimi-code/config.toml`(override `KIMI_CODE_HOME`; 옛 `~/.kimi`는 다른 세대). `[[hooks]]` 배열에 `event`, `matcher`(선택, regex), `command`, `timeout`(초)만 — **다른 칸이 있으면 config 전체가 안 읽힌다**(kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html). 표시한 block을 끝에 두고 그 안만 고친다(H `# >>> herdr kimi integration` / `# <<< herdr kimi integration`, `src/integration/config_edit.rs:855-889`; O `kimi-hook-config-toml.ts:24-27,125-139`).
- events: `SessionStart`→SessionStarted(O는 새 session 첫 prompt에서 SessionStart를 기다린다고 `matcher = "^resume$"`로만 둔다, `:127,133`); `UserPromptSubmit`→TurnStarted; `Stop`→TurnEnded(completed); `StopFailure`→TurnEnded(failed); **`Interrupt`→TurnEnded(interrupted)**(Esc, Stop 대신 온다); `PermissionRequest`→PermissionRequested(`tool_name`); `PermissionResult`→PermissionResolved; `SessionEnd`→SessionEnded. AskUserQuestion: `PreToolUse` matcher `^AskUserQuestion$`→PermissionRequested, `PostToolUse`/`PostToolUseFailure`→PermissionResolved(H `mod.rs:80-101`).
- trust 없음, 공유 server 없음. peers: O 8, E 8, H 12 events(Kimi Code ≥ 0.14.0).

## kiro
- label Kiro CLI; executables `kiro-cli`(aliases `kiro`; 대화 중 foreground가 `kiro-cli-chat`일 수 있음 — 미확인).
- hook: **V3(kiro-cli ≥ 2.31)** 전역 `~/.kiro/hooks/lophn.json`(override `KIRO_HOME`): `{"version":"v1","hooks":[{"name":"lophn-Stop","trigger":"Stop","action":{"type":"command","command":"<cmd>"},"timeout":10}]}`(O `kiro/standalone-hook-settings.ts:6,18-19,31-41`). V2(classic)는 전역 hook file이 없고 agent file마다 고쳐야 한다(O `kiro/hook-settings.ts:41-44`) — 하지 않는다.
- events(V3): `SessionStart`→SessionStarted(첫 prompt 직전에 늦게 온다); `UserPromptSubmit`→TurnStarted; `Stop`→TurnEnded(completed); `SessionEnd`→SessionEnded. 권한·끊김 신호 없음. 출력하지 않는다(stdout이 model context에 들어간다).

## droid
- label Droid (Factory); executable `droid`.
- hook: `~/.factory/settings.json`의 `hooks` key(O·E·H 모두; 공식은 `~/.factory/hooks.json`이 있으면 그것, 없으면 settings의 `hooks`). Claude 꼴, tool event만 matcher. 출력 없음. hook은 시작 때 읽는다(밖에서 바뀌면 `/hooks`에서 경고).
- events: `SessionStart`→SessionStarted(source clear/compact는 경계 아님); `UserPromptSubmit`→TurnStarted; `Stop`→TurnEnded(completed); `SessionEnd`→SessionEnded; `Notification`(`notification_type: "permission_prompt"`)→PermissionRequested(summary=`message`); **사람이 끊으면 Stop 대신 `Notification`(`idle_prompt`)** → TurnEnded(interrupted, 알리지 않음)(공식 문서, O `droid-events.ts:51`); `PostToolUse`→PermissionResolved. `PermissionRequest`는 공식 9 event에 없다. subagent는 `SubagentStop` 따로.

## amp
- label Amp; executable `amp`(alias `amp-local`; npm `@ampcode/cli`, foreground 이름 미확인).
- hook: **TS plugin** `~/.config/amp/plugins/lophn-status.ts`(Bun으로 실행; ampcode.com/manual/plugin-api; O `main/amp/managed-plugin-install-status.ts:14-16`; E는 `~/.amp/plugins/`로 문서와 다름). `export default function (amp: PluginAPI) { amp.on('session.start', ...); amp.on('agent.start', ...); amp.on('agent.end', ...) }`. `tool.call`은 action을 돌려야 해서 쓰지 않는다. plugin이 `<lophn> hook amp <event>`를 실행(1s 제한).
- events: `session.start`→SessionStarted(`thread.id`); `agent.start`→TurnStarted; `agent.end`→TurnEnded(`status` done→completed, error→failed, cancelled→interrupted). 권한 event 없음.
- **미확인**: plugin이 `PLUGINS=all` 없이 켜지는지(E는 그 env로 띄운다, O는 없이 설치). 실제 설치에서 확인 필요.
