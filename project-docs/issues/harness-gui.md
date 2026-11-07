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

## GUI view가 붙을 때 갱신을 처음부터 하나씩 받아 느리고, 지난 대화가 재생하듯 그려진다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/ipc, packages/shell/preload, packages/shell/renderer]
```

지금: handle은 publish된 갱신을 모두 배열에 쌓는다(`packages/shell/main/desktop/wiring/extensions.ts`의 `createAcp`). 흘러나온 글 조각(`writing_streamed`)도 버리지 않는다. view가 붙으면 `packages/shell/main/terminal/gui.ts`의 `connect`가 쌓인 갱신을 하나에 `webContents.send` 한 번씩 다시 보낸다. renderer는 그것을 `terminal-gui.tsx`의 feed와 `agent-tab-data.ts`에서 두 번 접고, 채팅 화면은 가상화 없이 대화 전체를 그린다.
- 다른 workspace에 갔다 오면 탭이 저장본에서 다시 만들어져 이 replay를 처음부터 받는다.
- restart toggle(TUI→GUI)과 `--resume`은 view가 먼저 붙고, 그 뒤 adapter의 replay(`claude.ts`의 `replay`)가 메시지 하나씩 publish한다. IPC 메시지 하나가 renderer의 task 하나라서 React가 갱신마다 대화 전체를 다시 그린다.

영향: 긴 session에서는 workspace를 오갈 때마다 GUI 탭이 한참 멈춘다. TUI에서 GUI로 넘기면 대화가 한 줄씩 다시 그려진다. handle의 메모리는 session 길이만큼 늘어난다.

고치려면:
- handle이 갱신 배열 대신 `reduceAcp`로 접은 `AcpState`를 들고, attach할 때 snapshot 하나와 그 뒤 갱신을 보낸다. 갱신은 tick마다 배열로 묶어 보내고, renderer는 묶음을 다 접은 뒤 한 번만 알린다. adapter가 지난 대화를 다시 그리는 동안은 묶음 하나로 보낸다. 중간. 추천. emdash(main이 접은 상태와 page), t3code(snapshot 뒤 live, 50ms 묶기), happy(최근 page와 `after_seq`)가 모두 이 꼴이다.
- 채팅 화면 가상화는 lophn agent와 같이 쓰는 화면이라 위를 한 뒤 다시 잰다.

## Claude GUI를 다시 열면 토큰 합계와 비용이 0부터 다시 센다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `claude.ts`의 `totals`·`cost`는 run 메모리에만 있고 `onResult`에서만 더한다. resume, TUI→GUI toggle, `open_session`은 새 run이거나 `resetStats`를 거쳐 0부터 시작하고, `replay`는 transcript의 사용량을 읽지 않는다. transcript에는 assistant entry마다 `message.usage`가 있다. CLI가 resume에 쓰는 `cost-state` entry(`totalCostUSD`, `modelUsage`)도 있다.

영향: GUI의 사용량 칸(input·output·cache token, turn 수, 비용)이 다시 열 때마다 앞 대화를 잃는다. TUI는 같은 session의 비용을 이어 센다.

고치려면: `replay`에서 transcript의 마지막 `cost-state`로 합계와 `cost.base`를 채운다. 없으면 assistant `message.usage`를 `message.id`와 `requestId`로 중복을 빼고 합한다(같은 message가 content block마다 반복된다). 작음. 추천.

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

## 메시지를 보내지 않은 TUI session에서 GUI로 넘기면 resume이 실패한다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: TUI→GUI toggle은 tracker가 아는 TUI session id를 `resume`으로 넘긴다(`packages/shell/main/terminal/gui.ts`의 `open` → `index.ts`의 `gui` → `adapter.start`). 첫 메시지 전의 session은 CLI가 저장하지 않는다.
- Claude: `claude.ts`의 `start`가 없는 id로 `resume`을 열고, `replay`도 그 id를 읽는다. 다시 보내도 같은 id로 다시 열어 계속 실패한다.
- Codex: `codex.ts`의 시작이 `thread/resume`을 그대로 보내고, rollout이 없으면 시작이 실패한다.
- OpenCode는 `api.get`이 실패하면 새 session을 만들지만, 실패한 turn("could not be loaded")을 남긴다.

영향: `claude`·`codex`를 켜고 바로 "Open as chat"을 누르면 GUI를 쓸 수 없다.

고치려면: `start`가 resume 대상이 저장돼 있는지 먼저 보고, 없으면 조용히 새 session을 연다. Claude는 `getSessionInfo`가 없으면 `sessionId: resume`(같은 id, 새 session)으로 연다. Codex는 rollout이 없으면 `thread/start`다. OpenCode는 빈 session이면 실패 줄을 내지 않는다. omp도 `--resume`의 같은 경우를 확인한다. 작음. 추천.
