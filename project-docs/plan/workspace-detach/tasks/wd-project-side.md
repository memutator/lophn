# wd-project-side

project 창(Workspace)이 탭을 detach하고 돌려받는다. 탭 menu의 Detach와 floated 패널 bar의 [Detach] 단추가 `detach(key)`를 부른다: kind의 `transfer`를 받아 main에 창을 열게 하고, 성공하면 layout을 `detachTab`으로 바꿔 저장한다. main이 보내는 event(`docked`, `changed`, `open-tab`, `closed`)를 layout에 반영한다. 이미 detached인 탭을 여는 길은 그 창을 앞으로 가져온다.

- 단위: wd-project-side (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/panes/panes.tsx`
  - `packages/shell/renderer/workspace/floats/floats.tsx`
  - `packages/shell/renderer/icons/workspace.ts`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 4(누가 layout을 갖나, 창을 닫을 때, 탭 옮기기), 5(wording), "정한 것"(탭 하나는 한 곳에만, project 창 renderer가 layout 전체를 갖는다)
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/workspace-layout.md`("지키는 것", 특히 focus와 ViewKeeps)
  - wording 규칙: `.claude/skills/wording/SKILL.md`
  - architecture: `project-docs/architecture/browser-tab.md`(`<webview>`는 창마다 하나인 그릇에 탭 key당 한 번 만들고, 탭이 layout에서 사라질 때만 지운다)
  - 지금 코드(main `5361104e8`을 열어 확인한 것이다):
    - `renderer/workspace/workspace.tsx`: `latest`·`update`·`persist`(저장), `openTab`(`openTabIn(…, options?.after)`)과 `openFloatTab`, `removeTab`(floated면 `closeFloat`), `withPositions`, `keeps`(`createViewKeeps`)와 `webviews`(`createWebviewHost`)를 같이 비우는 "layout에서 사라진 탭의 view를 닫는다" effect(`allTabs(view)`), `floatFocused`·`leaveTopFloat`·`focusPaneBody`, `terminal.store.onSelect` effect, `host: TabHost`(`viewKeeps: keeps`, `openFloat: openFloatTab` 포함), `Panes`·`Floats`에 넘기는 `onFloat`·`onDock`, 레이아웃을 읽는 `load` effect.
    - `renderer/workspace/panes/panes.tsx`: 탭 menu 항목 배열(`id: "float"`)과 `chooseMenu`. `onFloat` prop 흐름.
    - `renderer/workspace/floats/floats.tsx`: `FloatEntry`의 `actions`(minimize, dock, close). 패널 z-index는 층 번호 × 2이고 `Floats`가 `webviews` prop으로 `<WebviewLayer>`를 첫 자식에 둔다.
    - `renderer/icons/workspace.ts`: `workspaceIcons`.
  - 앞 task가 내놓은 것: `wd-layout`(`detachTab`, `openDetachedTab`, `attachDetached`, `closeDetached`, `isDetached`, `DetachedItem`), `wd-contract`(`LophnDetachedApi`, `DetachedEvent`, `TabKindDef.transfer`/`receive`/`noDetach`, `slimDetachedTab`, `WorkspaceProps.detached`)
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: 위 "앞 task가 내놓은 것". 창을 여는 `window.lophnDetached`는 `props.detached`로 받는다(entry가 `wd-window-ui`에서 넘긴다).
  - 내놓는 것: `Workspace`가 detached 탭을 다루는 동작 전부. 다른 task가 기대는 새 export는 없다. `Panes`와 `Floats`는 `onDetach?`와 `canDetach?: (tab: TabItem) => boolean`를 받는다: `onDetach`가 없거나 `canDetach`가 false이면 항목·단추를 그리지 않는다.

## 할 일

1. 아이콘·wording: `icons/workspace.ts`에 `detach`(lucide 아이콘 하나, 이미 쓰는 것과 다른 것. 예 `ExternalLink`). `catalog/project.ts`에 `project-workspace.button.tab-detach`("Detach"), `project-workspace.button.float-detach`("Detach")를 더하고 `deno task wording`으로 placeholders를 다시 만든다(손으로 고치지 않는다).
2. `panes.tsx`: `onDetach?: (pane: number, key: string) => void`, `canDetach?: (tab: TabItem) => boolean`. `onDetach`가 있고 `canDetach`가 true(없으면 true)이면 탭 menu에서 Float 항목 바로 뒤에 `id: "detach"` 항목(`tab-detach`, `workspaceIcons.detach`)을 더하고 `chooseMenu`가 `onDetach`를 부른다.
3. `floats.tsx`: `onDetach?: (key: string) => void`, `canDetach?: (tab: TabItem) => boolean`. 있으면(`canDetach` 조건은 위와 같다) 접히지 않은 패널의 `actions`에서 Dock 뒤·Close 앞에 `data-float-action="detach"` 단추(`float-detach`)를 더한다.
4. `workspace.tsx`:
   - `detach(key)`: `findTab(latest.current, key)`가 있고 detached가 아니며 kind에 `noDetach`가 없을 때만 한다. kind의 `transfer`를 부르고(`tabKindOf(tab.kind)?.transfer?.(tab, host) ?? { value: null, views: [] }`) null이면 아무것도 하지 않는다. `transfer`가 탭 값을 바꿨을 수 있으니(browser가 `devtools` 칸을 비운다) 그 뒤에 `findTab(latest.current, key)`를 다시 읽고, `withPositions`로 읽던 위치를 합친 것을 `slimDetachedTab`으로 줄여 쓴다. `props.detached.open({ project: projectId, tab, transfer, bounds: null })`가 거절되면(`conflict`, `invalid_input`, `unavailable`) 아무것도 바꾸지 않는다. 성공하면 그 사이 탭이 닫혔는지 본다(없으면 `props.detached.close({ key })`로 만든 창을 닫는다). 있으면 floated 맨 위였으면 `leaveTopFloat`, 칸이면 `focusPaneBody`로 focus를 칸에 두고 `update(detachTab(latest.current, key, reply.bounds))`.
   - `Panes`에 `onDetach`, `Floats`에 `onDetach`를 넘긴다(`props.detached`가 있을 때만). 둘에 `canDetach={(tab) => tabKindOf(tab.kind)?.noDetach !== true}`를 넘긴다. minimized 패널에는 단추가 없다.
   - `<webview>` 그릇: 지금 effect는 `allTabs(view)`에 없는 key의 `keeps`·`webviews`를 지운다. detached 탭은 `allTabs`에 있어 project 창의 `<webview>`가 남아 page가 두 창에 산다. `webviews`는 panes와 floats의 탭 key(`detached`는 뺀 것)에 없는 key를 지우도록 바꾼다(`keeps`는 그대로 `allTabs`). 그러면 browser 탭을 Detach할 때 project 창의 `<webview>`가 지워지고, Dock하면 `BrowserTab`이 mount되며 같은 url로 새로 만든다.
   - event 구독: `useEffect(() => props.detached?.subscribe(handler), [props.detached])`. `handler`는 `latest.current`를 읽는다.
     - `docked`: `isDetached`가 아니면 무시한다. 탭 종류의 `receive`가 있고 `transfer`가 있으면 `receive(tab, transfer, host)`를 먼저 부른 뒤 `update(attachDetached(latest.current, key, event.tab as TabItem))`, `setFloatFocused(false)`, `focusPaneBody`.
     - `changed`: detached 항목의 tab을 event 값으로 바꾸고 저장한다(`update`와 같은 길. detached 항목만 바꾸는 작은 helper를 이 file 안에 둔다).
     - `open-tab`: `openTab(event.tab as TabItem)`.
     - `closed`: `update(closeDetached(latest.current, key))`.
     - `opened`: `update(openDetachedTab(latest.current, event.tab as TabItem, event.bounds))`(detached 창 안의 popup. `transient`라 저장되지 않는다).
     - `moved`, `dock-request`: 무시한다(`moved`는 `wd-restore`가 쓴다).
   - detached 탭을 여는 길: `openTab`(여는 모든 길이 지난다)에서 `isDetached(current, tab.key)`면 `props.detached?.focus({ key })`만 하고 돌아온다. `terminal.store.onSelect` effect(대기 목록 카드의 [Answer in terminal])에도 같은 갈래를 더한다(`isDetached`면 그 창을 앞으로 가져온다).
   - `removeTab(key)`: detached 탭이면 `props.detached?.close({ key })` 뒤 `update(closeDetached(current, key))`(파일 이름 바꾸기·휴지통으로 열린 파일 탭을 닫을 때 지난다). `rememberClosed`는 detached 탭에 하지 않는다.
   - 떠나기: `projectId`가 바뀌거나 Workspace가 unmount되면 `props.detached?.close({ key: null })`(이 project 창의 detached 창을 모두 silent로 닫는다. 상태는 `detached`로 저장돼 있어 다시 열 때 되살아난다). 되살리기는 `wd-restore`가 한다.
5. 확인은 손으로 하지 않는다(창 여럿을 띄우는 Electron test는 만들지 않는다). 흐름은 type과 읽기로 검토한다.

## 정한 것

- 순서는 transfer → main이 창을 만들고 view를 옮김 → 성공했을 때만 layout을 바꾼다(agent). 어느 단계에서 실패해도 layout은 그대로라 탭이 사라지지 않는다. 옮긴 앱 view의 옛 창 쪽 요청은 main이 거절하므로 해가 없다.
- Detach 대상은 docked와 floated(접히지 않은 것)다(agent). minimized 패널은 먼저 펴야 한다. 이 task는 palette 명령이나 단축키를 더하지 않는다(roadmap에 없다).
- dock하면 focus pane 끝에 붙는다(agent). 떼기 전 자리(pane 번호)는 저장하지 않는다. 떼기 전이 floated였어도 docked로 돌아온다.
- detached 탭은 palette의 탭 행·breadcrumb에 나오지 않는다(agent). pane과 floats의 것만 보인다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 탭이 사라지거나 둘이 되지 않는 규칙은 `wd-layout`의 model test가 본다. 이 task의 흐름은 그 함수를 부를 뿐이다.
- 남지 않음: 없음(더하는 것뿐이다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 손으로 확인하지 못한 것을 적는다. lead가 손으로 본다.
