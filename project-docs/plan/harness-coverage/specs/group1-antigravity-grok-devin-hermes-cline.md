# 조사 1: antigravity, grok, devin, hermes, cline (이 컴퓨터에 설치됨)

worker 보고 요약(영문 원문의 사실을 줄였다). O = orca, E = emdash, H = herdr(`scratchpad/peers-src/...`). 설치판: agy 1.4.7, grok 1.0.70(조사 중 1.0.50에서 자동 업데이트), devin 3000.11.3, hermes v0.21.6, cline 3.0.74(3.0.65에서 업데이트).

## Cross-cutting (설계에 걸리는 것)

1. **grok과 devin은 Claude hook을 기본으로 같이 읽는다.** grok `[compat.claude] hooks on (default)`(`grok inspect`, `~/.grok/docs/user-guide/10-hooks.md` "Hook Locations"), devin `read_config_from.claude` 기본 켬(docs.devin.ai/cli/extensibility/hooks/overview, devin log의 `hooks discovery ... providers=[devin,...,claude,...]`). lophn이 `~/.claude/settings.json`에 놓은 hook이 grok·devin 탭에서 `lophn hook claude <Event>`로 불린다. grok은 hook에 `GROK_HOOK_EVENT`, `GROK_SESSION_ID`, `GROK_WORKSPACE_ROOT`를 넣는다.
2. **Hermes는 foreground가 `python3 -I -c '<launcher code>' <args>`다**(`~/.local/bin/hermes`가 `exec`). 지금의 "python 다음 인자" 규칙은 `-I`를 낸다. H는 code 본문으로 가른다(`H src/detect/mod.rs:430-509`, fixture `tests/fixtures/hermes-installer-process-info-4910.json`): code에 `hermes_cli.main`이 있으면 hermes.
3. Cline과 Hermes는 권한 물음 event가 없거나 이름이 다르다(아래).
4. Cline은 공유 hub daemon에서 agent가 돌 수 있다(아래).

## antigravity
- label Antigravity; executable `agy`(native Go ELF; `antigravity`는 IDE launcher).
- hook: `~/.gemini/config/hooks.json`(agy log `hooks_manager.go:53 loaded 1 named hooks from 1 hooks.json file(s)`로 확인; `~/.gemini/antigravity-cli/settings.json`의 hook은 읽지 않는다). 최상위 key가 hook 이름이고 그 아래 event 배열이다. `PreInvocation`, `PostInvocation`, `Stop`은 handler 목록을 바로 받고 `PreToolUse`/`PostToolUse`만 `{matcher, hooks:[...]}`다. 꼴이 틀리면 file 전체가 무효(H `src/integration/mod.rs:275-282`). `timeout` 초, 기본 30.
  ```json
  {"lophn":{"PreInvocation":[{"type":"command","command":"<lophn> hook antigravity PreInvocation","timeout":10}],
            "Stop":[{"type":"command","command":"<lophn> hook antigravity Stop","timeout":10}]}}
  ```
- **stdout 계약**: agy는 stdout에 JSON 객체를 기대한다(H `assets/antigravity_cli/herdr-agent-state.sh:13-14,77`). `PreInvocation`/`PostInvocation`은 `{}`(O `hook-script.ts:211-214`, E `hooks.ts:23`). `Stop`은 `decision`이 필요하고 `"continue"`면 agent가 계속 돈다 — `{"decision":"stop"}`(E `hooks.ts:27`; O는 `{"decision":""}`). `PreToolUse`는 출력 없으면 거절로 본다(O `hook-events.ts:27-28`) — 쓰지 않는다.
- events: `SessionStart`(문서에 있음, CLI 1.4.7이 내는지 미확인)→SessionStarted; `PreInvocation`→TurnStarted(`conversationId`가 처음 실리는 신호); `PostInvocation` 무시(끊기면 건너뜀); `Stop`→TurnEnded는 `fullyIdle === true`일 때만, `terminationReason === "error"`거나 `error`가 있으면 failed(O `antigravity-events.ts:57-63,100-106`, E `hooks.ts:100-104`). 권한 event 없음(O는 `PreToolUse`의 `toolCall.name` `ask_question`/`ask_permission`을 waiting으로 본다 — PreToolUse를 쓰려면 decision을 출력해야 해서 하지 않는다). session id `conversationId`. subagent는 자기 `conversationId`로 같은 process에서 돈다 — 첫 `conversationId`만 따르고 다른 것은 버린다(O `:30-45`). SessionEnd 없음(foreground로 안다).
- trust: 문서에 hook 승인 없음. 공유 server: 없음(`agy remote-control`은 따로 켜는 것). interrupt: 미확인(lophn의 Esc 규칙).
- peers: O 전부(`src/main/antigravity/*`), E plugin(`PreInvocation`, `Stop`), H session id만.

## grok
- label Grok; executable `grok`(native Rust; `~/.grok/bin/grok -> grok-<ver>`, exec 이름은 `grok`).
- hook: `~/.grok/hooks/lophn.json`(`~/.grok/hooks/*.json`을 합친다; override `GROK_HOME`, O `src/shared/grok-session-paths.ts:45`). Claude 꼴 중첩, matcher 생략, `timeout` 초. **항상 exit 0**(Stop에서 exit 2는 멈춤을 막는다).
- events: `SessionStart`→SessionStarted(`session_id`/`sessionId`); `UserPromptSubmit`→TurnStarted; `Stop`→TurnEnded(completed) **`reason == "end_turn"`일 때만**(session 끝에 `reason: "channel_closed"`/`"shutdown"`인 Stop이 또 온다, docs 399, O `grok-events.ts:132-138`); `StopFailure`→TurnEnded(failed); `StopCancelled`→TurnEnded(interrupted)(`cancelledBy !== "runtime"`, `max_turns`·`no_progress`는 completed); `SessionEnd`→SessionEnded. 권한: `PermissionRequest` 없음 — `Notification`의 `notificationType == "permission_prompt"`는 모든 tool 앞에 "Tool permission requested"(info)로도 와서 잡음이다(O `grok-tool-fields.ts:119-130`) → 권한 물음은 매핑하지 않는다. subagent 표지 `subagentType`(있으면 버린다). payload는 camelCase와 Claude식 snake 별칭을 같이 싣는다.
- trust: 전역 hook은 묻지 않음. 공유 server: leader는 기본 꺼짐(`cli.use_leader` false). interrupt: **Esc는 turn을 끊지 않는다**, Ctrl-C가 `StopCancelled`를 낸다(docs 399).
- peers: O 10 events(`grok-hook-config.ts:11-32`), E 9 events(`grok/hooks.ts:52-62`), H session id만.

## devin
- label Devin; executable `devin`(native).
- hook: `~/.config/devin/config.json`의 `"hooks"` key(JSONC, 주석 보존 필요 — O `devin/hook-config-json.ts:5-65`; 이 컴퓨터 file에 이미 mahas·orca 항목). Claude 꼴, **matcher 생략**(`"*"`는 Devin에서 잘못된 regex, O `devin/hook-settings.ts:22`). 출력 없이 exit 0.
- events: `SessionStart`→SessionStarted(idle TUI 열기와 resume에도 온다); `UserPromptSubmit`→TurnStarted; `Stop`→TurnEnded(completed)(실패·끊김 정보 없음); `PermissionRequest`→PermissionRequested(`tool_name`); `PostToolUse`→PermissionResolved; `SessionEnd`→SessionEnded. `PostCompaction` 경계 아님. subagent 표지 문서 없음.
- trust: 문서 없음. 공유 server: TUI는 못 찾음(`devin acp`는 다른 mode). interrupt: 미확인(H: "permission 취소나 끊김 뒤 신뢰할 만한 전이가 없다", `integrations.mdx:152`).
- peers: O 8 events, E 3 events, H session id만.

## hermes
- label Hermes; foreground `python3 -I -c '<code>'`(code에 `hermes_cli.main`), `--tui`면 같은 그룹에 `node .../ui-tui/dist/entry.js`, `python3 -m tui_gateway.entry`.
- hook(둘 다 `~/.hermes`, override `HERMES_HOME`):
  - shell hooks: `~/.hermes/config.yaml`의 `hooks:` block(YAML, 주석 보존 필요; docs `~/.hermes/hermes-agent/website/docs/user-guide/features/hooks.md:1785-2060`). `command`는 `shlex.split`(shell 없음), `timeout` 기본 60. stdin `{"hook_event_name","tool_name","tool_input","session_id","cwd","profile","extra":{...}}`(`agent/shell_hooks.py:79-94`). stdout 계약 없음.
  - plugin-dir: `~/.hermes/plugins/<name>/{plugin.yaml,__init__.py}` + `config.yaml`의 `plugins.enabled`에 이름(O·H 방식, in-process python).
- events: `on_session_start`→SessionStarted; `pre_llm_call`→TurnStarted; `on_session_end`(이름과 달리 turn 끝마다; `extra.completed/failed/interrupted`)→TurnEnded(outcome)(`post_llm_call`은 같이 매핑하지 않는다); `on_human_input_request`(`kind` sudo|clarify|approval, `prompt`)→PermissionRequested(tool=kind, summary=prompt); `on_human_input_resolved`→PermissionResolved(`hermes_cli/plugins.py:147` `VALID_HOOKS`); `on_session_finalize`→SessionEnded; `on_session_reset`(`/new`)은 경계 아님. subagent: `extra.platform == "subagent"`면 버린다.
- **trust**: shell hook은 `(event, command)`마다 처음 쓸 때 TTY에서 묻고 `~/.hermes/shell-hooks-allowlist.json`에 남긴다. TTY가 아니면 조용히 건너뛴다. 사전 기록 가능(hash 없이 event+command 문자열 일치): `{"approvals":[{"event":"...","command":"<정확한 command>","approved_at":"<ISO>","script_mtime_at_approval":null}]}`(`shell_hooks.py:71-72,598`). plugin 경로는 `plugins.enabled`로 신뢰.
- 공유 server: 이 판의 CLI·TUI는 없음(`tui_gateway.entry`는 launcher 자식). orca가 말하는 새 "shared gateway"(`agent.session_client_env`)는 이 설치에 없다.
- peers: O plugin `orca-status`(이 컴퓨터에 설치됨), H plugin(session id만), E hook 없음. **lophn의 `hermes: {}`·`hook: null`은 낡았다.**

## cline
- label Cline; foreground `node .../cline/bin/cline`(→ `cline`), 그 자식 bun binary `.cline`.
- hook: **event마다 script file 하나**. 찾는 곳 `~/.cline/hooks`(그 밖 `~/Documents/Cline/Hooks`, `<project>/.clinerules/hooks`, `<project>/.cline/hooks`; override `CLINE_DIR`/`CLINE_HOOKS_DIR`). file 이름이 event(대소문자 무시, 확장자 선택), shebang이나 확장자로 실행. 인자를 못 받으니 event 이름을 script에 박는다: `#!/bin/sh\nexec "<lophn>" hook cline TaskComplete`. `TaskStart`, `TaskResume`, `TaskCancel`, `TaskComplete`, `TaskError`, `UserPromptSubmit`, `SessionShutdown`은 분리 실행(stdin JSON, stdout 버림). `PreToolUse`/`PostToolUse`는 기다리고 stdout JSON을 읽는다(쓰지 않는다).
- events: `UserPromptSubmit`→TurnStarted; `TaskComplete`→TurnEnded(completed); `TaskCancel`→TurnEnded(interrupted); `TaskError`→TurnEnded(failed); `SessionShutdown`→SessionEnded. 권한 물음 hook 없음. subagent: `parent_agent_id`가 있으면 버린다. session id `taskId`.
- trust: 전역 hook file은 묻지 않음.
- **공유 server**: Cline 3.x hub(`127.0.0.1:25463`), 기본 `auto`는 hub가 있으면 쓴다. hub에서 돌면 hook env가 tab의 것이 아니다. `CLINE_SESSION_BACKEND_MODE=local`이면 in-process(code `z9()`가 받는다, 문서는 "확인하고 쓰라").
- peers: O·H 화면만, E ACP. **hook을 놓는 peer가 없다.**
