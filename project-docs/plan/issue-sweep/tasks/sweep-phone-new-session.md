# sweep-phone-new-session

폰의 새 session 화면에서 고르기 단추를 둘(workspace, agent)로 합치고 coding agent를 agent 목록의 item으로 넣는다.

- 단위: phone-new-session (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/session/new-session.tsx`
  - `packages/mobile/src/screens/coding/`
  - `packages/mobile/src/data/{coding.ts,coding.test.ts}`
  - `tools/wireframes/drafts/phone/coding.tsx`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `phone-new-session-has-redundant-coding-button`: agent sheet 안에 lophn agent 묶음과 coding agent 묶음. Coding agents 단추와 `coding` sheet를 지운다
2. `phone-new-coding-session-opens-on-pick`: 고를 때 열지 않고 첫 메시지를 보낼 때 `coding_sessions/open`을 부르고 그 메시지를 보낸다
3. `phone-coding-agent-list-waits-for-session-read`: 목록은 `GUI_HARNESSES` 상수에서 바로 그린다

알아 둘 것:
- agent sheet에 Terminal 항목을 놓을 자리(coding agent 묶음 아래)를 생각해 두되 넣지는 않는다. 여는 길은 `sweep-phone-terminal`이 만들고 뒤 wave가 잇는다.
- 폰 화면은 emulator 없이 type 검사와 unit test로만 확인한다.

## 끝남

- `npm run check:full`이 통과한다.
- 폰 앱을 고쳤으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다(root check 밖이다).
- 위험 test: 이슈의 `fix`가 "test를 쓴다"고 한 것과 데이터·권한에 닿는 것만(`write-test` skill). 나머지는 없음
- 이슈마다 고쳤는지, 못 고쳤으면 왜인지가 보고에 있다.

## 보고

- 이슈마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
