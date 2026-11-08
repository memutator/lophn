# keybindings

desktop 창의 작업대 단축키와 Settings › Keyboard. architecture 문서는 `project-docs/architecture/keybindings.md`.

## browser 머리 줄의 북마크 키와 desktop 팔레트의 Home hint가 사람이 바꾼 키를 따르지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer/browser, packages/shell/renderer/desktop/palette]
```

지금: 북마크 키는 표의 줄 `browser.bookmark`가 되었다. browser page와 탭 본문은 이 줄(사람이 바꾼 키 포함)을 따르지만, card mode 머리 줄(`packages/shell/renderer/browser/browser-chrome.tsx`의 `onKeyDown`)은 여전히 `event.key === "d"`와 Ctrl/Cmd를 직접 본다. desktop 팔레트의 Home 줄 hint(`packages/shell/renderer/desktop/palette/desktop-scope.ts`의 `windowShortcutLabel("home.open", …)`)는 기본 표만 읽는다(workspace 팔레트는 사람이 바꾼 키를 쓴다).

영향: 사람이 Settings에서 북마크 키나 Home 키를 바꾸면, 주소 줄에 focus가 있을 때는 옛 Ctrl/Cmd+D가 북마크를 하고 새 키는 듣지 않는다. Home 화면의 팔레트는 바뀌기 전 키를 hint로 보인다.

고치려면: 머리 줄의 `onKeyDown`을 지우고 머리 줄 요소도 `data-key-context="browser"` 안에 두어 `browser.bookmark` command가 받게 한다(작음). desktop scope builder에 overrides를 넘기거나 `useKeyLabel`을 쓴다(작음). 추천: 둘 다.

## main이 먼저 받는 키를 단 앱 key는 앱 안에서 돌지 않는다

```yaml
kind: bug
modules: [packages/protocol/apps, packages/shell/preload]
```

지금: 앱 key는 guest preload(`packages/shell/preload/app-tool.ts` `createAppKeys`)가 page keydown에서 맞춘다. 그런데 표의 `main` 줄(탭 이동·닫기, `desk.*`, `app.panel:*`, palette·Home 등)은 main의 `before-input-event`(`packages/shell/main/desktop/shortcuts.ts`)가 page보다 먼저 삼킨다. 선언 검사(`packages/protocol/apps/declaration/value.ts`)는 이 chord를 거절하지 않는다.

영향: 앱이 `Ctrl+W`나 `Ctrl+Tab` 같은 키를 선언하면 Settings에는 줄이 보이지만 눌러도 앱 handler가 돌지 않고 탭이 닫히거나 바뀐다.

고치려면: Settings › Keyboard 겹침 검사(`findConflicts`)에 앱 key와 `main` 줄의 겹침을 보이게 한다(작음). 또는 선언 검사가 기본 `main` 줄 chord를 거절한다(작음, 사람이 바꾼 main 키는 못 막는다). 추천: 겹침 검사.

## harness keymap의 키는 Settings 겹침 검사에 잡히지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer/desktop/settings, packages/shell/renderer/commands]
```

지금: harness-gui manifest의 keymap(`WindowCommands.keymap()`)은 Settings › Keyboard의 `agent.*` 줄에 글로만 보이고 `findConflicts`·`checkChord`에 들지 않는다(같은 command의 Ctrl+C 두 줄이 겹침으로 잡히지 않게).

영향: 사람이 `agent.find` 같은 command에 Ctrl+R을 달면 겹침 표시가 없는데, Claude·Codex·omp GUI 안에서는 harness의 Ctrl+R(history 검색)이 안쪽 context라 먼저 받아 사람이 단 키가 돌지 않는다.

고치려면: 겹침 검사에 keymap을 넣되 같은 context·같은 chord의 서로 다른 command 둘(Ctrl+C clear-input·interrupt)만 예외로 둔다(작음).
