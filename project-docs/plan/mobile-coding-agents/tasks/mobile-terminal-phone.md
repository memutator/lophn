# mobile-terminal-phone

폰의 raw 터미널 화면을 짓는다: coding session의 터미널을 styled text row로 그리고, 스크롤과 폭 맞추기, 허락받은 기기에서는 글 입력 칸과 key bar. 폰 allowlist에 `terminal_view/*` route와 `TerminalScreenChanged` event를 더한다. 입구는 coding session 대화의 menu다.

- 단위: terminal-view (wave 7)
- 선행: mobile-terminal-core, mobile-terminal-shell, mobile-terminal-device-grant, mobile-coding-phone-screens
- 소유(이 task만 고친다). 아래 `packages/mobile/...` path는 `phone-app` brief에서 예상한 이름이다. land된 실제 path를 먼저 확인한다(README "돌리기 전에"):
  - `packages/protocol/remote/allowlist.ts`
  - `packages/mobile/src/screens/terminal`(새 폴더 전체)
  - `packages/mobile/src/data/terminal.ts`(새 file)와 `terminal.test.ts`(새 file), `packages/mobile/src/data/mod.ts`(내보내기)
  - `packages/mobile/src/screens/coding`(대화 menu에 `Terminal` 줄을 꽂는 만큼만)
  - `packages/design/i18n/catalog/mobile-terminal.ts`(새 file. 만든 뒤 `packages/design/i18n/en.ts`에 올리는 한 줄은 lead가 더한다. 보고에 쓴다)
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/coding.tsx`의 터미널 화면들과 caption(`mobile-coding-wireframes`)
  - 이 계획 `README.md`의 "정한 것"(보기만이 기본, 입력은 기기 스위치, 폰은 PTY 크기를 바꾸지 않는다, styled text row로 먼저 그린다)
  - core 계약: `packages/protocol/coding-agent/terminal-view.ts`(`terminal_view/{snapshot,watch,input}`, `TerminalScreenChanged`, `snapshot.input`)와 `packages/protocol/host-link/frames.ts`의 `terminalLineSchema`(run의 `fg`, `bg`, `bold`, `dim`, `italic`, `underline`, `inverse`, `wide`)
  - 폰의 뼈대: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/data/{mod.ts,coding.ts}`(`useCodingSessions`와 `CodingSession.terminal`), 이벤트 구독은 `data/link.ts`의 event client
  - 비교 조사(터미널): `/home/pyosechang/projects/lophn/reports/phone-native-ui/paseo.md`(WebView xterm과 native 터미널을 쓴 이유), `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 7(7번: CJK와 box drawing)
- 계약:
  - 쓰는 것: 위 route와 event. 입력은 `snapshot.input`이 true일 때만 그린다(core가 어차피 거절한다)
  - 내놓는 것: `screens/terminal/index.tsx`의 `TerminalScreen`. data는 `useTerminal(terminal)`: `{screen: TerminalSnapshot | null, status, input: boolean, send(text): Promise<SourceResult<void>>}`. 화면을 열면 `terminal_view/watch {on: true}`를 부르고 10초마다 갱신하며 닫으면 `on: false`(앱이 background로 가면 갱신을 멈추고 돌아오면 다시 건다). `TerminalScreenChanged`나 `ready`를 받으면 `snapshot`을 다시 읽는다(한꺼번에 오는 것은 한 번으로 묶는다). allowlist에 `terminal_view/snapshot`, `terminal_view/watch`, `terminal_view/input`과 event `TerminalScreenChanged`를 더한다. 더하지 않는 것: `devices/set_terminal_input`, `host/*`

## 할 일

1. data: `data/terminal.ts`(`useTerminal`)와 `terminal.test.ts`(Node test: watch를 열고 닫는다, 갱신 주기, 변경 event를 묶는다).
2. 화면: 고정폭 font의 `Text` row를 줄(`lines`, 위에 `scrollback`)마다 한 `Text`로 그리고 run은 중첩 `Text`로 서식을 입힌다(색은 `#rrggbb`나 palette 번호 0~255를 xterm 표준 색표로 옮기는 작은 표를 이 폴더에 둔다. light·dark 모두 읽히게 기본 전경·배경은 kit token을 쓴다). `inverse`는 전경과 배경을 바꾼다. `wide` run은 두 칸 폭으로 맞춘다(CJK가 깨지지 않게 글자 폭을 `columns`에 맞춘 고정 칸 폭으로 고정한다). cursor 칸을 표시한다. 폭 맞추기 Seg `Fit width`(글자 크기를 줄여 `columns`가 한 줄에 들게)와 `100%`(가로 스크롤). 세로는 `FlatList`로 scrollback까지 스크롤하고 최신 화면을 따라가며 읽으려고 올리면 따라가기를 멈추고 최신으로 가기 단추가 뜬다. 상단에 session 이름과 `View only` 표시(입력이 허락되면 표시 없음).
3. 입력: `input`이 true면 아래에 글 입력 칸과 key bar(Esc, Tab, Ctrl-C, ↑ ↓ ← →, Enter)를 둔다. 글자는 `terminal_view/input`의 `text`로, key는 각 제어 문자열(`\x1b`, `\t`, `\x03`, `\x1b[A` 등)로 보낸다. 각 호출에 새 `key`를 싣는다. 입력이 허락되지 않으면 wireframe의 안내 줄("Typing is off for this phone. Turn it on in Settings › Remote on the computer.")만 둔다. 화면을 못 쓰는 상태(coding session이 사라짐 `not_found`, 컴퓨터 offline)는 한 줄로 알린다.
4. 입구: 대화 menu(`screens/coding`)에 `Terminal` 줄. 누르면 `TerminalScreen`으로 간다(`nav.ts`에 필요한 변경은 보고한다).
5. 결론을 보고에 쓴다: styled row 그림이 못 쓸 정도인 곳(CJK, box drawing, 속도)이 있었는지. 있으면 어디가 어떻게 못 쓰는지(WebView xterm은 이 계획이 더하지 않는다. 필요하면 다음 계획의 일).
6. 마지막으로 emulator(port 5592, Metro 8232)에 lead가 지어 둔 dev build를 깔고(`-read-only -memory 2048 -port 5592`, 모든 adb 명령에 `-s emulator-5592`) 개발 core(`npm run dev:core`)와 `tools/fake-coding-host.ts`(색 있는 canned 화면을 올린다)에 pairing해 화면 그림을 `.dev-data/mobile-terminal-phone/shots/`에 둔다(보기만, 입력 허락 둘 다. 입력 허락은 개발 core에서 `devices/set_terminal_input`을 사람 자격으로 한 번 불러 켠다). 못 본 것은 "확인 못 함"으로 적는다. 끝나면 `adb -s emulator-5592 emu kill`로 끄고 띄운 process를 모두 정리한다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.

## 끝남

- `npm run check`와 `cd packages/mobile && npm run typecheck && npm test`가 통과한다.
- 위험 test: 없음(허락 경계는 core의 test가 본다. 폰 allowlist에 `devices/set_terminal_input`이 없다는 것은 기존 "폰 자격은 목록 밖 route를 못 부른다" test가 본다)
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, 터미널 row 그림의 결론(위 5), 한 화면 갱신당 읽은 바이트와 갱신 빈도, 확인한 것과 못 한 것, 등록할 것(`en.ts`의 catalog 한 줄, `nav.ts` 변경).
