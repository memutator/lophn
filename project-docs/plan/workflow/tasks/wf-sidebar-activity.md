# wf-sidebar-activity

project 창의 sidebar를 VS Code식 activity bar로 바꾼다. 왼쪽 끝에 icon 세로 줄을 늘 두고, icon을 누르면 그 panel을 열고, 열린 icon을 다시 누르면 panel을 접는다. 지금의 위쪽 icon segmented control(Explorer, Agent, Artifacts, Domains)과 접힌 rail(`rail.tsx`)을 이것이 대신한다. 항목은 지금 네 개 그대로이고 Workflows는 `wf-screen-sidebar`가 한 항목으로 더한다. 사람이 wireframe(`wf-wireframe`)을 승인한 뒤에 돈다. project 창만이고 앱 공간은 그대로다.

- 단위: activity (wave 3)
- 선행: wf-wireframe
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/activity-bar.tsx`(새 file)
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.module.css`
  - `packages/shell/renderer/workspace/sidebar/rail.tsx`(지운다)
  - `packages/shell/renderer/workspace/workspace.tsx`(`RailAction` import 경로 한 줄만. 아래 할 일 4)
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-pages.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/project-app.tsx`
  - `tools/wireframes/pages/screens/domain/pages.tsx`
- 읽을 것:
  - 시작 조건: `wf-wireframe`를 사람이 승인했다. 이 task는 승인된 activity bar wireframe 코드(`tools/wireframes/drafts/workflow/activity-bar.tsx`와 `workflow.module.css`의 activity bar 부분, page `draft-activity-bar-*`)를 **옮긴다**. 보고 다시 그리지 않는다. `wf-wireframe.md` 끝 "사람이 고른 모양"이 있으면 그것이 우선이다
  - 제품 결정: roadmap `project-docs/products/roadmap/workflow.md`의 "화면과 shell"(project sidebar는 activity bar로 바꾼다)과 "정한 것 (사람)"의 마지막 항목들. 이 계획 README의 "정한 것" 가운데 "화면 (이 계획)"
  - architecture: `project-docs/architecture/workspace-layout.md`(sidebar 폭과 접힘은 `model.ts`의 `sidebarView`가 정한다)
  - 이 plan의 brief: `wf-wireframe.md`("정한 것" 1의 짝표: `activity-bar.tsx` → `sidebar/activity-bar.tsx`), `wf-screen-sidebar.md`(Workflows 항목을 이 task가 만든 activity bar에 더한다)
  - 본보기(코드):
    - `sidebar/project-sidebar.tsx`(`SidebarTab`, `TABS`, `TAB_ICONS`, `tabLabel`, 본문 `tab ===` 가지, `mode: "open" | "collapsed"`, `onToggle`, `initialTab`, `reveal`·`focusExplorer`가 `setTab("explorer")`를 부르는 effect), `sidebar/rail.tsx`(지울 것: `RailAction`, `Rail`), `sidebar/project-sidebar.module.css`(`.sidebar`, `.collapsed`, `.header`, `.rail`, `.body`, `.resizer`)
    - `workspace/workspace.tsx`: `toggleSidebar`·`expandSidebar`(접힘 단추와 Ctrl/Cmd+B, Ctrl+Shift+E), `onRail`(`openTerminalTab`·`openRole("lophn")`·`openSearchShortcut`), `sidebarView(...)`가 주는 `mode`·`width`, `<ProjectSidebar … onRail={onRail} />`
    - `workspace/model.ts`의 `sidebarView`, `SIDEBAR_WIDTH`(240), 접힘 폭 56(**읽기만 한다.** 소유가 아니다: 계획 `workflow-shell`의 `ws-model`이 이 file을 고친다)
    - gallery: `pages/screens/project-window.tsx`(`SidebarSpec.collapsed`·`railTooltip`·`mode`, `useSidebarScript`의 rail 갈래, `PageSidebar`의 `mode`·`width={props.collapsed ? 56 : 240}`·`onRail`), `pages/screens/project-pages.tsx`의 `SidebarCollapsed`, `pages/screens/project-workspace.tsx`의 `new-sidebar-collapsed`, `pages/screens/project-app.tsx`의 `rail`·`onRail`, `pages/screens/domain/pages.tsx`의 `openDomainsTab`(`[data-sidebar] [role="tab"]`을 index 3으로 누른다)과 `ProjectSidebar`를 직접 세우는 곳의 `onRail={noop}`, `tools/wireframes/mock/drive.ts`(`click`, `find`, `useDrive`. 이 file은 일반 helper라 고치지 않는다)
    - wording: `.claude/skills/wording/SKILL.md`, `catalog/project.ts`의 `project-workspace.label.sidebar-tab-*`·`rail-*`, `domain.label.sidebar-tab`(`catalog/domain.ts`), `common.ts`의 `project-workspace.button.expand-sidebar`·`collapse-sidebar`(Settings sidebar도 쓴다)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/write-test/SKILL.md`(화면은 test하지 않는다)
- 계약:
  - 쓰는 것: 승인한 wireframe, `model.ts`의 `sidebarView`(그대로 쓴다)
  - 내놓는 것(`wf-screen-sidebar`가 기대는 것):
    - `sidebar/activity-bar.tsx`: `ActivityBar`와 항목 type. 항목 하나는 `{ key: SidebarTab; label: string; icon }`이고 `ProjectSidebar`가 `ACTIVITY_ENTRIES` 배열(Explorer, Agent, Artifacts, Domains 순)로 넘긴다. 항목을 더하는 일은 `SidebarTab` type, 이 배열, 본문 가지에 한 줄씩 더하는 것이다.
    - `ProjectSidebar`: prop은 그대로다(`mode`, `width`, `initialTab`, `onToggle`, `onRail` 등). `onRail`은 bar 아래쪽 바로 가기 묶음이 쓴다. `RailAction` type은 `activity-bar.tsx`가 내놓는다. `mode`는 이제 panel이 열렸는지(`open`) 접혔는지(`collapsed`)다. 접혀도 activity bar는 보인다.
    - 동작: 접혀 있거나 다른 항목이 열려 있을 때 항목을 누르면 그 panel이 열린다(접혀 있으면 펼친다). 열린 항목을 다시 누르면 panel을 접는다.

## 정한 것

1. **activity bar는 `ProjectSidebar`의 왼쪽 세로 줄이고 폭은 접힘 폭과 같은 56px다.** 이유: `sidebarView`의 접힘 폭이 56px라 `model.ts`를 고치지 않고 "접힘 = bar만 보임"이 된다. 열렸을 때 `width`(200~400px)는 bar를 포함하므로 panel은 그보다 56px 좁다. 사람이 panel이 너무 좁다고 하면 `SIDEBAR_WIDTH`와 최소 폭을 올리는 일이 `model.ts`에 필요하다(보고의 "계약 바꾸기 요청").
2. **bar의 항목은 `role="button"`(`IconButton`)이고 `role="tab"`이 아니다.** 열린 항목은 `aria-pressed`와 선택 표시를 갖는다. 이름은 tooltip과 `aria-label`이다. bar는 `role="toolbar"`, `aria-orientation="vertical"`이고 각 항목에 `data-activity="<key>"`를 단다. 이유: gallery drive(`[data-sidebar] [role="tab"]`)와 다른 화면의 `[role="tab"]` 조회가 sidebar를 문서 탭으로 오인하지 않게 한다.
3. **고른 항목은 지금처럼 `ProjectSidebar`의 화면 상태(`tab`)이고 저장하지 않는다.** 접힘은 지금처럼 `workspace.tsx`의 `sidebar.collapsedByUser`와 창 폭이 정한다. 항목을 누르는 길은 `tab`을 바꾸고, 접혀 있었거나 열린 항목을 다시 눌렀으면 `onToggle()`을 부른다(`toggleSidebar`가 접혀 있으면 펼치고 열려 있으면 접는다). `reveal`·`focusExplorer`의 `setTab("explorer")`는 그대로이고 펼치기는 이미 `workspace.tsx`의 `expandSidebar`가 한다.
4. **머리 줄의 접기 단추를 없앤다.** 머리에는 launcher 단추와 project 이름만 남는다. 접고 펴는 길은 열린 icon을 다시 누르는 것과 Ctrl/Cmd+B(`sidebar.toggle`)다. 이유: 같은 일을 하는 단추가 둘이면 어느 쪽이 접힘 상태를 보이는지 흐려진다. `project-workspace.button.expand-sidebar`·`collapse-sidebar`는 Settings sidebar가 쓰므로 지우지 않는다.
5. **접힌 rail의 바로 가기(Terminal, Agent, Search)는 activity bar 아래쪽 묶음으로 옮겨 남긴다.** VS Code가 bar 아래쪽에 계정·설정을 두는 자리와 같다. 사람은 sidebar를 activity bar로 바꾸라고 했을 뿐 바로 가기를 없애라고 하지 않았으므로 있던 동작을 잃지 않는다(planner, 2026-10-22). `onRail`과 `RailAction`의 뜻은 그대로이고 `RailAction` type만 `activity-bar.tsx`로 옮긴다.
6. **launcher 단추 자리는 지금 규칙을 따른다.** 접히면 `sidebarView`의 `launcherInTopBar`가 참이라 상단 바에 있고, 열리면 panel 머리에 있다. 창이 640px 미만이라 sidebar가 `hidden`이면 bar도 없다(지금 규칙 그대로).
7. **Agent 항목의 이름은 Agents로 바꾼다.** key `project-workspace.label.sidebar-tab-agent`의 값만 "Agents"로 고친다(항목 id `agent`와 key 이름은 그대로).

## 할 일

1. **bar를 옮긴다.** `tools/wireframes/drafts/workflow/activity-bar.tsx`의 `ActivityBar`를 `packages/shell/renderer/workspace/sidebar/activity-bar.tsx`로 옮긴다(모양, 순서, 이름 그대로). 위쪽은 panel 항목, 아래쪽은 바로 가기 묶음(Terminal, Agent, Search. 지금 `rail.tsx`의 단추와 tooltip 그대로)이다. props는 `{ entries, selected, open, onSelect(key), onRail }` 꼴로 정하고(`open`이 거짓이면 선택 표시를 `aria-pressed`로 보이지 않는다), 아이콘은 `icons/*.ts` 묶음에서 가져온다(`lucide-react`를 직접 import하지 않는다). CSS는 `project-sidebar.module.css`에 `.activityBar…` class로 더하고 값은 token 변수만 쓴다.
2. **`project-sidebar.tsx`를 바꾼다.**
   - `TabStrip` 위쪽 segmented control과 `Rail` 갈래를 지운다. `TABS`/`TAB_ICONS`/`tabLabel`은 `ACTIVITY_ENTRIES`(`{ key, label, icon }[]`)로 모은다.
   - `<nav>` 안을 가로로 나눈다: 왼쪽 `ActivityBar`(늘 그린다), 오른쪽 panel(머리 + 본문, `mode === "collapsed"`면 그리지 않는다). `data-sidebar={mode}`, `aria-label`, `width`는 그대로 `nav`에 둔다. 본문 `tab ===` 가지와 `data-sidebar-tab`은 그대로다.
   - 항목 누르기: 정한 것 3. `Rail` import를 지우고 `onRail`은 `ActivityBar`의 바로 가기 묶음에 넘긴다. 머리의 접기 `IconButton`을 지운다(정한 것 4). 파일 머리 주석을 "activity bar + panel"로 고친다.
   - `onResizeStart`의 `resizer`는 panel 쪽 오른쪽 가장자리에 그대로 둔다(접히면 그리지 않는다).
3. **rail을 지운다.** `sidebar/rail.tsx`를 지우고, `RailAction` type은 `activity-bar.tsx`로 옮기고, `.rail` CSS를 `project-sidebar.module.css`에서 지운다. wording: `project-workspace.label.rail-terminal`, `rail-agent`, `rail-search`는 bar 아래쪽 바로 가기의 tooltip으로 그대로 쓰고, 묶음 이름 `rail-shortcuts`도 그 묶음의 `aria-label`로 쓴다. `project-workspace.label.sidebar-tab-agent`의 값을 "Agents"로 고친다. activity bar의 `aria-label`(예: `project-workspace.label.activity-bar`)을 더하고 `deno task wording`으로 placeholders를 만든다(손으로 고치지 않는다).
4. **`workspace.tsx`.** 고치는 곳은 `RailAction` import 경로(`./sidebar/rail.tsx` → `./sidebar/activity-bar.tsx`) 한 줄뿐이다. `onRail` 함수와 prop은 그대로 둔다. 이 밖은 고치지 않는다. 계획 `workflow-shell`의 `ws-layout-map`(wave 1)이 이 file을 먼저 고치고 `ws-wire-state`·`ws-wire-selector`와 `wf-screen-sidebar`가 뒤에 고치므로 줄을 최소로 둔다. 보고에 고친 줄을 적는다.
5. **gallery를 고친다.**
   - `project-window.tsx`: `RailAction` import 경로를 `activity-bar.tsx`로 바꾼다. `SidebarSpec.railTooltip`과 `useSidebarScript`의 rail 갈래는 bar 아래쪽 바로 가기 단추를 가리키게 고친다. `SidebarProps.onRail`·`PageSidebar`의 `onRail`은 그대로다. `PageSidebar`는 `mode`(열 항목)를 `initialTab`으로 넘기고, 접힌 상태는 `collapsed`로 그대로 그린다. 이제 `width={props.collapsed ? 56 : 240}`는 bar 폭을 포함한 값이다. 접힌 모양에서 사람이 한 것처럼 보이게 하려면 `spec.collapsed`일 때 `useSidebarScript`가 `[data-activity="<mode>"]`에 focus하는 갈래로 바꾼다(tooltip이 열린 채 보이는 모양).
   - `project-pages.tsx`: `SidebarCollapsed`는 접힌 activity bar를 그린다. `railTooltip: "search"`는 bar 아래쪽 Search 단추의 tooltip으로 그대로 보인다. 설명 글이 "바로 가기 rail"을 말하면 "bar 아래쪽 바로 가기"로 고친다.
   - `project-workspace.tsx`: `new-sidebar-collapsed`의 title과 description을 activity bar 말로 고친다("접은 sidebar는 icon 줄만 남는다. 누르면 그 panel이 열린다"). 한국어 한두 문장이다. 이 page의 id는 바꾸지 않는다.
   - `project-app.tsx`: `onRail={rail}`과 `rail` handler는 그대로 둔다. `RailAction` import가 있으면 경로만 바꾼다.
   - `domain/pages.tsx`: `openDomainsTab`을 `click('[data-sidebar] [data-activity="domain"]')`로 바꾸고(index 3 의존을 없앤다), `ProjectSidebar`를 직접 세우는 곳의 `onRail={noop}`은 그대로 둔다. 이 page들의 모양은 그대로여야 한다.
   - `mock/drive.ts`와 `project-files/`·`agent` page들은 고치지 않는다(`sidebar={{ mode: "agent" }}`는 `initialTab`으로 그대로 된다).
6. **check.** `deno task wording`, `deno run --allow-read tools/check-wording.ts`, `deno task check`, `deno task wireframes`, `deno run -A packages/shell/renderer/build.ts`(`check:full`은 renderer build를 보지 않는다). 승인된 Drafts page와 옮긴 page를 Light·Dark로 나란히 보고, 기존 sidebar page(Explorer, Agent, Domains)가 바 폭만큼 좁아진 것 말고는 같은 모양인지 본다(`domain-project-a`의 drive가 Domains를 연다). `deno task dev:mock`에서 icon 누르기, 다시 눌러 접기, Ctrl/Cmd+B, Ctrl+Shift+E, 창을 줄여 자동 접힘을 손으로 확인한다.

## 끝남

- `deno task check`가 통과한다. `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- 위험 test: 없음(화면이다. `write-test` skill)
- (화면) `deno task wireframes`가 되고, gallery의 project window 계열 page가 activity bar로 그려진다. `deno run -A packages/shell/renderer/build.ts`도 선다.
- 승인된 wireframe과 옮긴 page가 같은 모양이다(Light·Dark).
- 남지 않음: `grep -rn "sidebar/rail" packages tools --include=*.ts --include=*.tsx`가 0줄이다. `sidebar/rail.tsx`가 없다.
- `git diff -U0 packages/shell/renderer/workspace/workspace.tsx`가 위 할 일 4의 import 한 줄뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno task wording`을 돌렸는지. 그 밖에 없으면 "없음"
- 안 쓰게 된 export: `Rail`(지웠다). `RailAction`은 `activity-bar.tsx`로 옮겼다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. `workspace.tsx`의 고친 줄(고친 뒤 줄 번호)
- 계약 바꾸기 요청: panel이 56px 좁아져 사람이 불편해하면 `model.ts`의 `SIDEBAR_WIDTH`·최소 폭 변경이 필요하다는 것(소유 밖), 그 밖에 `wf-screen-sidebar`가 기대는 `ActivityBar` 모양이 모자라면 그것
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: bar 안 방향키 이동은 없다(Tab 키로 항목을 옮긴다)
