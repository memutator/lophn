# 조사 2: pi, omp, prime-agent, mimocode, kilo, letta

worker 보고 요약. 경로는 `scratchpad/peers-src/` 기준. `omp-src`는 `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src`(설치된 18.8.7). upstream 소스는 `scratchpad/{pi,mimo,kilo,letta,prime}/`.

## Cross-cutting
1. foreground: shebang script를 symlink로 부르면 `/proc/<pid>/cmdline`에 부른 symlink 경로가 남는다(시험: `bun ./omp-link`, `node ./pi-link`). npm·bun 전역 설치의 `pi`, `omp`, `mimo`, `kilo`, `letta`는 "node/bun 다음 script basename" 규칙으로 맞는다. pnpm·yarn shim만 `cli.js`, `letta.js`, `mimo.js`로 보인다(O `shared/agent-node-entrypoint-identities.ts:22-34`, H `src/detect/mod.rs:719-760`).
2. pi·omp·prime-agent는 extension 뼈대(spawn `lophn hook <id> <event>`, `ctx.sessionManager.getSessionId()`, `session_start`, `agent_start`)를 같이 쓸 수 있지만 turn 끝과 권한 handler는 다르다. omp는 `agent_settled`가 없고(`grep` 0건) turn 끝이 `agent_end{willContinue?}`다. omp는 `tool_approval_requested`/`tool_approval_resolved`가 있다. omp는 extension을 subagent session마다 다시 묶는다(`omp-src/sdk.ts:2630-2640`) → `ctx.agent.kind === "main"`으로 거른다. 설치 위치가 다르고(`~/.pi/agent/extensions/` vs `~/.omp/agent/extensions/`), 둘이 같은 곳으로 풀리면 놓지 않는다(H `src/integration/targets.rs:89-98`).
3. agent 안에서 띄운 pi·omp 자식 process도 `LPN_TERMINAL_HOOK`을 물려받는다. H는 omp의 `OMPCODE=1`로, O는 owner pid env로 거른다.
4. kilo, mimocode는 OpenCode fork라 lophn opencode plugin 본문을 harness id만 바꿔 쓴다. 둘 다 default export `{id, server}`를 먼저 읽는다(v1 경로). event 이름은 lophn 1.x 표와 같다. `hookSignalOf`에서 kilo·mimocode도 `opencodeSignal`로 보낸다.

## pi
- executable `pi`; extension `~/.pi/agent/extensions/lophn-status.ts`(override `PI_CODING_AGENT_DIR`). 지금 lophn template이 pi API와 맞다(`ctx.sessionManager.getSessionId()` 확인).
- events: `session_start{reason}`→SessionStarted(`reload`은 경계 아님); `agent_start`→TurnStarted; `agent_end`는 turn 끝이 아니다; `agent_settled{aborted}`→TurnEnded(aborted면 interrupted); `ui_prompt_start`/`ui_prompt_end`(extension UI 물음, 선택)→PermissionRequested/Resolved; `session_shutdown{reason}`→SessionEnded는 `reason === "quit"`일 때만. 실패 outcome 없음. trust 없음. 공유 server 없음. Esc → `agent_settled.aborted`.

## omp (Oh My Pi, 설치됨 18.8.7)
- executable `omp`(bun 전역 `~/.bun/bin/omp`); extension `~/.omp/agent/extensions/lophn-status.ts`(override `PI_CODING_AGENT_DIR`, 없으면 `$PI_CONFIG_DIR`(기본 `.omp`)`/agent`; profile `--profile`/`OMP_PROFILE`이 폴더를 옮긴다). 이 컴퓨터 폴더에 orca `orca-agent-status.ts`가 이미 있다.
- events: `session_start`(payload 없음; `session_switch`·`session_branch`로 같은 process 안에서 session이 바뀐다 → id를 event마다 다시 읽는다)→SessionStarted; `agent_start`→TurnStarted(`ctx.agent.kind === "main"`만); `agent_end{messages, willContinue?}`→TurnEnded **`willContinue !== true`일 때만**, outcome은 마지막 assistant message `stopReason`(`aborted`→interrupted, `error`→failed, 그 밖 completed); `tool_approval_requested{toolName, reason}`→PermissionRequested; `tool_approval_resolved`→PermissionResolved; `ask` tool의 `tool_execution_start/end`→waiting(선택). `agent_end`가 두 번 올 수 있다(H) → in-flight flag로 막는다. trust 없음. 공유 server 없음. Esc → `stopReason === "aborted"`.

## prime-agent
- 지금 판(0.10.x, Rust)은 **hook API가 없다**(`crates/pa-core/src/settings/load.rs:161-172`, `packages/mod.rs:4`). 옛 TS 판(≤ 0.9.8)만 pi식 extension. 게다가 session이 공유 background daemon에서 돈다(README "The background daemon keeps the environment it started with"). → **foreground icon만**(`prime-agent`).

## mimocode (MiMo Code)
- executable `mimo`(installer `~/.mimocode/bin/mimo`, npm `@mimo-ai/cli`). `mimocode`를 실행 파일 이름으로 쓰지 않는다.
- plugin-file `~/.config/mimocode/plugins/lophn-status.ts`(`$XDG_CONFIG_HOME/mimocode`, `MIMOCODE_HOME`이면 `$MIMOCODE_HOME/config`; `~/.mimocode/plugins/`도 읽는다). OpenCode plugin API, lophn opencode plugin 본문 그대로.
- events: `session.status`(busy/retry→TurnStarted, idle→TurnEnded; `notice` 무시), `permission.asked`/`permission.replied`. child session은 `parentID`. 공유 server 없음(TUI는 in-process Worker).

## kilo (Kilo Code CLI)
- executables `kilo`, `kilocode`(npm `@kilocode/cli`, `node <bindir>/kilo`).
- plugin-file `~/.config/kilo/plugin/lophn-status.ts`(H 선택; `~/.kilo/plugin/`도 읽는다; `$KILO_CONFIG_DIR`). OpenCode plugin 본문 그대로(v2식 SDK client — `sessionOf1`이 두 꼴을 다 시도한다).
- events: `session.status` busy/retry→TurnStarted, idle→TurnEnded; `offline`·`scheduled` 무시; `permission.asked`/`permission.replied`(H는 `question.*`도).
- **공유 server**: daemon이 떠 있으면(`kilo daemon start`, `kilo console`) TUI가 붙고 plugin은 daemon 안에서 돈다. 피하는 것은 env `KILO_NO_DAEMON`(빈 값이 아니면) — wrapper는 `KILO_NO_DAEMON=1 command kilo "$@"`.

## letta (Letta Code)
- executable `letta`(npm `@letta-ai/letta-code`, bin `letta.js`).
- json-settings `~/.letta/settings.json`의 `hooks`(Claude 꼴; tool event(PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest)만 `matcher`; **timeout은 ms**, 기본 60000). hooks는 "deprecated"(Mods로 옮긴다고 함)지만 지금은 hooks가 낫다. stdin은 `event_type` 칸. exit 2는 막으니 늘 exit 0. `SessionStart` stdout은 다음 입력에 들어가니 출력하지 않는다.
- events: `SessionStart`→SessionStarted(`conversation_id`); `UserPromptSubmit`(`is_command`면 model turn 아님)→TurnStarted; `Stop`→TurnEnded(completed, 정상 끝에만 온다); `PermissionRequest`(`tool_name`)→PermissionRequested(matcher `""`); `PostToolUse`/`PostToolUseFailure`→PermissionResolved; `SessionEnd`→SessionEnded.
- **`agent_id`가 main agent에도 실린다** → lophn의 `agent_id` subagent 거르기를 letta에는 쓰지 않는다. 끊기면 Stop이 안 온다(Esc 규칙이 덮는다).
