# sweep-phone-lists

폰의 sidebar·Home·검색·file 목록을 desktop 규칙에 맞추고 앱·project 아이콘을 보인다. 가벼운 목록과 아이콘은 폰에 file로 두고 먼저 그린다.

- 단위: phone-lists (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/app/{sidebar.tsx,nav.ts}`
  - `packages/mobile/src/data/{workspaces.ts,apps.ts,search.ts,places.ts}`
  - `packages/mobile/src/parts/`
  - `packages/mobile/src/screens/home/{apps.tsx,compose.tsx,index.tsx,offline.tsx}`
  - `packages/mobile/src/screens/{search,workspace,agents}/`
  - `packages/mobile/src/shortcuts/`
  - `packages/mobile/app.json`
  - `packages/design/native/feedback/`
  - `packages/shell/renderer/shell/left-sidebar-workspaces.ts`
  - `packages/shell/renderer/parts/agent-session/`
  - `tools/wireframes/drafts/phone/{shell,index,workspace}.tsx`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `phone-sidebar-sessions-and-dots-differ-from-desktop`: 고르기·순서·점의 순수 함수를 `packages/shell/renderer/parts/agent-session/`의 DOM 없는 file로 꺼내 desktop과 폰이 같이 쓴다
2. `phone-app-icons-not-shown`: hash 없이. `StateChanged`의 apps와 다시 붙을 때 다시 받는다. 받은 그림은 (컴퓨터, 앱)마다 file로 둔다. project도 같은 길
3. `phone-home-offline-drops-computer-apps`: 컴퓨터마다 마지막 앱·project 목록을 file로 둔다. 대화 내용은 저장하지 않는다
4. `phone-project-first-folder-only`
5. `shortcut-reconcile-covers-current-computer-only`
6. `shortcut-keeps-old-label-and-icon`: 이름이 바뀐 것을 맞춘다. 그림은 위 아이콘 file과 비교할 수 있으면 같이
7. `phone-notification-icon-default`

알아 둘 것:
- 저장은 한 file(새로 만드는 `data/` 아래 store)에 모은다. 기기를 끊거나 컴퓨터를 지우면 그 컴퓨터의 것을 지운다.
- `data/hooks.tsx`는 `sweep-phone-chat`의 것이다. 거기에 필요한 줄은 보고의 "넘길 줄"에 적는다.
- `app.json`을 바꾸면 새 dev build가 있어야 보인다. 보고에 적는다.

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
