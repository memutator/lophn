# sweep-kit-instructions

폰 kit과 앱 agent가 읽는 지침을 고친다: 앱 화면의 머리 줄 규칙, guest 안의 Sheet, kit 기본값, phone 탭 지침, 다른 workspace에 알리는 길.

- 단위: kit-instructions (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/native/{overlay,navigation,layout,primitives,input,guide.md,package.json}`
  - `packages/sdk/`
  - `packages/core/agent-workspaces/{skills,prompts}/`
  - `packages/core/apps/packages/template/`
  - `packages/mobile/guest/fixtures/`
  - `tests/support/app/sample/`
  - `tools/wireframes/package.json`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `phone-app-screen-draws-second-header`: `decided`: lophn만 그린다. skill, 두 guide, fixture를 고친다
2. `phone-kit-topbar-shows-menu-by-default`
3. `phone-kit-button-under-touch-target`
4. `phone-guest-can-cover-app`: guest 안에서는 kit `Sheet`를 화면 안의 view로 그린다. lophn 자기 화면(host)의 `Sheet`는 그대로 둔다
5. `phone-drive-cannot-reach-sheet`: 위와 같은 변경으로 풀리는지 확인
6. `phone-drive-lists-partial`: 지침 문장만(`phone-check.md`). `[more]` 표지는 하지 않는다
7. `phone-drive-type-skips-press`: 지침 문장
8. `home-memory-workspace-map-empty`: 추천안(prompt 셋)
9. `remove-public-command-users-found-via-home`: `decided`. `project-docs/products/AGENT.md`의 A21은 lead가 고친다

알아 둘 것:
- SDK 판과 앱 agent 지침을 바꾸는 일이다. `.claude/skills/sdk-note/SKILL.md`대로 판을 정하고 pin을 모두 고치고 `migrate-sdk` 메모(`## Instruction diff`)를 쓴다. check의 sdk notes 단계가 본다.
- `packages/design/native/feedback/`은 `sweep-phone-lists`의 것이다.
- 폰 앱 type 검사도 돈다(kit을 폰 앱이 쓴다).

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
