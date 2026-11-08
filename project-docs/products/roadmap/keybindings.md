# keybindings: extension과 앱이 key를 등록하고 shell이 key context를 다룬다

상태: 계획 `keybindings-ext`로 연다(2026-11-08).
배경 문서: `project-docs/architecture/keybindings.md`, `project-docs/architecture/extension.md`, `project-docs/architecture/harness-gui.md`, `project-docs/products/roadmap/app-webview.md`.

## 왜

사람의 말 (2026-11-08, 요지):

- extension이 많다. 사용자가 만든 앱도 있고 harness GUI(harness 정의 앱)도 있다. keyboard manager에 extension key를 등록하고 key에 관한 context를 관리하는 기반을 깔고 싶다.
- harness GUI에서 각 CLI와 같은 단축키 UX를 준다. 앱에서도 단축키를 쓰게 한다.
- 비어 있는 곳을 리팩터링하고 채우는 기반 공사가 이번 목적이다. 앱 SDK까지 같이 한다.
- `when`(command를 지금 부를 수 있나)은 지금처럼 함수로 둔다. 식 언어를 만들지 않는다.

## 지금 코드 (main `d376843e1`)

### 표와 service

- key 표는 `packages/shell/ipc/keybindings.ts`의 `KEYBINDINGS`(약 90행, 순서가 우선순위)다. `Command`는 닫힌 문자열 union(59개)이다. chord는 `"Ctrl+Shift+KeyT"` 같은 한 번 누름이고 연속 key 개념이 없다.
- renderer의 `createCommandRegistry`(`renderer/commands/registry.ts`)와 `createKeybindingService`(`renderer/commands/keybinding-service.ts`)는 이미 아무 문자열 id를 받는다. service는 keydown 하나를 chord 하나와 맞추고, 맞은 것 중 `canRun`(command의 `when`)이 참인 첫 것을 실행한다. keydown 사이 상태가 없다.
- 동적 id를 막는 것은 type과 저장이다. `parseBindingId`·`parseKeyOverrides`가 표에 없는 id를 버려 `shell.keybindings`에 저장되지 않는다. Settings > Keyboard(`renderer/desktop/settings/keyboard/model.ts`)는 command마다 i18n 문구(`WORDING`, 59개)를 요구한다. 예외는 `app.panel:<app>:<screen>` 하나이고 동적 행의 선례다.
- context는 없다. focus는 DOM으로 짐작한다(`closest("[data-terminal-screen]")`, `[data-key-capture]`). Linux/Windows의 Ctrl+W/B/P/T/N/O는 터미널에 focus가 있으면 PTY로 간다(`shellOwns`).
- 표 밖 key: composer Enter·Esc·Ctrl+Shift+M(`agent-composer.tsx:306-352`), slash menu ↑↓·Esc(`use-slash-menu.tsx`), 채팅 찾기 Ctrl+F(`agent-view.tsx:270`), thread index Alt+↑↓(`thread-index.tsx:130-161`), palette Ctrl+K·home Ctrl+Shift+L(`ipc/shortcuts.ts`, 바꿀 수 없음), OS 전역 Ctrl+Shift+K(`main/desktop/global-shortcut.ts`), 북마크 Ctrl+D(`main/browser/electron-view.ts:84`), 터미널 Ctrl+Shift+C/V(`xterm-view.ts:422`). 이것들은 바꿀 수 없고 충돌 검사에도 안 잡힌다.

### extension과 앱

- extension manifest(`packages/protocol/extensions/manifest.ts`)는 `{id, name, description, version, entry, provides}`뿐이다. `activate(ctx)`의 `ctx`에도 command·key 등록이 없다. harness GUI 화면은 extension이 아니라 core renderer 코드(`renderer/terminal/terminal-gui.tsx`, `renderer/conversation/`)다.
- 앱은 `<webview>` guest다. preload `lophnApp`(`preload/app-tool.ts`)과 정해진 channel로 shell과 오간다(guest→shell `sendToHost`, shell→guest `element.send`). main은 모든 guest webContents의 key를 `before-input-event`로 먼저 보지만, `main` flag 행과 palette·home만 가로채고 나머지는 page가 받는다.
- `@lophn/app-ui`(2.9.0)에 key API가 없고, 앱 선언(`@lophn/declaration` 4.2.0, `defineApp`)에 key 칸이 없다. 선언의 `commands`는 agent가 부르는 명령이다.

### CLI와 다른 GUI (조사, `../harness-lab`와 CLI 실행 file)

- 네 CLI 모두 command(action id) 중심이고, 사용자가 자기 file로 key를 바꾼다: Claude `~/.claude/keybindings.json`(context 30개, `null`로 풀기), Codex `~/.codex/config.toml [tui.keymap.<context>]`, OpenCode `keybinds`(leader `ctrl+x`), omp `keybindings.yml`. action id는 CLI마다 다르다.
- context는 화면에 뜬 UI가 켜고, 안쪽 context가 먼저다. Claude CLI는 handler마다 켜짐을 값(`isActive`)으로 계산하고 `false`를 돌려주면 다음으로 넘긴다. emdash는 scope 나무에 code로 된 조건을 둔다. 함수 `when`과 같은 꼴이다.
- 연속 key가 있다: Claude `ctrl+x ctrl+e`(3초), Codex 2타까지, OpenCode `<leader>x`. Esc Esc(rewind·backtrack)는 Claude·Codex·omp에서 component가 직접 센다.
- 공통 action과 key:

  | action | Claude | Codex | OpenCode | omp | lophn GUI 지금 |
  |---|---|---|---|---|---|
  | 보내기 / 줄바꿈 | Enter / Ctrl+J | Enter / Shift+Enter, Ctrl+J | Enter / Shift+Enter, Ctrl+J | Enter / Shift+Enter, Ctrl+J | Enter / Shift+Enter |
  | 멈추기 | Esc | Esc | Esc 두 번 | Esc | Esc |
  | mode 돌리기 | Shift+Tab | Shift+Tab(plan) | Shift+Tab(agent) | Shift+Tab(thinking) | 기능만 |
  | 지금 보내기 / 줄 세우기 | Ctrl+Enter / Ctrl+X Enter | Enter / Tab | — / `<leader>`Enter | Enter / Ctrl+Q | 기능만 |
  | 되돌리기 | Esc Esc | Esc Esc | `<leader>`u | Esc Esc | 기능만 |
  | 입력 history / 검색 | ↑↓ / Ctrl+R | ↑ / Ctrl+R | ↑↓ | — / Ctrl+R | 없음 |
  | 도는 tool을 background로 | Ctrl+B | — | Ctrl+B | — | 없음(steer만 detach) |
  | transcript·도구 펼치기 | Ctrl+O, Ctrl+T(todo) | Ctrl+T | — | Ctrl+O | 없음 |
  | 입력 지우기 / 끝내기 | Ctrl+C / Ctrl+D | Ctrl+C / Ctrl+D | Ctrl+C / Ctrl+D | Ctrl+C / Ctrl+D | Ctrl+C는 복사 |
  | model 고르기 | Meta+P | `/model` | `<leader>`m | Alt+M, Ctrl+P | Ctrl+Shift+M |
  | 외부 편집기 | Ctrl+G | Ctrl+G | `<leader>`e | Ctrl+G | 없음 |

- desktop GUI(Claude desktop, Codex desktop, t3code, emdash)는 desktop 관례(Ctrl+C 복사, Ctrl+W 닫기)를 지키고 CLI key는 composer의 Esc·Esc Esc·↑·Ctrl+R 정도만 따른다. happy는 composer에 CLI key를 그대로 둔다. extension·plugin이 key를 더하는 곳은 OpenCode(plugin이 command를 더하고 key는 설정이 붙인다)와 omp(extension이 key를 직접, 예약 목록 밖에서만)다.

## 정한 것

1. **command가 단위다.** key는 command id에 붙는다. extension·앱·GUI는 command를 등록하고 기본 key를 낸다. 그래서 Settings에서 바꾸기, 충돌 검사, palette 실행을 셋이 같이 쓴다. (사람, 2026-11-08: "keyboard manager에 extension 키를 등록") 정석(VS Code, OpenCode, Codex desktop, emdash)이 이 꼴이다. (agent)
2. **`when`은 함수다.** command를 등록하는 code가 `when: () => boolean`을 같이 준다. (사람, 2026-11-08)
3. **context는 이름 붙은 stack이다.** 화면에 뜬 UI가 자기 context를 켠다(예: `terminal`, `agentView`, `agentView:<harness>`, `composer`, `slashMenu`, `modal`, `app:<app id>`, `browser`). binding은 context 이름 하나를 가질 수 있고(데이터), 안쪽 context의 binding이 먼저, 같은 context 안에서는 나중 것(사용자 > 등록 > 기본)이 이긴다. `[data-terminal-screen]` 같은 DOM 짐작과 `shellOwns`의 터미널 예외는 이것으로 바꾼다. 식 언어는 만들지 않는다(2). (agent: Claude CLI·Codex·emdash가 모두 이 꼴)
4. **연속 key를 받는다.** 2타까지(`Ctrl+X Ctrl+E`, `Escape Escape`), 사이 timeout 약 1.5초. 앞 타가 더 긴 binding의 머리이면 기다린다. Esc는 기다리는 연속을 취소한다. CLI parity에 필요하다(Esc Esc, OpenCode leader). (agent)
5. **id는 이름공간을 가진다.** shell 내장은 지금 id 그대로, extension은 `ext.<extension id>.<name>`, 앱은 `app.<app id>.<name>`. `Command` union은 내장 id 목록으로 남기고, 저장·검증·Settings는 등록된 동적 id를 받는다. 지금 없는 id의 사용자 설정(extension을 껐거나 앱을 지운 경우)은 버리지 않고 남긴다(`app.panel`의 "없는 앱" 행과 같게). `shell.keybindings`의 모양은 그대로라 migration은 없다. (agent)
6. **표 밖 key를 표로 옮긴다.** composer, slash menu, 찾기, thread index, palette·home(바꿀 수 있게)를 command와 context로 옮긴다. 북마크 Ctrl+D와 터미널 Ctrl+Shift+C/V도 행이 된다. OS 전역 palette는 OS 등록이라 따로 둔다. (사람: "비어 있는 곳을 리팩터링하고 채워넣고") (agent)
7. **harness GUI key는 harness마다 다르다.** GUI 동작은 공통 command(`agent.cycleMode`, `agent.rewind`, `agent.sendNow`, `agent.queue`, `agent.history.previous` 등)이고, harness-gui extension이 harness마다 기본 keymap을 context `agentView:<harness>`에 낸다(manifest 데이터). 같은 Shift+Tab이 Claude에서는 permission mode, omp에서는 thinking 단계를 돈다. (agent: 화면이 core renderer라 handler는 renderer, key는 데이터)
8. **extension은 manifest로 낸다.** manifest에 `contributes.commands`(id, 제목)와 `contributes.keybindings`(command, key, context)를 더한다. main에서 도는 handler가 필요하면 `ctx.commands.register(id, handler)`로 등록하고 renderer가 IPC로 부른다. manifest는 product 판과 같은 판이라 schema를 바로 바꾼다. (agent)
9. **앱은 SDK로 낸다.** 선언(`defineApp`)에 `keys: [{id, title, key: {mac?, other}, context?}]`를 더하고(`@lophn/declaration` minor), `@lophn/app-ui`에 `useCommand(id, handler, {when})`를 더한다(minor). 앱 focus 안의 key는 guest preload가 먼저 맞춘다: 그 앱의 binding이고 handler가 있고 `when`이 참이면 실행하고 삼킨다. 아니면서 shell binding에 맞으면 `sendToHost`로 shell에 넘겨 shell command가 돈다(지금은 앱 안에서 `main` flag 행만 된다). 함수 `when`이 guest 안에 있어 main이 동기로 판단할 수 없으므로 guest가 먼저 본다. browser tab(남의 page)은 지금처럼 page가 받는다. (agent)

10. **GUI 안에서는 CLI key가 이긴다.** harness GUI에 focus가 있으면 그 harness의 keymap(context `agentView:<harness>`)이 lophn 탭·창 key와 desktop 관례보다 먼저다. 터미널에서 Ctrl+letter가 PTY로 가는 것과 같다. Ctrl+C는 글을 골랐으면 복사, 아니면 CLI 동작(입력이 있으면 지우기, 비었고 turn이 돌면 멈추기). (사람, 2026-11-08)
11. **CLI 설정 file은 이번에 읽지 않는다.** 각 CLI의 기본 key와 lophn Settings로 바꾸기만 한다. (사람, 2026-11-08)
12. **parity에 빠진 기능 중 입력 history(↑↓), Ctrl+R 검색, 도는 tool을 background로 보내기(Ctrl+B)를 이번에 만든다.** 외부 편집기는 하지 않는다. (사람, 2026-11-08)

## 순서

1. 기반: 연속 key, context stack, 동적 id 저장·검증, Settings가 동적 command를 보이기. 표 밖 key를 표로 옮기기.
2. extension: manifest `contributes`, `ctx.commands`, harness-gui의 harness별 keymap과 공통 agent command.
3. GUI parity: harness별 keymap(정한 것 7·10)과 빠진 기능(정한 것 12).
4. 앱 SDK: 선언 `keys`, `useCommand`, guest preload 맞추기와 shell로 넘기기, SDK 판과 `migrate-sdk` 메모, template.

## 끝나면

- harness GUI에서 각 CLI의 주요 key(멈추기, mode, 지금 보내기, 되돌리기, history)가 CLI와 같이 돈다.
- 앱이 `useCommand`로 등록한 key가 앱 안에서 돌고 Settings에서 바꿀 수 있다. 앱 안에서도 shell key가 돈다.
- extension이 manifest로 낸 key가 Settings에 보이고 바꿀 수 있다.
- 표 밖에서 직접 keydown을 듣는 곳이 Esc 닫기 같은 component 내부 이동만 남는다.

## 하지 않는 것

- `when` 식 언어(정한 것 2).
- 3타 이상의 연속 key.
- OS 전역 단축키를 extension·앱이 등록하기.
- CLI 설정 file 읽기(정한 것 11). 외부 편집기(정한 것 12).
