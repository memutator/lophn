# UI overhaul: 하나의 shell

- 목표: launcher·project·app·settings로 나뉜 공간과 activity bar·pane grid를 지우고, 모든 workspace(Home, project, app)가 같은 shell 하나를 쓰게 한다. 모양의 기준은 gallery Screens › Shell의 `shell-*` page(실제 shell을 그린다)다. 처음 그린 Drafts 초안(`draft-shell-*`)은 지웠다.
- branch: `ui/overhaul`(worktree `.claude/worktrees/ui-overhaul`). task는 이 branch에서 갈라 끝나면 여기로 합친다. 모든 task가 이 branch에 합쳐졌다. main에는 사람의 Electron 확인(아래 "남은 것") 뒤에 사람에게 묻고 올린다.

## 모양 (정한 것)

| 자리 | 무엇 |
|---|---|
| title bar | 왼쪽: sidebar 접기, lophn 표지, desk 단추(project만, 구역 오른쪽 끝). 가운데: tab 줄(고른 tab은 card와 곡선으로 이어지고 이름이 다 보인다. 고르지 않은 group 칸은 아이콘만), 끝에 + menu, 오른쪽 끝에 접힌 float 아이콘 칸. 오른쪽: 오른쪽 panel icon tab, sidebar 접기, 창 단추. 검색 단추는 없다(Ctrl+K) |
| 왼쪽 sidebar | 위: New session(▾로 lophn agent·coding agent 고르기), Inbox·Jobs(줄 옆에 열리는 overlay, 머리의 [Open in tab]이 탭을 연다). Workspaces: workspace마다 열린 session과 사람 차례인 workflow desk, Recent는 workspace마다 접힌 줄 하나. 아래: 빠른 실행(Terminal · Browser · App ▾ · Search)과 Settings |
| 가운데 | 둥근 card 하나(둘레 16px 여백). tab 하나 또는 group(2~4칸)을 그린다. 칸마다 머리 줄: ← →(이동 기록), 경로, 상태, ⋯(tab 메뉴). browser·file·agent·artifact 탭은 자기 머리 줄을 따로 그리지 않고 이 머리 줄에 올린다(`useCardHead`) |
| 오른쪽 sidebar | project: Files(root 고르기), Domain, Artifacts, Workflows, Jobs. Home: Workspaces(project·app 목록, archived, register·create), Jobs. app: App(Icon·Folders·Version·Access·Activity), Domain, Logs |
| Settings | 같은 shell. 왼쪽 sidebar가 Settings 항목, tab 줄에 Settings tab 하나, 오른쪽 sidebar 없음. Jobs는 Settings에 없다 |

## 정한 것 (agent)

- **desk**: 이름은 그대로 desk, 기본 desk 문구는 `Main`. desk는 사람이 만든 것(New desk, 이름 바꾸기, 닫기)과 workflow desk 둘이다. desk 하나가 tab 줄, group, float, detached를 통째로 가진다. 사람이 만든 desk의 x는 그 일을 끝내는 것이다: 확인 dialog 뒤에 그 desk의 tab·float·창을 보통 닫기 길로 닫고(터미널은 멈추고, 저장 안 된 파일은 묻는다) desk를 지운다. 탭을 Main으로 옮기지 않는다. 사라진 workflow desk만 Main에 합친다.
- **session 열기**: 옆에서 session을 누르면 그 session tab이 열린 desk로 간다. 어디에도 없으면 지금 desk에 tab으로 연다. 다른 workspace의 session이면 그 workspace로 옮긴 뒤 같은 규칙이다.
- **split → group**: 처음 정한 "tab 둘을 붙인 split tab"은 버렸다. desk의 tab 2~4개를 한 칸(group)으로 묶고 배치는 나눔 tree(row·column, 몫 0.15~0.85)다. 칸마다 머리 줄이 있고 tab 줄은 하나다. 만들기: tab menu의 Split right·down, `pane.split`, tab을 끌어 card 가장자리에 놓기(pointer drag, drop zone). 칸이 가득(4)이면 가장자리 drop은 안 된다. 6칸 tree, 칸마다의 tab 줄, 옛 칸 focus·drop zone은 지운다. 칸 focus는 Ctrl+Alt+화살표(`pane.focus-*`)와 `pane.focus:N`이다.
- **이동 기록**: ← →는 창 하나의 기록(workspace, desk, tab, group 안 focus)을 오간다. 저장하지 않는다.
- **창**: 창은 여럿일 수 있고 창마다 지금 workspace 하나를 보인다. workspace를 옮기는 것은 창 안의 이동이다. 떼어 낸 창(detach)은 project만 하고, 그 project를 보이는 창이 주인이다.
- **layout 저장**: workspace마다 file 하나 `<data>/shell/workspaces/<workspace>.json`(project id, app id, `home`). schema v8의 desk는 `{ tabs, selected, groups: [{layout, focus}], floats, detached }`. 없으면 기본 layout(빈 Main desk)이다. 옛 `<data>/shell/layouts/<project>.json`(v5~v7)은 읽지 않고 올리지도 않는다(사람이 결정: 이미 지웠고 새로 시작한다). `rail_apps`와 app의 localStorage `lophn.app-layout.<app>`도 읽지 않는다.
- **Home**: folder가 없다(`workspace === null`). 터미널·Files·검색·project settings가 없다. launcher 화면은 없어졌고 Home이 새 기본 창의 첫 화면이다. 최근 Home session은 왼쪽 sidebar의 Home 묶음이 하고, register·create·archived는 오른쪽 Workspaces panel이 한다.
- **Jobs**: Settings의 Scheduled jobs 항목을 지우고 왼쪽 sidebar의 Jobs overlay, Jobs 탭(모든 workspace), 오른쪽 Jobs panel로 옮겼다. 대기 목록도 Inbox overlay와 Inbox 탭이다.
- **둥근 모서리와 webview**: 앱 화면·browser·artifact `<webview>`는 slot 부모로 잘리지 않으므로 webview host의 page 요소가 아래 두 모서리에 radius를 준다. native view(browser popup, DevTools, overlay)는 각진 채다. `FloatPanel`도 둥글다.
- **디자인 시스템**: radius를 키우고(xs 6, sm 8, md 10, lg 14, xl 20), shell 바탕 token `color.surface.shell`(light는 subtle, dark는 floor)을 더했다. background preset 셋(warm, neutral, cool)에도 같은 token이 있다.

## 단계

`uo-docs`를 뺀 모두 `ui/overhaul`에 합쳤다.

| wave | task | 하는 일 | 상태 |
|---|---|---|---|
| 1 | `uo-design` | token(radius, `surface.shell`), preset, design component 모양, kit, `architecture/appearance.md` | 합침 |
| 1 | `uo-model` | 새 desk model(순수 함수, test), workspace layout 저장(v8, IPC `shell:workspace-layout-read/save`) | 합침 |
| 2 | `uo-shell-frame` | shell 화면 부품(frame, title bar tab 줄, desk 단추, panel tab, card, float layer, 창 단추), gallery `shell-*` | 합침 |
| 2 | `uo-shell-project` | project 창을 새 shell과 desk model로(옛 panes·floats·minimized·desk selector 지움) | 합침 |
| 3 | `uo-left` | 왼쪽 sidebar(workspace·session·Recent·New session·Add workspace) | 합침 |
| 3 | `uo-right` | 오른쪽 sidebar chrome, panel 모양, Home Workspaces panel | 합침 |
| 3 | `uo-settings` | Settings를 shell 안으로 | 합침 |
| 3 | `uo-tabs` | 잃은 tab 기능(우클릭 메뉴, 이름 바꾸기, Close others, 저장 안 됨 점, preview, 파일 끌어 놓기), 옛 tab strip 지움 | 합침 |
| 4 | `uo-home` | Home workspace를 shell로(launcher 대신, Workspaces panel, Home layout `home`) | 합침 |
| 4 | `uo-app` | app workspace를 shell로(앱 화면 tab, App panel, webview radius), 떼어 낸 창 주인 규칙 | 합침 |
| 5 | `uo-cleanup` | 옛 launcher, app side panel, 안 쓰는 keybinding·icon·i18n·CSS, 옛 layout IPC 쓰기 길, top-path 지움. launcher를 home으로 이름 바꿈 | 합침 |
| 6 | `uo-fb-frame` | 사람 피드백: title bar 순서(desk 단추를 왼쪽 구역 오른쪽 끝으로), 검색 단추 삭제, sidebar 폭 손잡이, 창 단추 안 줄어듦, Files root 고르기를 panel 머리로, FloatPanel 강조 막대 삭제 | 합침 |
| 6 | `uo-fb-split` | split 방향·몫과 끌어 바꾸는 나누는 선, desk 이름 바꾸기·지우기, 안쪽으로 열리는 menu | 합침 |
| 6 | `uo-fb-overlays` | 왼쪽 sidebar의 Jobs·Inbox overlay와 [Open in tab], Jobs·Inbox 탭, Settings에서 Scheduled jobs 삭제 | 합침 |
| 6 | `uo-fb-tabs` | 고른 tab은 이름이 다 보이고 고르지 않은 split 칸은 아이콘만, 곡선 padding까지 scroll-into-view | 합침 |
| 6 | `uo-fb-quick` | 왼쪽 sidebar 아래 빠른 실행(Terminal, Browser, App ▾) | 합침 |
| 6 | `uo-fb-browser` | browser 탭이 card 머리 줄을 쓴다(nav, address, actions), DevTools는 tab menu의 Inspector, 빠른 실행 Search | 합침 |
| 6 | `uo-layout` | 자유 split: group(2~4 tab)과 나눔 tree, 평평한 absolute 칸 | 합침 |
| 6 | `uo-fb-heads` | file·agent·artifact 탭의 머리 줄을 card 머리 줄로(`useCardHead`) | 합침 |
| 6 | `uo-dnd` | pointer drag and drop: 알약, 줄 밀리기, card drop zone(split·swap·ungroup), drag 중 webview 통과 | 합침 |
| 6 | `uo-polish` | 고른 칸만 제목을 크게, desk 닫기가 일을 끝내기, Ctrl+Alt+화살표 칸 focus, card 여백 | 합침 |
| 7 | `uo-docs` | gallery 초안 삭제, architecture 문서 정리, plan, changelog | 진행 |

## 끝남

- `npm run check` 통과.
- 위험 test: desk model의 모든 동작(열기, 닫기, split·group, float, dock, desk 옮기기·지우기·합치기)이 tab을 잃거나 둘로 만들지 않는다(`desk-model_test.ts`).
- 사람의 Electron 확인은 아직이다. 아래 "남은 것"의 첫 항목을 끝내야 main에 올린다.

## 남은 것

실제 Electron 조작(`npm run dev:mock`)은 자동 test와 gallery로만 봤고 사람이 아직 직접 하지 않았다. 올리기 전에 볼 것:

- layout 저장·복원.
- detached 창: Detach, Dock, ×, desk를 바꿀 때 숨기기·다시 열기, 같은 실행의 terminal 다시 붙기.
- webview(앱·artifact·browser)의 아래 모서리 radius와 잘림, group 안의 안쪽 모서리.
- 탭을 끌 때 `<webview>` 위를 지나도 놓을 자리가 보이는지(pointer 통과), Esc 취소.
- 터미널·저장 안 된 파일이 있는 desk 닫기(확인 dialog, 하나 거절하면 멈춤).
- 앱 release를 바꿀 때 앱 화면 reload.

알고 남긴 것(이슈로 올리지 않은 작은 빈칸):

- detach는 project만 한다. Home과 앱 workspace는 못 뗀다.
- Home에는 터미널이 없다.
- 앱 workspace에 preview 열기·승격 UI가 없다(`products/roadmap/app-preview.md`).
- desk 닫기가 일부 거절되어 멈출 때 toast가 없다(desk가 남은 것으로만 보인다).
- 지운 desk의 닫은 tab은 "닫은 탭 다시 열기" 목록에 없다.
- Ctrl+Alt+화살표(`pane.focus-*`)가 Linux의 작업 공간 전환 키와 겹칠 수 있다. Keyboard 설정에서 바꾼다.
- tab 줄은 끄는 동안 가장자리에서 자동 scroll하지 않는다.
- group 통째로 다른 칸에 끌어 놓을 수 없다(group 칸은 tab 줄 안에서만 옮긴다).
