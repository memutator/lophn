# keybindings

desktop 창의 단축키가 어디서 받혀 어느 기능의 command로 가는가. 키를 받고 맞추고 부르는 일은 창마다 한 곳이 하고, command가 하는 일은 기능이 갖는다.

## 흐름

```
 OS 전역 (main/desktop/global-shortcut.ts) ── CommandOrControl+Shift+K 하나. Electron globalShortcut
        │ desktop.send("global-palette")
        ▼
 main before-input-event (main/desktop/shortcuts.ts) ── 창의 모든 webContents(창 본문, `<webview>` guest(앱·artifact·browser page), browser native popup·DevTools, overlay)
   팔레트·home chord (ipc/shortcuts.ts WINDOW_SHORTCUTS. home = Home workspace로 가기)
   표에서 `main`이 적힌 binding과 사람이 단 `app.panel:*` (ipc/keybindings.ts)
        │ shell:shortcut  "palette" | "home" | binding id ("tab.close", "desk.nth:3", "app.panel:<app>:<surface>")
        ▼
 renderer PaletteProvider ── palette·home은 자기가, 나머지는 parseBindingId → registry.execute(command, arg)
                                                         │
 renderer document keydown capture ─▶ KeybindingService ─┤  (commands/keybinding-service.ts)
   listener 하나. 기본 바인딩 = 표(ipc/keybindings.ts)에 사람이 바꾼 키를 덮은 것
                                                         ▼
                                    CommandRegistry (commands/registry.ts) ── id → handler
                                                         ▲
                                    기능이 useCommands(...)로 올린다 (workspace/workspace-window.tsx: tab.*, pane.*, desk.*, float.*, new.*, nav.*, app.panel …)

 사람이 바꾼 키 (Settings › Keyboard, renderer/desktop/settings/keyboard/)
   선언 설정 shell.keybindings { mac?: {id → chord[]}, other?: {id → chord[]} }  ── core가 저장
        │ Desktop이 core 준비 때 읽고, Keyboard 화면이 고칠 때
        ▼
   WindowCommands.setOverrides(이 OS의 것) ─┬─▶ keybindings.setDefaults(resolveBindings(...))   (표 + 사람이 단 app.panel:*)
                                            ├─▶ lophnKeybindings.set ─ shell:keybindings ─▶ main이 compileBindings로 덮음
                                            └─▶ subscribe한 화면(useKeyLabel: menu·tooltip·DeskSwitcher의 키 이름)이 다시 그린다
```

- 창 하나에 registry·service가 하나다. `Desktop`(renderer/desktop/main.tsx)이 `createWindowCommands`로 만들고 `CommandsProvider`로 내리며 `document`에 listener를 하나 건다.
- command id는 표의 `Command` 이름 그대로다(`tab.close`, `files.quick-open`). 팔레트·menu·사용자 설정이 같은 id로 부를 수 있다. 표의 줄마다 `section`(`tab`, `pane`, `desk`, `float`, `open`, `view`, `app`)이 있고 Settings › Keyboard가 그 순서로 묶는다. 표는 그 순서로 놓였다.
- context menu 항목은 같은 일의 command가 있다(`tab.close-others`, `pane.unsplit`, `pane.close-group`, `tab.float`, `desk.close` …). menu는 누른 tab에, command는 고른 tab에 하고, 작업대는 command를 menu의 `runTabAction`으로 돌려 길이 하나다. menu 항목은 그 command의 키를 오른쪽에 보인다(design `MenuItem.shortcut`).
- 드물거나 지우는 일은 기본 키 없이 표에 있다(`other: []`, `mac: []`). 사람이 Settings에서 단다.
- 사람이 바꾸는 단위는 binding id다. 번호가 없는 것은 command 이름, 번호가 있는 것은 `tab.nth:3`·`pane.focus:1`·`desk.nth:2`이다(`bindingId`, 푸는 것은 `parseBindingId`). `pane.*`는 고른 group 안의 칸(leaf)을 가리킨다: `pane.focus:N`은 N번째 칸, `pane.focus-*`(Ctrl+Alt+화살표, mac은 Cmd+Alt+화살표)는 맞닿은 칸, `pane.swap-*`(Shift를 더한 것)는 맞닿은 칸과 tab 바꾸기, `pane.stack-*`는 한 칸에 쌓인 tab 돌려 보기, `pane.split`·`pane.split-down`은 다음 plain tab과 오른쪽·아래로 묶기다. `desk.next`·`desk.prev`·`desk.nth`는 DeskSwitcher 목록 순서(사람이 만든 desk, 그다음 workflow desk)를 쓴다.
- **앱 단축키는 `app.panel:<app>:<surface>`다.** 표에 줄이 없고 사람이 단 키에서만 생긴다. `parseKeyOverrides`가 모양을 보고 `resolveBindings`가 표 뒤에 붙인다(section `app`, main 둘 다). 빠른 실행 pin과 상관없이 그 앱 panel 화면을 연다(pin 단추를 누른 것과 같은 길). 앱이 지워져도 저장된 키는 남고 Settings가 "없는 앱" 줄로 보여 지우게 한다.
- React 쪽은 `useCommands`(commands/react.tsx) 하나다. mount 동안 등록하고 unmount에서 푼다. 판정은 하지 않는다.

## 불변 조건

- **키는 받은 때만 삼킨다.** service는 맞는 chord가 있고 그 command를 지금 부를 수 있을 때(`registry.canRun`)만 `preventDefault`·`stopPropagation` 한다. 주인이 없는 공간(Settings)에서는 Ctrl+B·Ctrl+P가 page로 간다.
- **같은 키는 나중에 묶은 바인딩부터 본다.** 그 command를 부를 수 없으면 다음 바인딩을 본다. 우선순위 수는 두지 않는다.
- **같은 command id는 나중 주인이 받는다.** 그 주인이 풀리면 앞 주인이 다시 받는다. workspace 창이 다시 mount될 때 앞 것의 정리와 새 것의 등록이 겹쳐도 command를 잃지 않는다.
- **command `when`이 false면 없는 것과 같다.** 키를 넘기고 `execute`는 `unavailable`이다.
- **handler가 던져도 입력은 산다.** registry가 잡아 log에 남기고 `internal`을 돌린다. listener까지 올라가지 않는다.
- **한글 조합 중(`isComposing`)은 보지 않는다.** 판정은 `code`와 글자 키의 `key`를 같이 본다(ipc/keybindings.ts `chordMatches`).
- **터미널(`[data-terminal-screen]`) 안의 Linux·Windows Ctrl+글자 하나는 shell로 보낸다**(`shellOwns`). 그 밖의 표 키는 앱이 받는다.
- **눌러 둔 반복은 부르지 않고 삼키기만 한다.** 반복을 넘기면 menu의 Close Window가 탄다.
- **main이 먼저 받는 키는 표의 `main`이 정한다.** tab 이동·닫기·다시 열기, `new.browser`, `desk.next`·`desk.prev`·`desk.nth`, 모든 `app.panel:*`이다. 나머지는 page·앱이 쓰는 키를 빼앗지 않게 renderer만 받는다. `<webview>` guest(앱·artifact·browser page)나 native popup·DevTools에 focus가 있으면 renderer keydown이 못 받고, macOS menu key equivalent는 page keydown보다 앞선다. 이 키는 main이 삼켜 같은 command id로 보낸다. guest는 창의 자식 view가 아니라서 `wiring/desktop.ts`가 `contents.hostWebContents`로 그 창을 찾는다.
- **사람이 바꾼 키는 검사를 지난 것만 덮는다.** `parseKeyOverrides`가 표에 있는 id와 읽을 수 있는 chord(최대 4개)만 남긴다. 저장 파일이 틀리거나 IPC 값이 틀려도 그 줄만 표의 키가 되고 나머지 키는 산다. main도 같은 함수로 다시 검사한다.
- **빈 chord 목록은 키를 뺀 것이다.** 표와 같은 값은 저장에서 빠진다. OS마다 따로 저장하고 Keyboard 화면은 지금 OS의 것만 바꾼다.
- **새 키는 받기 전에 본다**(`checkChord`). modifier 없는 키(F1~F12 빼고)는 입력칸 글자를 삼켜서, RESERVED(팔레트·home·전역 팔레트 키, Linux·Windows 터미널의 Ctrl+Shift+C/V, 글자 편집 Ctrl/Cmd+A·C·V·X·Z, OS 키 Cmd+Q·H·M·Tab·Space, Alt+F4 등)는 lophn이나 OS가 먼저 가져가서 거절한다. 다른 바인딩이 쓰는 키(`taken`)는 거절하지 않고 "바꾸기"를 준다: 이 줄에 달고 그 chord를 가진 다른 줄에서는 그 chord만 뺀 변경 하나로 저장한다(`takeKeys`). 겹침은 modifier 순서와 상관없이 본다.
- **겹침은 저장된 값에서도 본다**(`findConflicts`). 같은 platform에서 두 binding이 같은 chord를 가지거나, 사람이 단 키가 RESERVED와 같으면 겹침이다(표가 바뀌어 옛 사람 키와 새 기본 키가 부딪힌 경우). chord마다 하나이고 `ids`는 표 순서다. 겹치면 표 순서가 앞인 binding이 받는다. Settings › Keyboard는 맨 위에 겹친 수와 "겹친 것만 보기"를, 겹친 줄에 상대 이름과 빼기를 보인다. 기본 표에는 겹침이 없다(test).
- **그 workspace에 그 일이 없으면 키를 삼키지 않는다.** 통로가 없는 command(Home의 터미널·Explorer·desk, 앱 통로가 없는 `app.panel`)는 올리지 않고, 지금 사정에 기대는 command(group이 아닐 때 `pane.*`, 쌓이지 않은 칸의 `pane.stack-*`, float이 없을 때 `float.*`, 이동 기록이 없을 때 `nav.*`)는 `when`으로 막는다. `when` 판정은 context menu가 그 항목을 보이는 사정(`menuStateOf`)과 같다. 번호(arg)마다의 판정은 하지 않는다.
- **새 키를 받는 칸(`[data-key-capture]`) 안의 키는 command로 보내지 않는다.** service가 그 target을 보지 않는다. 그래서 지금 듣는 키를 눌러도 command가 돌지 않고 칸이 받는다.
- **기능이 `register`로 묶은 바인딩은 늘 기본 바인딩보다 먼저 본다.** 사람이 키를 바꿔 기본 바인딩을 갈아 끼워도 그 순서는 같다.

## 넣지 않은 것

- context key(focus·UI 상태 식). 지금은 command마다 `when` 함수 하나다. 식이 필요해지면 `when`을 바꾸고 service의 순서 규칙은 그대로 둔다.
- 사용자 키는 작업대 단축키 표의 줄과 `app.panel:*`만 바꾼다. 팔레트·home·전역 팔레트 키(ipc/shortcuts.ts)는 바꾸지 않는다. chord는 한 키 조합이고 VS Code의 `Ctrl+K Ctrl+S` 같은 두 단계 chord는 없다.
- 팔레트의 "모든 command 실행" 목록. 팔레트는 행동 행 몇 개의 hint만 표의 키로 보인다.
- 앱 단축키를 OS 전역 단축키로 거는 것. 창 안에서만 받는다.
- 바인딩 소유자(extension)별 일괄 해제. `Disposable`을 모아 푸는 것으로 된다.
- component 안에서만 뜻이 있는 키(목록 화살표, 입력칸 Enter·Esc, browser 머리 줄의 Ctrl/Cmd+D)는 그 component가 받는다. browser page focus의 Ctrl/Cmd+D는 main이 `bookmark-key`로 보낸다(browser-tab.md).

## 기본 키를 고른 규칙

- 자주 쓰고 이름난 키가 있는 것(VS Code·Chrome)만 기본 키를 준다.
- Linux·Windows의 `Ctrl+Alt+숫자`는 AltGr 배열에서 `{ [ ] @`를 치는 키라 쓰지 않는다(desk 번호는 `Ctrl+Shift+숫자`).
- Explorer의 F2, 터미널 Ctrl+Shift+C/V, 글자 편집 키는 빼앗지 않는다. 편집기의 `Shift+Mod+\`(괄호 짝)와 `Mod+Alt+↑↓`(커서 더하기)는 `pane.split-down`·`pane.focus-*`가 가린다(VS Code와 같은 선택).
- Linux·Windows 터미널에서 Ctrl+글자 하나(W·B·P·T·N·O)는 shell로 간다(`shellOwns`).

## 왜 이 모양인가

- 예전에는 Workspace가 `useKeybindings`(document listener)와 `useMainCommand`(main command)로 키를 직접 받아 `runCommand` switch를 불렀다. 키 판정과 기능의 일이 한 component에 묶여, 다른 공간이나 다른 소비자(팔레트, menu)가 같은 command를 부를 길이 없었다.
- main → renderer payload가 command 이름이던 때는 arg를 실을 수 없어 `desk.nth`·`app.panel`을 main이 보낼 수 없었다. binding id 글자 하나로 바꿔 type(`MainCommand`) 목록을 따로 두지 않고 표의 `main`만 본다.
- 앱 단축키를 표 밖의 동적 binding으로 둔 것은 설치된 앱이 사람마다 다르기 때문이다. 같은 `shell.keybindings`에 저장해 겹침 판정과 main 통로를 그대로 쓴다.
- registry·service는 React 밖의 값이다. 창 수명과 같고, React의 재렌더와 StrictMode의 이중 effect는 등록·해제 횟수만 바꾼다.
