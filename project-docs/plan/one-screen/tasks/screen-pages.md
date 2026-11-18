# screen-pages

다른 기계의 agent가 연 browser page를 이 컴퓨터의 창에서 탭으로 연다. `core-browser`의 page 보기(목록 탭과 page 탭, kind `page-view`)는 기계마다의 창을 전제로 지어졌다. 그것을 탭의 기계로 보게 바꾸고, 새 탭 menu에서 connected인 다른 기계마다 그 기계의 page 목록을 연다. 이 컴퓨터의 agent page는 지금처럼 browser 탭이다.

- 단위: screen (wave 3)
- 선행: screen-lists. `core-browser`가 main에 올라간 뒤에 띄운다(README "lead가 할 일").
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/page-view.tsx`, `packages/shell/renderer/browser/page-view/`
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`
  - `tools/wireframes/pages/screens/shell.tsx`, `tools/wireframes/pages/screens/shell/machine-page-scene.tsx`
  - `packages/design/i18n/catalog/remote-desk.ts`
  - `project-docs/architecture/browser-tab.md`("멀리서 보기" 절)
- 읽을 것:
  - 계획 README "정한 것 › 열리는 것"의 agent의 browser page
  - `core-browser`의 brief `project-docs/plan/core-browser/tasks/page-view-desktop.md`(kind, key, 목록 탭과 page 탭, lease, 입력)와 `page-view-core.md`
  - architecture: `project-docs/architecture/browser-tab.md` "멀리서 보기", `remote.md`(screen-base-scope 초안)
  - 조사 `reports/multi-device/survey-n1-one-screen.md` G7, 부록 A "Agent browser page"
  - screen-base-scope의 `TabScope`, `TabItem.machine`, `useMachineData`, `useScopeMachine`
- 계약:
  - 쓰는 것: `page_view/list|snapshot|watch|input|control|open`, `PAGE_VIEW_RENEW_MS`(`packages/protocol/lophn-agent/page-view.ts`), event `PageViewChanged`, `StateChanged{browser_pages}`, `TabItem.machine`, `TabHost.machineData`
  - 내놓는 것: 없음

시작 전에 다시 볼 것: 이 brief는 `core-browser`가 올라가기 전에 `git show plan/core-browser:…`로 썼다. 그때의 main과 댄다: `kinds/page-view.tsx`와 `browser/page-view/`의 실제 이름, 목록 탭 key(`pages`)와 page 탭 key(`page-view:<tab>`), `add-tab-menu.tsx`의 `onPages`, `workspace-window.tsx`가 `onPages`를 넘기는 갈래(`machine !== null`), gallery page id(`shell-machine-pages`, `shell-machine-page*`), 글 key(`machines.page.*`). 다르면 그 이름을 쓰고 보고에 적는다. `core-browser`가 기기 목록에 `PAGE_VIEW_ROUTES`와 `PageViewChanged`를 넣었는지 본다(없으면 "등록할 것").

## 할 일

1. wireframe 먼저(`ui-design` skill): `core-browser`가 그린 `shell-machine-page*` page를 기계 창이 아닌 이 컴퓨터의 창의 탭으로 고친다(탭 이름 옆 기계 꼬리표, 새 탭 menu의 "Pages on <기계>"). 새 page `shell-pages-menu`(새 탭 menu에 connected인 다른 기계마다 한 줄)를 더한다. scene은 `shell/machine-page-scene.tsx`.
2. `kinds/page-view.tsx`: 탭이 `machine`을 든다. 목록 탭 key는 `pages-<mch>`, page 탭 key는 `page-view-<mch>-<tab>`이다(기계를 건너 탭 key가 겹치지 않는다. 이 task가 갖는 규칙). 본문은 `TabScope` 안에서 그 기계의 core로 `page_view/*`를 부른다. `fromStored`·`toStored`는 두지 않는다.
3. `add-tab-menu.tsx`: connected인 다른 기계 목록을 스스로 읽고(`useMachinesView()`) 기계마다 "Pages on <기계>"를 두며 `onPages(machine)`을 부른다. 다른 기계가 없으면 항목이 없다(한 대만 쓰는 사람의 화면은 그대로다). `workspace-window.tsx`는 같은 wave의 `screen-windows`가 갖는다: 그 file에서 `onPages`를 늘 넘기고(창이 기계에 묶이던 `machine !== null`이나 `data.here` 갈래를 지우고) `machine`을 받아 탭을 여는 줄을 "넘길 줄"에 정확히 적는다. lead가 둘을 merge한 뒤 넣는다.
4. 다룰 수 없는 기기(snapshot의 `control: false`)는 지금 `core-browser`의 규칙대로 그림만 보인다. 꺼진 기계의 탭은 `TabScope`가 꺼짐으로 그린다.
5. 글은 `remote-desk.ts`의 `machines.page.*`. `browser-tab.md` "멀리서 보기"에서 "다른 기계의 창"을 "이 창의 탭(탭이 기계를 든다)"으로 고친다. route·IPC를 더하거나 지우지 않으므로 flows는 고치지 않는다. 바뀐 화면 흐름이 flows의 page 보기 줄과 다르면 그 줄의 file과 바꿀 글을 보고에 적는다.

### 정한 것
- page 탭은 저장하지 않는다: page id가 그 기계 core의 것이고 agent가 닫으면 사라진다(`core-browser`의 결정 그대로).
- 기계마다 목록 탭 하나다: 여러 기계의 page를 한 목록에 섞지 않고 탭 줄이 기계 꼬리표로 나란히 보인다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `shell-pages-menu`와 고친 `shell-machine-page*`가 renderer component로 그려진다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음(입력 자격은 받는 core가 본다, `core-browser`의 `page-view-core`).
- 남지 않음: `grep -n "machine !== null\|machine === null" packages/shell/renderer/workspace/add-tab-menu.tsx`가 0줄이다(`workspace-window.tsx`의 갈래는 넘길 줄로 lead가 지운다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## (lead가 더함)

- `core-browser`와 그 뒤 고침(`project-docs/products/change-log/0.23/core-browser.yaml`, `browser-control-release.yaml`)이 main에 올라갔다. brief가 가리키는 그 계획의 task brief는 지워졌다: `git show 651e76856^:project-docs/plan/core-browser/tasks/<file>`로 읽는다.
- `page_view/list`의 page마다 `held_by`(`"you" | "phone" | "computer" | null`)가 온다. page 목록(desktop과 폰)에 "누가 잡고 있나"를 그린다. 잡기는 그 page를 보고 있어야 되고(lease), 보는 쪽이 떠나면 core가 푼다.
- 기계마다의 창이 없어지므로 다시 볼 것(review `reports/multi-device/review-core-browser.md` 10): page 보기가 기계 이름을 창에서 가져오던 곳, route가 가는 core(창의 core가 아니라 범위의 기계), 다른 기계의 event가 `MachineFrameReceived`로 오는 것, 이 컴퓨터의 단축키와 부딪히는 key 잡기.
