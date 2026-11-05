# keybindings: 작업대 단축키 넓히기, 사람이 고치기, 겹침 보기, 앱 단축키

- 목표: tab·group(split)·stack·desk·float와 context menu에만 있던 일을 command로 올려 단축키 표에 넣고, Settings › Keyboard에서 사람이 고치고 겹침을 보고 풀게 한다. 사람이 앱 panel 화면(빠른 실행의 앱)마다 단축키를 달아 연다.
- 재료: `project-docs/architecture/keybindings.md`, `project-docs/architecture/workspace-layout.md`, `project-docs/plan/ui-overhaul/README.md`의 "정한 것"(desk, group, 이동 기록), `packages/shell/ipc/keybindings.ts`(지금 표)
- 범위 밖: 두 단계 chord(`Ctrl+K Ctrl+S`), context key 식(`when` 식), 팔레트의 "모든 command 실행" 목록, 팔레트·home·전역 팔레트 키 바꾸기, OS 전역 단축키로 앱 열기, 빠른 실행 Terminal·Browser·Search 단추의 별도 binding(그 단추는 아래 `new.*`·`search.open`과 같은 일이다)
- 단위: `kb` 하나. task 넷.
- 순서: wave 1 `kb-table`(계약: 표, binding id, main 통로, 겹침 판정, menu의 키 칸). wave 2 `kb-workspace`·`kb-settings`·`kb-hints`를 같이 돌린다.

## 정한 것 (lead)

사람에게 묻지 않고 정했다. 모두 사람이 Settings › Keyboard에서 바꿀 수 있어 되돌리기 싸다.

- **기본 키를 고르는 규칙.** (1) 자주 쓰고 이름난 키가 있는 것(VS Code·Chrome)만 기본 키를 준다. 드물거나 지우는 일(Close others, Close all, Detach)은 키 없이 표에 올려 사람이 단다. (2) Linux·Windows의 `Ctrl+Alt+숫자`는 AltGr 배열에서 `{ [ ] @`를 치는 키라 쓰지 않는다. (3) Explorer의 F2(이름 바꾸기), 터미널 Ctrl+Shift+C/V, 편집기 글자 편집 키는 빼앗지 않는다. 편집기 `Shift+Mod+\`(괄호 짝으로 가기)는 `pane.split-down`이 가린다(VS Code와 같은 선택).
- **command 이름은 context menu 항목과 짝이다.** menu가 그 항목 옆에 키를 보인다. menu는 누른 tab에, command는 고른 tab에 한다.
- **앱 단축키는 binding id `app.panel:<app>:<surface>`다.** 표에 줄이 없고 사람이 단 키(`shell.keybindings`)에서만 생긴다. 고정(빠른 실행 pin)과 상관없이 그 앱 panel 화면을 연다(빠른 실행 단추를 누른 것과 같다). 앱을 지워도 저장된 키는 남고 Settings가 "없는 앱" 줄로 보여 지우게 한다.
- **main이 먼저 받는 것**: 지금의 tab 이동·닫기·다시 열기에 더해 `new.browser`, `desk.next`·`desk.prev`·`desk.nth`, 모든 `app.panel:*`. browser page·앱 view에 focus가 있어도 된다. 그 밖은 지금처럼 renderer만 받는다(page·앱이 쓰는 키를 빼앗지 않게).
- **main → renderer payload는 binding id 글자다**(`tab.close`, `desk.nth:3`, `app.panel:notes:main`). `MainCommand` type은 지운다.
- **겹침**: 같은 platform에서 두 binding이 같은 chord를 가지면 겹침이다(modifier 순서는 보지 않는다). 사람이 단 키가 RESERVED(팔레트·home·전역 팔레트, 터미널 복사·붙여 넣기, OS·글자 편집 키)와 같아도 겹침이다. 겹치면 표 순서가 앞인 binding이 받는다(지금과 같다). Settings는 겹침을 모아 보이고, 새 키가 이미 쓰이면 거절 대신 "바꾸기"(그 키를 다른 줄에서 빼고 여기에 단다)를 준다.
- **저장 모양은 그대로다**(`shell.keybindings { mac?, other? }`, id → chord[]). core schema의 key 길이 상한 64 → 160, 항목 수 상한 64 → 256만 늘린다. 값 모양이 안 바뀌어 migration이 없다.

## 표 (계약, `kb-table`이 넣는다)

`—`는 기본 키 없음. `main`은 main이 먼저 받는 platform. section은 Settings 묶음이다.

| section | binding id | 하는 일 (짝인 menu 항목) | other | mac | main |
|---|---|---|---|---|---|
| tab | `tab.next`·`tab.prev`·`tab.nth:N`·`tab.close`·`tab.reopen`·`tab.move-left`·`tab.move-right` | 지금 그대로 | 지금 | 지금 | 지금 |
| tab | `tab.rename` | Rename | — | — | |
| tab | `tab.close-others` | Close others | — | — | |
| tab | `tab.close-right` | Close to the right | — | — | |
| tab | `tab.close-saved` | Close saved | — | — | |
| tab | `tab.close-all` | Close all | — | — | |
| tab | `tab.keep-open` | Keep open (preview 고정) | — | — | |
| tab | `tab.copy-path` | Copy path | `Alt+Shift+KeyC` | `Cmd+Alt+KeyC` | |
| tab | `tab.copy-relative-path` | Copy relative path | `Ctrl+Alt+Shift+KeyC` | `Cmd+Alt+Shift+KeyC` | |
| tab | `tab.reveal` | Reveal in Explorer | — | — | |
| pane | `pane.split` | Split right (지금 그대로) | `Ctrl+Backslash` | `Cmd+Backslash` | |
| pane | `pane.split-down` | Split down | `Ctrl+Shift+Backslash` | `Cmd+Shift+Backslash` | |
| pane | `pane.focus:N`·`pane.focus-left/right/up/down` | 지금 그대로 | 지금 | 지금 | |
| pane | `pane.swap-left/right/up/down` | 고른 tab을 그쪽 칸 tab과 바꾼다 | `Ctrl+Alt+Shift+Arrow*` | `Cmd+Alt+Shift+Arrow*` | |
| pane | `pane.stack-next`·`pane.stack-prev` | 고른 칸에 쌓인 tab을 돌려 본다(`cyclePane`) | `Alt+PageDown`·`Alt+PageUp` | 같음 | |
| pane | `pane.unstack` | Move out of pane | — | — | |
| pane | `pane.remove` | Remove from split | — | — | |
| pane | `pane.unsplit` | Unsplit / Unsplit all | — | — | |
| pane | `pane.close-others` | Close others in pane | — | — | |
| pane | `pane.close-group` | Close group | — | — | |
| desk | `desk.new` | New desk | `Ctrl+Shift+KeyN` | `Cmd+Shift+KeyN` | |
| desk | `desk.next`·`desk.prev` | desk 목록 다음·앞(끝에서 돈다) | `Ctrl+Alt+PageDown`·`Ctrl+Alt+PageUp` | `Cmd+Alt+PageDown`·`Cmd+Alt+PageUp` | both |
| desk | `desk.nth:N` (1~9) | desk 목록 N번째 | `Ctrl+Shift+DigitN` | `Ctrl+Shift+DigitN` | both |
| desk | `desk.rename` | 지금 desk 이름 바꾸기 | — | — | |
| desk | `desk.close` | 지금 desk 닫기(확인 dialog, Main은 안 된다) | — | — | |
| float | `tab.float` | Float | — | — | |
| float | `tab.detach` | Detach | — | — | |
| float | `float.dock` | 맨 위 float을 card로 | — | — | |
| float | `float.minimize` | 고정 안 한 float 모두 접기 | — | — | |
| open | `new.terminal` | + › Terminal | `Ctrl+Shift+Backquote` | `Ctrl+Shift+Backquote` | |
| open | `new.browser` | + › Browser | `Ctrl+KeyT` | `Cmd+KeyT` | both |
| open | `new.agent` | 새 lophn session(왼쪽 sidebar의 New session 기본) | `Ctrl+KeyN` | `Cmd+KeyN` | |
| open | `new.document` | + › Document(파일 고르기) | `Ctrl+KeyO` | `Cmd+KeyO` | |
| open | `search.open`·`files.quick-open` | 지금 그대로 | 지금 | 지금 | |
| view | `sidebar.toggle`·`explorer.focus`·`terminal.focus` | 지금 그대로 | 지금 | 지금 | |
| view | `sidebar.toggle-right` | 오른쪽 sidebar 접기 | `Ctrl+Alt+KeyB` | `Cmd+Alt+KeyB` | |
| view | `nav.back`·`nav.forward` | card 머리의 ← → (창 이동 기록) | `Ctrl+Alt+Minus`·`Ctrl+Shift+Minus` | `Ctrl+Minus`·`Ctrl+Shift+Minus` | |
| view | `settings.open` | Settings | `Ctrl+Comma` | `Cmd+Comma` | |
| view | `inbox.open`·`jobs.open` | Inbox·Jobs overlay | — | — | |
| app | `app.panel:<app>:<surface>` | 그 앱 panel 화면 열기 | 사람이 단다 | 사람이 단다 | both |

## 사람이 정할 것

없다. 위 기본 키는 추천안으로 넣고 사람에게 보고한다.

## lead가 할 일

- merge 때마다: 보고의 "등록할 것"과 i18n 요청을 반영한다.
- 다 끝나면: `project-docs/architecture/keybindings.md`를 새 흐름(binding id payload, 동적 `app.panel`, 겹침, section, menu 키 칸)으로 고친다. `project-docs/boundary-catalog.yaml`·`module-catalog.yaml`에 keybindings 항목이 있으면 맞춘다. changelog 열린 판에 항목을 붙인다. 사람의 Electron 확인 항목(아래)을 보고에 적는다.

## 사람이 Electron에서 볼 것

- browser 탭 page에 focus가 있을 때 `Ctrl+T`, `Ctrl+Alt+PageDown`, 앱 단축키가 먹는다.
- Linux 터미널에서 `Ctrl+T`·`Ctrl+N`·`Ctrl+O`는 shell로 간다.
- Settings › Keyboard에서 겹친 키를 "바꾸기"로 옮기면 다른 줄의 키가 빠지고, 창을 다시 열어도 남는다.
