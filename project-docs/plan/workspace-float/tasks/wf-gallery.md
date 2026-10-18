# wf-gallery

wireframes gallery에 floated와 minimized 상태를 더한다. 실제 `Workspace`가 floats를 가진 layout을 읽어 그린다. 그림을 따로 그리지 않는다. 탭 menu의 Float는 이미 있는 탭 menu page가 보인다.

- 단위: wf-gallery (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/project-float/pages.tsx` (새 file)
  - `tools/wireframes/mock/mock-desktop.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 5(gallery 상태 여섯 중 floated·minimized 몫: docked editor 위의 floated terminal, 겹친 패널 둘, 상단 bar의 minimized span 셋과 `+N`, 탭 menu의 Float, docked app panel 위의 floated DOM 패널. detached 창과 탭 menu의 Detach는 `workspace-detach`가 한다)
  - 규칙: `.claude/skills/ui-design/SKILL.md`("새 화면 만들기" 4~7, "확인", "함정")
  - architecture: `project-docs/architecture/ui-kit.md`
  - 본보기(화면): `tools/wireframes/pages/screens/project-workspace.tsx`의 `project-terminal` page와 `DOCUMENT_PANES`·`TERMINAL_PANES`, `mock/mock-desktop.tsx`의 `PaneSpec`·`layoutOf`·`MockDesktop`, `screens/project-files/tab-menu.tsx`(`EditorTabMenu`)
  - 갈 renderer 위치: 이 task는 renderer를 고치지 않는다. 그리는 것은 `packages/shell/renderer/workspace/floats/floats.tsx`(패널), `minimized/minimized-bar.tsx`(상단 bar span), `panes/panes.tsx`(탭 menu의 Float)다.
  - 가짜 data의 source: layout은 `mock-desktop.tsx`의 `layoutOf`가 만든다. 앱 view는 `packages/shell/renderer/desktop/dev-mock/app-space.ts`의 가짜 상자(`mockViews`, bounds 사각형에 안내 상자를 놓는다. cover로 줄어드는 모습이 그대로 보인다)이고 앱 id는 `dev-mock/ids.ts`의 `APP_BUDGET`·`APP_PLANNER`, 화면 key는 `home`이다.
- 계약:
  - 쓰는 것: 저장 layout의 `floats` 모양(`wf-layout-schema.md`: `{ tab, rect, minimized, origin_pane }`), 실제 `Workspace`/`Floats`/`MinimizedBar`.
  - 내놓는 것: gallery page 넷(id는 한 번 정하면 바꾸지 않는다). 새 영역이 아니라 기존 영역 `project-workspace`에 더하므로 `pages/index.ts`는 고치지 않는다.

## 할 일

1. `mock-desktop.tsx`: `PaneSpec` 옆에 `FloatSpec = { tab: TabSpec; rect: {x,y,width,height}; minimized?: boolean; originPane?: number }`를 더하고 `TabSpec.kind`에 `"app_panel"`을 더한다(앱 패널 탭은 `app`, `screen` 칸을 갖는다). `MockDesktopProps.floats?: readonly FloatSpec[]`를 받아 `layoutOf`가 저장 꼴 `floats`(`{ tab: storedTab(tab), rect, minimized, origin_pane }`)로 만든다. `storedTab`이 `app_panel`(`{ kind, key, app, surface }`)을 만든다. `floats`가 없으면 `[]`다. `useMemo` 의존성에 `floats`를 넣는다.
2. `project-float/pages.tsx`: 아래 page 셋의 component. 각각 `MockDesktop`에 `panes`, `floats`를 준다. 창 크기는 gallery iframe 고정 크기(`ui-design` "함정")라서 rect 숫자는 한 번 열어 보고 맞춘다.
   - `FloatTerminal`: 문서 두 탭이 docked된 칸 위에 terminal 패널 하나가 뜬 모습. `openTerminal`로 terminal을 열어 출력이 보이게 한다.
   - `FloatStack`: 패널 둘이 위아래로 겹친 모습(아래는 문서, 위는 terminal. 위쪽만 `active`).
   - `FloatMinimized`: 접힌 탭이 상단 bar에 span으로 줄지어 있고 넘치는 것이 `+N`으로 묶인 모습. span 셋과 `+N`이 보이게 접힌 항목 수와 창 폭을 맞춘다(`wf-minimized`의 span 폭 140px, `+N` 40px 기준). 문서 탭과 terminal 탭을 섞는다.
   - `FloatOverApp`: docked 칸에 app panel 탭(`APP_BUDGET`, `home`)이 있고 그 위에 terminal 패널이 뜬 모습. app view의 가짜 상자가 패널을 피해 줄어든 것이 보인다(cover).
3. `project-workspace.tsx`의 `pages`에 위 넷을 `{ id, title, description, render }`로 더한다. id: `new-float-terminal`, `new-float-stack`, `new-float-minimized`, `new-float-over-app`. title은 영어(예: "Project · floated terminal"), description은 한국어 한두 문장이다. 기존 `new-editor-tab-menu`의 description에 menu 항목 목록(Close … Copy Path … 순)에 Float 항목이 들어갔음을 더한다(menu 모양은 실제 component가 그리므로 그림은 그대로다).
4. `deno task wireframes`를 돌리고 `python3 -m http.server`로 새 page 넷과 `new-editor-tab-menu`를 열어 눈으로 본다(`ui-design` "확인"). Light·Dark 둘 다.

## 정한 것

- detached 몫(창 하나, 탭 menu의 Detach)은 하지 않는다(README, roadmap "단계"). `workspace-detach`가 한다.
- 탭 menu page는 새로 만들지 않고 기존 `new-editor-tab-menu`가 실제 menu로 Float를 보인다(agent). menu를 그리는 코드가 하나이기 때문이다.
- roadmap은 `project-window.tsx`도 적었지만 그 file은 sidebar·탭 줄 조각을 모은 곳이라 건드릴 일이 없다(agent).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 화면이다.
- 남지 않음: 없음(더하는 것뿐이다).
- (화면) `deno task wireframes`가 되고, gallery의 `new-float-terminal`, `new-float-stack`, `new-float-minimized`, `new-float-over-app`가 실제 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(rect 숫자, 접힌 항목 수)
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
