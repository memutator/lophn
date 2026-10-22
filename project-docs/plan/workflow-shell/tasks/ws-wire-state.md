# ws-wire-state

project 창 `Workspace`의 layout state를 `WorkspaceView` 하나에서 `WorkspaceDesks`로 바꾼다. 보이는 자리의 view만 그리고 고치게 하고, 자리를 바꾸는 일(`switchTo`), 어느 탭 여는 길이든 다른 자리의 탭이면 그 자리로 바꿔 보이기, detached 창 event를 탭이 있는 자리의 것으로 받기, 자리를 바꿀 때 detached 창 숨기기·보이기를 잇는다. selector 화면은 ws-wire-selector가 단다. wireframe 승인 뒤에 돈다.

- 단위: wire (wave 2)
- 선행: ws-model, ws-layout-map, ws-detached-show, ws-desk-wireframe. 앞 셋은 이 task가 import하는 계약이고, wireframe은 사람이 승인해야 renderer wiring이 돈다.
- 시작 조건: ~~계획 `workflow`의 `wf-screen-sidebar`가 main에 land했다.~~ 사람이 바꿨다(2026-10-22): `wf-screen-sidebar`를 기다리지 않고 먼저 돈다. 이 task는 workflow 코드를 쓰지 않는다. 계획 `workflow`의 `workspace.tsx` 고침(`wf-sidebar-activity`의 `onRail` 줄, `wf-screen-sidebar`의 두 줄)이 뒤에 이 변경 위로 rebase한다. 아래 "읽을 것"의 "`wf-screen-sidebar`가 land한 `workspace.tsx`"는 아직 없으니 건너뛴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/workspace/detached/detached-space.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것" 전부
  - architecture: `project-docs/architecture/workspace-layout.md`의 "지키는 것" 중 "탭 하나는 한 곳에만 있다", "탭을 찾고 바꾸는 곳은 pane, floats, detached를 모두 본다", "project 창 renderer가 detached 항목까지 layout 전체를 갖고 저장한다", "Detach와 Dock은 transfer → main이 창을 열거나 닫고 view를 옮김 → 성공했을 때만 layout 바꾸기 순서다", "detached 창의 ×는 dock이다", "minimized는 floated에서만 간다"(접힌 탭은 고르지 않은 docked 탭처럼 다룬다), "app panel의 native view는 탭이 사는 동안 산다"
  - 계약 brief: `project-docs/plan/workflow-shell/tasks/ws-model.md`, `ws-layout-map.md`, `ws-detached-show.md`
  - 코드(모두 `packages/shell/renderer/workspace/` 아래)
    - `workspace.tsx`: `freshView`, `view` state와 `latest`·`update`·`persist`·`persistLater`·`withPositions`, `load` effect(복원과 detached 창 열기), layout에서 사라진 탭의 view를 닫는 effect, `removeTab`, `openTab`, `openFloatTab`, `patchTab`, 대기 목록 `terminal.store.onSelect` effect, `detach`, `onDetachedEvent`, `runCommand`의 `tab.reopen`, `tabsAt`·`moveFile`·`trashFile`
    - `kinds/host.ts`(`TabHost`), `kinds/agent.tsx`(`agentTabs`, `reusable`, `freshKey`, `distinctAgentTab`, `openAgent`), `detached/detached-space.tsx`(detached 창이 `TabHost`를 만드는 곳)
    - `model.ts`의 자리 층 함수(ws-model이 land한 것)
  - 계획 `workflow`의 `wf-screen-sidebar`가 land한 `workspace.tsx`(workflow 줄을 연결한 곳)
- 계약:
  - 쓰는 것
    - ws-model: `WorkspaceDesks`, `DEFAULT_DESK`, `emptyView`, `desksFromView`, `activeView`, `setActiveView`, `setDeskView`, `deskOfTab`, `allDeskTabs`, `mapDeskTabs`, `storableDesks`(layout-map이 부른다), `switchDesk`, `openAcrossDesks`, `vanishedDesks`, `mergeDeskIntoDefault`
    - ws-layout-map: `desksFromStored`, `toStoredLayout({ project, desks })`
    - ws-detached-show: `window.lophnDetached.showOnly({ keys }): Promise<{ missing: string[] }>`(`props.detached`)
  - 내놓는 것(ws-wire-selector가 같은 file에서 쓴다. `workspace.tsx` 안의 내부 값이라 export하지 않는다)
    - state `desks: WorkspaceDesks`와 파생 값 `view = activeView(desks)`, `activeDesk = desks.active`
    - `switchTo(key: string, seed: WorkspaceView)`: `switchDesk` → 저장 → 이 project 창의 detached 창을 가는 자리의 `detached` key만 보이게(`showOnly`) → `missing`은 `open({ transfer: null, bounds })`로 연다. `setFloatFocused(false)`.
    - `mergeVanished(liveKeys: readonly string[])`: `vanishedDesks` → 자리마다 `mergeDeskIntoDefault` → 저장 → `showOnly` 갱신. 이 task는 부르는 곳을 두지 않는다(ws-wire-selector가 목록을 읽은 뒤 부른다).
    - `TabHost.windowTabs(): readonly TabItem[]`(`kinds/host.ts`): 이 창 전체(모든 자리)의 탭. project 창은 `allDeskTabs`, detached 창은 자기 탭 하나다.
  - 동작(이 task가 맞추는 것)
    - `update(next)`는 `setActiveView`다. 저장은 `toStoredLayout({ project, desks })`다(`withPositions`는 `mapDeskTabs`로 모든 자리에).
    - 복원: `desksFromStored` 결과를 state로. 열 detached 창은 보이는 자리의 `detached`만이다(지금 반복문 그대로). 다른 자리의 detached 항목은 창 없이 layout에 남고, 그 자리로 갈 때 `showOnly`의 `missing`으로 연다.
    - 탭을 여는 모든 길(`host.openTab`, 시작 route의 session·파일·Project Manager 열기, 대기 목록의 terminal 고르기, 팔레트, 닫은 탭 다시 열기)이 `openAcrossDesks`를 쓴다. 돌려준 `desks.active`가 바뀌었으면 `showOnly`로 창을 맞추고, 그 탭이 detached면 지금처럼 창을 앞으로 가져온다. 닫은 탭 다시 열기는 `deskOfTab(desks, key) === undefined`일 때만 한다.
    - keep 해제: `allDeskTabs(desks)`에 없는 key만 해제한다. 떠난 자리의 `<webview>`는 지금 "shown" 판정(보이는 자리의 pane과 floats)대로 해제된다(다시 돌아오면 page를 다시 load한다).
    - detached event(`docked`·`changed`·`open-tab`·`closed`·`opened`·`moved`): `key`가 있는 event는 `deskOfTab`으로 찾은 자리의 view에 적용하고(보이는 자리가 아니어도), `open-tab`·`opened`·`moved`는 보이는 자리다. 숨은 자리의 `docked`(창이 갑자기 사라짐)도 그 자리의 view에서 `attachDetached`로 받는다.
    - project를 떠나면 지금처럼 `detached.close({ key: null })`(모든 자리의 창)을 닫는다.
    - palette 탭 행과 breadcrumb은 보이는 자리의 pane과 floats만 본다(지금 규칙이 detached를 빼는 것과 같다).

## 정한 것

1. **자리 state를 `workspace.tsx` 한 곳에 둔다.** 근거: `view`, `latest`, `persist`, detached event, keep 해제가 모두 이 file의 한 state를 읽는다. 새 module로 빼면 이 file이 만드는 ref와 callback을 여럿 넘겨야 한다(가장 단순한 구현).
2. **떠난 자리의 탭은 unmount하고 보이는 자리의 탭만 그린다.** 근거: README ("고르지 않은 docked 탭처럼 다룬다")와 `workspace-layout.md`의 규칙. app panel·artifact의 native view는 `ViewKeeps`가 탭이 layout에 있는 동안 숨겨 둔다. 이 판정이 `allDeskTabs`를 쓰므로 자리를 건너도 살아 있다. 일반 browser 탭의 `<webview>`는 놓는다(다시 돌아오면 page를 다시 load한다). README는 "keep kind를 숨긴 채 mount 유지"라고 적었지만 `<webview>`를 숨겨 두려면 panes·floats를 고쳐야 한다. 보고의 "알려진 미완 동작"에 적는다.
3. **자리를 만드는 일은 `switchTo`가 한다.** workflow 탭을 여는 길(sidebar)이 자기 자리로 가는 것은 ws-wire-selector가 맡는다.
4. **`latest`(보이는 자리의 view)를 그대로 두고 `latestDesks`를 더한다.** 근거: 이 file의 핸들러 수십 곳이 `latest.current`와 `update(view)`를 쓴다. 둘을 `commit(desks)` 한 곳에서 같이 갱신하면 그 핸들러를 바꾸지 않고 자리 층을 얹는다. 아는 함정: 비동기 핸들러는 `latest.current`를 읽으므로 자리가 바뀐 뒤에는 새 보이는 자리를 본다. 이는 의도다(그 사이 바뀐 배치에 적용한다는 지금 규칙).
5. **kind가 보는 `host.view`는 보이는 자리의 view로 두고, key를 만들거나 열린 탭을 찾는 곳만 `host.windowTabs()`로 모든 자리를 본다.** 근거: Agent 탭의 새 key는 `agent:<agent>:<n>`으로 보이는 자리에서 안 쓰는 가장 작은 번호인데(`kinds/agent.tsx`의 `freshKey`), 다른 자리에 같은 key가 있으면 `openAcrossDesks`가 새 탭 대신 그 자리로 건너가 버린다. 같은 session을 열었을 때 다른 자리의 탭을 재사용하는 일(`reusable`)도 같은 문제다. `host.view`를 합친 view로 바꾸면 browser 탭의 floated 층 번호(`kinds/browser.tsx`)가 틀어진다. 고치는 곳: `kinds/host.ts`(`windowTabs` 추가), `kinds/agent.tsx`(`agentTabs`와 `freshKey`가 `host.windowTabs()`를 쓰고 `distinctAgentTab(view, tab)`에 모든 탭을 받는 인자를 더한다), `detached/detached-space.tsx`(`TabHost`를 만드는 곳). 이 셋은 이 task가 소유한다(`workflow` 계획의 어떤 brief도 이 file들을 소유하지 않는다).
6. **`detach()`는 고치지 않는다.** 근거: transfer와 `open`을 기다리는 사이 자리가 바뀌면 `findTab(latest.current, key)`가 undefined라서 지금 코드가 만든 창을 닫고 멈춘다. 탭은 원래 자리에 그대로 남는다.
7. **terminal 대기 목록 고르기와 닫은 탭 다시 열기, 파일 이름 바꾸기·휴지통의 `tabsAt`도 자리를 건너 본다.** 근거: 탭 하나는 자리를 건너서도 한 곳에만 있으니 이 길들이 보이는 자리만 보면 같은 탭을 두 자리에 만들거나 못 찾는다.

## 할 일

지금: `Workspace`가 `view`(`useState<WorkspaceView>`), `latest` ref, `update`, `persist(view)`를 갖고, `viewFromStored`(ws-layout-map 뒤에는 `desksFromStored`의 보이는 자리)로 복원한다. 모든 탭 여는 길은 `openTab`/`update`로 `latest.current`를 바꾼다.

1. `kinds/host.ts`, `kinds/agent.tsx`, `detached/detached-space.tsx` (정한 것 5)
   - `TabHost`에 `windowTabs(): readonly TabItem[]`를 더한다(주석: 이 창 전체의 탭. 자리가 여럿인 창은 모든 자리).
   - `agent.tsx`: `agentTabs(host)`는 `host.windowTabs()`에서 agent 탭을 고른다. `freshKey(tabs, agent)`는 view가 아니라 탭 목록을 받는다(`openAgent`는 `host.windowTabs()`, `distinctAgentTab`은 인자로 받은 목록). `distinctAgentTab(view, tab, tabs)`로 세 번째 인자를 더하고 `existing`을 `tabs`에서 찾는다. `isDetached(view, tab.key)`는 그대로 보내는 창 자신의 탭 판정이다.
   - `detached-space.tsx`의 `host`에 `windowTabs: () => allTabs(view)`(그 창은 탭 하나)를 넣는다.
2. state를 바꾼다(`workspace.tsx`).
   - `const [desks, setDesks] = useState(() => desksFromView(emptyView()))`, `const view = activeView(desks)`. `freshView`를 지우고 `emptyView`를 쓴다.
   - `const latestDesks = useRef(desks)`를 더하고 `latest.current = activeView(...)`는 `commit`이 같이 맞춘다.
   - `commit(next: WorkspaceDesks, save = true)`: `latestDesks.current`와 `latest.current`를 바꾸고 `setDesks(next)`, `save`면 `persist(next)`. `next.active`가 이전과 다르면 `syncDetached(next)`.
   - `update(next: WorkspaceView)`는 `commit(setActiveView(latestDesks.current, next))`다. 다른 핸들러는 그대로 `update`를 쓴다.
   - `patchTab`은 `mapDeskTabs`로 모든 자리의 그 key 탭에 적용한다. `later`면 `commit(next, false)` 뒤 `persistLater()`다.
3. 저장과 복원
   - `persist(next: WorkspaceDesks)`는 `toStoredLayout({ project: projectId, desks: withPositions(next) })`. `withPositions`는 `mapDeskTabs`로 모든 자리에 적용한다. `persistLater`와 unmount flush(`persistRef.current(latest.current)`)는 `latestDesks.current`를 넘긴다.
   - `load` effect: `desksFromStored(layout.layout)`가 있으면 `desks`, `latestDesks`, `latest`를 같이 맞추고, detached 창은 `activeView(restored).detached`만 지금 반복문대로 연다.
4. keep 해제 effect: 의존을 `[desks, keeps, webviews]`로 하고 `live`를 `allDeskTabs(desks)`로, `shown`은 보이는 자리의 pane과 floats로 한다.
5. detached 창 맞추기 `syncDetached(next)`: `props.detached`가 없으면 아무것도 안 한다. `keys = activeView(next).detached.map(item => item.tab.key)`로 `showOnly({ keys })`를 부르고, 돌려받은 `missing` key마다 그 자리의 `detached` 항목으로 `open({ project, tab: slimDetachedTab(item.tab), transfer: null, bounds: item.bounds })`를 부른다(거절은 무시한다. 지금 복원과 같다). `switchTo`와 탭 열기, 합치기가 모두 이것을 부른다.
6. 자리 바꾸기
   - `switchTo(key, seed)`: `commit(switchDesk(latestDesks.current, key, seed))`, `setFloatFocused(false)`. 같은 자리면 `switchDesk`가 그대로라 아무 일도 없다.
   - `mergeVanished(liveKeys)`: `vanishedDesks(latestDesks.current, liveKeys)`가 비면 아무것도 안 한다. 아니면 `mergeDeskIntoDefault`를 자리마다 적용한 뒤 `commit`한다. 합치기 전 모든 자리의 detached key와 합친 뒤를 비교해, 합치고 나서 detached가 아니게 된 key(상한을 넘겨 docked로 옮긴 탭)는 `props.detached?.close({ key })`로 창을 닫는다(ws-model "정한 것" 2가 이 task에 넘긴 일이다).
7. 탭 여는 길
   - `openTab`: 먼저 `at = deskOfTab(desks, tab.key)`. `at`의 view에서 그 탭이 detached면 `at`이 보이는 자리가 아닐 때 `commit(switchDesk(current, at, emptyView()))`로 자리를 건너가고 `detached.focus({ key })`를 부른다(지금 갈래 그대로). `select: false`는 어느 자리에도 없을 때만 보이는 자리 끝에 붙인다. 나머지는 `commit(openAcrossDesks(latestDesks.current, tab, isUnsaved, options?.after))`다.
   - 시작 route(`openFile`, `openSessionTab`, `openProjectManager`)와 팔레트는 `host.openTab`을 지나므로 따로 고칠 것이 없다. 확인만 한다.
   - `terminal.store.onSelect` effect: `deskOfTab`이 보이는 자리가 아니면 먼저 `switchTo(that, emptyView())`(있는 자리라 seed는 쓰이지 않는다)로 건너가고 지금 본문(detached는 focus, floated는 restore, pane은 고르기)을 그대로 돈다.
   - `tab.reopen`: 다시 열기를 건너뛰는 판정(`open`)을 `deskOfTab(latestDesks.current, key) !== undefined`로 바꾼다.
   - `tabsAt`(파일 이름 바꾸기·휴지통)은 `allDeskTabs(latestDesks.current)`를 훑는다.
   - `removeTab(key)`: `at = deskOfTab(...)`. 없으면 끝. 지금 세 갈래(detached는 창 닫고 `closeDetached`, floated는 `closeFloat`, pane은 `closeTab`)를 `at` 자리의 view에 적용하고 `commit(setDeskView(current, at, next))`다. `leaveTopFloat`·`focusPaneBody`는 `at`이 보이는 자리일 때만 부른다.
8. detached event(`onDetachedEvent`): `key`가 있는 event(`docked`·`changed`·`closed`)는 `at = deskOfTab(latestDesks.current, event.key)`로 자리를 찾고 그 자리의 view에 지금 변환(`attachDetached`·`changed` 반영·`closeDetached`)을 적용해 `commit(setDeskView(...))`한다. `setFloatFocused(false)`와 `focusPaneBody`는 `at`이 보이는 자리일 때만. `open-tab`은 `openTab(distinctAgentTab(view, tab, allDeskTabs(latestDesks.current)))`, `opened`·`moved`는 보이는 자리다.
9. 지금 동작과 같은지 본다. 자리는 `DEFAULT_DESK` 하나뿐이므로(selector가 없다) `deno task dev:mock`에서 sidebar 열기, 탭 열기, Float·Dock·Minimize, Detach(gallery는 fake detached), 닫았다 다시 열기, 새로 고침 뒤 복원이 이 task 전과 같아야 한다. 자리 바꾸기는 화면이 없으므로 ws-wire-selector가 단 뒤 사람이 본다.

## 끝남

- `deno task check`가 통과한다. `deno run -A packages/shell/renderer/build.ts`도 선다(`check:full`은 renderer build를 보지 않는다).
- `deno task wireframes`가 되고 `new-float-*`·`new-detached-terminal`·`project-document` page가 지금처럼 그려진다.
- 위험 test: 없음. 순수 규칙은 ws-model의 위험 test가 본다. 이 task는 그 함수를 잇는 wiring이다.
- 남지 않음: `grep -rn "freshView" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음(`kinds/host.ts`·`kinds/agent.tsx`·`detached/detached-space.tsx`는 이 task의 소유다). `workspace.tsx`에서 `wf-screen-sidebar`가 고친 줄과 겹친 곳이 있으면 어디인지
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 아래를 적는다. 일반 browser 탭의 page는 자리를 건너면 다시 load한다. terminal이 다른 자리에 있을 때 bridge URL 열기 요청(`openBridgeUrl`)은 그 terminal을 못 찾아 처리하지 않는다(`host.view`가 보이는 자리라서).
