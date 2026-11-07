# 앱 자리: 앱 화면 체계를 고치고, 앱이 shell 화면 자리(sidebar, 전역 float, tray)에 꽂힌다

상태: 로드맵. 2026-11-07 사람이 방향을 냈고 planner가 정리했다. 사람이 "extension"으로 낸 일이지만, 따로 extension 개념을 두지 않고 앱에 자리와 hook을 더해 푼다(정한 것 4). 지금의 extension(기능 묶음, `architecture/extension.md`)은 이 일과 따로 남는다. 정할 것은 없다. 2026-11-07 계획 `app-place`로 열었다(`project-docs/plan/app-place/README.md`). 계획을 열며 정한 것(자리는 열린 view에 고정, sidebar panel은 모든 workspace에, tray 값은 `@lophn/cap-notify`)은 그 README에 있다.
배경 문서: `project-docs/architecture/extension.md`, `project-docs/architecture/workspace-layout.md`, `project-docs/architecture/workflow.md`, `project-docs/architecture/acp.md`, `project-docs/architecture/app-notice.md`, `project-docs/products/roadmap/agent-platform.md`(정한 것 1), `project-docs/products/roadmap/workflow.md`(activity bar), `/home/pyosechang/projects/harness-lab/extension-systems-report.md`(Claude Code mod와 dsh plugin 비교).

## 사람의 말 (원문, 2026-11-07)

> 바로 extension!
> 지금 extension이 있긴한데 근데 그건 extension 느낌이라기보다는 추가 의존성? 번들 ? 같은 느낌이라서
> 다른 multi harness에서는 막 git worktree 나 그런 것들을 보여주는데 오른쪽 사이드 바에다가 그런 것들을 extension으로 사용자가 직접 만들고 쓸 수 있게하려는 목적
> acp, a2a 등등 프로토콜과 sdk로 만들 수 있게하면 좋을 듯
> 아마 우리 workflow도 extension 식으로 리팩터링해서 공식 extension으로 둘 수도 있을 것 같고 이건 core로직하고 얼마나 그거한 지를 봐야할 것 같은데

> 그리고 우리 메인화면 밑에 그 여백을 넓혀서 그걸 작업 표시줄로 쓸까도 고민 중이야
> 왜냐하면 일단 생각보다 floated, minimized해서 쓰는 게 현재는 desk인데 전역적으로 써야하는 것들도 많기도하고
> 그리고 tray 기능도 넣고 싶거든 (Masup float 화면) 내 구독 usage 보여주는 앱 pannel인데 이걸 크기를 줄여서 고정해두고 쓰는데 이럴 바에 tray 전용 header랑 그런 훅들을 마련하는 게 더 좋을 거 같다라는 생각
> 근데 작업 표시줄 layout을 설정에서 toggle 하는 것도 좋을 거 같고

> 아니 OS tray를 말하는 게 아니라 내 앱에서 tray가 필요하다는 말이라니까?

> float도 전역이필요하다니까? 그리고 내가 궁금한 거는 full pannel card가 앱 마다 하나로 고정이야? 앱 내에서도 부분들이나 그런 것들 정할 수 있나? 반응형으로 정해지기도 하나? 이 체계부터 좀 어떻게 해봐야 할 것 같은데

> 좋은 것 같아 extension이라는 걸 굳이 두지 않고도 우리 기존의 앱 개념으로 처리 가능하고 자리랑 hook만 추가로 만들면 된다는 거 아녀

> Masup 같은 것도 내가 여러 프로젝트에서 바이브코딩하면서 열어두고싶잖아
> 근데 workspace마다 다 따로 켜놔야한다는 게 불편한거야
> minimized 상태도 같이 이제 전역적으로 보관되어야하고

## 왜

- 지금 extension은 shell main에서 Node 권한으로 도는 기능 묶음이다(harness, harness-gui). shell 화면에는 아무것도 꽂지 못한다. 사람이 원하는 것은 다른 multi harness처럼 오른쪽 sidebar에 git worktree 같은 panel을 직접 만들어 꽂는 것이다.
- 늘 보고 싶은 작은 앱(Masup, 구독 사용량)을 지금은 app panel을 float로 줄이고 pin해서 쓴다. 그런데 float는 desk 하나에 묶여 있어서 desk를 바꾸면 사라진다. 전역 float와, lophn 창 안의 작업 표시줄·tray가 필요하다.
- 앱 화면을 어디에 띄울지 정하는 체계(`full | panel | card`)가 "크기"라는 이름으로 "자리"를 정한다. 그래서 자리가 늘 때마다 enum이 는다. 앱 안의 한 부분을 인자로 열지 못하고, 앱은 자기가 어느 자리에 떠 있는지 모른다. sidebar와 tray를 더하기 전에 이 체계부터 고친다(사람, 2026-11-07).

## 지금 코드 (main `fec90820a`)

### 앱 화면 체계

- 선언의 `screens[]`는 여럿일 수 있다. 화면 하나는 `ScreenDeclaration {key, label, path, sizes}`이고 `ScreenSize = "full" | "panel" | "card"`다(`packages/protocol/apps/declaration/types.ts`). `sizes`는 그 화면이 나갈 수 있는 자리 목록이다.

  | size | 나가는 곳 | 몇 개가 쓰이나, 누가 고르나 | code |
  |---|---|---|---|
  | `full` | 앱 workspace 본문, 앱 전용 창 | `full`을 가진 첫 화면 하나만 쓰인다 | `createEntryScreen`(`packages/shell/main/app-frame/declaration-source.ts`), `entryScreen`(`packages/shell/renderer/apps/core-source.ts`) |
  | `panel` | project의 app panel 탭(dock·float) | 여럿이고 사람이 picker로 고른다 | `panelScreens`(`packages/shell/renderer/workspace/app-panel-tab.tsx`) |
  | `card` | 채팅 안 앱 card | 여럿이고 agent가 `app_card {app, view}`로 key를 고른다 | `packages/core/apps/agent-tools/visual.ts`, `app-card.ts` |

- 화면에 인자를 넘기는 길이 없다. card도 `{app, view}`뿐이다. 그래서 "Mahas의 세션 하나"처럼 앱 안의 한 부분을 열지 못한다.
- 앱 화면은 자기가 어느 자리에 떠 있는지 모른다. size는 main registry의 view target에만 있다(`packages/shell/main/app-frame/view-model.ts`). bridge(`packages/protocol/shell/app-bridge-types.ts`의 `callOperation`, `openExternal`, `agent`, `setTabHead`, `onTabHead`)에는 없다.
  - 아는 것은 `useTabHead`가 돌려주는 "lophn 탭 머리 줄이 있나" 하나뿐이다.
  - 크기에 반응하는 것은 앱 CSS가 `<webview>` 폭에 media query로 맞추는 것뿐이다. lophn이 크기를 보고 화면을 바꿔 주지 않는다.
- 사람의 앱 Mahas와 Masup은 `~/.lophn`에 있고 이 선언을 쓴다(`project-docs/products/roadmap/command-surface.md`).

### extension

- 계약은 `packages/protocol/extensions/`(3 file, 193줄)에 있다. registry는 `packages/shell/main/extensions/registry.ts`(355줄), 조립은 `packages/shell/main/desktop/wiring/extensions.ts`(416줄)다.
- 묶음은 둘이다(`packages/shell/main/extensions/bundled/`).
  - `harness`: 약 360줄.
  - `harness-gui`: fixture를 포함해 약 19k줄.
- `ExtensionContext`는 `{core, settings, spawn, acp, clock, ids, files}`다. 화면에 panel, sidebar, 상태 항목, 명령을 꽂는 길은 없다. manifest의 `provides`는 Settings 목록에 보이기만 한다.
- harness-gui의 화면은 extension 폴더 밖 shell 코드가 그린다. 그 extension 하나에 묶인 shell 코드가 약 1.5k줄이다(`packages/shell/renderer/terminal/terminal-gui.tsx` 526줄, `packages/shell/main/terminal/gui.ts` 477줄 등).
- `PRODUCT.md` 2절: "다른 software의 extension처럼 쓰지만, lophn이 따로 extension이라는 개념을 두는 것은 아니다."

### shell 화면 자리

- 모든 workspace 창과 Settings가 `ShellFrame`(`packages/shell/renderer/shell/shell-frame.tsx`) 하나를 쓴다. 자리는 title bar, 왼쪽 sidebar, stage, 오른쪽 sidebar, float 층이다.
- 아래 여백은 bar가 아니다. `shell-frame.module.css`의 `.stage { padding-block-end: var(--space-6) }`(16px)일 뿐이다.
- 오른쪽 sidebar의 panel 목록은 workspace 종류마다 함수에 하드코딩돼 있다.

  | workspace | 함수와 file | panel |
  |---|---|---|
  | project | `panelTabs(withJobs)`, `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx` | explorer, artifact, workflow, jobs |
  | home | `homePanelTabs`, `home-panel.tsx` | workspaces, jobs |
  | 앱 | `appPanelTabs()`, `app-panel.tsx` | logs |

  - 본문은 `tab === "x" ? <X/> : null` 사슬로 고른다.
  - 고른 panel은 `packages/shell/renderer/workspace/workspace-window.tsx`의 `useState`이고 저장되지 않는다.
  - 틀인 `RightSidebar`(`packages/shell/renderer/shell/right-sidebar.tsx`)는 범용이다.
- float(`FloatTab {tab, rect, minimized, pinned}`, `packages/shell/renderer/shell/desk-model.ts`)는 desk마다 따로 있고, workspace layout 파일(`<data>/shell/workspaces/<workspace>.json`)에 저장된다.
  - 접힌 float는 `tab-strip.tsx`의 tab 줄 끝에 chip으로 보인다(4개까지, 나머지는 "+N").
  - pin은 "늘 위"라는 뜻이다. desk를 넘는다는 뜻이 아니다.
  - desk와 workspace를 넘어 전역인 layout 값은 `shell.quick_launch`, `shell.app_launch`, 창 bounds뿐이다.
- OS tray(`packages/shell/main/desktop/tray.ts`, 메뉴 Home·start at login·Quit)는 이 일과 다르다(정한 것 1).

### workflow와 core의 결합

- core: `packages/core/workflows/`(13 file, 2051줄)와 `packages/core/main/daemon/wiring/workflows.ts`(478줄)다. ledger 표 `workflow_instances`와 `workflow_lines`(schema step `workflows.tables`)가 있다.
- core 다른 곳에 엮여 있다.
  - router의 input kind `step`이 `ApplyWorkflowChange`와 한 transaction으로 돈다.
  - job action `workflow_start`(`packages/protocol/jobs/values.ts`)가 `workflowService.start`를 process 안에서 부른다.
  - 앱의 flow caller credential(`packages/core/apps/calls/caller.ts`)이 있다.
  - artifact source kind `workflow`가 있다.
- shell: `packages/shell/renderer/workflow/`, workflow 탭 kind, Workflows sidebar panel이 13 file 1795줄이다. desk model에 `Desk.workflow?`가 있다.

### protocol

- ACP(App Context Protocol)와 A2A는 lophn 자체 규격이다(`agent-platform.md` 정한 것 1).
  - ACP는 대화를 나른다(`architecture/acp.md`).
  - A2A는 agent 사이 call과 명함이다(`architecture/agent-call.md`).
  - 둘 다 화면 자리에 UI를 꽂는 것은 나르지 않는다.
- MCP는 client만 있다(`packages/core/lophn-agent/extensions/`).

## 무엇을 만드나

### 1. 앱 화면 체계: 화면과 자리를 나눈다

- **화면**은 앱의 한 부분이다: `{key, label, path, places[], params?}`.
  - `params`는 그 화면을 열 때 받는 인자의 schema다(`InputSchema`). 예를 들어 Mahas `session` 화면은 `{harness, session}`을 받는다.
  - 화면을 여는 곳은 모두 인자를 넘길 수 있다. agent의 `app_card {app, view, params}`, 앱 화면 안 link, 탭 열기가 그렇다.
- **자리**는 lophn이 정한다: `tab`(지금 `full`), `panel`(dock·float), `card`, `sidebar`, `tray`. 화면은 나갈 수 있는 자리를 `places`에 적는다. 이름이 크기에서 자리로 바뀐다(`sizes` → `places`).
- **화면은 지금 자리를 안다.** bridge가 `{place, params, workspace}`를 준다. 자리는 열릴 때 정해지고 바뀌지 않는다(dock, desk float, 전역 float 모두 `panel`). `@lophn/app-ui`에 `usePlace()`를 둔다.
- **크기 반응은 앱 CSS가 한다.** `<webview>` 폭에 container·media query로 맞춘다. lophn은 크기 bucket을 정하지 않는다. float는 사람이 늘이고 줄이므로 크기가 정해진 자리가 아니다.
- 앱 workspace 본문은 `tab` 자리를 가진 첫 화면으로 그대로 연다. 다른 화면은 인자와 함께 탭으로 연다.
- 앱이 화면으로 선언한 부분은 그 화면이 적은 어느 자리에서든 따로 연다. 예: Mahas의 `sessions`(세션 검색) 화면이 `places: [tab, panel, sidebar]`, `params: {query?}`면 전역 float, project sidebar, 앱 workspace의 탭 어디서든 그 화면만 연다. 화면으로 선언하지 않은 부분(한 화면 안의 검색 칸 하나)은 lophn이 잘라 내지 않는다. 앱 agent가 화면으로 나눈다.
- 정석과 맞춘다.
  - OpenAI Apps SDK: host가 widget에 지금 display mode(inline, pip, fullscreen)와 tool 입력·결과를 넘기고, 같은 code가 맞춰 그린다.
  - Apple WidgetKit: 앱이 지원 family를 선언하고 지금 family를 읽는다.
  - 둘 다 "앱이 자리를 선언하고, host가 지금 자리와 data를 알려 주고, 같은 code가 맞춰 그린다"는 꼴이다.
- 바뀌는 계약: 선언 schema(`packages/protocol/apps/declaration/`), `@lophn/declaration`, `app_card` 입력, bridge type.
  - 쓰는 쪽(main registry, renderer picker, core activation `desired.ts`, `design-app` skill)을 같은 변경에서 고친다.
  - 사람의 `~/.lophn` 앱 선언(Mahas, Masup)과 저장된 release 선언은 migration으로 옮긴다(AGENTS.md "호환성").

### 2. 화면 자리(slot)를 등록으로 연다

- 오른쪽 sidebar의 내장 panel(explorer, artifact, workflow, jobs, workspaces, logs)을 하드코딩 함수에서 등록으로 옮긴다. `roadmap/workflow.md`의 "sidebar를 activity bar로"를 같이 한다.
- 앱의 `sidebar` 화면은 모든 workspace 종류(project, home, 앱)의 sidebar에 나온다. 화면이 지금 workspace를 보고 맞춘다. shell은 그 화면에 지금 workspace를 준다(project라면 폴더 경로). git worktree 앱은 그 경로로 `git worktree list`를 돌린다. 앱 process는 권한을 막지 않는다(`packages/sdk/cap-fs/guide.md`).
- 설치된 앱의 sidebar와 tray 기여는 사람이 켜야 나온다. 지금 QuickLaunch에 app panel을 pin하는 것과 같은 자리다(`shell.quick_launch`).

### 3. 전역 float, 작업 표시줄, tray

- **전역 float**: float에 desk float와 전역 float 두 범위를 둔다.
  - 전역 float는 workspace 창에 산다. 그 창에서 desk와 workspace를 바꿔도 남는다(정한 것 10).
  - 자리(rect), 접힘(minimized), pin을 workspace layout 파일 밖 전역 한 곳에 저장한다. 어느 workspace에서 접어도 다른 workspace에서 접힌 채 보이고, lophn을 다시 켜도 그대로다(정한 것 11).
  - workspace를 옮길 때 전역 float의 `<webview>`는 다시 load되지 않는다. 지금 `WorkspaceWindow`가 workspace마다 새로 mount되므로 전역 float 층은 그 밖(창 하나에 하나)에 둔다.
- **작업 표시줄**: `.stage` 아래 16px 여백 자리에 bar를 둔다.
  - 왼쪽에는 접힌 float chip을 둔다(`tab-strip.tsx`에서 옮긴다). 전역 float는 늘 보이고, desk float는 그 desk의 것만 보인다.
  - 오른쪽에는 tray를 둔다.
  - 설정 `shell.taskbar`(boolean)로 켜고 끈다. 끄면 지금 모양으로 돌아간다: chip은 tab 줄 끝에, tray 항목은 title bar 오른쪽 icon으로 간다.
- **tray**:
  - 항목은 data다: 앱 icon, 짧은 글(예: `84%`), tone. 앱이 화면에서도, 앱 process에서도 SDK로 바꾸고, shell은 마지막 값을 보인다. 이것이 사람이 말한 "tray 전용 header와 hook"이다.
  - 항목을 누르면 작업 표시줄 위에 그 앱의 `tray` 자리 화면이 popup으로 뜬다.
  - tray는 전역이다.

## 정한 것

1. tray는 lophn 창 안의 것이다. OS tray(`tray.ts`)에 앱 내용을 꽂는 것이 아니다(사람, 2026-11-07).
2. float에도 전역 범위가 있다(사람, 2026-11-07).
3. 앱 화면 체계를 sidebar·tray보다 먼저 고친다. 화면은 인자를 받는 앱의 부분이고, 자리는 lophn이 정하고, 화면은 지금 자리를 알고, 크기는 앱 CSS가 맞춘다(사람, 2026-11-07, 위 1).
4. extension이라는 사용자 개념을 따로 두지 않는다. 사용자가 만드는 sidebar panel, tray, 전역 float는 앱이 채우고, lophn은 자리와 hook만 더한다(사람, 2026-11-07). `PRODUCT.md` 2절("lophn이 따로 extension이라는 개념을 두는 것은 아니다")과 맞아 PRODUCT를 고치지 않는다. 지금 extension 묶음(harness, harness-gui)은 Node 권한이 필요한 공식 기능 묶음으로 남고 이름도 그대로 둔다.
5. 새 protocol을 만들지 않는다(agent). ACP와 A2A는 대화와 agent call을 나르는 lophn 규격이다. 화면 자리는 앱 선언과 `@lophn/app-ui`로 연다.
6. workflow engine은 core에 둔다(agent). 표, router `step`, job `workflow_start`, flow caller credential이 core 여러 곳과 한 transaction으로 엮여 있다. 화면 쪽(Workflows panel)만 slot의 첫 내장 사용자로 옮긴다. "공식 extension"이라고 부르지 않는다.
7. tray 항목 내용은 data이고 popup만 화면이다(agent). 항목마다 늘 떠 있는 `<webview>`를 두지 않는다. Claude Code mod의 `$.ui.status(text)`와 같은 꼴이다.
8. 크기 bucket을 두지 않는다(agent). 앱이 아는 것은 자리와 인자이고, 크기는 앱 CSS가 `<webview>` 폭에 맞춘다. float가 사람 손으로 크기가 바뀌는 자리라 bucket이 맞지 않는다.
9. 작업 표시줄은 설정 toggle `shell.taskbar`로 켜고 끈다. 기본은 켬이다(agent).
10. 전역 float는 workspace 창에 산다(agent). 창 하나가 한 번에 workspace 하나를 보이고 왼쪽 sidebar로 옮긴다(`architecture/workspace-layout.md`). 그 밖의 창은 detached 탭 창과 앱 전용 창뿐이고 둘 다 탭이나 앱 하나만 든 창이다(`recentWindow`, `packages/shell/main/desktop/wiring/desktop-window.ts`). 그래서 전역 float는 그 창에서 desk와 workspace를 바꿔도 남고, detached 창과 앱 전용 창에는 뜨지 않는다. 사람이 원한 것도 이것이다: 여러 project를 오가며 Masup을 workspace마다 따로 켜지 않는다(사람, 2026-11-07).
11. 전역 float의 접힘 상태도 전역으로 보관한다(사람, 2026-11-07). rect와 pin도 같이 둔다(agent).

## 단계

1. 앱 화면 체계: `places`, `params`, bridge의 지금 자리, `usePlace()`, `app_card` 인자, migration.
2. slot 등록: 오른쪽 sidebar 내장 panel을 등록으로 옮기고 activity bar를 둔다. 앱 `sidebar` 자리를 연다.
3. 전역 float, 작업 표시줄(`shell.taskbar`), tray 항목 SDK와 popup.
4. 사람의 앱 Masup을 tray로 옮기고, git worktree 앱을 짓는다. 이것은 앱 일이다.

## 끝남 기준

- 사람이 Masup을 tray에서 본다. 어느 desk와 workspace에서든 같다.
- 사람이 전역 float로 띄운 앱 panel이 desk와 workspace를 바꿔도 다시 load되지 않고 남는다. 한 workspace에서 접으면 다른 workspace에서도 접혀 있고, lophn을 다시 켜도 그대로다.
- agent가 Mahas의 세션 하나를 인자로 넘긴 card로 보인다.
- agent가 지은 git worktree 앱이 project 오른쪽 sidebar panel로 나오고, 그 project의 worktree를 보인다.

## 하지 않는 것

- OS tray에 앱 내용을 꽂기.
- 남이 만든 extension을 내려받는 장터(`PRODUCT.md` 5절 앱 마켓).
- Claude Code mod 같은 engine hook(agent loop, tool call, prompt 조립을 가로채기). 사람이 말하지 않았고 쓰는 곳이 없다.
- workflow engine을 core 밖으로 옮기기(정한 것 6).
- extension 묶음의 `ExtensionContext`에 화면 기여 API를 더하기. 쓰는 곳이 없다(harness-gui는 터미널 탭을 쓴다).
- 크기 bucket(small, medium, large)을 정하기(정한 것 8).
- extension이라는 사용자 개념(manifest `contributes`, 자기 code)을 새로 두기(정한 것 4).
