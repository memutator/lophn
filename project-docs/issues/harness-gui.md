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
