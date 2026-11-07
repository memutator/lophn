# shell-sidebar-slots

오른쪽 sidebar의 panel 목록을 workspace 종류마다 하드코딩한 함수에서 등록 목록 하나로 옮긴다. 사람이 켠 앱의 `sidebar` 화면이 같은 목록에 panel로 더해진다. git worktree 같은 앱이 project 오른쪽 sidebar에 나온다.

- 단위: shell (wave 3)
- 선행: place-params, shell-taskbar
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/**`
  - `packages/shell/renderer/shell/panel-tabs.tsx`, `packages/shell/renderer/shell/right-sidebar.tsx`와 그 CSS
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `packages/shell/renderer/desktop/settings/quick-launch/**`
  - `packages/shell/renderer/workspace/project-settings/quick-launch-editor.tsx`
  - `packages/core/config/shell-settings.ts` (`shell.sidebar_panels` 선언만)
  - `packages/design/i18n/catalog/{project.ts,workspace-settings.ts,shell.ts,app-space.ts,workflow.ts}` (sidebar·설정 문구만)
  - `tools/wireframes/pages/screens/**`, `tools/wireframes/mock/**` (sidebar page만)
- 읽을 것:
  - 계획: `project-docs/plan/app-place/README.md`의 정한 것 4, 11
  - roadmap: `project-docs/products/roadmap/app-place.md`의 "2. 화면 자리(slot)를 등록으로 연다"
  - architecture: `project-docs/architecture/workspace-layout.md`의 오른쪽 sidebar, QuickLaunch 절
  - 지금 길:
    - `workspace-window.tsx`가 `panel`을 `useState`로 둔다(project 기본 `explorer`, Home `workspaces`, 앱 `logs`). `setPanel("explorer")`를 부르는 reveal 흐름이 두 곳 있다.
    - `ShellFrame`의 `panelTabs` prop은 `homePanelTabs`, `appPanelTabs`, `panelTabs` 셋 중 하나이고, `rightSidebar` prop은 `AppWorkspacePanel`, `HomePanel`, `ProjectPanel` 셋 중 하나다.
    - `project-sidebar.tsx`의 `panelTabs`, `SidebarTab`, `ProjectPanel`. `home-panel.tsx`의 `homePanelTabs`, `HomePanel`. `app-panel.tsx`의 `appPanelTabs`, `AppWorkspacePanel`.
    - `panel-tabs.tsx`의 `PanelTab {key, label, icon}`과 `right-sidebar.tsx`의 `RightSidebar`.
    - 앱 view 그리기: `app-panel-tab.tsx`, `EmbeddedView`(wave 2가 `place`, `params`, `workspace`를 받게 했다).
    - 설정: `quick-launch/store.tsx`의 `QuickPrefs`. Settings › Quick launch pane(`quick-launch-panel.tsx`)과 `AppPanelList`.
- 계약:
  - 쓰는 것: `EmbeddedView`의 `place`, `workspace`(wave 2), 앱 화면 목록 read(`useScreensRead`, `places`)
  - 내놓는 것: 설정 `shell.sidebar_panels: {app, screen}[]`(최대 20, 기본 빈 목록)

## 할 일

1. **등록 목록** (`renderer/workspace/sidebar/`)
   - panel 하나를 `{key, label, icon, kinds: ("project"|"home"|"app")[], render(ctx)}`로 적는 목록을 둔다. 내장 panel(explorer, artifact, workflow, jobs, workspaces, logs)을 그 목록으로 옮긴다.
   - jobs처럼 조건이 있는 panel은 `render`나 조건 칸으로 둔다.
   - `workspace-window.tsx`의 세 갈래(`panelTabs` prop과 `rightSidebar` prop)를 "지금 workspace 종류로 목록을 걸러 고른 key의 `render`"로 바꾼다. 기본 panel과 reveal 흐름(`setPanel("explorer")`)은 그대로 동작한다.
   - 쓰지 않게 된 `panelTabs`, `homePanelTabs`, `appPanelTabs`와 세 갈래를 지운다.
2. **앱 sidebar panel**
   - 설정 `shell.sidebar_panels`에 든 `{app, screen}` 가운데 지금 설치돼 있고 그 화면 `places`에 `sidebar`가 있는 것을 목록 끝에 더한다. 모든 workspace 종류에 나온다(정한 것 4).
   - key는 `app:<app>:<screen>`, 아이콘은 앱 아이콘이고 label은 화면 label이다.
   - 본문은 `RightSidebar` 안의 `EmbeddedView`다(`place: "sidebar"`, 지금 workspace를 넘긴다). sidebar 폭을 바꾸거나 panel을 오가도 page가 다시 load되지 않게 keep key를 쓴다.
   - 앱이 지워졌거나 화면이 없어지면 그 panel은 보이지 않는다.
3. **켜기**
   - Settings › Quick launch pane에 "Sidebar panels" 묶음을 더한다. `sidebar` 자리를 가진 앱 화면마다 줄 하나와 Switch다. `AppPanelList` 꼴을 따른다.
   - 켜면 `shell.sidebar_panels`에 더하고 끄면 뺀다.
   - project settings의 quick launch 덮어쓰기와는 상관없는 전역 값이다.
4. **gallery**: project 창 오른쪽 sidebar에 앱 panel 하나가 켜진 page(id `shell-sidebar-app-panel`)를 더한다. 앱 화면 자리는 기존 앱 view mock을 쓴다.
5. 문구는 i18n catalog에 둔다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`와 `npm run wireframes`가 된다.
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn "homePanelTabs\|appPanelTabs\|function panelTabs" packages/shell tools`가 0줄이다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
