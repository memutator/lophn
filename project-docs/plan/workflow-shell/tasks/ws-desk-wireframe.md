# ws-desk-wireframe

title bar 가운데에 자리(desk) selector를 놓고 자리를 바꾸는 모양을 wireframe으로 그린다. 실제 renderer component(`DeskSelector`와 TopBar의 가운데 자리)를 만들어 gallery(`tools/wireframes`)의 Screens에 올리고, 사람이 보고 승인하기 전에는 이 계획의 renderer wiring task(ws-wire-state, ws-wire-selector)가 돌지 않는다. `ui-design` skill의 순서를 따른다.

- 단위: screen (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/top-path/desk-selector.tsx`(새 file)
  - `packages/shell/renderer/workspace/top-path/desk-selector.module.css`
  - `packages/shell/renderer/desktop/top-bar/top-bar.tsx`
  - `packages/shell/renderer/desktop/top-bar/top-bar.module.css`
  - `tools/wireframes/pages/screens/project-desk.tsx`(새 file)
  - `tools/wireframes/pages/screens/project-desk/`(새 폴더)
  - `packages/design/wording`(key만)
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`(순서, "모든 화면의 규칙", 함정의 "위쪽 바는 창 끌기 영역"), `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것"과 "사람이 정할 것", roadmap `project-docs/products/roadmap/workflow.md`의 "화면과 shell"
  - architecture: `project-docs/architecture/ui-kit.md`(범용 component는 design에 먼저), `project-docs/architecture/workspace-layout.md`의 "흐름"(`TopBar.leading`에 Breadcrumbs와 MinimizedBar)
  - 코드: `packages/shell/renderer/desktop/top-bar/top-bar.tsx`(`TopBar`의 `leading`·`trailing`·`platform`, `WindowControls`)와 `top-bar.module.css`(`.bar`의 drag 영역과 mac 신호등 여백, `.leading`이 남는 폭을 차지), `packages/shell/renderer/workspace/top-path/breadcrumbs.tsx`, `workspace/minimized/minimized-bar.tsx`(`ResizeObserver`로 넘치면 +N), `workspace/workspace.module.css`의 `.leading`·`.trailing`
  - 본보기(화면): `tools/wireframes/pages/screens/project-app.tsx`의 `ProjectApp`(실제 `TopBar`·`Breadcrumbs`·`PageSidebar`·`TabStrip`으로 project 창을 gallery에서 동작하게 그린다), `pages/screens/project-window.tsx`(`PageSidebar`, `stripTabsOf`), `pages/screens/project-float/pages.tsx`(floated·minimized 상태), `pages/screens/project-workspace.tsx`(영역 file 모양), `mock/drive.ts`(`useDrive`, `find`, `click`)
  - design: `packages/design/components/overlay/menu/menu.tsx`(`Menu`, `MenuItem`, `MenuIcon`), `packages/design/components/input/select/select.tsx`(`Select`)
- 계약:
  - 쓰는 것: `TopBar`(`desktop/top-bar/top-bar.tsx`. 지금 `leading`·`trailing`만 있고 가운데 자리가 없다), `Breadcrumbs`·`MinimizedBar`(왼쪽에 이미 있는 것), design의 menu·Select 계열 component(`@lophn/ui/overlay`, `@lophn/ui/input`. 새 범용 component가 필요하면 `ui-design` skill대로 design에 먼저), wireframe 본문 조각(`tools/wireframes/pages/screens/project-window.tsx`의 `PageSidebar`·`stripTabsOf` 등).
  - 내놓는 것(wiring task가 import한다. 이름과 props를 바꾸지 않는다. 사람이 모양을 바꾸라고 하면 모양만 고친다)
    - `DeskSelector`(`desk-selector.tsx`)
      ```ts
      export interface DeskOption {
        readonly key: string;        // default 자리(`_default`) 또는 workflow 이름
        readonly label: string;      // 보일 이름. workflow는 `<name>`
        readonly invalid?: boolean;  // 선언이 틀려 시작은 못 하지만 자리는 열 수 있는 workflow
      }
      export interface DeskSelectorProps {
        readonly options: readonly DeskOption[];  // 첫 항목이 늘 기본 자리
        readonly active: string;                  // options의 key
        readonly onSelect: (key: string) => void;
      }
      ```
      표시하는 것은 `options`와 `active`뿐이다. 단축키는 두지 않는다(README).
    - `TopBar`에 `center?: ReactNode`를 더한다. 창 끌기 영역(`-webkit-app-region: drag`)을 빼앗지 않고, macOS 신호등 자리와 Windows·Linux 창 단추 자리를 피하고, 좁은 창에서 왼쪽 경로·접힌 span과 겹치는 규칙(양보 순서)은 wireframe으로 정한다. launcher·settings가 쓰는 TopBar는 `center` 없이 지금과 같게 그려져야 한다.
    - selector에 들어가는 입력의 출처(wiring task가 채운다): 기본 자리 하나(고정 label)와 그 project의 workflow 목록(계획 `workflow`의 `wf-screen-source`가 renderer source에 내놓는 `workflows(project)`. 틀린 선언 entry도 담은 평평한 `ReadResult<WorkflowEntryView[]>`이고, entry의 `name`이 자리 key이고 boolean `invalid`가 `invalid`다). 이 task는 fake data로 그린다.
  - gallery page(`ui-design` skill "새 화면 만들기"): 영역 file `project-desk.tsx`가 page를 낸다. 실제 `Workspace` 전체는 wiring 전이라 쓰지 않고, 실제 `TopBar`·`DeskSelector`·`Breadcrumbs`·`MinimizedBar`와 본문 조각으로 그린다. page 목록(id는 한 번 정하면 바꾸지 않는다):
    - `project-desk-default`: workflow가 없는 project. selector를 보이지 않는 모양이 기본이다(고를 것이 없다).
    - `project-desk-switch`: workflow 둘과 틀린 선언 하나. 눌러 자리를 바꾸면 pane의 탭·floated 패널·minimized span이 그 자리 것으로 통째로 바뀌는 동작하는 상태.
    - `project-desk-menu`: selector의 menu를 연 채(틀린 선언 항목 포함).
    - `project-desk-workflow`: workflow 자리가 켜진 상태(그 자리의 탭, floated 패널, minimized span).
    - `project-desk-failed`: workflow 목록 읽기에 실패한 상태(기본 자리와 이미 layout에 있는 자리만).
    - `project-desk-narrow`: 좁은 창(sidebar 접힘). 왼쪽 경로, minimized span, selector가 같이 있을 때 양보 순서.
    - `project-desk-platforms`: macOS 신호등과 Windows 창 단추를 가진 bar를 나란히(selector가 둘 다 피한다).

## 정한 것

1. **component 이름은 `DeskSelector`, props는 `options`·`active`·`onSelect`로 정한다.** 근거: 코드에서는 `space`가 공간이라 겹쳐 `desk`를 쓴다(ws-model). 목록 출처를 props 밖으로 두면 gallery가 fake 목록으로 그리고 wiring이 source를 꽂기만 하면 된다.
2. **gallery 영역은 새 file `project-desk.tsx`로 한다.** 근거: `project-workspace.tsx`는 `workflow` 계획의 wireframe task도 쓸 가능성이 높아 소유가 겹친다. `pages/index.ts`의 `GROUPS` 등록은 공용 등록 file이라 worker가 한 줄만 더하고 보고의 "넘길 줄"에 적는다.
3. **사람이 정할 것(승인 때 묻는다):** 기본 자리의 이름, workflow가 없는 project에서 selector를 보일지, 틀린 선언 항목의 표시, 자리 바꾸기 전환의 모양.
4. **page 본문은 `ProjectApp`을 고치지 않고 이 task의 `project-desk/` 안에 새 틀을 만든다.** 근거: `project-app.tsx`는 이 task의 소유가 아니고 `TopBar`를 직접 그린다. 틀은 `ProjectApp`의 모양을 본떠 `TopBar`에 `center`를 넘기는 일만 다르다. 자리가 바뀔 때 `useState`로 자리를 바꾸는 것도 이 틀이 한다.
5. **detached 창은 그리지 않는다.** 근거: gallery에 OS 창이 없다. detached 창이 자리를 바꿀 때 숨고 돌아오면 보이는 것은 모양이 아니라 동작이다(ws-detached-show). 사람이 승인 때 이 점을 안다.

## 할 일

지금: `TopBar`는 `leading`(남는 폭), `trailing`(고정) 둘만 있다. project 창은 `workspace.tsx`에서 `leading`에 `Breadcrumbs`와 `MinimizedBar`, `trailing`에 대기 목록·palette·Settings를 넣는다.

1. design에 새로 필요한 범용 component가 있는지 먼저 본다(`ui-design` "새 화면 만들기" 1). `Menu`가 trigger 하나로 항목 목록을 열고 `MenuItem`에 `leading`·`disabled`가 있으니 `DeskSelector`는 trigger(ghost 단추. 이름과 chevron)와 `Menu`로 시작한다. 목록이 길어지는 일은 없다고 보지만 길면 `Palette`다(`mod.ts` 주석). design에 더하는 일이 생기면 그 분류 `mod.ts` export와 kit page 견본까지 한다(`check-kit`).
2. `top-bar.tsx`에 `center?: ReactNode` prop을 더하고 `<div className={styles.center}>`를 `leading`과 `trailing` 사이에 놓는다. `top-bar.module.css`에 `.center`를 더한다.
   - drag 영역을 유지한다(`.bar :is(button, …)`가 이미 조작 요소만 no-drag).
   - macOS의 왼쪽 80px 여백과 Windows·Linux의 오른쪽 창 단추 138px을 침범하지 않는다.
   - `center`가 없으면 DOM과 CSS 결과가 지금과 같다(launcher·settings 화면이 바뀌지 않는다).
   - 가운데 맞춤은 bar 전체 기준(좌우 폭이 달라도 가운데)과 남는 폭의 가운데 중 wireframe으로 고른다. 좁은 창에서는 selector가 이름을 줄이고(ellipsis) 왼쪽 경로와 MinimizedBar가 먼저 양보한다. 양보 순서는 `project-desk-narrow`로 사람이 본다.
3. `desk-selector.tsx`와 `desk-selector.module.css`를 계약의 props대로 만든다.
   - 첫 항목(기본 자리)은 항상 있다. `active` 항목은 표시한다. `invalid`면 오류 표시를 붙이되 고를 수 있다(선언을 고치는 동안 자리를 열 수 있어야 한다).
   - 색과 간격은 token(var)이다. 아이콘은 renderer `icons/*.ts` 묶음을 쓰고 lucide를 직접 import하지 않는다. menu 항목에는 아이콘을 붙인다(`ui-design` "모든 화면의 규칙").
   - 글은 wording key로 쓴다. key는 `catalog/project.ts`(`project-workspace.*`가 있는 file)에 `project-workspace.label.desk-selector`(접근성 이름), `project-workspace.label.desk-default`(기본 자리 이름), `project-workspace.label.desk-invalid`(틀린 선언 표시)를 더하고 `deno task wording`으로 placeholders를 만든다. 값은 영어 제안이고 이름은 사람이 승인 때 정한다.
4. gallery를 만든다.
   - `tools/wireframes/pages/screens/project-desk/` 안에 틀 component를 둔다. `TopBar`, `Breadcrumbs`, `MinimizedBar`, `DeskSelector`, `PageSidebar`·`stripTabsOf`(`project-window.tsx`), 본문은 `bodies.tsx`의 `TerminalBody`나 `documents.tsx`의 `DocumentPane` 같은 있는 조각을 쓴다. 새 모양을 그리지 않는다.
   - 자리마다 다른 layout을 가진 fake data(탭, floated 패널, minimized 목록)를 두 개 이상 만들어 `project-desk-switch`에서 선택이 바뀔 때 통째로 바뀌게 한다. fake data는 `tools/wireframes/mock/` 쪽이 아니라 이 폴더 안이어도 된다.
   - `project-desk.tsx`가 `Area`(`pages/types.ts`)를 export하고 위 page 일곱을 `{ id, title, description, render }`로 낸다. title은 영어, description은 한국어 한두 문장이다.
   - `tools/wireframes/pages/index.ts`의 `GROUPS`(screens)에 영역을 한 줄 더한다. 공용 file이라 이 줄만 고치고 보고의 "넘길 줄"에 적는다.
5. `deno task wireframes`로 만들고(ui-design "확인") 7개 page를 라이트·다크로 본다. `deno run -A packages/shell/renderer/build.ts`도 선다.
6. 사람이 승인할 때 묻는 것(정한 것 3)을 보고에 목록으로 적는다. 추천안: 기본 자리 이름 "Main", workflow가 없으면 selector를 숨김, 틀린 선언 항목은 오류 표시를 붙이고 고를 수 있음, 전환은 즉시(animation 없음).

## 끝남

- `deno task check`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고, gallery의 위 일곱 page가 옮긴 component(실제 `TopBar`의 `center`와 `DeskSelector`)로 그려진다. `deno run -A packages/shell/renderer/build.ts`도 선다.
- launcher와 settings 화면의 TopBar가 지금과 같다(gallery의 launcher·settings page).
- 위험 test: 없음. 화면이다(`write-test` skill).
- 사람 승인: wireframe을 사람이 본 뒤에야 이 task를 merged로 둔다. 승인 전에는 ws-wire-state와 ws-wire-selector가 돌지 않는다.
- 남지 않음: 없음. 새 component와 page만 더하고 옛 것을 지우지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `pages/index.ts`의 `GROUPS`에 더한 줄, wording 생성(`deno task wording`을 돌렸는지)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(가운데 맞춤 기준, 양보 순서)
- 넘길 줄: 남의 file을 최소로 맞춘 곳(`pages/index.ts` 한 줄)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 사람이 승인 때 정할 것(위 할 일 6)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
