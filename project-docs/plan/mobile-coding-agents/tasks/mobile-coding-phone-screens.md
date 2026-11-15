# mobile-coding-phone-screens

폰 화면에서 coding session을 다룬다: project workspace의 coding session 목록, coding session 대화(같은 대화 화면에서 입력, 승인·질문 card, 멈춤), 터미널로 도는 session을 채팅 화면으로 바꾸는 switch sheet, 앱이 안 떠 있다는 안내. wireframe(`mobile-coding-wireframes`, 사람이 승인한 것)을 옮긴다.

- 단위: coding-phone (wave 6)
- 선행: mobile-coding-mobile-data, mobile-coding-wireframes
- 소유(이 task만 고친다). 아래 path는 `mobile-app` brief에서 예상한 이름이다. land된 실제 path를 먼저 확인한다(README "돌리기 전에"):
  - `packages/mobile/src/screens/coding`(새 폴더 전체)
  - `packages/mobile/src/screens/session`(coding session을 열었을 때 입력 칸·카드 자리가 `useConversation`의 coding 갈래로 도는 만큼만, 읽기만 보이던 coding session의 "컴퓨터에서 이어 간다" 줄을 대신하는 만큼만)
  - `packages/mobile/src/screens/workspace`(Sessions 탭에 coding 목록 묶음을 꽂는 만큼만)
  - `packages/design/i18n/catalog/mobile-coding.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/coding.tsx` 전부와 caption(그림 `.dev-data/mobile-coding-wireframes/shots/`와 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/4-session.png`, `6-project-workspace.png`), `session.tsx`의 `Coding`, `workspace.tsx`의 `Sessions`
  - 이 계획 `README.md`의 "정한 것"(switch 확인 문구는 도는 turn이 끊기고 desktop 탭도 채팅 화면으로 바뀐다는 것을 말한다)
  - desktop의 같은 화면: `packages/shell/renderer/conversation/agent-view.tsx`와 `packages/shell/renderer/terminal/terminal-gui.tsx`의 toggle modal(`GuiStops` 문구)
  - 폰의 뼈대와 kit: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/data/mod.ts`(`useCodingSessions`, `useCodingActions`, `useConversation`의 coding 갈래. `mobile-coding-mobile-data` 보고)
  - 목록과 keyboard를 다룬 법: `/home/pyosechang/projects/lophn/reports/phone-native-ui/{t3code,paseo,happy}.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `packages/mobile/src/data/mod.ts`. kit에 없는 조각이 필요하면 자기 영역 폴더에 두고 보고한다(kit은 고치지 않는다)
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog에 같은 문장(예: desktop toggle의 멈출 일 문구)이 있으면 그 key를 쓰고, 없을 때만 자기 catalog file에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장)
  - 내놓는 것: `screens/coding/index.tsx`가 내는 `CodingSessionList`(workspace의 Sessions 탭이 쓴다)와 `SwitchSheet`(`session`, 대화 화면이 연다), `nav`에 coding session을 여는 길이 필요하면 `session(id)`의 target에 coding 갈래를 싣는다(`nav.ts`는 고치지 않고 필요한 변경을 보고한다)

## 할 일

1. 목록: Sessions 탭 아래 "Coding agents on <computer>" 묶음. 줄은 harness 얼굴과 제목, 상태(running, waiting, idle), `view`가 tui면 작은 "Terminal" 표시. 누르면 대화로 간다. `shell`이 `absent`면 묶음 자리에 "lophn is not running on <computer>" 줄(깨우기 단추는 `mobile-coding-open-phone`이 단다. 이 task는 줄만 그린다). 빈 목록이면 묶음을 그리지 않는다.
2. 대화: `view`가 gui면 lophn agent와 같은 대화 화면이 `useConversation`의 coding 갈래로 돈다(입력, queue, 승인과 질문 card, 멈춤). 상태 `capabilities`가 없다고 하는 행(rewind, fork, model 바꾸기 등)은 그리지 않는다. `view`가 tui면 thread는 읽을 수 없으므로(상태가 없다) 입력 칸 자리에 "이 chat은 컴퓨터의 터미널에서 열려 있다" 줄과 `Switch to chat` 단추(막혔으면 `switch.blocked`의 이유를 한 줄로).
3. switch sheet: 단추를 누르면 `switchPlan(session)`으로 멈출 일(turn, 일하는 중인 task 수, queue 수)을 읽어 보이고, 사람이 `Switch`를 눌렀을 때만 `switchView(session, "gui")`를 부른다. 도는 turn이 있으면 끊긴다는 것과 desktop 탭이 채팅 화면이 된다는 것을 같은 sheet에 쓴다. 실패 code는 줄 하나로(`conflict`: 이미 바뀜, `unavailable`: 컴퓨터의 앱 또는 extension 문제, `not_found`: session이 사라짐).
4. 컴퓨터가 offline이면 목록은 마지막으로 읽은 것을 흐리게 보이고 단추를 잠근다.
5. 마지막으로 emulator(port 5590, Metro 8230)에 lead가 지어 둔 dev build(`mobile-app`의 것. native module을 더하지 않는다)를 깔고(`-read-only -memory 2048 -port 5590`, 모든 adb 명령에 `-s emulator-5590`) sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/mobile-coding-phone-screens/shots/`에 둔다(light 전부, dark 둘). 개발 core(`npm run dev:core`)와 `tools/fake-coding-host.ts`에 pairing해 실제 relay 길로 승인 card에 답하고 switch를 한 번씩 확인한다. 못 본 것은 "확인 못 함"으로 적는다. 끝나면 `adb -s emulator-5590 emu kill`로 끄고 띄운 process를 모두 정리한다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.

## 끝남

- `npm run check`와 `cd packages/mobile && npm run typecheck && npm test`가 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, fake host로 확인한 것과 못 한 것, `nav.ts`에 필요한 변경.
