# wd-gallery

wireframes gallery에 detached 창 하나(terminal)와 탭 menu의 Detach를 더한다. gallery는 진짜 `Desktop`을 mock data로 그리므로 새 component를 그리지 않는다. detached 창은 `openDetached` route와 가짜 `LophnDetachedApi`로 그리고, 탭 menu의 Detach는 mock이 가짜 `detached` 통로를 `Workspace`에 넘기면 진짜 menu에 나온다.

- 단위: wd-gallery (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/mock/mock-desktop.tsx`
  - `tools/wireframes/pages/screens/project-detached/pages.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 5(wireframes gallery)
  - 규칙: `.claude/skills/ui-design/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/screens/project-float/pages.tsx`(`FloatTerminal`: `MockDesktop`에 `panes`·`floats`·`openTerminal`을 주는 꼴)와 `tools/wireframes/pages/screens/project-workspace.tsx`의 `new-float-*` page 등록
  - 지금 코드(main `5361104e8`을 열어 확인한 것이다): `tools/wireframes/mock/mock-desktop.tsx`의 `MockDesktop`(props에 `browser?: LophnBrowserApi`가 이미 있다, `layoutOf`, `Desktop`에 넘기는 값, `TabSpec`(`kind`에 `browser`가 있다), `fakeTerminal`, `BrowserApiProvider`), `tools/wireframes/pages/screens/project-files/tab-menu.tsx`(`EditorTabMenu`가 탭을 우클릭해 진짜 menu를 연다. 이 file은 고치지 않는다)
  - 앞 task가 내놓은 것: `wd-window-ui`의 `openDetached(key)`와 `Desktop`의 `detached` prop, `DetachedSpace`, `wd-contract`의 `LophnDetachedApi`·`DetachedTaken`, `wd-project-side`의 Detach 항목·[Detach] 단추(`browser_devtools` 패널에는 없다)
  - module: `project-docs/module-catalog.yaml`의 `tools`
- 계약:
  - 쓰는 것: 위 "앞 task가 내놓은 것".
  - 내놓는 것: gallery page 하나(`new-detached-terminal`)와 기존 menu page의 설명. 다른 task가 기대는 것은 없다.

## 할 일

1. `mock-desktop.tsx`:
   - `fakeDetached(taken?: DetachedTaken)`: `LophnDetachedApi`를 채우는 가짜. `take()`는 `taken`을 돌려주고 나머지 method는 resolve만 하고 `subscribe`는 아무 때나 부르지 않는 해제 함수를 돌려준다. `open`은 `{ bounds: { x: 0, y: 0, width: 960, height: 600 } }`.
   - `MockDesktop`에 `detachedTab?: TabSpec` prop. 주면 `route`를 `openDetached(tab.key)`로 하고 `take()`가 `{ project: PROJECT_GROCERY, tab: <TabSpec을 TabItem으로>, transfer: null }`를 돌려주는 `fakeDetached`를 `Desktop`의 `detached`로 넘기고 `openTerminal`을 따른다(terminal 탭이 그려지게). 안 주면 `Desktop`에 `fakeDetached()`를 넘겨 project 공간의 Workspace가 Detach 항목과 [Detach] 단추를 그리게 한다.
2. `project-detached/pages.tsx`: `DetachedTerminal`. 위 prop으로 terminal 하나를 그린다(`FloatTerminal`의 `TERM_1`과 같은 모양). 새 file의 첫 줄에 이 page가 무엇을 보이는지 한 줄 주석.
3. `project-workspace.tsx`: `new-float-terminal` 근처에 page `new-detached-terminal`("Project · detached terminal", 설명: 탭 하나가 OS 창을 채운다. 위 bar에 제목과 [Dock]이 있고 창 단추는 OS의 것이다. [Dock]이나 창 닫기(×)는 탭을 project 창으로 돌려보낸다. terminal 출력은 gallery의 가짜 통로가 준 것이다). 설명이 한국어 문장 하나인 기존 page 꼴을 따른다. `new-editor-tab-menu`의 설명에 Detach를 더한다(Float 뒤. "Detach는 탭을 OS 창으로 뗀다"). 같은 영역의 `new-float-terminal`·`new-float-stack` 설명에 floated 패널 머리의 단추에 Detach가 생겼다고 더한다(접기, Dock, Detach, 닫기).
4. gallery index(`pages/index.ts`)는 고치지 않는다(`projectWorkspaceArea`가 이미 등록돼 있다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 화면은 test하지 않는다.
- 남지 않음: 없음(더하는 것뿐이다).
- `deno task wireframes`가 되고, gallery의 `new-detached-terminal`이 진짜 `DetachedSpace`로 그려지며 `new-editor-tab-menu`의 menu에 Detach가 나온다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
