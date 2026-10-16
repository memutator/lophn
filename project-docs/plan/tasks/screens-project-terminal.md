# screens-project-terminal

터미널 탭을 coding agent 시대에 맞춘다. 사람이 여는 shell 탭은 그대로 두고, lophn(core 요청)이 여는 coding 터미널 탭을 받는다. 그 탭은 focus를 옮기지 않고 열리고, 제목과 아이콘(harness vendor 아이콘)으로 구별되고, 끝나면 "session이 끝났다"만 보이고 다시 시작은 없다. 대기 목록의 coding 물음 카드가 session으로 그 터미널 탭에 focus를 옮길 수 있도록 session과 탭의 대응을 둔다. 앱 공간 옆 pane도 같은 `TerminalTab`을 쓰므로 props를 안정되게 둔다.

- 단위: screens-project (wave 3)
- 선행: 없음 (shell main 쪽 터미널 host와 coding 연결은 coding-agent 단위가 짓는다. 이 task는 contract-coding이 고정한 `ipc/terminal.ts`의 요청 모양에 맞춘 renderer 쪽만 한다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/` 전체
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/main/workspace/kinds/terminal.ts`
  - `tools/wireframes/frames/compositions/bodies.tsx`
  - `packages/design/wording/catalog/project.ts`와 생성물 `catalog/project.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S6 2장 5(harness의 권한 물음은 대기 목록에서 누르면 그 session의 터미널 탭으로 focus), 5장 4(터미널 탭은 그 앱의 앱 공간에서 열고 focus를 옮기지 않고 toast로 알린다), 7장(사람이 그 탭에 focus해 있으면 lophn은 메시지를 넣지 않고 기다린다), 8장(lophn이 꺼지면 터미널 탭 process도 끝난다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `U3.6#1`, `I3.6#16`
  - inventory(coding-agent 단위 줄이지만 이 폴더의 renderer 부분을 같이 맞춘다): `U2.6#3`(터미널 탭이 coding TUI를 보이는 모양: 연 쪽 구별, 끝나면 session이 끝난 상태, 다시 시작 없음). shell main 쪽 `main/terminal/supervisor.ts`와 `ipc/terminal.ts`의 `TerminalCoding`은 coding-agent 몫이다.
  - 결정: `../README.md` 3장 #6(PTY에 넣는 길은 core → shell main terminal host), #66·#67
  - 지금 코드: `terminal/{terminal-tab.tsx(392줄), store.ts(141줄: `request`가 사람 클릭만 받는다), model.ts(`Phase`), exit-banner.tsx(끝나면 새 [Start]), folder-choice.tsx, deps.ts, xterm-view.ts}`, `workspace/kinds/terminal.tsx`(`openTerminal`, `terminalKind`, `beforeClose`), `main/workspace/kinds/terminal.ts`(layout이 `project_folder`뿐)
  - 본보기(화면): `tools/wireframes/frames/compositions/app-space/coding-tab.tsx`(76줄: 앱 공간 pane의 coding 터미널 세 장면 running·permission·ended. screens-app-space가 옮긴다. 참고만), `compositions/bodies.tsx`(project 창의 Terminal 탭 본문), `tools/wireframes/frames/fake-terminal.ts`
- 계약:
  - 쓰는 것:
    - `packages/shell/ipc/terminal.ts`, `preload/terminal-api.ts`(contract-coding이 더하기만 한 것): `TerminalApi.focusSession({ session })`, `TerminalRuntime.coding_session?: { session, app, ticket, prompt }`, `launch_kind: "shell" | "coding_tui"`, 거절 이유 `no_terminal`. 이름은 고정된 파일을 따른다.
    - **(lead 준비) main이 새 coding runtime을 renderer에 알리는 통로.** core의 터미널 요청(`open`)은 shell main이 받아 runtime을 만들고(coding-agent-terminal) renderer에 요청 frame을 중계하지 않는다(plan의 env에 coding token이 있다). 그래서 renderer가 새 coding 탭을 알려면 `TerminalApi`에 runtime 상태를 push로 듣는 `onRuntime(listener)`가 있어야 한다. `TERMINAL_STATE_CHANNEL`은 정의돼 있으나 지금 preload가 잇지 않는다. 계약 고정에 없으면 이 task는 hook의 type만 짓고 "계약 바꾸기 요청"으로 멈춰 lead에게 알린다. runtime에 탭 제목(`title`)과 harness(`product`)도 있어야 한다(없으면 같은 요청에 적는다).
    - `packages/shell/ipc/workspace.ts`(contract-shell): layout의 터미널 탭 값
    - `VendorIcon`(ui-chrome이 design으로 옮긴 것)
  - 내놓는 것:
    - `terminal/store.ts`: `TerminalStore.requestFromCore(request)`(core 요청으로 열린 runtime을 탭으로. key는 `terminal_ref`에서 정하고 사람이 누르지 않아도 시작 상태로 둔다), `tabOfSession(session): string | null`, `focusSession(session)`(대기 목록 카드의 [Answer in terminal]이 부른다. 열려 있는 탭을 고르고, 없으면 `TerminalApi.focusSession`으로 main에 맡긴다)
    - `terminal/terminal-tab.tsx`: `TerminalTab`의 props는 지금 것에 `coding?: { product: string; session: string; app: string; ended?: boolean }`를 더하기만 한다. 앱 공간 pane이 같은 component를 쓴다.
    - `terminal/use-terminal-open-requests.ts`: `useTerminalOpenRequests(open: (request: TerminalOpenRequest) => void)`. `TerminalOpenRequest = { tab: { key: string; title: string; folder: string }; coding: { session: string; app: string; ticket: string; product: string }; focus: false }`. main이 새 `coding_tui` runtime을 알릴 때마다 한 번 부른다. project 창(`screens-project-window`)과 앱 공간(`screens-app-space-frame`)이 각자 자기 앱·project의 요청만 골라 쓴다.

## 할 일

0. 공통 규칙. `workspace/workspace.tsx`와 `kinds/host.ts`(screens-project-window)가 `terminal/`의 export(`TerminalStore`, `TerminalDeps`, `closeTerminalTab`)를 쓴다. 이름을 유지하고 더하기만 한다.
1. `store.ts`를 core 요청을 받게 넓힌다. 지금은 `request(key, folderRef)`가 사람 클릭만 받는다. `requestFromCore`는 main이 정한 key·`terminal_ref`를 쓰고 사람이 누르지 않아도 시작 상태로 둔다. session ↔ 탭 key 대응(`tabOfSession`)을 둔다. 근거: `U3.6#1`, `I3.6#16`.
2. 열림 규칙. core 요청으로 열리는 탭은 focus를 옮기지 않는다(`focus: false`). 사람이 그 탭에 focus해 있는 동안 lophn은 메시지를 넣지 않고 기다리는 규칙은 main의 coding 쪽이고, renderer는 사람이 그 탭에 focus해 있는지를 기존 `TerminalApi.focus` 알림으로 main에 알리는 것만 한다(기존 기능을 그대로 쓴다). 탭이 열렸다는 toast는 호스트(project 창은 이 task 다음에 오는 window task, 앱 공간은 screens-app-space-frame)가 이 hook의 요청을 받아 띄운다. 근거: S6 5장 4, 7장.
3. coding 터미널 탭 모양. `coding`이 있으면 탭 제목은 "{product} · {앱 이름}" 꼴이고 탭 아이콘은 harness vendor 아이콘이다(project 창의 탭 줄은 `kinds/terminal.tsx`의 `render`와 `icon`이 낸다). session이 끝나면 화면 위에 "Session ended" 상태줄(`StatusMark`)과 "다음 맡기기는 새 session으로 시작한다" 안내를 둔다. `exit-banner.tsx`의 새 [Start] 단추와 `restart`는 coding 탭에서 없앤다(사람이 연 shell 탭의 "종료됨" 줄은 그대로). harness의 권한 물음은 TUI 안에 있고 답도 거기서 한다. 근거: `U2.6#3`.
4. `workspace/kinds/terminal.tsx`와 `main/workspace/kinds/terminal.ts`를 고친다. layout이 `project_folder`뿐이던 것에 coding 표지(`session`, `product`)를 더하고, 복원은 지금처럼 종료된 placeholder로 둔다(PTY는 복원하지 않는다. lophn이 꺼지면 coding session도 끝난다). `hint`는 폴더 경로가 아닌 참조만 싣는 규칙을 그대로 둔다. 근거: `U3.6#1`.
5. 문구를 wording key로 바꾼다(영역 `terminal`: `terminal.label.session-ended`, `terminal.notice.next-handoff` 등). 새 [Start] 문구 가운데 coding 탭에서 쓰는 것이 없어지면 지운다. key는 `catalog/project.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/project.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
6. gallery `bodies.tsx`의 `TerminalBody`는 export 이름과 props를 유지한 채 renderer의 `TerminalTab`을 `fake-terminal.ts`의 bridge와 `TerminalStore`로 그리게 다시 쓴다(`project-app.tsx`가 import한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (탭 열기와 표시. 입력을 넣는 규칙의 판정은 coding-agent 단위 main 쪽 test가 본다)
- 남지 않음: 없음 (옛 이름을 지우는 task가 아니다. coding 탭에 다시 시작 단추가 없는 것은 코드 읽기로 확인한다)
- (화면) `deno task wireframes`가 되고, gallery의 `project-terminal`(지금 화면)과 `new-tab-kinds`의 Terminal 본문이 옮긴 component로 그려진다. 앱 공간의 `new-app-coding-*` 페이지는 screens-app-space가 같은 `TerminalTab`으로 그린다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (`workspace/kinds/registry.ts`는 window task가 가진다. 이름이 바뀌지 않으면 고칠 것이 없다)
- 안 쓰게 된 export: `terminal/store.ts`의 `request`가 core 요청과 구별돼 이름이 바뀌었다면 목록
- 정한 것: coding 탭 제목 꼴, session이 끝난 탭이 자동으로 닫히지 않고 남는 것, 요청 hook의 인자 모양
- 계약 바꾸기 요청(wave 3): `TerminalApi.onRuntime`과 runtime의 `title`·`product`가 계약에 없으면 여기 적는다(위 "쓰는 것" 참고)
