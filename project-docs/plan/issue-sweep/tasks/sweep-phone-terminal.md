# sweep-phone-terminal

폰의 터미널 보기를 Paseo의 크기 규칙으로 고치고, 폰이 연 것 때문에 컴퓨터에 project 창이 없어도 열리게 하고, 폰에서 터미널 탭을 여는 길을 만든다.

- 단위: phone-terminal (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/terminal/`
  - `packages/mobile/src/data/{terminal.ts,terminal.test.ts,sample.ts}`
  - `packages/core/terminal-view/`
  - `packages/protocol/coding-agent/`
  - `packages/shell/main/terminal/{terminal-view.ts,terminal-view_test.ts,coding-open.ts,coding-open_test.ts,controller.ts,supervisor.ts,harness-tui.ts}`
  - `packages/shell/main/desktop/wiring/{terminal-view.ts,surface.ts,coding.ts}`
  - `packages/shell/terminal-host/`
  - `packages/shell/renderer/terminal/`
  - `packages/shell/ipc/terminal.ts`
  - `tools/wireframes/drafts/phone/terminal.tsx`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `phone-terminal-view-unreadable-on-narrow-screen`: `decided`의 크기 규칙. 조사는 `reports/phone-native-ui/paseo-terminal.md`(main checkout에만 있다: `/home/pyosechang/projects/lophn/reports/phone-native-ui/paseo-terminal.md`). key 줄 보강과 맨 아래로 가기도 같이
2. `phone-terminal-wide-glyph-spacing`
3. `phone-sample-terminal-screen-missing`
4. `phone-coding-open-refused-without-project-window`: `decided`: 그 project의 창을 focus 없이 하나 열고 거기에 탭을 연다
5. `phone-cannot-open-terminal-tab`: core route와 host 요청, 폰의 `data/terminal.ts`에 여는 함수(project를 받아 터미널 id를 준다)와 터미널 화면까지. 새 session 화면에 항목을 놓는 것은 뒤 wave가 한다
6. `tui-tab-hold-two-gaps`

알아 둘 것:
- 터미널 화면의 머리 줄도 session 이름을 큰 글로 한다(이슈 `phone-session-header-leads-with-agent-name`의 규칙).
- 새 route는 `packages/protocol/remote/allowlist.ts`와 core 조립 목록에 등록해야 한다. 그 두 곳은 줄을 더하기만 하고 보고의 "등록할 것"에도 적는다.
- Electron 창과 실제 폰에서 돌려 보지 못한 것은 "알려진 미완 동작"에 적는다. lead가 merge 전에 확인한다.

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
