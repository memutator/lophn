# mobile-coding-open-phone

폰에서 coding session을 컴퓨터에 새로 열고(project와 coding agent를 고른다), 지난 coding session을 채팅으로 이어 가고, 컴퓨터의 lophn 앱이 꺼져 있으면 명시적 단추로 깨운다. core·shell 쪽은 `mobile-coding-open-host`가 했고 이 task는 화면과 흐름만 한다.

- 단위: coding-phone (wave 8)
- 선행: mobile-coding-open-host, mobile-terminal-phone, mobile-coding-phone-screens
- 소유(이 task만 고친다). 아래 path는 `phone-app` brief에서 예상한 이름이다. land된 실제 path를 먼저 확인한다(README "돌리기 전에"):
  - `packages/mobile/src/screens/coding`(`open*` 새 file들과, 목록의 깨우기·`Continue as chat` 단추, 새 session sheet의 coding 묶음을 꽂는 만큼만)
  - `packages/mobile/src/screens/session`(새 session 화면의 agent 고르기에 coding 묶음을 꽂는 만큼만)
  - `packages/mobile/src/data/coding.ts`(`useCodingActions`의 `open`·`wake` 흐름에 필요한 만큼만)
  - `packages/design/i18n/catalog/mobile-coding.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/coding.tsx`의 새 coding session, Continue as chat, 앱 안 떠 있음 화면과 caption(`mobile-coding-wireframes`)
  - 이 계획 `README.md`의 "정한 것"(깨우기는 명시적 단추로만, 되살리기는 ledger의 coding session에 한한다, 앱을 깨워도 목록은 비어 있고 열기와 함께일 때만 쓸모 있다)
  - core 계약: `coding_sessions/open`·`wake`의 입력과 오류(`mobile-coding-open-host` 보고), `useCodingActions`(`mobile-coding-phone-data`)
  - 폰의 뼈대: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/data/mod.ts`
- 계약:
  - 쓰는 것: `useCodingActions().open`·`wake`, `useCodingSessions`(`shell` 상태가 `attached`로 바뀌길 기다린다)
  - 내놓는 것: 없음(화면)

## 할 일

1. 깨우기: 목록의 "lophn is not running on <computer>" 줄(`mobile-coding-phone-screens`가 그린 자리)에 `Start lophn on the computer` 단추. 누르면 `wake()`를 부르고 `starting` 동안 진행 표시를 보이고 `shell`이 `attached`가 되면 줄이 사라진다. 실패(`unavailable`)는 한 줄 안내("컴퓨터에서 lophn을 직접 열어 주세요")다. 자동으로 부르지 않는다.
2. 새 session: 새 session 화면의 agent 고르기에 "Coding agents on <computer>" 묶음(`shell`이 `attached`일 때만. 아니면 깨우기 단추로 안내). 고르면 첫 말은 받지 않고 `open({project, harness})`를 부른 뒤 돌려받은 session의 대화로 간다(열리는 동안 진행 표시. 첫 말은 대화에서 보낸다). wireframe의 "Starts in a new terminal tab on the computer" 안내를 보인다. project workspace가 아니면(Home, 앱) coding 묶음을 그리지 않는다.
3. 이어 가기: 읽기만 보이던 지난 coding session(ledger의 harness agent session, 대화의 menu 또는 읽기 화면의 단추)에서 `Continue as chat`이 `open({project, harness, resume: {session}})`을 부른다. `conflict`(이미 컴퓨터에서 도는 중)는 "이미 컴퓨터에서 열려 있다" 줄로 알리고 목록으로 간다.
4. 마지막으로 emulator(port 5594, Metro 8234)에 lead가 지어 둔 dev build를 깔고(`-read-only -memory 2048 -port 5594`, 모든 adb 명령에 `-s emulator-5594`) 개발 core와 `tools/fake-coding-host.ts`(`mobile-coding-open-host`가 `coding_open`에 canned 답을 하게 만든 것)에 pairing해 깨우기 줄, 새 session, 이어 가기를 한 번씩 확인하고 그림을 `.dev-data/mobile-coding-open-phone/shots/`에 둔다. 개발 core는 launcher가 없어 `wake`가 `unavailable`이므로 그 실패 안내를 확인한다. 못 본 것은 "확인 못 함"으로 적는다. 끝나면 `adb -s emulator-5594 emu kill`로 끄고 띄운 process를 모두 정리한다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.

## 끝남

- `npm run check`와 `cd packages/mobile && npm run typecheck && npm test`가 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, fake host로 확인한 것과 못 한 것(실제 desktop에서 창 없이 열기는 확인 못 함).
