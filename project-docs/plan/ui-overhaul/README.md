# UI overhaul: 하나의 shell

- 목표: launcher·project·app·settings로 나뉜 공간과 activity bar·pane grid를 지우고, 모든 place(Home, project, app)가 같은 shell 하나를 쓰게 한다. 모양의 기준은 gallery Drafts › Experiments의 `draft-shell-*` page(`tools/wireframes/drafts/shell/`)다.
- branch: `ui/overhaul`(worktree `.claude/worktrees/ui-overhaul`). task는 이 branch에서 갈라 끝나면 여기로 합친다. main에는 다 끝난 뒤 사람에게 묻고 올린다.

## 모양 (정한 것)

| 자리 | 무엇 |
|---|---|
| title bar | 왼쪽: sidebar 접기, lophn, desk 단추(project만), 검색. 가운데: tab 줄(고른 tab은 card와 곡선으로 이어진다), 오른쪽 끝에 접힌 float 아이콘 칸. 오른쪽: 오른쪽 panel icon tab, sidebar 접기, 창 단추 |
| 왼쪽 sidebar | New session(▾로 lophn agent·coding agent 고르기), Inbox, Jobs. Places: place마다 열린 session과 사람 차례인 workflow desk. Recent는 place마다 접힌 줄 하나 |
| 가운데 | 둥근 card 하나. 머리 줄: ← →(이동 기록), 경로, 상태, ⋯(tab 메뉴: Float, Split with next tab/Unsplit, Move to new window, Close) |
| 오른쪽 sidebar | project: Files, Domain, Artifacts, Workflows, Jobs. Home: Places(project·app 목록, archived, register·create), Jobs. app: App(release, preview, domain, grant), Files, Domain, Logs |
| Settings | 같은 shell. 왼쪽 sidebar가 Settings 항목, tab 줄에 Settings tab 하나, 오른쪽 sidebar 없음 |

## 정한 것 (agent)

- **desk**: 이름은 그대로 desk, 기본 desk 문구는 `Main`. desk는 사람이 만든 것(New desk, 이름 바꾸기, 지우기)과 workflow desk 둘이다. desk 하나가 tab 줄, split, float, detached를 통째로 가진다.
- **session 열기**: 옆에서 session을 누르면 그 session tab이 열린 desk로 간다. 어디에도 없으면 지금 desk에 tab으로 연다. 다른 place의 session이면 그 place로 옮긴 뒤 같은 규칙이다.
- **split**: tab 둘을 한 칸으로 붙인 split tab 하나뿐이다. 6칸 tree, 칸마다의 tab 줄, 칸 focus, 칸 drop zone은 지운다.
- **이동 기록**: ← →는 창 하나의 기록(place, desk, tab, split 쪽)을 오간다. 저장하지 않는다.
- **창**: 창은 여럿일 수 있고 창마다 지금 place 하나를 보인다. place를 옮기는 것은 창 안의 이동이다. 떼어 낸 창은 지금처럼 project에 묶이고, 그 project를 보이는 창이 주인이다.
- **layout 저장**: place마다 file 하나 `<data>/shell/places/<place>.json`(project id, app id, `home`). 새 schema(v8)의 desk는 `{ tabs, selected, split: {a, b, focus} | null, floats, detached }`. 없으면 옛 `<data>/shell/layouts/<project>.json`(v5~v7)을 읽어 올린다: 칸들의 tab을 왼쪽·위에서부터 한 줄로 합치고(중복 key는 하나), 선택은 focus 칸의 선택 tab, split은 없음, float의 `origin_pane`·`docked_at`은 버린다. tab을 잃거나 둘로 만들지 않는다(test). `rail_apps`(activity bar에 꽂은 앱)는 activity bar가 없어지므로 버린다. app의 localStorage `lophn.app-layout.<app>`은 읽지 않고 버린다(화면 배치 기본값으로 돌아갈 뿐 data가 아니다).
- **Home**: folder가 없다(`place === null`). 오른쪽 sidebar에 Files를 두지 않는다. launcher의 lophn panel이 하던 일(최근 Home lophn session)은 왼쪽 sidebar의 Home 묶음이 한다. register·create·archived는 Home의 Places panel로 옮긴다.
- **둥근 모서리와 webview**: 앱 화면 `<webview>`는 slot 부모로 잘리지 않으므로 webview host의 page 요소에 radius를 준다. native view(browser popup, DevTools, overlay)는 각진 채로 둔다. `FloatPanel`도 둥글게 바꾸고 각진 이유 주석을 지운다.
- **디자인 시스템**: radius를 키우고(xs 6, sm 8, md 10, lg 14, xl 20), shell 바탕 token `color.surface.shell`(light는 지금 subtle, dark는 지금 floor)을 더한다. background preset 셋(warm, neutral, cool)에도 같은 token을 넣는다.

## 단계

| wave | task | 하는 일 | 상태 |
|---|---|---|---|
| 1 | `uo-design` | token(radius, `surface.shell`), preset, design component 모양, kit, `architecture/appearance.md` | 합침 |
| 1 | `uo-model` | 새 desk model(순수 함수, test), place layout 저장(v8, 옛 v5~v7 올리기, IPC `shell:place-layout-read/save`) | 합침 |
| 2 | `uo-shell-frame` | shell 화면 부품(frame, title bar tab 줄, desk 단추, panel tab, card, float layer, 창 단추), gallery `shell-*` | 합침 |
| 2 | `uo-shell-project` | project 창을 새 shell과 desk model로(옛 panes·floats·minimized·desk selector 지움). 양쪽 sidebar는 임시 | 합침 |
| 3 | `uo-left` | 왼쪽 sidebar(place·session·Recent·New session·Add place) | 진행 |
| 3 | `uo-right` | 오른쪽 sidebar chrome, panel 모양, Home Places panel | 진행 |
| 3 | `uo-settings` | Settings를 shell 안으로 | 진행 |
| 3 | `uo-tabs` | 잃은 tab 기능(우클릭 메뉴, 이름 바꾸기, Close others, 저장 안 됨 점, preview, 파일 끌어 놓기), 옛 tab strip 지움 | 진행 |
| 4 | `uo-home` | Home place를 shell로(launcher 대신, Places panel, Home layout `home`) | |
| 4 | `uo-app` | app place를 shell로(앱 화면 tab, App panel, webview radius), 떼어 낸 창 주인 규칙 | |
| 5 | `uo-cleanup` | 옛 launcher, app side panel, 옛 layout IPC(v5~v7 올리기는 남긴다), 안 쓰는 keybinding, gallery Drafts 지우기, 문서 | |

## 끝남

- `npm run check` 통과, `npm run dev:mock`으로 실제 Electron에서 Home·project·app·Settings를 연다.
- 위험 test: 옛 v7 layout을 올려도 tab을 잃거나 둘로 만들지 않는다. 새 model의 모든 동작(열기, 닫기, split, unsplit, float, dock, desk 옮기기)이 tab을 잃거나 둘로 만들지 않는다.
- 사람의 `~/.lophn/shell/layouts/*.json`은 읽기만 하고 고치지 않는다.
