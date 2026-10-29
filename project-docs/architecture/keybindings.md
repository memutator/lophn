# keybindings

desktop 창의 단축키가 어디서 받혀 어느 기능의 command로 가는가. 키를 받고 맞추고 부르는 일은 창마다 한 곳이 하고, command가 하는 일은 기능이 갖는다.

## 흐름

```
 OS 전역 (main/desktop/global-shortcut.ts) ── CommandOrControl+Shift+K 하나. Electron globalShortcut
        │ desktop.send("global-palette")
        ▼
 main before-input-event (main/desktop/shortcuts.ts) ── 창의 모든 webContents(앱 view, browser guest, overlay)
   팔레트·런처 chord (ipc/shortcuts.ts WINDOW_SHORTCUTS)
   표에서 `main`이 적힌 command (ipc/keybindings.ts)
        │ shell:shortcut  { "palette" | "launcher" | MainCommand }
        ▼
 renderer PaletteProvider ── palette·launcher는 자기가, 나머지는 registry.execute(id)
                                                         │
 renderer document keydown capture ─▶ KeybindingService ─┤  (commands/keybinding-service.ts)
   listener 하나. 기본 바인딩 = 표(ipc/keybindings.ts)에 사람이 바꾼 키를 덮은 것
                                                         ▼
                                    CommandRegistry (commands/registry.ts) ── id → handler
                                                         ▲
                                    기능이 useCommands(...)로 올린다 (workspace.tsx: tab.*, pane.*, sidebar.toggle …)

 사람이 바꾼 키 (Settings › Keyboard, renderer/desktop/settings/keyboard/)
   선언 설정 shell.keybindings { mac?: {id → chord[]}, other?: {id → chord[]} }  ── core가 저장
        │ Desktop이 core 준비 때 읽고, Keyboard 화면이 고칠 때
        ▼
   WindowCommands.setOverrides(이 OS의 것) ─┬─▶ keybindings.setDefaults(resolveBindings(...))
                                            └─▶ lophnKeybindings.set ─ shell:keybindings ─▶ main이 compileBindings로 덮음
```

- 창 하나에 registry·service가 하나다. `Desktop`(renderer/desktop/main.tsx)이 `createWindowCommands`로 만들고 `CommandsProvider`로 내리며 `document`에 listener를 하나 건다.
- command id는 표의 `Command` 이름 그대로다(`tab.close`, `files.quick-open`). 팔레트·menu·사용자 설정이 같은 id로 부를 수 있다.
- 사람이 바꾸는 단위는 binding id다. 번호가 없는 것은 command 이름, 번호가 있는 것은 `tab.nth:3`·`pane.focus:1`이다(`bindingId`).
- React 쪽은 `useCommands`(commands/react.tsx) 하나다. mount 동안 등록하고 unmount에서 푼다. 판정은 하지 않는다.

## 불변 조건

- **키는 받은 때만 삼킨다.** service는 맞는 chord가 있고 그 command를 지금 부를 수 있을 때(`registry.canRun`)만 `preventDefault`·`stopPropagation` 한다. 주인이 없는 공간(런처, Settings)에서는 Ctrl+B·Ctrl+P가 page로 간다.
- **같은 키는 나중에 묶은 바인딩부터 본다.** 그 command를 부를 수 없으면 다음 바인딩을 본다. 우선순위 수는 두지 않는다.
- **같은 command id는 나중 주인이 받는다.** 그 주인이 풀리면 앞 주인이 다시 받는다. Workspace가 다시 mount될 때 앞 것의 정리와 새 것의 등록이 겹쳐도 command를 잃지 않는다.
- **command `when`이 false면 없는 것과 같다.** 키를 넘기고 `execute`는 `unavailable`이다.
- **handler가 던져도 입력은 산다.** registry가 잡아 log에 남기고 `internal`을 돌린다. listener까지 올라가지 않는다.
- **한글 조합 중(`isComposing`)은 보지 않는다.** 판정은 `code`와 글자 키의 `key`를 같이 본다(ipc/keybindings.ts `chordMatches`).
- **터미널(`[data-terminal-screen]`) 안의 Linux·Windows Ctrl+글자 하나는 shell로 보낸다**(`shellOwns`). 그 밖의 표 키는 앱이 받는다.
- **눌러 둔 반복은 부르지 않고 삼키기만 한다.** 반복을 넘기면 menu의 Close Window가 탄다.
- **main이 먼저 받는 키는 표의 `main`이 정한다.** 앱 view·browser page에 focus가 있으면 renderer keydown이 못 받고, macOS menu key equivalent는 page keydown보다 앞선다. 이 키는 main이 삼켜 같은 command id로 보낸다.
- **사람이 바꾼 키는 검사를 지난 것만 덮는다.** `parseKeyOverrides`가 표에 있는 id와 읽을 수 있는 chord(최대 4개)만 남긴다. 저장 파일이 틀리거나 IPC 값이 틀려도 그 줄만 표의 키가 되고 나머지 키는 산다. main도 같은 함수로 다시 검사한다.
- **빈 chord 목록은 키를 뺀 것이다.** 표와 같은 값은 저장에서 빠진다. OS마다 따로 저장하고 Keyboard 화면은 지금 OS의 것만 바꾼다.
- **새 키는 받기 전에 막는다**(`checkChord`). modifier 없는 키(F1~F12 빼고)는 입력칸 글자를 삼키고, 팔레트·런처·전역 팔레트 키는 main이 먼저 가져가며, 다른 바인딩과 같은 키는 한쪽이 듣지 않는다. 겹침은 modifier 순서와 상관없이 본다.
- **새 키를 받는 칸(`[data-key-capture]`) 안의 키는 command로 보내지 않는다.** service가 그 target을 보지 않는다. 그래서 지금 듣는 키를 눌러도 command가 돌지 않고 칸이 받는다.
- **기능이 `register`로 묶은 바인딩은 늘 기본 바인딩보다 먼저 본다.** 사람이 키를 바꿔 기본 바인딩을 갈아 끼워도 그 순서는 같다.

## 넣지 않은 것

- context key(focus·UI 상태 식). 지금은 command마다 `when` 함수 하나다. 식이 필요해지면 `when`을 바꾸고 service의 순서 규칙은 그대로 둔다.
- 사용자 키는 작업대 단축키 표의 줄만 바꾼다. 팔레트·런처·전역 팔레트 키(ipc/shortcuts.ts)는 바꾸지 않는다. chord는 한 키 조합이고 VS Code의 `Ctrl+K Ctrl+S` 같은 두 단계 chord는 없다.
- 바인딩 소유자(extension)별 일괄 해제. `Disposable`을 모아 푸는 것으로 된다.
- component 안에서만 뜻이 있는 키(목록 화살표, 입력칸 Enter·Esc, browser toolbar의 Ctrl/Cmd+D)는 그 component가 받는다. browser page focus의 Ctrl/Cmd+D는 main이 `bookmark-key`로 보낸다(browser-tab.md).

## 왜 이 모양인가

- 예전에는 Workspace가 `useKeybindings`(document listener)와 `useMainCommand`(main command)로 키를 직접 받아 `runCommand` switch를 불렀다. 키 판정과 기능의 일이 한 component에 묶여, 다른 공간이나 다른 소비자(팔레트, menu)가 같은 command를 부를 길이 없었다.
- registry·service는 React 밖의 값이다. 창 수명과 같고, React의 재렌더와 StrictMode의 이중 effect는 등록·해제 횟수만 바꾼다.
