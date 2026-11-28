# keybindings

desktop 창의 단축키 설계다. 사람이 누른 키는 창마다 한 곳이 받아 맞추고, 맞은 키는 command id로 바뀌어 그 일을 가진 기능으로 간다. 키는 command에 붙고, command는 shell 내장 표, extension manifest, 앱 선언이 낸다. 같은 키를 여러 곳이 원할 때 누가 이기는지는 key context(focus가 있는 곳)가 정한다. 사람은 Settings › Keyboard에서 키를 보고 바꾸고, 바꾼 키는 창과 main에 같이 덮인다.

## 문제

- 키 판정과 기능의 일이 한 component에 묶이면 다른 소비자(팔레트, context menu, 사용자 설정)가 같은 일을 부를 길이 없고, 사람이 키를 볼 곳도 바꿀 길도 없다.
- 키가 닿는 곳이 여럿이다. OS 전역 키, 창의 renderer, `<webview>` guest(앱·artifact·browser page), native popup·DevTools, macOS의 menu key equivalent가 서로 다른 순서로 키를 먼저 가져간다. 한 곳에서만 받으면 page에 focus가 있을 때 탭 키가 shell에 닿지 않거나, 앱이 창을 닫아 버린다.
- 같은 키가 화면마다 다른 뜻이다. 터미널의 Ctrl+W는 shell로, harness GUI의 Ctrl+C는 그 CLI의 뜻으로, 입력칸의 Esc·Enter·화살표는 그 칸의 뜻으로 가야 한다. 이것을 짐작이 아닌 규칙으로 갖지 않으면 키를 빼앗거나 놓친다.
- 사람이 바꾼 키, extension·앱이 내는 키, 표의 기본 키가 부딪힌다. 겹침을 알려 주지 않으면 사람이 단 키가 조용히 돌지 않는다.

## 목표와 비목표

- 목표: 키를 받고 맞추고 부르는 길이 창마다 하나다. command의 일은 기능이 갖는다. 팔레트·menu·사용자 설정이 같은 command id를 쓴다. 사람이 키를 바꾸고 겹침을 알아챈다. extension과 앱도 key를 낼 수 있다.
- 비목표: `when` 식 언어(command마다 `when` 함수 하나, context는 DOM 속성 이름뿐), 세 타 이상의 연속 key, 전역 팔레트 키 바꾸기와 extension·앱의 OS 전역 키(OS 등록이라 창 안 길과 다르다), 각 CLI 자신의 key 설정 file 읽기(CLI 기본 key와 lophn Settings만 쓴다), harness마다 따로 키 바꾸기, 팔레트의 "모든 command 실행" 목록(행동 행 몇 개의 hint만 표의 키로 보인다), 바인딩 소유자(extension)별 일괄 해제, component 안에서만 뜻이 있는 키(목록·slash menu의 화살표, popover를 닫는 Esc)를 표에 올리는 것(그 component가 받는다).
- 비목표: Settings에서 사람이 modifier 없는 두 타(`Escape Escape` 같은 것)를 새로 다는 것. 기본 key와 manifest keymap에서만 쓴다.

## 모델

### 받는 길

```
 OS 전역 ── CommandOrControl+Shift+K 하나. 팔레트를 연다.
        │ desktop 창에 global-palette를 보낸다
        ▼
 main의 창 입력 감시 ── 창의 모든 webContents(창 본문, <webview> guest, browser native popup·DevTools, overlay)
   표에서 main이 적힌 홑 타 binding과 사람이 단 app.panel:*만 본다
   browser page(view scheme이 아닌 것)만 context browser를 알고 browser.bookmark를 그 탭에 보낸다
        │ shell:shortcut  payload는 binding id ("tab.close", "desk.nth:3", "palette.open", "app.panel:<app>:<surface>")
        ▼
 renderer 창 ──▶ command registry ── id → handler
                       ▲
 renderer document keydown capture ─▶ keybinding service ─┘   (창 하나에 listener 하나)
   binding = 표의 기본 키에 사람이 바꾼 키를 덮은 것
```

창 하나에 registry와 service가 하나다. 둘 다 React 밖의 값이고 창 수명과 같다. React의 재렌더와 StrictMode의 이중 effect는 등록·해제 횟수만 바꾼다. 기능 화면은 mount 동안 command를 올리고 unmount에서 푼다. 올린 쪽은 판정을 하지 않는다.

### command id와 binding id

- command id는 내장이면 표의 이름 그대로다(`tab.close`, `files.quick-open`, `agent.rewind`). extension이 낸 것은 `ext.<extension id>.<name>`, 앱이 낸 것은 `app.<app id>.<name>`, 지금 project의 project command가 내는 동적 id는 `project-command.<id>.run`·`project-command.<id>.stop`·`project-command.<id>.restart`다(기본 단축키는 없고 Settings › Keyboard에서 바인딩하며 Ctrl+K palette 행동 행에 hint로 보인다). 팔레트·menu·사용자 설정이 같은 id로 부른다.
- 표의 줄에는 section(`tab`, `pane`, `desk`, `float`, `open`, `view`, `app`, `agent`, `terminal`, `browser`)이 있고 Settings › Keyboard가 그 순서로 묶는다. 기여한 command는 `contributed` section이고 이름은 manifest·선언의 `title`이다.
- 번호가 붙는 command는 binding id에 번호가 붙는다: `tab.nth:3`, `pane.focus:1`, `desk.nth:2`. main이 renderer로 보내는 payload도 이 글자 하나라 arg를 실을 수 있다. 사람이 바꾸는 저장 단위도 binding id다. 화면은 command마다 한 줄이고 번호 줄은 modifier 하나를 받아 모든 번호에 붙인다(`Alt+0–9`). 같은 줄의 번호끼리는 겹쳐도 된다.
- 앱 panel을 여는 키는 `app.panel:<app>:<surface>`다. 표에 줄이 없고 사람이 단 키에서만 생기며 section `app`, main이 먼저 받는 줄이다. 빠른 실행 pin과 상관없이 그 앱 panel 화면을 연다(pin 단추를 누른 것과 같다). 앱이 지워져도 저장된 키는 남고 Settings가 "없는 앱" 줄로 보여 지우게 한다.
- command 몇 가지의 뜻: `pane.*`는 고른 group 안의 칸을 가리킨다. `pane.focus:N`은 N번째 칸, `pane.focus-*`(Ctrl+Alt+화살표, mac은 Cmd+Alt+화살표)는 맞닿은 칸, `pane.swap-*`(Shift를 더한 것)는 맞닿은 칸과 tab 바꾸기, `pane.stack-*`는 한 칸에 쌓인 tab 돌려 보기, `pane.split`·`pane.split-down`은 다음 plain tab과 오른쪽·아래로 묶기다. `desk.next`·`desk.prev`·`desk.nth`는 DeskSwitcher의 목록 순서(사람이 만든 desk, 그다음 workflow desk)를 쓴다. `inbox.open`·`jobs.open`은 Inbox·Jobs 탭을 연다.
- context menu 항목에는 같은 일의 command가 있다(`tab.close-others`, `pane.unsplit`, `pane.close-group`, `tab.float`, `desk.close` …). menu는 누른 tab에, command는 고른 tab에 한다. 작업대는 command를 menu 항목과 같은 동작으로 돌려 길이 하나다. menu·+ menu·빠른 실행·tooltip·팔레트 행동 행·desk 목록은 그 일의 지금 키를 보이고, Settings에서 키를 바꾸면 바로 따라 바뀐다.
- 드물거나 지우는 일은 기본 키 없이 표에 있다. 사람이 Settings에서 단다.

### binding의 세 층

같은 context에서 앞 층이 이긴다.

1. 사람이 바꾼 키. 저장은 선언 설정 `shell.keybindings`다.
2. 등록한 키. extension manifest의 `contributes.commands`(→ `ext.<id>.<name>`)와 `contributes.keybindings`(내장 command에 붙인다), 앱 선언의 `keys`(→ `app.<app id>.<name>`, context `app:<app id>`).
3. 표의 기본 키.

### key context

context는 DOM 속성이다. 요소에 `data-key-context="<이름>"`을 달면 된다. keydown target에서 위로 올라가며 만난 이름이 안쪽부터의 stack이고 맨 끝은 `global`이다. binding은 `context` 하나를 가질 수 있다.

이름: `terminal`(터미널 화면), `browser`(browser 탭), `agentView`·`agentView:<harness>`(agent 화면, GUI 탭은 harness 이름이 안쪽), `composer`, `slashMenu`, `modal`(카드·찾기 줄·이름 입력처럼 Esc·Tab·화살표가 제 뜻인 곳), `app:<app id>`(앱 webview), `sourceControlCommit`(Source Control 커밋 입력 칸, `source-control.commit` = Mod+Enter), `gitDiff`(`git_diff` 탭, `diff.next-change`·`diff.prev-change` = F7·Shift+F7). 세 command는 focus를 받은 그 칸·탭이 창의 focus 표에 동작을 건다(보이게 된 `git_diff` 탭은 본문이 focus를 받는다).

Source Control: `source-control.focus`(Mod+Shift+G, section `view`)가 오른쪽 sidebar를 Source Control로 바꾸고 연다. `worktree.new`(section `open`)는 기본 키가 없고 팔레트의 "New worktree…"로 만들기 창을 연다.

context는 chord를 "가질" 수 있다(owns). 가진 chord는 그보다 바깥 binding이 받지 않는다.
- `terminal`: Linux·Windows의 Ctrl+글자 하나.
- `agentView:<harness>`: 그 harness keymap의 Ctrl+글자 머리.
- `modal`·`slashMenu`: modifier 없는 Esc·Tab·화살표(`slashMenu`는 Enter도).

가진 chord에 부를 것이 없으면 키는 page(터미널은 PTY, 입력칸은 그 component)로 간다.

### 맞추는 순서

안쪽 context부터 그 context의 binding을 사람 > 등록 > 기본(같은 층이면 나중 것) 순서로 보고, 다음 바깥 context, 마지막에 context 없는 binding이다. 맞은 것 중 command의 `when`이 참인 첫 것을 부른다.

### 연속 key

chord 글은 한 타 또는 공백 하나로 이은 두 타(`"Ctrl+KeyX Enter"`, `"Escape Escape"`)다. 첫 타가 지금 부를 수 있는 두 타 binding의 머리이면 삼키고 1.5초 기다린다. 둘째 타가 맞으면 그것을, 다른 key면 머리를 버리고 그 key를 새로 맞추고, 시간이 다 되면 첫 타의 홑 binding을 부른다. 머리인 두 타 binding을 모두 지금 부를 수 없으면 기다리지 않고 홑 binding을 바로 부른다. 그래서 harness GUI에서 turn이 도는 동안 Esc는 바로 멈추고(`agent.rewind`의 `when`이 거짓), 쉬는 동안 Esc Esc가 되돌리기다. modifier만 누른 keydown은 기다림을 끊지 않는다. main은 두 타 chord를 세지 않는다.

### 앱 view 안의 키

앱 `<webview>` guest의 preload가 먼저 맞춘다. 그 앱 key이고 page가 건 handler(SDK `useCommand`)의 `when`이 참이면 실행하고 삼킨다. 아니면 host가 보낸 shell 홑 타 chord(context 없고 지금 부를 수 있는 것)에 맞을 때 삼키고 host에 `app:keys-forward`로 넘긴다. host는 그 webview를 target으로 service에 넘겨 context가 `app:<app id>`부터 위로 판정된다.

### 사람이 바꾼 키

```
 Settings › Keyboard ─ 선언 설정 shell.keybindings { mac?: {id → chord[]}, other?: {id → chord[]} } ── core가 저장
        │ Desktop이 core 준비 때와 설정이 바뀔 때 읽고, Keyboard 화면이 고칠 때
        ▼
   창의 binding을 덮는다 ─┬─▶ renderer service의 기본 키(표 + 사람이 단 app.panel:*)
                          └─▶ 키 이름을 보이는 화면(menu·tooltip·DeskSwitcher)이 다시 그린다
```

main은 core 설정의 사본에서 같은 값을 읽어 자기가 먼저 받는 키를 덮는다. 창이 main에 알리지 않는다.

OS마다 따로 저장하고(macOS의 Cmd 조합을 Linux에 옮기면 뜻이 달라진다) Keyboard 화면은 지금 OS의 것만 바꾼다.

## 지키는 것

1. **키는 받은 때만 삼킨다.** 맞는 chord가 있고 그 command를 지금 부를 수 있을 때만 `preventDefault`·`stopPropagation` 한다. 주인이 없는 공간(Settings)에서는 Ctrl+B·Ctrl+P가 page로 간다.
2. **같은 context·같은 층에서는 나중에 묶은 바인딩부터 본다.** 그 command를 부를 수 없으면 다음 바인딩을 본다. 우선순위 수는 두지 않는다. harness keymap의 Ctrl+C는 `agent.interrupt` 뒤에 `agent.clear-input`을 두어, 입력칸에 글이 있으면 지우고, 없고 turn이 돌면 멈추고, 글을 골랐으면 둘 다 거짓이라 복사로 지나간다.
3. **사람이 바꾼 키는 그 command의 기본·등록 키를 모든 context에서 대신한다.** Settings에서 `agent.cycle-mode`를 바꾸면 네 harness keymap의 Shift+Tab이 같이 빠진다. 빈 목록으로 저장하면 그 command는 키가 없다.
4. **같은 command id는 나중 주인이 받는다.** 그 주인이 풀리면 앞 주인이 다시 받는다. workspace 창이 다시 mount될 때 앞 것의 정리와 새 것의 등록이 겹쳐도 command를 잃지 않는다.
5. **command `when`이 false면 없는 것과 같다.** 키를 넘기고 `execute`는 `unavailable`이다.
6. **handler가 던져도 입력은 산다.** registry가 잡아 log에 남기고 `internal`을 돌린다. keydown listener까지 올라가지 않는다.
7. **한글 조합 중(`isComposing`)과 modifier만 누른 keydown은 보지 않는다.** 판정은 물리 키(`code`)와 글자 키의 `key`를 같이 보고, modifier는 정확히 같아야 맞는다(Ctrl+Alt+1은 Alt+1이 아니다).
8. **터미널(context `terminal`) 안의 Linux·Windows Ctrl+글자 하나는 shell로 보낸다.** 예외는 palette·Home이다. main이 shell 창 본문에서도 이 둘은 늘 삼켜 보낸다(터미널 안에서도 팔레트가 열린다).
9. **눌러 둔 반복은 부르지 않고 삼키기만 한다.** 반복을 넘기면 menu의 Close Window가 탄다. 반복은 연속 key를 시작하거나 끝내지 않는다(Esc를 누르고 있어도 Esc Esc가 되지 않는다).
10. **main이 먼저 받는 키는 표의 `main`이 정한다.** tab 이동·닫기·다시 열기(`tab.next`·`tab.prev`·`tab.close`·`tab.reopen`·`tab.move-*`), `new.browser`, `desk.next`·`desk.prev`·`desk.nth`, `palette.open`, `home.open`, 모든 `app.panel:*`, browser page의 `browser.bookmark`다. 나머지는 page·앱이 쓰는 키를 빼앗지 않게 renderer만 받는다. `<webview>` guest나 native popup·DevTools에 focus가 있으면 renderer keydown이 못 받고, macOS menu key equivalent는 page keydown보다 앞선다. 이 키는 main이 삼켜 같은 command id로 보낸다. guest는 창의 자식 view가 아니라서 main이 guest의 host web contents로 그 창을 찾는다. 이렇게 받아야 macOS의 Cmd+W가 menu의 Close Window로 가지 않는다.
11. **사람이 바꾼 키는 검사를 지난 것만 덮는다.** 표에 있는 id, `app.panel:*`, 꼴이 맞는 `ext.*`·`app.*`·`project-command.<id>.(run|stop|restart)` id와 읽을 수 있는 chord(한 타나 두 타, 한 id에 최대 4개)만 남긴다. 지금 기여되지 않은 동적 id(extension을 껐거나 앱·명령을 지움)의 값도 버리지 않는다. Settings는 "없는 command" 줄로 보여 지우게 하고, 다른 줄을 저장해도 그 값은 남는다. 저장 파일이나 IPC 값이 틀려도 그 줄만 표의 키가 되고 나머지 키는 산다. main도 같은 검사로 다시 거른다.
12. **빈 chord 목록은 키를 뺀 것이다.** 표와 같은 값은 저장에서 빠진다.
13. **새 키는 받기 전에 본다.** 두 타면 타마다 본다. modifier 없는 키(F1~F12 빼고)는 입력칸 글자를 삼켜서 받지 않는다. 예약 키(전역 팔레트 키, 글자 편집 Ctrl/Cmd+A·C·V·X·Z와 redo, OS 키 Cmd+Q·H·M·Tab·Space, Cmd+Shift+3·4·5, Alt+F4, Alt+Tab)는 lophn이나 OS가 먼저 가져가서 거절한다. palette·Home·북마크·터미널 복사·붙여 넣기는 표의 줄이라 바꿀 수 있다. 다른 바인딩이 쓰는 키는 거절하지 않고 "바꾸기"를 준다. 이 줄에 달고 그 chord를 가진 다른 줄에서는 그 chord만 뺀 변경 하나로 저장한다. 겹침은 modifier 순서와 상관없이 본다.
14. **겹침은 저장된 값에서도 본다.** 같은 platform·같은 context에서 두 binding이 같은 chord를 가지거나, 사람이 단 키가 예약 키와 같으면 겹침이다(표가 바뀌어 옛 사람 키와 새 기본 키가 부딪힌 경우). 다른 context인데 한쪽이 가리는 둘도 겹침이다: main이 먼저 받는 context 없는 줄은 같은 chord의 앱 key를 가리고(page가 받기 전에 main이 삼킨다), harness GUI keymap(context `<바깥>:<harness>`)은 그 context와 바깥 context의 같은 chord를 가린다(사람이 `agent.find`에 Ctrl+R을 달면 harness의 history 검색과 겹침으로 보인다). keymap끼리는 겹침으로 보지 않는다(Ctrl+C의 clear-input·interrupt처럼 조건으로 갈린다). chord마다 하나이고 겹친 id는 표 순서다. 겹치면 표 순서가 앞인 binding이 받는다. Settings › Keyboard는 맨 위에 겹친 수와 "겹친 것만 보기"를, 겹친 줄에 상대 이름과 빼기를 보인다. 번호 줄에서 빼기는 겹친 chord를 가진 번호의 id만 비운다. 기본 표에는 겹침이 없다. context가 다르면 같은 chord라도 겹침이 아니고, 두 타의 머리가 홑 binding과 같아도 겹침이 아니다. harness keymap은 겹침 검사에 들지 않고 `agent.*` 줄에 harness별 글로 보인다.
15. **그 workspace에 그 일이 없으면 키를 삼키지 않는다.** 통로가 없는 command(앱의 터미널, Home의 Explorer·desk, 앱 통로가 없는 `app.panel`)는 올리지 않는다. 지금 사정에 기대는 command(group이 아닐 때 `pane.*`, 쌓이지 않은 칸의 `pane.stack-*`, float이 없을 때 `float.*`, 이동 기록이 없을 때 `nav.*`)는 `when`으로 막는다. `when` 판정은 context menu가 그 항목을 보이는 사정과 같다. 번호(arg)마다의 판정은 하지 않는다.
16. **새 키를 받는 칸(`data-key-capture`) 안의 키는 command로 보내지 않는다.** 지금 듣는 키를 눌러도 command가 돌지 않고 칸이 받는다. 이 칸은 한 타 뒤 1.5초를 기다려 둘째 타를 받는다.
17. **여러 화면에 같은 command가 있으면 focus를 받은 화면이 받는다.** registry는 id마다 마지막 주인만 부르므로 터미널·browser·agent 화면은 focus가 들어올 때 창 하나의 command에 자기 `run`·`when`을 맡기고, 그 command가 focus를 받은 화면의 것을 부른다(`terminal.copy`·`terminal.paste`, `browser.bookmark`, `agent.*`).
18. **앱 key는 그 앱 webview 안에서 guest가 먼저 판정한다.** `when`이 guest 안의 함수라 main이 동기로 판단할 수 없어서다. 앱 key는 홑 타이고 modifier나 F1~F12가 있어야 한다(선언 검사). browser 탭(남의 page)과 artifact에는 이 preload가 없어 page가 키를 받는다. main이 먼저 받는 키는 page에 닿지 않아 그 chord의 앱 key는 돌지 않는다. 선언 검사는 거절하지 않고 Settings의 겹침 검사가 알린다.

## 경계와 계약

- boundary: `shell`(키 표·판정·창·main·preload), `config`(저장 설정). 이 설계에 따로 붙은 boundary-catalog 항목은 없다.
- OS 전역: 전역 팔레트 키 `CommandOrControl+Shift+K` 하나. 못 걸면 다른 키로 대신하지 않고 tray에 사용 불가를 알린다. headless에서는 걸지 않는다.
- IPC `shell:shortcut`(main → renderer): payload는 binding id 글자 하나다. `desk.nth:3`처럼 arg를 실을 수 있어서 command 이름 목록을 따로 두지 않는다.
- lophn(agent의 browser 호출, 멀리서 보기)이 page에 넣는 키는 그 page에만 간다. lophn이 넣은 키는 창 단축키·menu 단축키가 되지 않는다. 넣는 동안 그 page에 온 사람의 키는 사람이 그 page에 있지 않았으면 버린다(창 focus가 잠깐 그 page에 간 사이의 키). 창과는 IPC `shell:driver-input`(main → renderer, `{page, event: start|end|tab|person}`)과 `shell:driver-focus`(renderer → main, start의 답 `{page, person}`)로 주고받아 창이 사람의 focus를 지킨다(`browser-tab.md` 37).
- main이 먼저 받는 키도 설정을 따른다. main은 core 설정의 사본에서 `shell.keybindings`의 이 OS 것을 읽어 같은 검사로 걸러 자기 표를 바꾼다. 설정이 바뀌면(Settings 화면, `lophn settings set`, agent) 다시 읽는다(`settings.md`). 창에서 main으로 키를 알리는 IPC는 없다.
- 선언 설정 `shell.keybindings`: `{ mac?: {binding id → chord[]}, other?: {binding id → chord[]} }`. id 글자 ≤160, chord 글자 ≤64, id당 chord ≤4, 항목 ≤256(표 약 90줄에 앱 단축키가 더해지는 수). `core`가 저장하고, 바꿀 때 binding id와 chord 글자를 shell과 같은 규칙으로 검사해 모르는 id와 읽을 수 없는 chord를 거절한다. shell은 읽을 때 같은 규칙으로 틀린 줄만 버린다(손으로 고친 file). extension·앱 command도 같은 저장·같은 Settings 줄을 쓴다.
- chord 글: 수정키(`Ctrl`·`Cmd`·`Alt`·`Shift`) `+` 물리 키 이름(`KeyX`, `Digit1`, `F5`, `Backquote`, `ArrowLeft`, `PageUp`, `Escape` …), 두 타는 공백 하나로 이은 것.
- extension manifest `contributes`: `commands: [{name, title}]`, `keybindings: [{command, key: {other, mac?}, context?}]`. `ctx.commands.register`로 handler를 건다. 자세한 것은 [extension.md](extension.md).
- 앱 선언 `keys`(`@lophn/declaration`)와 `@lophn/app-ui`의 `useCommand`. command id `app.<app id>.<name>`, context `app:<app id>`.
- harness GUI의 keymap은 harness-gui manifest가 `contributes.keybindings`로 harness마다 낸다. 공통 `agent.*` command에 CLI 기본 key를 붙인다([harness-gui.md](harness-gui.md)).
- DOM 속성: `data-key-context`(context 이름), `data-key-capture`(새 키를 받는 칸).

## 결정

- 키 판정을 command registry와 keybinding service 한 곳으로 모은다. 이유: 키 판정과 기능의 일이 한 component에 묶여 다른 소비자(팔레트, menu)가 같은 command를 부를 길이 없었다. VS Code처럼 키 입력을 중앙에서 받고 command의 일은 기능이 갖는 중간 구조를 사람이 요청했다. (사람, 0.10.0)
- command id는 표의 이름 그대로다. id 공간을 새로 만들지 않는다. extension·앱은 `ext.`·`app.` 접두사로 같은 공간에 낸다. (agent)
- context는 등록 저장소가 아니라 DOM 속성이고 `when`은 함수 하나다(식 언어 없음). 이유: focus가 이미 DOM에 있어서 화면이 자기 요소에 이름을 달면 끝이고 떼어 낼 때 풀 것이 없다. Claude CLI·Codex·emdash도 화면에 뜬 UI가 context를 켜는 같은 꼴이다. 처음에는 context key 식, 우선순위 수, extension 소유권을 모두 넣지 않고 `when` 함수와 "나중 것 먼저"만 뒀고, 이후 context·연속 key·extension 소유 binding을 더하면서도 식 언어는 버린 채로 둔다. (사람 0.22.0, 처음 (agent) 0.10.0)
- main → renderer payload를 command 이름이 아니라 binding id 글자 하나로 한다. 이유: command 이름만으로는 arg를 실을 수 없어 `desk.nth`·`app.panel`을 main이 보낼 수 없었다. 그래서 main용 command type 목록을 따로 두지 않고 표의 `main`만 본다. (agent, 0.18.0)
- main이 먼저 받는 키를 키 표의 `main`으로 정한다. 이유: macOS는 menu key equivalent가 page keydown보다 앞서 renderer의 `preventDefault`로 막히지 않는다. main의 입력 감시는 page keydown과 menu 단축키를 함께 막는다. 그러나 Linux·Windows에서 shell renderer 자신의 키는 main이 삼키지 않는다. 터미널의 Ctrl+W를 shell로 보내야 해서다. 버린 안: application menu를 직접 짜서 Cmd+W를 받기(macOS에서 menu를 없애면 Cmd+C/V/Z가 죽고, Edit role을 지키며 새로 짜면 mac에서 눈으로 확인하지 못한 채 menu 전체를 바꾸게 된다). tab 키는 page가 받지 않는다(Chrome과 같다). (agent, 0.2.0·0.4.0)
- 앱 단축키는 표 밖의 동적 binding으로 두고 같은 `shell.keybindings`에 저장한다. 이유: 설치된 앱이 사람마다 달라서다. 겹침 판정과 main 통로를 그대로 쓰고, extension·앱 command도 같은 Settings 줄을 쓴다. 그래서 저장 모양은 바뀌지 않아 migration이 없다. (agent, 0.18.0·0.22.0)
- 앱 key의 `when`은 guest 안에서 판정한다. 앱 key는 홑 타이고 modifier나 F1~F12가 있어야 한다. browser 탭에는 넣지 않는다. (agent, 0.22.0)
- 표 밖에서 keydown을 직접 듣던 곳(composer Enter·Esc, 찾기 Ctrl+F, thread index Alt+↑↓, palette·Home, 북마크, 터미널 복사·붙여 넣기)을 command로 옮긴다. 이유: 사람이 바꿀 수 있고 겹침 검사에 잡힌다. service가 `document` capture에서 먼저 받으므로 화면 component의 `onKeyDown`보다 앞서고, 제 뜻의 Esc·Enter·화살표를 쓰는 요소는 `modal`·`slashMenu` context로 그 키를 가진다. 처음에는 찾기·북마크를 표에 올리지 않았다(편집기·browser 탭의 Ctrl+F·Ctrl+D와 부딪히고 터미널 Ctrl+D는 EOF라서). 지금은 표에 올리고 `terminal`·`browser`·`agentView` 같은 context로 키를 갈랐다. (agent, 0.22.0)
- harness GUI 안에서는 그 CLI의 key가 lophn 탭·창 key와 desktop 관례보다 먼저다. 터미널에서 Ctrl+글자가 PTY로 가는 것과 같다. Ctrl+C는 글을 골랐으면 복사, 아니면 CLI 동작이다. CLI key 설정 file은 읽지 않는다. (사람, 2026-11-08)
- Settings에서 바꾼 `agent.*` 키는 네 harness keymap을 함께 대신한다. harness마다 따로 바꾸기는 하지 않는다. (agent, 0.22.0)
- 겹치면 표 순서가 앞인 binding이 받고, 이미 쓰는 키는 거절하지 않고 바꾸기를 준다. (agent, 0.18.0)
- shell은 Electron 기본 application menu에서 Reload·Force Reload만 뺀 menu를 건다. 이유: Linux·Windows에서 page가 막지 않은 Ctrl+R·Ctrl+Shift+R이 창 renderer를 다시 불러 열린 popover·입력칸·scroll을 잃었다. 편집 role, 창 닫기, zoom, 전체 화면 accelerator는 기본 menu와 같이 남긴다. (agent)
- browser 머리 줄의 북마크 키와 desktop 팔레트 Home 줄의 hint도 사람이 바꾼 키를 따른다(머리 줄은 키를 직접 듣지 않고 `browser.bookmark` 줄을 쓴다). (agent)
- 전역 팔레트 키는 바꾸지 않는다. 이유: OS 전역 등록이라 창 안 shortcut 길로 덮을 수 없다. 팔레트·Home 창 안 키는 이제 표의 줄이라 바꿀 수 있다. (agent, 0.10.0·0.22.0)
- 저장은 OS마다 따로다. 이유: macOS의 Cmd 조합을 Linux에 옮기면 뜻이 달라진다. (agent, 0.10.0)
- 저장 단위는 binding id이고 Settings 화면만 command로 묶는다. 이유: "n번째 탭"·"칸 focus"가 번호마다 따로 서 있을 이유가 없다는 사람의 지적. 번호 줄은 modifier 하나를 모든 번호에 붙이고 번호마다 겹침을 본다. 처음 결정(줄 하나에 키 하나, 여러 키 UI 없음)에서 바뀐 것이다. (사람, 0.10.0)
- 기본 키는 자주 쓰고 이름난 키가 있는 것(VS Code·Chrome)만 준다. 나머지는 Settings에서 단다. (agent, 0.18.0) float 이동·dock에는 기본 키를 두지 않는다. 처음 float 때 Ctrl+Alt+화살표가 GNOME에서 workspace를 바꿔서 기본 키를 두지 않기로 했고(사람, 0.4.0), 그 뒤에도 float 줄은 키 없이 표에 있다.
- Linux·Windows의 `Ctrl+Alt+숫자`는 AltGr 배열에서 `{ [ ] @`를 치는 키라 쓰지 않는다. desk 번호는 `Ctrl+Shift+숫자`다. (agent, 0.18.0)
- 기본 키가 편집기·터미널 키와 부딪힐 때: Explorer의 F2와 파일 clipboard 키(Ctrl/Cmd+C·X·V·D)는 표가 아니라 Explorer tree가 자기 `onKeyDown`에서 받는다(고른 줄이 있을 때만 삼킨다). 터미널 Ctrl+Shift+C/V, 글자 편집 키는 표가 빼앗지 않는다. 편집기의 `Shift+Mod+\`(괄호 짝)와 `Mod+Alt+↑↓`(커서 더하기)는 `pane.split-down`·`pane.focus-*`가 가린다(VS Code와 같은 선택). Linux 터미널의 `Alt+PageUp/Down`은 쌓인 tab 돌려 보기가 가져간다. Linux·Windows 터미널의 Ctrl+글자(W·B·P·T·N·O)는 shell로 간다. (agent, 0.2.0·0.18.0)
- Ctrl/Cmd+B(sidebar)는 편집기 밖 우선이다(VS Code처럼). markdown 편집기의 굵게는 Mod-Shift-b로 옮겼다. Ctrl/Cmd+P는 창 팔레트와 같은 곳의 파일 빠른 열기다. (agent, 0.2.0)
- `inbox.open`·`jobs.open`은 왼쪽 sidebar overlay가 아니라 Inbox·Jobs 탭을 연다. 이유: overlay 상태가 sidebar component 안에만 있다. (agent, 0.18.0)

## 열린 것

이슈는 topic이 `keybindings`인 이슈다.

- **main이 먼저 받는 키를 단 앱 key는 앱 안에서 돌지 않는다.** Settings의 겹침 검사가 알리지만 선언 검사는 이 chord를 거절하지 않는다.
- Electron 창에서 실제로 눌러 본 확인은 사람 몫으로 남아 있다: browser 탭 page에 focus가 있을 때 `Ctrl+T`·`Ctrl+Alt+PageDown`·앱 단축키, Linux 터미널의 `Ctrl+T`·`Ctrl+N`·`Ctrl+O`, mac의 `Ctrl+Shift+숫자`·``Ctrl+Shift+` ``가 OS 키와 겹치지 않는지, 실제 앱에서 CLI마다 눌러 보기.
