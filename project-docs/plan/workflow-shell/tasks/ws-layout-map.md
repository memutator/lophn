# ws-layout-map

renderer가 layout을 저장하고 복원하는 모양을 판 4(자리 층)로 바꾼다. `layout-map.ts`가 저장된 layout을 `WorkspaceDesks`로, `WorkspaceDesks`를 저장 입력으로 바꾸게 하고, `workspace.tsx`는 자리 하나(`DEFAULT_DESK`)만 쓰는 가장 작은 이음만 맞춘다. 화면 동작은 그대로이고, main의 새 schema(ws-schema)와 같이 있어야 layout 저장이 계속 된다.

- 단위: layout (wave 1)
- 선행: ws-model, ws-detached-show. `WorkspaceDesks` 타입을 쓰고, `tools/wireframes/mock/mock-desktop.tsx`는 ws-detached-show와 같이 고쳐서 순서를 둔다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/layout-map.ts`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/desktop/dev-seed.ts`
  - `tools/wireframes/mock/mock-desktop.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/workspace-layout.md`의 "흐름"(`storableView` → `toStoredLayout` → `layout:save`)과 "지키는 것"의 "`transient` 탭은 저장하지 않는다"
  - 계약: `project-docs/plan/workflow-shell/tasks/ws-schema.md`(판 4 모양과 저장 IPC 입력), `ws-model.md`(`WorkspaceDesks`와 함수들)
  - 코드: `packages/shell/renderer/workspace/layout-map.ts`(`viewFromStored`, `toStoredLayout`, `tabFromStored`·`toStoredTab`·`floatFromStored`·`detachedFromStored`), `workspace.tsx`의 복원(`load` effect의 `viewFromStored` 호출)과 저장(`persist`), `desktop/dev-seed.ts`의 `SEEDED.readLayout`, `tools/wireframes/mock/mock-desktop.tsx`의 `layoutOf`
- 계약:
  - 쓰는 것: ws-model의 `WorkspaceDesks`, `DEFAULT_DESK`, `desksFromView`, `activeView`, `storableDesks`. ws-schema의 판 4 모양(`active_desk`, `desks`)과 저장 IPC 입력 `{ project, active_desk, desks }`.
  - 내놓는 것(ws-wire-state가 import한다)
    - `desksFromStored(layout: unknown): WorkspaceDesks | null`: `viewFromStored`를 대신한다(그 이름은 지운다). 저장된 `desks`의 자리마다 지금 `viewFromStored`와 같은 규칙으로 `WorkspaceView`를 만든다(맞출 수 없는 탭만 빠진다). `desks[DEFAULT_DESK]`가 없으면 null. `active_desk`가 `desks`에 없으면 `DEFAULT_DESK`.
    - `toStoredLayout(input: { project: string; desks: WorkspaceDesks }): { project; active_desk; desks: Record<string, { panes; split_ratio; focused_pane; floats; detached }> }`: 인자에서 `view`와 `lastSpace`를 지우고 `desks`를 받는다. 자리마다 `storableView`(transient 탭 빼기, `storableDesks`)와 지금 상한(panes 2, floats 20, detached 20)을 적용한다.
  - `workspace.tsx`의 이음(이 task가 하는 것은 이것뿐이다. 이 file은 계획 `workflow`의 `wf-screen-sidebar`와 ws-wire-state가 뒤에 고치므로 줄을 최소로 둔다)
    - 복원: `desksFromStored(layout.layout)`를 받아 `activeView`만 `setView`에 넣는다. detached 창을 여는 지금 반복문은 그대로 둔다.
    - 저장: `persist`가 `toStoredLayout({ project, desks: desksFromView(withPositions(next)) })`를 부른다. 자리는 `DEFAULT_DESK` 하나뿐이다.
    - 이 이음은 ws-wire-state가 `desks` state로 바꾼다. 그 사이 자리 둘 이상인 파일은 만들어지지 않는다.
  - fixtures: `dev-seed.ts`의 `readLayout`과 `mock-desktop.tsx`의 `layoutOf`가 만드는 값을 판 4 모양(`active_desk`, `desks._default`)으로 고친다. gallery와 `dev:mock`이 계속 같은 layout을 그린다.

## 정한 것

1. **`last_space`는 지운다.** 근거: 값이 늘 `"project"`였고 읽는 곳이 없다. 판 4에서 `active_desk`가 그 자리를 대신한다.
2. **이음을 이 task에 둔다.** 근거: ws-schema가 land하면 옛 저장 모양은 main이 거절한다. main과 plan branch는 늘 동작해야 하므로(orchestrate 병렬 규칙 5) 저장 모양을 바꾸는 쪽(main, renderer)이 같은 wave에서 합쳐진다.
3. **test를 쓰지 않는다.** 근거: `layout-map.ts`가 `kinds/registry.ts`를 import하고 그것이 `.tsx` kind와 `.module.css`를 끌어와 `deno test`가 css import에서 막힌다(`layout-map.ts`를 import하는 빈 test로 확인했다). 변환이 틀려 저장이 거절되면 main이 `invalid_input`으로 막고 파일은 그대로다(ws-schema의 검증).
4. **자리가 여럿인 파일도 복원은 모든 자리를 읽는다.** 근거: `desksFromStored`가 자리 하나만 읽으면 ws-wire-state가 필요한 값을 다시 만들어야 한다. 이 task의 이음만 `activeView`로 그 하나를 쓴다.

## 할 일

지금: `viewFromStored(layout)`은 최상위 `panes`·`split_ratio`·`focused_pane`·`floats`·`detached`를 `WorkspaceView`로, `toStoredLayout({ project, view, lastSpace })`는 그 반대로 바꾼다. 탭 하나와 float·detached 항목을 바꾸는 안쪽 함수(`tabFromStored`, `toStoredTab`, `floatFromStored`, `detachedFromStored`)는 자리와 상관없다.

1. `layout-map.ts`
   - 지금 `viewFromStored` 본문을 안쪽 `viewOfDesk(value: unknown): WorkspaceView | null`로 옮긴다(규칙은 그대로).
   - `desksFromStored(layout)`를 export한다: `layout.desks`가 객체가 아니면 null, 자리마다 `viewOfDesk`를 돌려(null인 자리는 빠진다) `DEFAULT_DESK`가 없으면 null, `active`는 `active_desk`가 결과에 있으면 그것, 아니면 `DEFAULT_DESK`.
   - `toStoredLayout`을 `{ project, desks }`를 받게 고친다: `storableDesks(desks)`를 거친 뒤 자리마다 지금 본문(panes 2개, 비율 가둠, focused 가둠, floats·detached 20개)을 안쪽 `storedDesk(view)`로 만들어 `{ project, active_desk: desks.active, desks }`를 돌려준다. `last_space`를 쓰지 않는다.
   - `viewFromStored`를 지운다. 머리 주석의 설명은 판 4에 맞게 고친다.
2. `workspace.tsx`: import를 `desksFromStored`, `toStoredLayout`으로 바꾸고, `load` effect와 `persist` 두 곳만 계약의 이음대로 고친다. `freshView`와 나머지는 건드리지 않는다.
3. `dev-seed.ts`의 `readLayout`: 지금 값(`panes`, `split_ratio`, `focused_pane`, 쓰지 않는 `information_panel`)을 `{ active_desk: DEFAULT_DESK, desks: { [DEFAULT_DESK]: { panes, split_ratio, focused_pane, floats: [], detached: [] } } }`로 고친다. `information_panel`은 지운다(읽는 곳이 없다).
4. `mock-desktop.tsx`의 `layoutOf`도 같은 모양으로 고친다(`floats`는 지금 값 그대로 `desks._default`에 넣는다). 이 file은 ws-detached-show도 고친다. 그 변경 위에서 한다.
5. `deno task dev:mock`(renderer를 먼저 build)에서 sidebar 열기, 탭 열기, floated, 닫았다 다시 열기를 해 저장·복원이 지금과 같은지 본다.

## 끝남

- `deno task check`가 통과한다. `deno run -A packages/shell/renderer/build.ts`도 선다(`check:full`은 renderer build를 보지 않는다).
- 위험 test: 없음. 이유는 위 "정한 것" 3(test가 css import에서 막힌다).
- 남지 않음: `grep -rnE "viewFromStored|lastSpace|last_space|information_panel" packages tools`가 0줄이다.
- gallery: `deno task wireframes`가 되고 `project-document`·`project-terminal`·`new-float-terminal`·`new-float-minimized` page가 지금처럼 탭과 floated 패널로 그려진다(`layoutOf`가 판 4를 만든다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `viewFromStored`는 이 task가 지운다(쓰는 곳은 `workspace.tsx`뿐이다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `workspace.tsx`에서 고친 줄(복원 한 곳, 저장 한 곳)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
