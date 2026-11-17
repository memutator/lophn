# sweep-phone-chat

폰의 대화 화면과 desktop 대화가 같이 쓰는 규칙을 고친다: 머리 줄, 글로 친 `/` command, 거절 이유, fork·rewind·subagent 열기, 보내기의 `seen`, 받은 메시지 panel.

- 단위: phone-chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/session/{conversation,thread,ask,sheets,parts,attach,diff,index}.tsx`
  - `packages/mobile/src/screens/inbox/`
  - `packages/mobile/src/screens/home/needs.tsx`
  - `packages/mobile/src/data/{hooks.tsx,attach.ts,mod.ts}`
  - `packages/shell/renderer/conversation/`
  - `tools/wireframes/drafts/phone/{session,inbox}.tsx`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `phone-session-header-leads-with-agent-name`: 대화 화면의 머리 줄만(터미널 화면의 머리 줄은 `sweep-phone-terminal`이 한다)
2. `phone-typed-slash-command-not-handled`: desktop `runSlash`의 규칙을 DOM 없는 file로 꺼내 폰과 같이 쓴다
3. `phone-deny-has-no-reason`: Deny 자리 셋 모두
4. `phone-conversation-lacks-fork-rewind-subagent`
5. `stale-send-false-changed-elsewhere`: 작은 안(첫 snapshot 전에는 `seen`을 싣지 않는다). desktop과 폰 둘 다
6. `phone-copies-desktop-pure-helpers`: 다섯 helper를 DOM 없는 file로 꺼내 폰이 import한다
7. `received-message-panel-repeats-body`

알아 둘 것:
- `conversation.tsx`의 그림 붙이기(`pictures`)와 coding session의 tool 본문은 건드리지 않는다(뒤 wave가 한다).
- `new-session.tsx`와 `screens/coding/`은 `sweep-phone-new-session`의 것이다.
- 폰 화면은 emulator 없이 type 검사와 unit test로만 확인한다. 못 본 것은 "알려진 미완 동작"에 적는다.

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
