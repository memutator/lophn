# ws-model

layout model에 자리(desk) 층을 더한다. 지금 `WorkspaceView` 하나가 project 창의 layout 전체인데, 이것을 자리 key마다 하나씩 담는 `WorkspaceDesks` 안에 그대로 넣고, 자리를 바꾸고, 자리를 건너 열고, 사라진 workflow의 자리를 기본 자리로 합치는 순수 함수를 `model.ts`에 더한다. 위험 test(`model_test.ts`)를 자리 층까지 넓힌다.

- 단위: model (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/model_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것"(자리를 바꾸면 그 자리의 `WorkspaceView`로 통째로 바뀐다, 탭 하나는 자리를 건너서도 한 곳에만 있다, 사라진 workflow의 자리는 기본 자리로 합친다)
  - architecture: `project-docs/architecture/workspace-layout.md`의 "지키는 것" 중 "탭 하나는 한 곳에만 있다", "탭을 찾고 바꾸는 곳은 pane, floats, detached를 모두 본다", "minimized는 floated에서만 간다", "`transient` 탭은 저장하지 않는다"
  - 코드: `packages/shell/renderer/workspace/model.ts`(`WorkspaceView`, `openTabIn`, `closeTab`, `closeFloat`, `closeDetached`, `isFloated`, `isDetached`, `allTabs`, `mapTabs`, `storableView`, 안쪽 `holderOf`·`dropEmptyPane`)와 본보기 `model_test.ts`(float·dock·detach를 이어 하며 탭 key 집합을 단계마다 보는 test)
  - skill: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 같은 file의 `WorkspaceView`, `TabItem`, `FloatItem`, `DetachedItem`, `PaneState`, `normalizePane`, `openTabIn`, `storableView`, `mapTabs`, `allTabs`, `findTab`, `isDetached`, `isFloated`, `closeTab`, `closeFloat`, `closeDetached`, 안쪽 함수 `holderOf`·`dropEmptyPane`. 옛 함수의 시그니처는 바꾸지 않는다(전부 `WorkspaceView` 하나를 받고 돌려준다. 자리 층은 그 위에 얹는다).
  - 내놓는 것(다른 task가 import한다. 이름과 모양을 바꾸지 않는다):
    - 낱말: 코드에서는 README의 "자리(space)"를 `desk`라 부른다. `space`는 이미 공간(ProjectSpace, AppSpace, SettingsSpace)이고 옛 schema의 `last_space`도 그 뜻이라 겹친다.
    - 모양
      ```ts
      /** slug(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)가 될 수 없는 값이다(`_`로 시작). workflow 이름과 겹치지 않는다. */
      export const DEFAULT_DESK = "_default";

      export interface WorkspaceDesks {
        /** 지금 보이는 자리의 key. `desks`에 늘 있다. */
        readonly active: string;
        /** 자리 key → 그 자리의 WorkspaceView. `DEFAULT_DESK`는 늘 있고 합쳐서 지워지지 않는다.
         *  나머지 key는 그 project 안의 workflow 이름(slug)이다. project 이름을 넣지 않는다. */
        readonly desks: Readonly<Record<string, WorkspaceView>>;
      }
      ```
    - 기본값과 읽기·쓰기
      - `emptyView(): WorkspaceView`: 빈 칸 하나. 지금 `workspace.tsx`의 `freshView()`와 같다(그쪽은 wiring task가 이것으로 바꾼다).
      - `desksFromView(view: WorkspaceView): WorkspaceDesks`: `{ active: DEFAULT_DESK, desks: { [DEFAULT_DESK]: view } }`
      - `activeView(desks): WorkspaceView`
      - `setDeskView(desks, key, view): WorkspaceDesks`: `key` 자리의 view만 바꾼다. 없는 자리면 그대로. 같은 view면 같은 참조를 돌려준다. (이 계획의 처음 계약에 없던 것을 더했다. 숨은 자리의 detached event를 그 자리에 적용하는 데 ws-wire-state가 쓴다.)
      - `setActiveView(desks, view): WorkspaceDesks`: 지금 `update(next)`가 하는 일. 보이는 자리의 view만 바꾼다. `setDeskView(desks, desks.active, view)`다.
    - 탭 찾기
      - `deskOfTab(desks, key): string | undefined`: 그 key의 탭이 있는 자리(pane, floats, detached 어디든)
      - `allDeskTabs(desks): TabItem[]`: 자리를 건너 모든 탭. keep 해제 판정이 쓴다.
      - `mapDeskTabs(desks, change): WorkspaceDesks`: `mapTabs`를 모든 자리에 적용. 바뀐 것이 없으면 그대로.
      - `storableDesks(desks): WorkspaceDesks`: 자리마다 `storableView`.
    - 자리 바꾸기
      - `switchDesk(desks, key, seed: WorkspaceView): WorkspaceDesks`: `key`가 있는 자리면 `active`만 바꾼다(그 자리의 view는 그대로). 없는 자리면 `seed`로 새 자리를 만들고 바꾼다. 이때 `seed`의 탭 가운데 다른 자리에 이미 있는 key는 뺀다(두 자리에 있지 않게). `key === active`면 그대로.
    - 자리를 건너 열기
      - `openAcrossDesks(desks, tab, isUnsaved, after?): WorkspaceDesks`: `openTabIn`의 자리 층 판. `deskOfTab(tab.key)`가 다른 자리면 그 자리로 `active`를 바꾸고 그 자리의 view에 `openTabIn`을 적용한다(floated면 펴서 맨 위로, docked면 고르기, detached면 view 그대로 — 창을 앞으로 가져오는 일은 호출하는 쪽이 지금처럼 `isDetached(activeView(next), tab.key)`로 안다). 어느 자리에도 없으면 보이는 자리에 `openTabIn`. 돌려준 `desks.active`가 바뀌었는지는 호출하는 쪽이 앞뒤를 비교해 안다.
    - 사라진 workflow 합치기
      - `vanishedDesks(desks, liveKeys: readonly string[]): string[]`: `DEFAULT_DESK`가 아니고 `liveKeys`(workflow 이름들)에 없는 자리 key
      - `mergeDeskIntoDefault(desks, key): WorkspaceDesks`: `key` 자리의 탭을 `DEFAULT_DESK`로 옮기고 그 자리를 지운다. `key`가 `DEFAULT_DESK`이거나 없으면 그대로. `active === key`였으면 `active`는 `DEFAULT_DESK`가 된다. 옮기는 규칙은 아래 "정한 것".
  - 이 task가 하지 않는 것: 저장 모양 변환(`layout-map.ts`, ws-layout-map), schema(ws-schema), React state(ws-wire-state).

## 정한 것

1. **합칠 때 탭은 말없이 사라지지 않고 두 번 생기지 않는다.** `DEFAULT_DESK`의 view에 이렇게 옮긴다: docked 탭은 `DEFAULT_DESK`의 focus pane 끝(pane 0의 탭, pane 1의 탭 순서), floated 탭은 `DEFAULT_DESK.floats` 끝(맨 위)에 `rect`와 `minimized`를 지킨 채(`originPane`은 그 view의 칸 수 안으로 당긴다), detached 탭은 `DEFAULT_DESK.detached` 끝에 `bounds`를 지킨 채. 옮기는 탭의 `preview`는 지운다. `DEFAULT_DESK`에 이미 같은 key가 있으면(있어서는 안 되지만) 옮기지 않는다.
2. **schema의 상한(floats 20, detached 20)을 넘는 탭은 docked로 옮긴다.** 근거: schema가 거절하면 저장이 통째로 실패해 layout을 잃는다(`workspace-layout.md` "rect" 항목의 0×0 rect와 같은 위험). detached에서 docked로 바뀐 탭의 창을 닫는 일은 wiring task가 `detached` 목록 차이로 한다(이 task는 순수 함수라 모른다). 칸 하나 200탭 상한은 따로 막지 않는다(사람이 한 칸에 200탭을 둘 일이 없다. floats 20과 같은 이유다).
3. **`switchDesk`가 만드는 새 자리에서 다른 자리에 있는 탭을 뺀다.** 근거: "탭 하나는 한 곳에만 있다"를 자리 건너서도 지킨다(README). 탭을 빼앗아 오지 않는 까닭은 detached 창과 살아 있는 terminal이 딸려 있어서다. workflow 탭을 sidebar에서 열면 그 workflow 자리로 가야 하므로 wiring task는 `openAcrossDesks`가 아니라 `switchDesk`로 그 자리를 만든다.
4. **`openAcrossDesks`는 closed 탭 다시 열기(`reopenTab`)를 대신하지 않는다.** 다시 열기는 호출하는 쪽이 `deskOfTab(desks, key) === undefined`일 때만 부른다. `moveTab`, `shiftTab`, `closeTab` 등 옛 함수는 보이는 자리의 view만 받으므로 다른 자리 탭을 건드리지 못해 자리 층에서 따로 막을 것이 없다.
5. **default 자리 key는 `_default`다.** 근거: workflow 자리 key는 workflow 이름 자체다(README 정한 것). `default`는 slug라 `default`라는 workflow와 겹칠 수 있다. `_`로 시작하는 값은 slug가 아니다(정규식은 `wf-contract`의 `workflowNameSchema`). main의 schema(ws-schema)가 같은 값을 따로 적는다(renderer와 main이 코드를 나누지 않는다. `windowBounds`가 두 곳에 있는 것과 같다).

## 할 일

지금 `model.ts`는 `WorkspaceView` 하나를 받고 돌려주는 함수들이다. 자리 층은 그 아래 함수를 부르기만 하고 옛 함수는 고치지 않는다(근거: `workspace-layout.md`, 계약의 "옛 함수의 시그니처는 바꾸지 않는다").

1. `model.ts`의 `storableView` 아래에 자리 층 구역을 더한다. 주석 한 줄로 구역을 가른다.
   - `DEFAULT_DESK`, `WorkspaceDesks`는 계약 그대로다. 이 구역의 상수 `DESK_FLOATS_MAX = 20`, `DESK_DETACHED_MAX = 20`을 두고 "`main/workspace/schema.ts`의 상한과 같다"는 이유 한 줄을 단다.
2. 읽기·쓰기를 만든다.
   - `emptyView()`: `{ panes: [{ tabs: [], selected: null }], splitRatio: 0.5, focusedPane: 0, floats: [], detached: [] }`
   - `desksFromView`, `activeView`, `setDeskView`, `setActiveView`: 바뀐 것이 없으면(`setDeskView`에 같은 view) 같은 참조를 돌려준다. React state가 불필요하게 바뀌지 않게 하는 지금 `changeFloat`와 같은 규칙이다.
3. 찾기를 만든다.
   - `deskOfTab`: 보이는 자리를 먼저 보고 나머지는 `Object.entries` 순서로 `findTab`을 부른다.
   - `allDeskTabs`: 자리마다 `allTabs`를 이어 붙인다.
   - `mapDeskTabs`: 자리마다 `mapTabs`를 부르고, 모든 자리가 같은 참조면 `desks` 그대로 돌려준다.
   - `storableDesks`: 자리마다 `storableView`. 바뀐 자리가 없으면 그대로.
4. `switchDesk`를 만든다.
   - 안쪽 `withoutKeys(view, drop: ReadonlySet<string>)`를 둔다: view의 탭 가운데 key가 `drop`에 있는 것을 `allTabs`로 찾아 `isDetached`면 `closeDetached`, `isFloated`면 `closeFloat`, 아니면 `closeTab(view, holderOf(...), key)`로 뺀다. 새로 만들지 않고 있는 함수를 쓰는 까닭은 빈 칸 정리(`dropEmptyPane`)와 선택 옮기기가 이미 거기 있어서다.
   - 새 자리의 `drop`은 `seed` 밖의 자리에 있는 key 전부(`allDeskTabs(desks)`)다.
5. `openAcrossDesks`를 만든다: `deskOfTab`이 자리 `at`를 주면 `{ ...desks, active: at }`로 바꾼 뒤, 아니면 그대로 `setActiveView(next, openTabIn(activeView(next), tab, isUnsaved, after))`.
6. `vanishedDesks`와 `mergeDeskIntoDefault`를 만든다. 합치기는 순서가 중요하다.
   1. `gone = desks.desks[key]`, `base = desks.desks[DEFAULT_DESK]`. `key`가 `DEFAULT_DESK`이거나 `gone`이 없으면 `desks` 그대로.
   2. `gone`의 탭을 docked(pane 0, pane 1 순서), floated(배열 순서), detached(배열 순서) 차례로 훑는다. `base`에 같은 key가 있으면 건너뛴다(정한 것 1).
   3. docked 탭은 `base`의 focus pane 끝에 `{ ...tab, preview: false }`로 붙인다. 그 칸의 선택은 그대로 둔다(고르던 탭을 빼앗지 않는다). 선택이 없으면 `normalizePane`이 첫 탭을 고른다.
   4. floated 탭은 `base.floats.length < DESK_FLOATS_MAX`면 끝에 붙인다(`rect`, `minimized` 유지, `originPane`은 `base.panes.length - 1` 이하로). 넘으면 docked로 붙인다(정한 것 2).
   5. detached 탭은 `base.detached.length < DESK_DETACHED_MAX`면 끝에 `bounds`를 지킨 채 붙인다. 넘으면 docked로 붙인다.
   6. `key` 자리를 지우고, `active === key`면 `active`를 `DEFAULT_DESK`로 한다.
7. `model_test.ts`에 위험 test를 더한다(아래 "끝남").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "float, dock, detach 등을 한 자리에서 하다가 자리를 바꾸고, 다른 자리에 있는 탭을 열고, 자리를 합쳐도 모든 자리를 합친 탭 key가 사라지거나 두 번 나오지 않고 옮긴 탭이 맞는 자리에 있다."
  - 기존 chain test와 같은 모양으로 `Deno.test` 한 개를 `model_test.ts`에 더한다. 단계 표(이름, 함수, 닫는 key, 여는 key, 단계 뒤 key의 자리)를 돌고, 단계마다 `allDeskTabs(desks)`의 key 집합이 `known`과 같고 중복이 없고 pane의 선택이 칸에 있는지 본다.
  - 시작: `DEFAULT_DESK`(pane 둘, floated 하나, detached 하나), `alpha`(pane 하나, floated 하나가 minimized), `beta`(detached 하나뿐)를 직접 만든다.
  - 단계(최소): 보이는 자리에서 float·detach 한 번, `switchDesk`로 있는 자리, `switchDesk`로 없는 자리(seed에 다른 자리에 있는 key를 넣어 빠지는지), `openAcrossDesks`로 다른 자리의 docked·floated(minimized)·detached 탭 열기와 어느 자리에도 없는 새 탭 열기, 자리를 건너 하나라도 `deskOfTab`이 맞는 자리를 주는지, `mergeDeskIntoDefault`를 보이는 자리·안 보이는 자리에, `DEFAULT_DESK`나 없는 key에 부르기(그대로), 상한을 넘기는 합치기(`DEFAULT_DESK.floats`를 19개로 채워 두고 floated 둘이 든 자리를 합쳐 하나는 floats로, 하나는 docked로 가는 것).
  - 합치기 단계는 `active`가 `DEFAULT_DESK`가 되는지, 옮긴 floated의 `rect`·`minimized`가 그대로인지, 옮긴 docked 탭의 `preview`가 없는지를 같이 본다.
- 남지 않음: 없음. 옛 함수를 지우지 않고 `workspace.tsx`도 고치지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상. `workspace.tsx`의 `freshView`는 ws-wire-state가 `emptyView`로 바꾼다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(예: 합치기에서 고르던 탭을 유지하는 방법)
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다. 이 brief가 더한 `setDeskView`가 옛 계약에 없던 것임을 lead가 안다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
