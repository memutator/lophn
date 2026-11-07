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

## GUI 탭 이름이 shell 제목(`user@host: ~/폴더`)으로 덮인다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: GUI는 ACP session 제목을 `GuiSwitch`의 `onTitle`로 `tab.title`에 쓴다(`packages/shell/renderer/terminal/terminal-gui.tsx`). 그런데 `packages/shell/renderer/workspace/workspace-window.tsx`가 terminal store가 바뀔 때마다 모든 터미널 탭의 `title`을 `terminalTabTitle`(사람 이름 > hook session 이름 > agent가 있는 동안의 마지막 OSC 제목 > 자동 이름)로 다시 쓴다. 이 계산은 GUI 제목을 모른다. GUI 동안 그 터미널의 마지막 OSC 제목은 TUI가 끝난 뒤 shell prompt가 낸 `user@host: 경로`다.

영향: GUI 탭 이름이 session 이름이 아니라 shell 제목으로 보인다. 같은 대화를 TUI로 열면 session 이름이 보인다.

고치려면: GUI 제목을 탭 field(예: `guiTitle`)에 두고, `tabName`이 GUI view일 때 사람 이름 다음으로 그것을 쓰게 한다. 그때는 OSC 제목을 보지 않는다. sidebar의 `otherWorkspaceTerminalTitle`도 같은 계산을 쓴다. 작음. 추천.

## 다른 agent·CLI가 넣은 메시지가 GUI에서 사람 메시지로 그려진다

```yaml
kind: bug
modules: [packages/shell/main, packages/protocol, packages/shell/renderer]
```

지금: Claude adapter의 `addUser`(`claude.ts`)는 늘 `actor: "user"`이고, `replay`는 글이 있는 user entry를 모두 사람 메시지로 그린다. 그런 entry에는 task-notification, lophn call(`<lophn-call>`·`<lophn-reply>`), 다른 session에서 온 메시지가 있다. live에서는 root 줄기의 남의 user 메시지를 그리지 않는다(`onUser`가 root에서는 tool_result만 본다). transcript는 출처를 적어 둔다: `origin.kind`(human, task-notification), `promptSource`, `turnOrigin`(human, task_notification, peer). ACP에는 이미 `actor: "received"`, `sender`(agent | program), `call`, `reply_to`가 있고, 화면은 `ReceivedMessage`로 그린다(`agent-thread.tsx`).

영향: resume이나 toggle 뒤에는 남이 보낸 메시지가 내가 쓴 말로 보인다. 실시간에는 아예 보이지 않는다. 그 메시지로 rewind 시점과 사람 메시지 bookmark도 생긴다.

고치려면:
- adapter가 출처로 가른다. human은 `user`다. lophn call tag는 `received`, agent sender, `call`·`reply_to`다. task-notification은 `received`, program이다. peer는 `received`다. 모르는 꼴은 지금처럼 둔다. live 경로도 같은 분류로 그린다. 작음.
- ACP `sender`에 lophn agent가 아닌 다른 CLI session 종류와 알림 종류를 더한다. 화면은 `ReceivedMessage`를 보낸 쪽과 열기가 붙은 한 줄로 접는다. 중간. t3code(`createdBy`, `senderThreadId`, `notification.source`)와 happy desktop(`senderAgent.relation`)이 이 꼴이다.
- 추천: 첫째를 먼저 하고 Codex·OpenCode·omp도 같은 확인을 한다. 둘째는 handoff UI와 같이 한다.
