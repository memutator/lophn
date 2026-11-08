# agent-chat

agent 채팅 화면(`AgentView`, `packages/shell/renderer/conversation/`). lophn agent 탭과 harness GUI가 같이 쓴다. architecture: `project-docs/architecture/agent-chat.md`.

## 대화를 key로 scroll할 수 없다

```yaml
kind: bug
modules: [packages/shell/ipc, packages/shell/renderer]
```

지금: `packages/shell/ipc/keybindings.ts`의 `agent.*` command에 scroll(한 화면 위·아래, 맨 위·맨 아래)이 없다. harness-gui manifest의 keymap도 같은 command만 다시 단다. 대화 scroll 칸(`message-list/thread-scroll.tsx` `ThreadScroll`)은 `tabIndex`가 없고 focus는 보통 입력칸에 있어, PageUp·PageDown은 입력칸 caret만 옮긴다. `message-list/follow.ts`는 그 key를 맨 아래 따라가기를 끄는 데만 본다.

영향: 사람이 긴 대화를 mouse 없이 올려 읽지 못한다. harness GUI를 CLI 대신 쓰는 사람이 가장 먼저 느낀다(CLI TUI는 key로 scroll한다).

고치려면: `agent.scroll-page-up`·`scroll-page-down`·`scroll-top`·`scroll-bottom` command를 context `agentView`에 PageUp·PageDown·Ctrl+Home·Ctrl+End로 더하고, `agent-view.tsx` route가 `ThreadScroll`이 내놓는 scroll handle을 부른다. 위로 갈 때는 따라가기를 끈다. PageUp·PageDown은 tab·pane key(`Ctrl+PageUp`, `Alt+PageUp` 등)와 겹치지 않는다. 중간. 추천.

## 메시지를 보내도 대화가 맨 아래로 가지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `ThreadScroll`(`message-list/thread-scroll.tsx`)은 `following`이 켜져 있을 때만 맨 아래로 간다. `following`을 다시 켜는 것은 맨 아래 여유(`BOTTOM_SLACK`) 안으로 scroll해 내려오기, "최신으로" 버튼, 처음 그리기뿐이다(`follow.ts`). 보내기(`agent-view.tsx` `dispatch` → `agent-thread.tsx`의 `outgoing` 줄)는 `following`을 건드리지 않는다. 조금이라도 올려 읽었거나 저장된 읽던 위치로 탭을 다시 열었으면, 보낸 메시지가 화면 밖에 붙고 화면은 그대로다.

영향: 사람이 보낸 메시지와 그 답을 보려면 손으로 내려가야 한다. lophn agent와 harness GUI 모두다.

고치려면: 사람이 보내기를 하면 `ThreadScroll`이 따라가기를 켜고 맨 아래로 간다(예: `outgoing.id`를 prop으로 받아 바뀌면 "최신으로"와 같은 길). 작음. 추천.
