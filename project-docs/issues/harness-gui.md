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

## Claude GUI 사용 한도 warning이 SDK 값 그대로 나오고 이벤트마다 다시 뜬다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `packages/shell/main/extensions/bundled/harness-gui/claude.ts`의 `onRateLimit`은 `rate_limit_event`의 status가 `allowed`가 아니면 `Usage limit ${status} (${rateLimitType})`(예: "Usage limit allowed_warning (seven_day)")를 warning info로 낸다. status가 그대로인 동안 이벤트가 올 때마다 또 낸다.

영향: 사람이 읽을 수 없는 글이 대화에 끼고, 같은 warning이 여러 번 쌓인다.

고치려면: "주간 한도의 N%를 썼다. <시각>에 초기화된다"처럼 그 창(`LIMIT_LABELS`)의 이름, 사용률, 초기화 시각으로 글을 만들고, 창마다 status가 바뀔 때 한 번만 낸다(gallery `harness-gui` status limits 문구와 같게). 작음. 추천.

## GUI에서 띄운 subagent session이 lophn의 recent session에 보인다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: 사람 보고. harness GUI(Claude)에서 Agent tool로 띄운 subagent들이 lophn의 recent session 목록에 따로 보인다. GUI 머리의 지난 session 목록(`listSessions({includeProgrammatic: true})`)에는 없음을 확인했다. 어느 목록인지와 그 줄이 어떻게 생기는지(hook으로 들어온 subagent의 SessionStart인지, background agent가 따로 CLI session으로 도는지)는 아직 확인하지 않았다.

영향: recent session이 사람이 연 적 없는 session으로 찬다.

고치려면: 그 목록이 받는 신호를 찾아, 부모가 있는 session(subagent, background agent)은 넣지 않는다. 작음 추정.
