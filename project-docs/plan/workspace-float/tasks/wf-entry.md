# wf-entry

탭을 floated로 만드는 길과 되돌리는 길을 낸다. docked 탭의 right-click menu에 Float를 더하고, 명령 palette에 Float tab, Dock panel, Minimize panel 행을 더한다. 단축키는 두지 않는다. Detach는 `workspace-detach` 계획이 더하므로 여기에 없다.

- 단위: wf-entry (wave 2)
- 선행: wf-minimized
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/panes/panes.tsx`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/desktop/palette/workspace-scope.ts`
  - `packages/shell/renderer/icons/workspace.ts`
  - `packages/design/wording/catalog/project.ts` (key만 더한다)
  - `packages/design/wording/catalog/workspace.ts` (key만 더한다)
  - `packages/design/wording/catalog/project.placeholders.ts` (`deno task wording`이 만든다)
  - `packages/design/wording/catalog/workspace.placeholders.ts` (`deno task wording`이 만든다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 2(여는 길)
  - 규칙: `.claude/skills/wording/SKILL.md`
  - 앞 task: `wf-layout-model.md`(`floatTab`, `dockTab`, `minimizeFloat`), `wf-floated-layer.md`(`Floats`, `area`), `wf-minimized.md`
  - 지금 코드: `panes/panes.tsx`의 `menuItems`, `chooseMenu`, `PanesProps`(`onPin` 모양), `workspace.tsx`의 `<Panes … onPin=…>`와 `usePaletteScope(() => workspaceScope({… go: (target) => …}))`, `desktop/palette/workspace-scope.ts`의 `WorkspaceAction`, `actions()`, `WorkspaceScopeInput`
- 계약:
  - 쓰는 것: 앞 task들의 export. `area`는 `workspace.tsx`가 `Floats`에 넘기는 `mainSize` 값이다.
  - 내놓는 것: `PanesProps.onFloat(pane: number, key: string)`. `WorkspaceAction`에 `"float" | "dock" | "minimize"`. `ipc/keybindings.ts`의 `Command`와 표는 고치지 않는다.

## 할 일

1. 탭 menu의 Float. 근거: roadmap "무엇을 만드나" 2.
   - `panes.tsx`: `PanesProps`에 `onFloat: (pane: number, key: string) => void`를 더하고 `PaneView`에 내려 menu 항목 `id: "float"`를 `menuItems`에 더한다. 위치는 close 묶음 뒤, Copy Path 묶음 앞이다(`separatorBefore: true`). `chooseMenu`가 `onFloat(menuTab.key)`를 부른다. 아이콘은 `workspaceIcons.float`(lucide에서 고른다, `icons/workspace.ts`). 문구는 `project-workspace.button.tab-float`("Float").
   - `workspace.tsx`: `onFloat={(pane, key) => update(floatTab(latest.current, key, area))}` (`area`가 아직 없으면 아무것도 하지 않는다).
2. 명령 palette. `workspace-scope.ts`의 `actions()`에 행 셋을 더한다. 행마다 있을 때만 보인다.
   - Float tab: focus 칸에 고른 탭이 있을 때. Dock panel, Minimize panel: 접히지 않은 floated 패널이 있을 때(대상은 floats 배열의 마지막 접히지 않은 항목, 곧 가장 위 패널). 단축키 hint는 없다.
   - `WorkspaceAction`에 `"float" | "dock" | "minimize"`. 아이콘은 palette가 이미 가진 이름(`"tab"`, `"screen"` 등)에서 고른다. 행 문구는 `common.button.palette-float-tab`("Float tab"), `common.button.palette-dock-panel`("Dock panel"), `common.button.palette-minimize-panel`("Minimize panel").
   - `workspace.tsx`의 `go`가 `target.action`을 받아 `floatTab`(focus 칸의 고른 탭), `dockTab`(그 뒤 `focusPaneBody(latest.current.focusedPane)`), `minimizeFloat`을 `update`로 부른다. 대상이 없으면 아무것도 하지 않는다.
3. wording: 위 key를 `project.ts`, `workspace.ts`(`common.button.palette-*`가 있는 영역 file)에 더하고 `deno task wording`. `deno run --allow-read tools/check-wording.ts`.
4. 손으로 확인한다: `deno task dev:mock`에서 탭 menu로 Float → 패널, 끌기, resize, Minimize → 상단 bar span → 누르면 같은 자리, Dock → 떠나 온 pane. palette 행 셋도 눌러 본다. 확인한 것과 못 한 것을 보고에 한 줄로 적는다.

## 정한 것

- 기본 단축키를 두지 않는다(사람). Ctrl+Alt+Arrow는 GNOME에서 workspace를 바꾼다. 명령은 탭 menu, 패널 단추, palette로만 닿는다. 그래서 `Command` 표(`ipc/keybindings.ts`)에 `tab.float`, `tab.dock`, `float.minimize`를 더하지 않는다. 단축키가 필요해지면 그때 표에 더한다.
- palette의 Dock panel과 Minimize panel의 대상은 "가장 위의 접히지 않은 floated 패널"이다(agent). 어느 패널에 focus가 있는지 따로 추적하지 않는다. 누르거나 focus하면 맨 위로 오므로 사람이 보는 패널과 같다.
- Float·Dock 뒤 focus는 옮기지 않는다. 다만 Dock은 칸 본문으로 준다(agent).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: 없음(더하는 것뿐이다).
- (화면) `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성을 돌렸으면 "돌림"
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 손으로 확인하지 못한 것
