# wf-floated-wire

`workspace.tsx`가 탭을 찾고 바꾸고 닫는 곳이 pane만 보지 않고 floats도 보게 맞춘다. 화면에 floats 층을 그리는 일은 `wf-floated-layer`가 한다. 이 task가 끝나면 floated 탭도 `host.openTab`, `host.patchTab`, `host.removeTab`, 닫은 탭 다시 열기, 읽던 위치 저장, 대기 목록 카드의 terminal 고르기에서 pane 탭처럼 다뤄진다.

- 단위: wf-floated (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "정한 것"(탭 하나는 한 곳에만)
  - 앞 task: `project-docs/plan/workspace-float/tasks/wf-layout-model.md`의 "계약"(`findTab`, `isFloated`, `allTabs`, `mapTabs`, `closeFloat`, `restoreFloat`, `openTabIn`의 floats 처리)
  - 지금 코드: `workspace.tsx`의 `withPositions`(305), `removeTab`(381), `openTab`(392), `patchTab`(418), 대기 목록 `terminal.store.onSelect` effect(`useEffect` 안, `latest.current.panes.findIndex`), `rememberClosed`·`close`·`closeMany`, `tabsAt`
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wf-layout-model`이 내놓은 `model.ts`의 함수들.
  - 내놓는 것: `Workspace` 안의 `close(null, key)`. floated 탭을 닫기 확인(`beforeClose`)을 거쳐 닫는다. `wf-floated-layer`가 패널의 [Close]에 붙인다. 다른 export는 없다.

## 할 일

1. `workspace.tsx`에서 pane만 보던 곳을 고친다. 근거: roadmap "정한 것"(탭 하나는 한 곳에만, 어디에 있든 같은 탭).
   - `withPositions`: `mapTabs(next, ...)`로 panes와 floats 모두에 읽던 위치를 싣는다.
   - `removeTab(key)`: `isFloated(current, key)`면 `closeFloat`, 아니면 지금처럼 `closeTab`.
   - `openTab`: `select: false` 분기의 "이미 있으면 그만" 검사를 `findTab`으로 한다(floated여도 그만). `select`가 true면 이미 `openTabIn`이 floats를 안다.
   - `patchTab`: `mapTabs`로 바꾼다(`later` 옵션 처리는 그대로).
   - `terminal.store.onSelect`: 그 탭이 floats에 있으면 `restoreFloat`로 올려서 `update`한다(접혀 있으면 펴진다). 없으면 지금 코드.
   - `tabsAt(path)`: `allTabs(latest.current)`에서 거른다(파일 이름 바꾸기·휴지통이 floated 탭도 닫고 다시 열도록).
   - `rememberClosed(key)`: floats에 있는 탭이면 `{ tab, pane: item.originPane, index: Number.MAX_SAFE_INTEGER }`로 기억한다(`reopenTab`이 끝에 붙인다. 닫은 탭은 docked로 돌아온다).
2. `close(pane, key)`가 `pane: number | null`을 받는다. null이면 floated 탭이다. 닫기 확인(`beforeClose`)과 `rememberClosed`는 지금과 같은 순서이고, 확인이 필요 없을 때도 `update(closeTab(view, pane, key))` 대신 `removeTab(key)`로 닫는다. `Panes`가 부르는 pane 번호 호출은 그대로다.
3. 이 task에서 화면은 바뀌지 않는다. floats가 늘 비어 있어 동작이 그대로여야 한다.

## 정한 것

- 팔레트(`desktop/palette/workspace-scope.ts`)의 탭 행은 floats를 싣지 않는다(agent). roadmap에 없고, floated 탭은 화면에 보이거나 상단 bar의 span으로 닿는다.
- 파일 이름 바꾸기로 다시 열린 탭은 docked로 열린다(agent). floated였던 위치는 이어 가지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 이 task의 동작은 `wf-layout-model`의 순수 함수 test가 보는 것을 부르는 배선이다.
- 남지 않음: `grep -n "panes.flatMap\|panes.findIndex" packages/shell/renderer/workspace/workspace.tsx`에 남은 줄이 pane 전용으로 맞는 곳뿐이다(남은 줄마다 보고에 한 줄로 이유를 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
