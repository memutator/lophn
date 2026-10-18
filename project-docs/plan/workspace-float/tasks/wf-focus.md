# wf-focus

focus 표시가 한 곳에만 있게 한다. 지금은 floated 패널을 맨 위로 올려도 docked 칸의 고른 탭이 focus 색 강조선을 그대로 갖고, 맨 위 패널도 focus 색 강조선을 가져 둘이 동시에 focus로 보인다. 칸 본문을 눌러도 맨 위 패널의 강조가 남는다. 사람이 손으로 찾았다.

- 단위: wf-focus (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/panes/panes.tsx`
  - `packages/shell/renderer/workspace/floats/floats.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`("지키는 것"의 패널 DOM 순서와 `active`)
  - 지금 코드: `panes.tsx`의 `Panes`(`focused={view.focusedPane === index}`, `onFocus`를 `focusedPane`이 다를 때만 부른다), `PaneView`(`onPointerDown`·`onFocusCapture`가 `onFocus`, `renderTab(selected, focused)`, `TabStrip`의 `focused`), `floats.tsx`의 `Floats`(`active`는 맨 위의 접히지 않은 패널, `onRaise`는 `active`가 아닐 때만), `workspace.tsx`의 `<Panes onFocus=…>`, `<Floats …>`, `<MinimizedBar …>`, palette `go`의 `float`·`dock`·`minimize`, `onFloat`
  - kind가 `active`를 쓰는 곳: `renderer/terminal/terminal-tab.tsx`(active일 때만 main focus 표에 적고 `viewRef.focus()`, PTY resize를 보낸다)
- 계약:
  - 쓰는 것: `model.ts` 함수(바꾸지 않는다), `FloatPanel`의 `active`.
  - 내놓는 것: 없음.

## 할 일

1. `workspace.tsx`에 renderer 상태 하나를 둔다: `floatFocused: boolean`(저장하지 않는다. layout model과 `layout.json`은 바꾸지 않는다). true면 focus가 floats 층(맨 위의 접히지 않은 패널)에 있고, false면 `focusedPane` 칸에 있다.
   - true로: 패널을 누르거나 패널에 focus가 들어올 때(`onRaise`), 탭 menu·palette의 Float, span이나 palette로 패널을 펼 때(`restoreFloat`).
   - false로: 칸을 누르거나 칸에 focus가 들어올 때, Dock 뒤, 접히지 않은 패널이 하나도 남지 않을 때(Minimize·Close로). 맨 위 패널을 Minimize·Close했을 때도 false로 하고 `focusPaneBody(focusedPane)`로 칸에 focus를 준다.
2. `panes.tsx`: `Panes`가 칸의 focus 여부를 `view.focusedPane === index`로 정하지 않고 prop으로 받는다(예: `focusedPane: number | null`, null이면 어느 칸도 focus가 아니다). `onFocus`는 `focusedPane`이 같아도 부른다(floats에서 같은 칸으로 돌아올 때 표시를 되돌려야 한다). 고른 탭 강조선, `renderTab(selected, focused)`, `data-focused`가 모두 이 값을 따른다.
3. `floats.tsx`: `Floats`가 `focused: boolean` prop을 받는다. `FloatPanel`의 `active`와 `renderTab(tab, active)`는 "맨 위의 접히지 않은 패널이고 `focused`"일 때만 true다. `onRaise`는 맨 위 패널이어도 부른다(`focused`가 false일 때 다시 누르면 focus를 돌려받아야 한다). 맨 위면 `raiseFloat`가 같은 view를 돌려주니 workspace는 `floatFocused`만 바꾼다(같은 view로 `update`해 저장하지 않는다).
4. 결과: 늘 한 곳만 focus 색이다. terminal도 focus인 쪽 하나만 `active`라서 입력과 PTY resize가 그쪽으로만 간다.

## 정한 것

- focus 위치는 저장하지 않는다(agent). 다시 띄우면 칸이 focus다.
- Ctrl+W 같은 칸 단축키(`ipc/keybindings.ts`)는 floats에 focus가 있어도 지금처럼 `focusedPane` 칸에 듣는다(agent). 패널용 단축키는 이 계획이 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 화면 상태다.
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- 남지 않음: `grep -n "view.focusedPane === index" packages/shell/renderer/workspace/panes/panes.tsx`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 손으로 확인하지 못한 것
