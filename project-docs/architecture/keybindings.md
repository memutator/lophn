# keybindings

desktop 창의 단축키가 어디서 받혀 어느 기능의 command로 가는가. 키를 받고 맞추고 부르는 일은 창마다 한 곳이 하고, command가 하는 일은 기능이 갖는다. 키는 command id에 붙고, command는 shell 내장 표, extension manifest, 앱 선언이 낸다. 어느 키가 이기는지는 key context(focus가 있는 곳)가 정한다.

## 흐름

```
 OS 전역 (main/desktop/global-shortcut.ts) ── CommandOrControl+Shift+K 하나. Electron globalShortcut
        │ desktop.send("global-palette")
        ▼
 main before-input-event (main/desktop/shortcuts.ts) ── 창의 모든 webContents(창 본문, `<webview>` guest(앱·artifact·browser page), browser native popup·DevTools, overlay)
   표에서 `main`이 적힌 홑 타 binding과 사람이 단 `app.panel:*` (ipc/keybindings.ts). palette·Home(`palette.open`·`home.open`)도 이 줄이다
   browser page(<webview>, view scheme이 아닌 것)만 context `browser`를 알고 `browser.bookmark`를 그 탭의 `bookmark-key`로 보낸다
        │ shell:shortcut  binding id ("tab.close", "desk.nth:3", "palette.open", "app.panel:<app>:<surface>")
        ▼
 renderer PaletteProvider ── parseBindingId → registry.execute(command, arg)
                                                         │
 renderer document keydown capture ─▶ KeybindingService ─┤  (commands/keybinding-service.ts)
   listener 하나. 기본 바인딩 = 표(ipc/keybindings.ts)에 사람이 바꾼 키를 덮은 것
                                                         ▼
                                    CommandRegistry (commands/registry.ts) ── id → handler
                                                         ▲
                                    기능이 useCommands(...)로 올린다 (workspace/workspace-window.tsx: tab.*, pane.*, desk.*, float.*, new.*, nav.*, app.panel …)
                                    여러 탭에 같은 화면이 있는 command(terminal.copy·paste, browser.bookmark, agent.*)는 창 하나의
                                    handler가 focus를 받은 화면의 것을 부른다(WindowCommands.focus, conversation/agent-keys.ts)

 binding의 세 층 (service 안, 같은 context에서 앞이 이긴다)
   사람이 바꾼 키   setUser       ── shell.keybindings. 이 command(와 arg)의 아래 두 층 binding은 모든 context에서 쓰지 않는다
   등록한 키        register·bind·contribute
                     extension manifest  (commands/extension-keys.ts: contributes.commands → `ext.<id>.<name>`, contributes.keybindings → 내장 command에 bind)
                     앱 선언 keys         (commands/app-keys.ts `AppKeyContributions`: apps.tools의 keys → `app.<app id>.<name>`, context `app:<app id>`)
   표의 기본 키     setDefaults   ── ipc/keybindings.ts KEYBINDINGS

 앱 view(<webview> guest, preload/app-tool.ts) 안의 키
   guest가 먼저 맞춘다: 그 앱 key이고 page가 `lophnApp.commands.register`(SDK `useCommand`)로 건 handler의 when이 참이면 실행하고 삼킨다
   아니면 host가 보낸 shell 홑 타 chord(context 없고 지금 부를 수 있는 것)에 맞으면 삼키고 sendToHost(app:keys-forward)
        ▼
   webview-host가 target = webview element로 keybindings.handle  (context는 webview의 `app:<app id>`부터 위로)

 사람이 바꾼 키 (Settings › Keyboard, renderer/desktop/settings/keyboard/)
   선언 설정 shell.keybindings { mac?: {id → chord[]}, other?: {id → chord[]} }  ── core가 저장
        │ Desktop이 core 준비 때 읽고, Keyboard 화면이 고칠 때
        ▼
   WindowCommands.setOverrides(이 OS의 것) ─┬─▶ keybindings.setDefaults(resolveBindings(...))   (표 + 사람이 단 app.panel:*)
                                            ├─▶ lophnKeybindings.set ─ shell:keybindings ─▶ main이 compileBindings로 덮음
                                            └─▶ subscribe한 화면(useKeyLabel: menu·tooltip·DeskSwitcher의 키 이름)이 다시 그린다
```

- 창 하나에 registry·service가 하나다. `Desktop`(renderer/desktop/main.tsx)이 `createWindowCommands`로 만들고 `CommandsProvider`로 내리며 `document`에 listener를 하나 건다.
- command id는 내장이면 표의 `Command` 이름 그대로다(`tab.close`, `files.quick-open`, `agent.rewind`). extension이 낸 것은 `ext.<extension id>.<name>`, 앱이 낸 것은 `app.<app id>.<name>`이다. 팔레트·menu·사용자 설정이 같은 id로 부를 수 있다. 표의 줄마다 `section`(`tab`, `pane`, `desk`, `float`, `open`, `view`, `app`, `agent`, `terminal`, `browser`)이 있고 Settings › Keyboard가 그 순서로 묶는다. 기여한 command는 `contributed` section이고 이름은 manifest·선언의 `title`이다.
- **key context는 DOM 속성이다.** 요소에 `data-key-context="<이름>"`을 단다. keydown target에서 위로 올라가며 만난 이름이 안쪽부터의 stack이고 맨 끝은 `global`이다. 지금 이름: `terminal`(터미널 화면), `browser`(browser 탭), `agentView`·`agentView:<harness>`(agent 화면, GUI 탭은 harness 이름이 안쪽), `composer`, `slashMenu`, `modal`(카드·찾기 줄·이름 입력처럼 Esc·Tab·화살표가 제 뜻인 곳), `app:<app id>`(앱 webview). binding은 `context` 하나를 가질 수 있다.
- **맞추는 순서.** 안쪽 context부터 그 context의 binding을 사람 > 등록 > 기본(같은 층이면 나중 것) 순서로 보고, 다음 바깥 context, 마지막에 context 없는 binding이다. 맞은 것 중 `canRun`(command의 `when`)이 참인 첫 것을 부른다. context가 `defineContext(name, {owns})`로 가진 chord는 그보다 바깥 binding이 받지 않는다: `terminal`은 Linux·Windows의 Ctrl+글자 하나(`shellOwns`), `agentView:<harness>`는 그 harness keymap의 Ctrl+글자 머리, `modal`·`slashMenu`는 modifier 없는 Esc·Tab·화살표(`slashMenu`는 Enter도)다. 가진 chord에 부를 것이 없으면 키는 page(터미널은 PTY, 입력칸은 그 component)로 간다.
- **연속 key는 두 타까지다.** chord 글은 한 타 또는 공백 하나로 이은 두 타(`"Ctrl+KeyX Enter"`, `"Escape Escape"`)다. 첫 타가 지금 부를 수 있는 두 타 binding의 머리이면 삼키고 1.5초(`SEQUENCE_WAIT_MS`) 기다린다. 둘째 타가 맞으면 그것을, 다른 key면 머리를 버리고 그 key를 새로 맞추고, 시간이 다 되면 첫 타의 홑 binding을 부른다. 머리인 두 타 binding을 모두 지금 부를 수 없으면 기다리지 않고 홑 binding을 바로 부른다. 그래서 harness GUI에서 turn이 도는 동안 Esc는 바로 멈추고(`agent.rewind`의 `when`이 거짓), 쉬는 동안 Esc Esc가 되돌리기다. modifier만 누른 keydown은 기다림을 끊지 않는다. main은 두 타 chord를 세지 않는다.
- context menu 항목은 같은 일의 command가 있다(`tab.close-others`, `pane.unsplit`, `pane.close-group`, `tab.float`, `desk.close` …). menu는 누른 tab에, command는 고른 tab에 하고, 작업대는 command를 menu의 `runTabAction`으로 돌려 길이 하나다. menu 항목은 그 command의 키를 오른쪽에 보인다(design `MenuItem.shortcut`).
- 드물거나 지우는 일은 기본 키 없이 표에 있다(`other: []`, `mac: []`). 사람이 Settings에서 단다.
- 사람이 바꾸는 단위는 binding id다. 번호가 없는 것은 command 이름, 번호가 있는 것은 `tab.nth:3`·`pane.focus:1`·`desk.nth:2`이다(`bindingId`, 푸는 것은 `parseBindingId`). `pane.*`는 고른 group 안의 칸(leaf)을 가리킨다: `pane.focus:N`은 N번째 칸, `pane.focus-*`(Ctrl+Alt+화살표, mac은 Cmd+Alt+화살표)는 맞닿은 칸, `pane.swap-*`(Shift를 더한 것)는 맞닿은 칸과 tab 바꾸기, `pane.stack-*`는 한 칸에 쌓인 tab 돌려 보기, `pane.split`·`pane.split-down`은 다음 plain tab과 오른쪽·아래로 묶기다. `desk.next`·`desk.prev`·`desk.nth`는 DeskSwitcher 목록 순서(사람이 만든 desk, 그다음 workflow desk)를 쓴다.
- **앱 panel 열기 키는 `app.panel:<app>:<surface>`다.** 표에 줄이 없고 사람이 단 키에서만 생긴다. `parseKeyOverrides`가 모양을 보고 `resolveBindings`가 표 뒤에 붙인다(section `app`, main 둘 다). 빠른 실행 pin과 상관없이 그 앱 panel 화면을 연다(pin 단추를 누른 것과 같은 길). 앱이 지워져도 저장된 키는 남고 Settings가 "없는 앱" 줄로 보여 지우게 한다.
- React 쪽은 `useCommands`(commands/react.tsx) 하나다. mount 동안 등록하고 unmount에서 푼다. 판정은 하지 않는다.

## 불변 조건

- **키는 받은 때만 삼킨다.** service는 맞는 chord가 있고 그 command를 지금 부를 수 있을 때(`registry.canRun`)만 `preventDefault`·`stopPropagation` 한다. 주인이 없는 공간(Settings)에서는 Ctrl+B·Ctrl+P가 page로 간다.
- **같은 context·같은 층에서는 나중에 묶은 바인딩부터 본다.** 그 command를 부를 수 없으면 다음 바인딩을 본다. 우선순위 수는 두지 않는다. harness keymap의 Ctrl+C는 `agent.interrupt` 뒤에 `agent.clear-input`을 두어, 입력칸에 글이 있으면 지우고, 없고 turn이 돌면 멈추고, 글을 골랐으면 둘 다 거짓이라 복사로 지나간다.
- **사람이 바꾼 키는 그 command의 기본·등록 키를 모든 context에서 대신한다.** Settings에서 `agent.cycle-mode`를 바꾸면 네 harness keymap의 Shift+Tab이 같이 빠진다. 빈 목록으로 저장하면 그 command는 키가 없다.
- **같은 command id는 나중 주인이 받는다.** 그 주인이 풀리면 앞 주인이 다시 받는다. workspace 창이 다시 mount될 때 앞 것의 정리와 새 것의 등록이 겹쳐도 command를 잃지 않는다.
- **command `when`이 false면 없는 것과 같다.** 키를 넘기고 `execute`는 `unavailable`이다.
- **handler가 던져도 입력은 산다.** registry가 잡아 log에 남기고 `internal`을 돌린다. listener까지 올라가지 않는다.
- **한글 조합 중(`isComposing`)과 modifier만 누른 keydown은 보지 않는다.** 판정은 `code`와 글자 키의 `key`를 같이 본다(ipc/keybindings.ts `chordMatches`).
- **터미널(context `terminal`) 안의 Linux·Windows Ctrl+글자 하나는 shell로 보낸다**(`terminal`의 `owns` = `shellOwns`). 예외는 palette·Home이다: main이 shell 창 본문에서도 이 둘은 늘 삼켜 보낸다(터미널 안에서도 팔레트가 열린다).
- **눌러 둔 반복은 부르지 않고 삼키기만 한다.** 반복을 넘기면 menu의 Close Window가 탄다. 반복은 연속 key를 시작하거나 끝내지 않는다(Esc를 누르고 있어도 Esc Esc가 되지 않는다).
- **main이 먼저 받는 키는 표의 `main`이 정한다.** tab 이동·닫기·다시 열기, `new.browser`, `desk.next`·`desk.prev`·`desk.nth`, 모든 `app.panel:*`이다. 나머지는 page·앱이 쓰는 키를 빼앗지 않게 renderer만 받는다. `<webview>` guest(앱·artifact·browser page)나 native popup·DevTools에 focus가 있으면 renderer keydown이 못 받고, macOS menu key equivalent는 page keydown보다 앞선다. 이 키는 main이 삼켜 같은 command id로 보낸다. guest는 창의 자식 view가 아니라서 `wiring/desktop.ts`가 `contents.hostWebContents`로 그 창을 찾는다.
- **사람이 바꾼 키는 검사를 지난 것만 덮는다.** `parseKeyOverrides`가 표에 있는 id, `app.panel:*`, 꼴이 맞는 `ext.*`·`app.*` id와 읽을 수 있는 chord(한 타나 두 타, 최대 4개)만 남긴다. 지금 기여되지 않은 `ext.*`·`app.*` id(extension을 껐거나 앱을 지움)의 값도 버리지 않는다. Settings는 "없는 command" 줄로 보여 지우게 하고, 다른 줄을 저장해도 그 값은 남는다. 저장 파일이 틀리거나 IPC 값이 틀려도 그 줄만 표의 키가 되고 나머지 키는 산다. main도 같은 함수로 다시 검사한다.
- **빈 chord 목록은 키를 뺀 것이다.** 표와 같은 값은 저장에서 빠진다. OS마다 따로 저장하고 Keyboard 화면은 지금 OS의 것만 바꾼다.
- **새 키는 받기 전에 본다**(`checkChord`). 두 타면 타마다 본다. modifier 없는 키(F1~F12 빼고)는 입력칸 글자를 삼켜서, RESERVED(전역 팔레트 키, 글자 편집 Ctrl/Cmd+A·C·V·X·Z, OS 키 Cmd+Q·H·M·Tab·Space, Alt+F4 등)는 lophn이나 OS가 먼저 가져가서 거절한다. palette·Home·북마크·터미널 복사·붙여 넣기는 이제 표의 줄이라 바꿀 수 있다. 다른 바인딩이 쓰는 키(`taken`)는 거절하지 않고 "바꾸기"를 준다: 이 줄에 달고 그 chord를 가진 다른 줄에서는 그 chord만 뺀 변경 하나로 저장한다(`takeKeys`). 겹침은 modifier 순서와 상관없이 본다.
- **겹침은 저장된 값에서도 본다**(`findConflicts`). 같은 platform·같은 context에서 두 binding이 같은 chord를 가지거나, 사람이 단 키가 RESERVED와 같으면 겹침이다(표가 바뀌어 옛 사람 키와 새 기본 키가 부딪힌 경우). chord마다 하나이고 `ids`는 표 순서다. 겹치면 표 순서가 앞인 binding이 받는다. Settings › Keyboard는 맨 위에 겹친 수와 "겹친 것만 보기"를, 겹친 줄에 상대 이름과 빼기를 보인다. 기본 표에는 겹침이 없다(test). context가 다르면 같은 chord라도 겹침이 아니고, 두 타의 머리가 홑 binding과 같아도 겹침이 아니다. harness keymap은 겹침 검사에 들지 않고 `agent.*` 줄에 harness별 글로 보인다.
- **그 workspace에 그 일이 없으면 키를 삼키지 않는다.** 통로가 없는 command(Home의 터미널·Explorer·desk, 앱 통로가 없는 `app.panel`)는 올리지 않고, 지금 사정에 기대는 command(group이 아닐 때 `pane.*`, 쌓이지 않은 칸의 `pane.stack-*`, float이 없을 때 `float.*`, 이동 기록이 없을 때 `nav.*`)는 `when`으로 막는다. `when` 판정은 context menu가 그 항목을 보이는 사정(`menuStateOf`)과 같다. 번호(arg)마다의 판정은 하지 않는다.
- **새 키를 받는 칸(`[data-key-capture]`) 안의 키는 command로 보내지 않는다.** service가 그 target을 보지 않는다. 그래서 지금 듣는 키를 눌러도 command가 돌지 않고 칸이 받는다. 이 칸은 한 타 뒤 1.5초를 기다려 둘째 타를 받는다.
- **여러 화면에 같은 command가 있으면 focus를 받은 화면이 받는다.** registry는 id마다 마지막 주인만 부르므로 터미널·browser·agent 화면은 focus가 들어올 때 `WindowCommands.focus.set(id, run, when)`로 자리를 맡고, 창 하나의 command가 그 화면의 `run`·`when`을 부른다(`FOCUSED_COMMANDS`).
- **앱 key는 그 앱 webview 안에서 guest가 먼저 판정한다.** `when`이 guest 안의 함수라 main이 동기로 판단할 수 없어서다. 앱 key는 홑 타이고 modifier나 F1~F12가 있어야 한다(선언 검사). browser 탭(남의 page)과 artifact에는 이 preload가 없어 page가 키를 받는다. main이 먼저 받는 키(`main` 줄)는 page에 닿지 않아 그 chord의 앱 key는 돌지 않는다(`project-docs/issues/keybindings.md`).

## 넣지 않은 것

- `when` 식 언어. command마다 `when` 함수 하나이고 context는 DOM 속성 이름뿐이다.
- 세 타 이상의 연속 key. Settings에서 사람이 `Escape Escape`처럼 modifier 없는 두 타를 새로 달 수는 없다(기본·manifest keymap만 쓴다).
- 전역 팔레트 키(`GLOBAL_PALETTE_ACCELERATOR`)는 OS 등록이라 바꾸지 않는다. extension·앱이 OS 전역 키를 거는 것도 없다.
- harness GUI에서 각 CLI 자신의 key 설정 file(`~/.claude/keybindings.json` 등)을 읽는 것. 각 CLI의 기본 key와 lophn Settings만 쓴다.
- harness마다 따로 키를 바꾸기. Settings에서 바꾼 키는 그 command의 모든 harness keymap을 대신한다.
- 팔레트의 "모든 command 실행" 목록. 팔레트는 행동 행 몇 개의 hint만 표의 키로 보인다.
- 앱 단축키를 OS 전역 단축키로 거는 것. 창 안에서만 받는다.
- 바인딩 소유자(extension)별 일괄 해제. `Disposable`을 모아 푸는 것으로 된다.
- component 안에서만 뜻이 있는 키(목록과 slash menu의 화살표, popover를 닫는 Esc)는 그 component가 받는다. browser 머리 줄의 Ctrl/Cmd+D는 아직 component가 직접 받는다(`project-docs/issues/keybindings.md`).

## 기본 키를 고른 규칙

- 자주 쓰고 이름난 키가 있는 것(VS Code·Chrome)만 기본 키를 준다.
- Linux·Windows의 `Ctrl+Alt+숫자`는 AltGr 배열에서 `{ [ ] @`를 치는 키라 쓰지 않는다(desk 번호는 `Ctrl+Shift+숫자`).
- Explorer의 F2, 터미널 Ctrl+Shift+C/V, 글자 편집 키는 빼앗지 않는다. 편집기의 `Shift+Mod+\`(괄호 짝)와 `Mod+Alt+↑↓`(커서 더하기)는 `pane.split-down`·`pane.focus-*`가 가린다(VS Code와 같은 선택).
- Linux·Windows 터미널에서 Ctrl+글자 하나(W·B·P·T·N·O)는 shell로 간다(`shellOwns`).
- harness GUI 안에서는 그 CLI의 key가 lophn 탭·창 key와 desktop 관례보다 먼저다(사람, 2026-11-08). 터미널에서 Ctrl+글자가 PTY로 가는 것과 같다. harness keymap은 roadmap 조사 표의 각 CLI 기본 key이고 harness-gui manifest에 있다([harness-gui.md](harness-gui.md)).

## 왜 이 모양인가

- 예전에는 Workspace가 `useKeybindings`(document listener)와 `useMainCommand`(main command)로 키를 직접 받아 `runCommand` switch를 불렀다. 키 판정과 기능의 일이 한 component에 묶여, 다른 공간이나 다른 소비자(팔레트, menu)가 같은 command를 부를 길이 없었다.
- main → renderer payload가 command 이름이던 때는 arg를 실을 수 없어 `desk.nth`·`app.panel`을 main이 보낼 수 없었다. binding id 글자 하나로 바꿔 type(`MainCommand`) 목록을 따로 두지 않고 표의 `main`만 본다.
- 앱 단축키를 표 밖의 동적 binding으로 둔 것은 설치된 앱이 사람마다 다르기 때문이다. 같은 `shell.keybindings`에 저장해 겹침 판정과 main 통로를 그대로 쓴다. extension·앱 command도 같은 저장과 같은 Settings 줄을 쓴다. 그래서 `shell.keybindings`의 모양은 바뀌지 않았다.
- context를 등록 저장소가 아니라 DOM 속성으로 둔 것은 focus가 이미 DOM에 있어서다. 화면이 자기 요소에 이름을 달면 끝이고, 떼어 낼 때 풀 것이 없다. Claude CLI·Codex·emdash도 화면에 뜬 UI가 context를 켜는 같은 꼴이다.
- 표 밖에서 keydown을 직접 듣던 곳(composer Enter·Esc, 찾기 Ctrl+F, thread index Alt+↑↓, palette·Home, 북마크, 터미널 복사·붙여 넣기)을 command로 옮겼다. 사람이 바꿀 수 있고 겹침 검사에 잡힌다. service가 `document` capture에서 먼저 받으므로 화면 component의 `onKeyDown`보다 앞선다. 제 뜻의 Esc·Enter·화살표를 쓰는 요소는 `modal`·`slashMenu` context로 그 키를 가진다.
- registry·service는 React 밖의 값이다. 창 수명과 같고, React의 재렌더와 StrictMode의 이중 effect는 등록·해제 횟수만 바꾼다.
