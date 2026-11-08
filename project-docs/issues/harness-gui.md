# harness-gui

lophn 터미널 탭 안 harness GUI(`claude gui` 등)와 harness adapter. `project-docs/architecture/harness-gui.md`.

## adapter 넷이 줄 세우기 code를 따로 가진다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: 도는 중에 보낸 메시지를 줄에 세우고 고치고 옮기고 turn 뒤에 보내는 code(`resendQueue`와 `edit_queued`·`move_queued` 처리)가 `claude.ts`, `codex.ts`, `opencode.ts`, `omp.ts`에 각자 복사돼 있다. 뒤의 셋이 `claude.ts`를 본떠 썼다.

영향: 줄 세우기 bug를 고치면 네 곳을 같이 고쳐야 하고, 하나만 고치면 harness마다 동작이 갈린다.

고치려면:
- 같은 폴더에 줄 file 하나(queue와 그 입력 처리, 다음 turn에 넣을 callback을 받는다)를 두고 넷이 쓴다. 작음. 추천.

## Claude GUI의 `!` 출력이 끝나야 보인다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `claude.ts`는 `!` 출력을 process가 끝날 때 tool item `body`에 한 번에 싣는다(ACP에 도는 tool의 본문 갱신이 없다). shell은 `/bin/sh`로 박혀 있다. cwd는 앞 `!`가 끝난 곳에서 이어진다.

영향: 오래 도는 `!` 명령은 끝날 때까지 출력이 비어 보인다. Windows에서는 `!`가 돌지 않는다.

고치려면: 출력 흐름은 tool body를 덧붙이는 갱신이 ACP에 생길 때 같이 한다. 작음.

## OpenCode GUI에서 다른 client가 보낸 lophn call이 live로는 사람 메시지로 그려진다

```yaml
kind: bug
modules: [packages/shell/main, packages/protocol]
```

지금: `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`는 다시 그릴 때(`userMessage`) `classifyReceived`로 lophn call·reply를 받은 메시지로 그린다. 그런데 live로 다른 client(TUI, lophn)가 넣은 메시지는 `userQueued`가 `message_queued` 뒤 `message_taken`으로 그리고, ACP의 줄 선 item(`packages/protocol/acp/`)에는 `actor`·`sender`가 없다.

영향: OpenCode GUI를 열어 둔 채 다른 agent가 그 session에 call을 보내면, 다시 열기 전까지 사람 메시지로 보인다.

고치려면: 줄 선 item에 받은 메시지 표시를 더하거나, 다른 client의 메시지는 줄을 거치지 않고 `message_added`로 그린다. 뒤의 것이 작다. 추천.

## Claude Agent 줄의 시작 시각을 맞추려고 줄을 늦게 낸다

```yaml
kind: defect
modules: [packages/shell/main, packages/protocol]
```

지금: `packages/shell/main/extensions/bundled/harness-gui/claude.ts`는 Agent tool 줄을 tool_use가 올 때가 아니라 `task_started`가 올 때 낸다(`startRow`를 `setAgent`·`toolEnd`·`canUseTool`·`onTask` 네 곳에서 먼저 낸다). ACP에 낸 tool item의 `at`을 고칠 갱신이 없어서다.

영향: model이 subagent prompt를 쓰는 동안 줄이 없고, 같은 assistant 메시지에서 tool_use 뒤에 글이 있으면 줄이 그 글 뒤에 놓인다. 네 곳에서 미룬 줄을 챙겨야 해 고칠 때 빠뜨리기 쉽다.

고치려면: ACP `tool_detail_changed`나 tool item에 실행 시작 시각(`started_at`)을 더하고 renderer가 그것으로 센다. 그러면 줄은 바로 내고 미루는 code를 지운다. 작음. 추천.

## 탭 CLI 안에서 띄운 다른 harness session이 그 탭의 session과 recent에 들어간다

```yaml
kind: bug
modules: [packages/shell/main, packages/coding-agent, packages/protocol]
```

지금: 탭의 CLI 아래에서 뜬 harness process(Bash tool이나 `!`로 돌린 `claude -p`, 녹화 script)는 `LPN_TERMINAL_HOOK`을 물려받아 hook을 같은 탭으로 보낸다. tracker(`packages/shell/main/terminal/agent/tracker.ts`)는 새 `session_id`를 `/clear`·resume처럼 그 탭의 session으로 받고, `sessionSeen`이 terminal agent session 목록(`<data root>/shell/agent-sessions/<project>.json`, `packages/shell/main/terminal/agent/session-store.ts`)에 적는다. Agent tool subagent는 부모 `session_id`로 hook을 내서 원인이 아니다. 사람이 본 "subagent session"은 `!`로 돌린 Claude 녹화의 session이었다(첫 prompt가 "Use the Agent tool …").

영향: recent가 사람이 연 적 없는 session으로 찬다. 그 session이 도는 동안 탭의 session id가 바뀌어 GUI toggle이 엉뚱한 session을 열 수 있다.

고치려면:
- `lophn hook`이 가장 가까운 harness 조상 process의 pid를 싣고, main은 그 pid가 PTY foreground group(TUI)이나 GUI handle이 띄운 CLI일 때만 받는다. 중간. 추천.
- Claude만: SessionStart에서 `$CLAUDE_ENV_FILE`에 `unset LPN_TERMINAL_HOOK`을 적어 Bash tool 자식이 물려받지 않게 한다. 작음. SDK mode에서 되는지 확인이 필요하고 다른 harness는 남는다.
- 녹화 script들이 `LPN_TERMINAL_HOOK`을 지운다. 작음. 본 경우만 막는다.
