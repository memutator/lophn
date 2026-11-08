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
