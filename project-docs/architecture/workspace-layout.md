# workspace layout

workspace 창(Home, project, 앱)이 가진 탭이 어디에 있는가를 정하고 그 배치를 저장하는 메커니즘이다. 사람은 창 하나에서 한 번에 workspace 하나를 보고, 그 workspace의 desk 하나가 탭 줄, 위에 뜬 패널(float), OS 창으로 뗀 탭(detached)을 통째로 가진다. 모든 탭 kind(터미널, 파일, browser, agent, 앱 화면 등)가 같은 길을 쓴다. Home, project, 앱 workspace와 Settings가 shell 틀 하나를 같이 쓴다. 옛 launcher, 앱 공간의 위쪽 바와 side panel, activity bar, 칸마다 탭 줄이 있던 pane tree는 없다.

이 문서는 desk 모델, 저장, float 층(desk float과 전역 float), detached 창, `<webview>` 그릇과 층 순서, 창 틀(title bar, 양쪽 sidebar, card, 작업 표시줄), workspace 종류별 차이(Home, 앱, Settings), 빠른 실행, agent가 연 탭을 다룬다. browser 탭 자체는 `browser-tab.md`, 알림과 tray 값은 `app-notice.md`, 앱 호출은 `app-call.md`가 맡는다.

## 문제

- 사람은 terminal, 파일, browser, agent 대화, 앱 화면을 한 창에서 같이 쓰고 workflow마다 다른 배치를 원한다. 배치(어느 탭이 어디에 있나)가 탭 kind마다, 공간마다 다르면 같은 일이 화면마다 달라지고 규칙이 갈라진다.
- 배치는 사람이 공들여 늘어놓은 화면 상태다. project를 오가거나 앱을 다시 띄워도 이어져야 하고, 저장이 다른 project의 배치를 덮거나 읽지 못한 파일을 덮으면 사람이 시간을 잃는다.
- 탭에는 한 곳에서만 살 수 있는 것이 있다. editor는 session이 둘이면 conflict가 나고 terminal은 입력을 받을 webContents가 하나뿐이다. 탭이 두 자리에 있거나 자리를 옮기다 사라지면 데이터를 잃는다.
- 앱 화면, browser, artifact는 `<webview>`로 그려진다. 이것이 DOM에서 빠지거나 부모를 바꾸면 page가 다시 load되어 쓰던 form과 scroll을 잃는다. 한편 native view는 shell DOM 위에 그려져 menu, popover, 패널, toast가 page 밑에 깔린다.
- agent는 탭을 열 수 있어야 하지만 layout을 가진 곳은 shell이고 core는 layout을 모른다. 그렇다고 사람이 하던 일을 agent가 끊으면(focus를 뺏으면) 안 된다.
- agent가 연 browser page의 수명이 사람이 지금 어느 workspace를 보는가에 묶이면, 사람이 다른 workspace로 간 사이 page가 사라지고 job이나 workflow가 사람 없이 browser를 쓸 수 없다. page를 그리는 `<webview>`는 보이는 창 안에서만 그리므로 창이 하나도 없으면 page도 없다.

## 목표와 비목표

- 목표:
  - 탭의 자리 하나(탭 줄, group, float, detached)와 그 사이의 이동을 한 모델로 정하고, 자리를 옮기는 어떤 길에서도 탭이 사라지거나 둘이 되지 않게 한다.
  - 배치를 workspace마다 저장해 재시작을 넘어 복원한다. 저장은 읽을 때 검증되고 다른 판은 건드리지 않는다. 단 lophn session을 보이는 Agent 탭은 저장하지 않는다(아래 "Agent 탭은 저장하지 않는다"): 앱을 다시 켜거나 창을 다시 열면 sidebar에서 session을 다시 연다.
  - 탭이 사는 동안은 desk를 오가도 page를 다시 load하지 않는다.
  - agent가 연 browser 탭의 page는 그 탭을 든 창이 사는 동안, 그 창이 어느 workspace를 보이든 산다.
  - 같은 shell 틀과 같은 탭 규칙을 Home, project, 앱 workspace가 쓴다.
- 비목표:
  - 칸마다 탭 줄이 있는 pane tree로 돌아가지 않는다. 탭 줄은 하나다.
  - detached 창에 탭 줄이나 탭 여럿을 두지 않는다(그것은 workspace를 하나 더 만드는 일이다).
  - 옛 layout(판 1~7)이나 앱 localStorage 배치를 읽지 않는다.
  - 서로 다른 desk의 탭을 빼앗아 합치지 않는다.
  - `<webview>` 탭을 다시 load 없이 창 사이로 옮기지 않는다(Electron이 못 한다).

## 모델

### workspace, desk, 탭의 자리

layout은 workspace(Home, project 하나, 앱 하나) 하나에 `active`(보이는 desk)와 desk 여럿이다.

```
WorkspaceLayout { active, desks: { <key> → Desk } }
Desk   { key, label, workflow?, tabs[], selected, groups[], floats[], detached[] }
Group  { layout: GroupNode, focus }
         GroupNode = { tab, stack? } | { dir: row|column, ratio, a, b }
FloatTab     { tab, rect, minimized, pinned }
DetachedItem { tab, bounds }
```

- desk는 셋이다. 기본 desk `_default`(화면 이름 "Main", 이름 바꾸기도 지우기도 없다), 사람이 만든 desk(`desk-<시각>-<번호>`, label은 "Desk N", 이름 바꾸기와 지우기가 있다), 그 project의 workflow마다 하나인 workflow desk(key와 label이 workflow 이름, `workflow` 필드가 있다). Home과 앱은 Main 하나라 desk 단추가 없다. project에서는 title bar 왼쪽의 desk 단추가 desk 목록(아직 desk가 없는 workflow 포함), New desk, 이름 바꾸기, 지우기를 준다.
- 탭 하나는 desk의 `tabs`(탭 줄), `floats`, `detached` 중 한 곳에만 있다. 탭 줄의 한 칸은 탭 하나나 group 하나다.
- `floats`의 배열 순서가 위아래 순서다(마지막이 맨 위). 고정(pinned)한 float은 늘 뒤쪽(위)에 모인다. `detached`의 순서는 뗀 순서이고 `bounds`는 OS 화면 좌표다.
- 탭의 상태는 탭 줄(docked), 펴진 float, 접힌 float(minimized), detached 넷이다. 접힌 float은 mount하지 않고(keep kind도) title bar 오른쪽 칸의 아이콘으로 있다. 아이콘을 누르면 펴서 맨 위로 온다. 펴진 float의 아이콘은 눌린 모양이다.
- 접힘은 float에서만 간다. 접혀도 `rect`는 접기 전 값을 지킨다.
- `transient` 탭(popup처럼 잠깐 뜬 패널)은 저장하지 않는다. Dock하면 사람이 고른 것이라 저장한다.
- Agent 탭(lophn session, 첫 말 전의 "New session" 탭 포함)은 저장하지 않는다. 탭 줄, group, float, detached, 전역 float 어디에 있든 같다. 이 창이 사는 동안은 workspace·desk를 오가도 그대로이고(아래 "저장"의 창 메모리) 앱을 다시 켜거나 창을 다시 열면 없다. session은 core에 그대로 있어 sidebar의 Recent나 Main 묶음(도는·못 본 session)에서 다시 연다. 다른 탭 kind(터미널의 coding agent TUI, browser, 파일, 앱 화면, artifact 등)는 그대로 저장한다.
- 파일 아닌 탭 중에는 한 desk에 하나인 고정 key 탭이 있다: project settings(key `project-settings`, project 창에 하나), app details(`app-detail`, 앱 workspace에 하나), jobs(`jobs`), inbox(`inbox`, 둘은 어느 workspace든 desk마다 하나). 모두 Detach하지 않는다. layout 파일에는 kind와 key만 남고 내용은 그릴 때 읽는다. Jobs는 Settings 항목이 아니라 overlay, 탭, 오른쪽 panel로 본다.

### group과 칸의 stack

- group은 `tabs`의 탭 2~4개를 한 칸 묶음으로 보이는 값이고 배치는 나눔 tree다(row는 a가 왼쪽, column은 a가 위, `ratio`는 a의 몫 0.15~0.85). leaf(칸)의 `tab`이 보이는 탭이고 leaf 수가 보이는 칸 수다.
- 불변 조건: leaf key는 모두 `tabs`에 있다. 탭은 group 하나에만 든다. group의 탭은 `tabs`에서 leaf 순서(왼쪽·위부터)로 붙어 있다. leaf가 1개가 되면 group은 풀린다. 최대 4칸이다. `selected`가 구성원이면 group의 `focus`가 `selected`다. float과 detached는 group이 아니라 desk가 가진다: group 구성원을 float·detached로 보내거나 닫으면 먼저 group에서 빠지고, dock·reattach는 plain tab으로 tabs 끝에 붙는다. 모든 변경은 끝에 이 조건을 맞춘다(없는 leaf 걷어내기, 1개 group 풀기, 붙여 두기).
- 칸 하나가 여러 탭을 돌려 볼 수 있다(stack). stack은 온 순서이고 보이는 `tab`을 포함하며 둘 이상일 때만 있다. 숨은 탭은 `tabs`에 있어 저장, 닫기 확인, 창 사이 이동을 그대로 거치지만 탭 줄 칸과 card에는 없다. group의 탭은 `tabs`에서 보이는 leaf를 leaf 순서로, 그 뒤에 숨은 탭 순으로 붙어 있고 group 소속은 숨은 탭도 센다. 숨은 탭을 고르면 그 칸이 그 탭을 보인다. 칸 머리의 ‹ n/m ›로 돌려 본다(끝에서 처음으로). 보이는 탭이 칸을 떠나면(닫기, float, detach, 끌어 옮기기, Remove from split, Move out of pane) stack의 이웃(뒤, 없으면 앞)이 보이고 칸은 남는다. Unsplit은 숨은 탭까지 모두 탭 줄에 내놓는다. 지금 stack을 만드는 길은 터미널 옆에 열기(아래 "탭 안에서 연 것의 자리")뿐이다.
- 동작: 한 탭을 다른 탭 옆(left·right·top·bottom)에 놓기(target이 group이면 그 leaf로 끼고 아니면 둘로 group을 만든다. 이미 4개면 그대로), 두 칸의 자리 맞바꾸기, leaf를 plain tab으로 꺼내기, group 풀기, 나눔 비율 바꾸기(나눔 node까지의 `a`/`b` 경로로 가리킨다)가 있다. 탭 줄 순서 바꾸기와 이동은 group의 탭을 함께 옮기고 다른 group 한가운데로는 못 든다.
- card는 group을 평평한 absolute 칸들로 그린다. 칸(머리 줄 + 본문)은 탭 key로 key를 주고 DOM 순서도 key 순으로 고정하므로, leaf가 자리를 바꾸거나 구조가 달라져도 요소가 옮겨지거나 본문이 다시 mount되지 않는다. 칸의 자리는 tree에서 계산하고 나누는 선을 끌어 몫을 바꾼다(놓을 때 한 번 저장, 더블클릭은 0.5). 칸을 누르면 그 칸이 focus가 된다. 고른 탭이 group 구성원이면 그 group의 leaf 전부를 mount한다.
- 탭 줄의 group 칸은 반쪽 N개와 사이의 방향 표시다. 탭 줄이 넘치지 않으면 group도 모든 이름이 보이고, 넘치면 먼저 고르지 않은 group 칸이 아이콘만 남고(이름은 tooltip), 그다음 고른 group의 focus 아닌 반쪽, 그다음 고르지 않은 탭이 좁아지다 최소 폭에서 가로 scroll이 된다. 닫기 자리는 탭(group이면 반쪽)마다 이름 뒤에 하나다: 저장 안 된 표시나 상태 점이 있으면 평소 그것을 보이고 hover하면 ×가 된다. 고르지 않은 group과 칸에 숨은 탭에는 ×가 없다.
- drag and drop은 pointer drag다. 탭 줄의 칸(group 칸이면 누른 탭 하나, 칸의 빈 곳이면 통째)과 group 칸의 머리 줄이 시작점이고 4px 넘게 움직여야 drag다. 놓을 자리는 사각형으로 찾는다: 탭 줄(어느 칸 앞인지), 탭 줄 group 칸의 안쪽(그 칸 stack의 자리), card 칸(가장자리 안쪽 28%는 그쪽으로 split, 가운데는 swap이거나 group 칸이면 그 칸 stack 끝에 쌓기). 가득 찬 group의 가장자리, 자기 자신, 옮기면 group이 풀리는 가운데는 놓을 수 없다. 떠 있는 패널과 접힌 칸 아이콘은 대상이 아니다. 끄는 동안 `<webview>`는 pointer를 받지 않는다(guest로 새면 놓을 자리가 안 보인다). Esc와 pointercancel은 취소다. Explorer 파일을 card에 놓는 것만 HTML5 drag다.
- 이동 기록은 창 하나의 메모리에만 있고 단축키(`nav.back`·`nav.forward`)로 걷는다. card 머리 줄의 ← →는 이 기록이 아니라 탭 본문 안의 이동이다. `{ desk, 고른 칸, 그 칸의 focus 탭 }` 최대 50개이고 저장하지 않는다. desk, 고른 칸, group 안 focus가 바뀔 때 쌓고 뒤로 간 뒤 새로 쌓으면 앞이 잘린다. 닫은 탭과 지운 desk의 자리는 건너뛰고, 걷는 중에는 더 쌓지 않는다. layout을 다 읽은 뒤부터 쌓는다.
- focus는 group의 leaf 하나이고 `selected`와 같다. 탭에 들어가는 `active`는 group이 아니거나 focus leaf일 때 true이고 float 안의 탭은 늘 true다. 탭 단축키는 focus leaf에 듣는다.

### float

- desk float: 탭이 workspace 위에 뜬 패널이다. `rect`는 float 층(title bar 아래 창 몸통 전체, 양쪽 sidebar 포함)의 왼쪽 위를 기준으로 한 정수 CSS px이고 가장 작은 크기는 320×200이다. 그릴 때는 지금 float 층 안으로 당겨 그리고, 저장된 rect는 사람이 옮기거나 크기를 바꿀 때만 바뀐다(창이 줄었다 커지면 원래 자리로 돌아온다). float 층을 아직 못 쟀으면 패널을 그리지 않고 rect도 저장하지 않는다. 새 패널은 float 층 가운데 60% 크기로 뜬다(비껴 놓기 없음).
- 고정(pinned, always on top)은 사람이 패널 bar의 핀으로 켜고 끈다. 새 float은 고정 안 함이다. 고정한 패널은 늘 고정 안 한 패널 위이고, 고정 안 한 패널을 raise해도 고정한 패널 바로 아래까지다. 고정 안 한 펴진 패널은 그 패널 밖을 사람이 누르면 접힌다(닫지도 뒤로 보내지도 않는다). `<webview>` 안의 click은 embedder에 오지 않으므로 webview 그릇이 쏘는 focusin으로 본다. 패널에서 연 menu·dialog와 접힌 패널 아이콘 칸은 밖이 아니고, 코드가 옮긴 focus로는 접지 않는다. 저장은 `pinned: true`일 때만 적는다.
- 패널 bar를 두 번 누르면 dock이다(행동 단추 위 제외). 패널의 DOM 순서는 탭 key 순으로 고정하고 위아래는 z-index로만 정한다(재배열하면 focus와 scroll이 날아간다). 누르거나 focus가 들어오면 맨 위로 온다.
- 전역 float: workspace를 넘어 남는 float이다. 탭 kind가 Detach 가능(`noDetach`가 아님)하고 저장할 수 있으며 `noGlobal`이 아니면 desk float을 전역으로 올릴 수 있다(앱 panel, 터미널, browser, Agent 탭, 파일 등. Agent 탭의 전역 float은 이 창 메모리에만 있고 전역 float 파일에는 쓰지 않는다). 전역 float은 탭이 나온 workspace를 지닌다. 본문이 그 workspace의 통로로 그려져서 터미널의 cwd와 PTY, agent의 workspace, 파일의 folder가 맞는다. 앱 panel만 workspace 없이 그린다(어느 workspace에도 묶이지 않는 화면이고 같은 앱·화면은 전역 float 하나다). browser의 native popup(opener view)은 창 밖으로 옮길 수 없어 올릴 수 없다. 전역 float 본문이 여는 탭(파일 링크, popup)은 같은 workspace의 새 전역 float이 된다. 전역 float의 제목 줄은 본문의 slice 없이 읽어 agent의 profile 아이콘과 상태 점은 없다. 고정 안 한 펼친 전역 float도 밖을 누르면 접힌다.
- float bar의 단추 하나가 desk float과 전역 float 사이를 옮긴다("Show in all workspaces" / "Move to this desk"). rect, 접힘, pin을 가져가고 옮기는 쪽의 자리는 닫는다. 받는 쪽이 못 받으면(전역 20개, 이 desk에 더 둘 수 없음) 옮기지 않아 float이 사라지지 않는다. 전역에서 desk로 돌아오는 단추는 kind가 `anyWorkspace`(app_panel, browser, document_editor)이거나 float의 workspace가 지금 창의 workspace일 때만 있다. 터미널은 project 폴더, agent·artifact·search·workflow는 workspace에 묶여서 다른 workspace desk로는 오지 못한다. 그릇이 달라 옮길 때 page를 다시 load한다. 같은 창 안의 이동이라 main을 거치지 않는다.
- 전역 float 층은 창마다 하나이고 workspace 창 밖에 있다(project·Home·앱·Settings 공간에만 있고 detached 창, 앱 전용 창, 연결 화면에는 없다). 그래서 workspace를 바꿔 창 본문이 다시 mount돼도 층의 `<webview>` 그릇과 view 보관소가 남아 page를 다시 load하지 않는다. 층은 desk float 층보다 늘 위이고 menu·dialog보다 아래다. 영역은 title bar 아래 몸통 전체라 rect 기준이 desk float과 같다(작업 표시줄이 있으면 그 위에서 끝난다). 접기·펴기·고정·쌓임·rect 규칙은 desk float과 같은 모델 동작을 빈 desk 위에서 쓴다. 같은 화면은 전역 float 하나이고 다시 더하면 맨 위로 온다. 닫기는 kind의 닫기 확인(터미널 종료, 파일 저장)을 거친다.
- 앱을 영구히 지우면 그 앱 workspace의 layout 파일과 전역 float 목록의 그 앱 float이 지워진다(열린 창의 전역 float도 닫힌다). 다른 workspace layout의 앱 panel 탭과 `quick.apps` 고정은 지우지 않고, 없는 앱은 "앱이 없다" 안내로 그리고 고정 단추는 건너뛴다. 설정 쪽 key(`shell.quick_launch`, `shell.app_launch`, `shell.sidebar_panels_off`, `shell.tray_off`, `shell.tray_order`)는 core가 같은 때 지운다(`app-call.md`).

### detached 창

- detached 창은 탭 하나만 그린다. 탭 줄도 sidebar도 float 층도 없고 `<webview>` 그릇 하나가 자기 탭의 화면을 담는다. 창은 hash `#detached=<key>`로 route를 고르고 값(탭, transfer)은 창이 뜬 뒤 main에서 당겨 받는다(key가 4096자까지, transfer가 커질 수 있어서).
- Detach와 Dock의 순서는 transfer → main이 창을 열거나 닫고(native view가 있으면 옮김) → 성공했을 때만 layout 바꾸기다. 어느 단계가 실패해도 layout은 그대로라 탭이 사라지지 않는다. kind가 transfer를 null로 내면 옮기지 않는다(editor는 마지막 고침을 flush하지 못하면 null이라 저장 안 된 글을 잃지 않는다).
- 옮겨 가는 값은 `TabTransfer { value(JSON), views(옮길 native view의 view_session) }`이고 받는 창이 그리기 전에 받는다. terminal은 `terminal_ref`와 `generation`(받는 창이 snapshot을 0부터 받는다), agent는 그 session의 composer draft(새 session 탭은 `new:` draft 전부, 받는 창의 글은 덮지 않는다), browser popup은 view_session과 state를 넘긴다. 앱 panel·artifact·보통 browser 탭은 transfer를 선언하지 않고(`{ value: null, views: [] }`) 받는 창이 다시 열며 page를 다시 load한다. 나머지 kind는 저장 값으로 다시 연다. `noDetach` kind(browser DevTools 패널 등)는 Detach 항목이 없다. 탭은 보내기 전에 4096자를 넘는 `fields` 값(favicon data URL)을 뺀다(IPC 한 번이 64KiB까지다).
- native view는 닫지 않고 창을 옮긴다. 이 길을 쓰는 것은 browser의 크기 준 popup과 DevTools뿐이다. 옮길 view가 모두 보내는 창의 것인지 먼저 보고(아니면 아무것도 옮기지 않고 `invalid_input`), 옮긴 view는 떼어 숨긴 상태로 새 창 renderer가 bounds를 보내면 붙는다. 옛 창이 늦게 보내는 요청은 소유 검사로 거절된다. `<webview>` guest는 이 길로 오지 않는다. 앱·artifact·보통 browser 탭은 보내는 창이 element를 지우고 받는 창이 새로 만든다(browser는 url로 다시 load되고 cookie는 partition에 남으며 그 탭의 DevTools는 닫힌다). popup 탭의 DevTools는 같이 옮긴다(float이던 것은 탭 안으로 바꿔서).
- ×는 dock이다. main이 창 닫기를 가로채 renderer에 dock 요청을 보내고 renderer가 [Dock]과 같은 흐름을 돈다. 실패하면 창이 그대로 남는다. 앱을 끄는 중에는 가로채지 않고 자동으로 dock하지도 않는다(다음 실행에 `detached`로 돌아온다). 창이 예기치 않게 사라지면(renderer crash 등) main이 저장된 값으로 docked(transfer 없음)를 보내 탭이 layout에 남는다. Dock과 reattach는 tabs 끝에 넣고 고르고 preview·transient 표시를 지운다. 떠나기 전 자리는 저장하지 않는다(float이었어도 docked로 온다).
- project 창이 detached 항목까지 layout 전체를 갖고 저장한다. detached 창은 자기 탭 하나를 main을 거쳐 받고, 바뀐 값, 탭 열기(project 창에 docked로), 닫기를 main을 거쳐 project 창에 알린다. 저장하는 곳이 하나라 마지막에 쓴 것이 이긴다. main은 탭 값을 열어 보지 않고(key와 kind만) 같은 project 창에만 중계하며, 보낸 창으로 역할을 가려 `forbidden`으로 막는다. detached 창 bounds는 main이 저장할 때 살아 있는 창 값으로 채우고, 창을 옮기거나 크기를 바꾸면 project 창에 알려 다시 저장하게 한다. 두 방향(project 창, detached 창)은 IPC 하나로 묶는다.
- project 창을 닫거나 같은 창에서 다른 공간으로 가면 그 창의 detached 창이 조용히 닫히고 상태는 `detached`로 남는다. 다시 열면 저장된 값과 bounds(지금 화면 작업 영역 안으로 당긴 것)로 창을 연다. 같은 실행 안이면 terminal은 PTY에 다시 붙는다: detached 창이 kind의 resume 값(terminal은 `terminal_ref`·`generation`)을 알려 main이 메모리에만 들고 있다가, 조용히 닫힌 창의 값을 (project, key)로 남겨 같은 key의 열기 요청에 한 번 쓰고 지운다. 쓰든 말든 지워서 같은 PTY가 두 창에 붙지 않고, 개별 close·dock·remove와 앱 종료에서도 지운다. 앱을 다시 띄우면 transfer가 없어 PTY에 못 붙는다. 같은 (project, key)의 창이 이미 있으면 새로 띄우지 않고 앞으로 가져온다(`conflict`).
- detached 창 안의 `openTab`은 project 창에 docked로 연다. agent 새 탭의 key가 project 창의 다른 session 탭과 겹치면 project 창이 새 번호로 바꿔 연다. 크기 준 browser popup은 또 하나의 detached 창으로 연다(popup view를 그 창으로 옮겨 `window.opener`를 지킨다). 그 창의 bounds는 opener 창 가운데 popup features 크기이고 화면 작업 영역 안으로 당긴다. detached 창에만 최소 크기 320×240이 있고 bounds가 없으면 960×600이다. float 층이 없으므로 browser 탭의 DevTools 자리 menu에서 float을 뺀다. toast와 전역 palette intent는 이 route에서 끄고, tray와 전역 palette 키는 detached 창을 "가장 최근 창"으로 고르지 않는다.
- Detach는 project만 한다. Home과 앱 창은 detached를 받지 않는다. desk를 바꾸는 흐름은 아래 "desk 바꾸기"다.

### `<webview>` 그릇과 층 순서

- 앱 화면, artifact 화면, browser 탭은 native view가 아니라 `<webview>`로 그린다. 창의 `<webview>` 그릇이 탭 key(앱 card는 그 화면의 view_session)당 element를 한 번 만들고 옮기지 않는다. 다른 부모로 옮기면 guest가 다시 만들어져 page가 다시 load되기 때문이다. native view는 browser의 크기 준 popup과 DevTools, overlay뿐이다.
- 그릇은 workspace 창이 mount될 때마다 하나 생기므로 workspace를 옮기면 새 그릇이 된다. workspace를 넘어 page가 살아야 하는 것은 전역 float뿐이고 전역 float 층이 자기 그릇을 따로 든다. project·Home·앱 창은 float 층의 첫 자식, detached 창과 앱 전용 창은 본문 안에 둔다.
- 층 순서: card 화면(층 0) < floated 화면(펴진 float의 몇 번째인가에 따라 그 패널 위·다음 패널 아래) < DOM 패널. float 층은 stacking context를 만들지 않고 패널 z-index가 층 번호에 비례한다. 접힌 float은 세지 않는다. 겹치는 패널은 `<webview>` 위에 DOM으로 바로 겹치고 밑의 page는 가려진 채 계속 돈다. 오른쪽 sidebar는 card 옆 열이라 화면을 덮지 않는다.
- native view의 층: browser popup·DevTools는 card 화면 < floated 화면 순으로 쌓고 overlay가 늘 그 위에 둔다.
- element 자체의 규칙: 앱·artifact element는 `src`만 적고(partition과 preload는 main이 붙일 때 강제한다) 첫 load 성공·실패 전까지 숨기며, main이 새 `src`를 내면 같은 자리에서 element를 새로 만든다. browser element는 partition과 `allowpopups`를 직접 적는다. 붙이기 ticket은 `src` 하나이고 한 번만 쓴다: main이 그 창의 view이고 그 `src`를 아직 안 쓴 때만 받으며, renderer가 적은 partition·preload·webPreferences는 버리고 main이 정한 값만 쓴다. 자리는 사각형만 알린다.
- card·float 패널의 아래 두 모서리는 그릇의 page 요소가 직접 둥글게 그린다(`<webview>`는 slot 부모로 잘리지 않아 조상의 overflow가 닿지 않는다). group이면 안쪽 아래 모서리도 둥글다(알려진 모양). 앱 전용 창은 각지고 native view는 각진 채다.
- view 보관소(창마다 하나, renderer)가 view_session과 마지막 state를 unmount·Float·Dock·detach 사이에 잇는다. 보관하는 동안에도 main이 보내는 state(응답 없음, crash, 연결 상태)를 받아 갱신하므로 다시 mount한 탭이 낡은 "정상"을 보이지 않는다. 앱 card는 그 화면이 unmount될 때 닫고, 열기 입력이 바뀌면 옛 view를 닫고 새로 연다.
- workspace를 떠나도 살려 두는 page. 기본은 떠나는 workspace의 `<webview>`를 모두 놓는 것이고 돌아오면 다시 load한다. page가 "살려 둬" 신호를 켠 동안은 예외다. 그릇을 workspace 창 밖에 한 번만 놓고 workspace마다 `{webviews, keeps}` pool을 둔다. 떠날 때 layout에 아직 있는 탭(detached 제외) 가운데 살려 둘 이유가 있는 화면만 두고 나머지와 그 view는 닫는다. 이유는 (a) 앱 page의 `useKeepAlive` 신호(key별로 켜고 껐다가 page가 새로 load되면 지운다. 앱이 올리는 길은 `app:keep-alive` 채널), (b) browser 탭의 사람이 켠 Keep alive(`keep_alive: true`로 저장), (c) browser 탭이 download를 받는 중, (d) browser 탭이 소리를 내는 중이다(떠날 때 한 번 본다). artifact 탭은 bridge가 없어 신호가 없고 늘 놓는다. 돌아오면 같은 pool을 받아 그 사이 layout에서 사라진 탭의 화면은 놓는다. 숨은 page는 not visible로 끝나 있다. 살려 둔 page는 창마다 6개까지이고 넘치면 가장 오래 안 본 것부터 놓는다. 놓는 시점은 떠날 때뿐이라 떠난 뒤 소리가 멈추거나 신호를 끈 page도 상한이나 돌아옴까지 남는다. 전역 float은 이 규칙과 상관없이 늘 남는다.
- agent가 연 browser 탭의 page(key `host:`, `lophn tab open --url`)는 위 이유 목록 밖이다. 그 탭이 layout에 있는 한 창이 사는 동안, 창이 어느 workspace를 보이든 산다.
  - 떠날 때 놓지 않고 pool에 숨겨 둔다. 숨은 동안에도 그려야 screenshot과 입력이 되므로(그리지 않으면 screenshot이 끝나지 않는다) 그릇의 오른쪽 아래 모서리에 1px만 걸쳐 둔다. 다른 내용 뒤나 투명으로는 그리기가 멈춘다. 그 한 점은 사람 화면에 점으로 보일 수 있다(열린 것).
  - 위 6개 상한에 세지 않고 창마다 12개 상한을 따로 둔다. 사람이 켠 Keep alive가 agent의 page를 밀어내지 않게서다. 세는 것은 mount되지 않은 workspace에 숨은 page 가운데 guest가 붙은 것뿐이다(느린 site의 page는 열기가 시간 초과로 끝나 어차피 놓이므로 멀쩡한 탭을 밀어내지 않는다). 넘으면 가장 오래 쓰지 않은 것부터 놓는다. 쓴 때는 agent의 browser 호출과 guest가 붙은 때다. 보인 때가 아니다.
  - 탭을 닫아서가 아니라 상한, 창 닫힘, 앱 종료로 page가 없어지면 그 탭은 core 표에서 빠진다. 사라진 page는 다시 load하지 않는다. 탭이 없으니 agent가 다시 연다. layout 쪽은 상한으로 놓은 탭이면 그 workspace가 다시 mount될 때 layout에서 뺀다. 창 닫힘과 앱 종료는 layout 파일에 탭이 남으므로 다음 mount 때 page가 없는 접힌 float(agent가 혼자 쓰던 `work`)만 지금 desk에서 뺀다. 그 밖의 자리(펴진 float, 탭 줄, 다른 desk)에 남은 것은 사람의 탭으로 남고 열면 다시 load한다(열린 것).
  - 한 workspace를 두 창이 모두 mount하면 창마다 자기 `<webview>`를 만들어 page가 둘이 된다. 나중에 붙은 쪽이 agent가 다루는 page이고, 그 workspace를 보이지 않는 옛 창은 자기 page를 놓는다(열린 것).

### 창 틀(shell)

- title bar 왼쪽: 왼쪽 sidebar 접기, lophn 표지, desk 단추(project만). 가운데: 탭 줄(끝에 새 탭 + menu, 오른쪽 끝에 접힌 float 아이콘 칸). 오른쪽: 그 workspace 종류의 panel icon(PanelTabs)과 창 단추. 검색 단추는 없다(palette는 Ctrl+K).
- stage: card. 머리 줄(경로, 상태 글, ⋯ tab menu)은 한 탭당 하나이고, 탭 본문이 머리 줄 일부를 올리거나 덮어쓸 수 있다(본문 안 이동의 ← →인 nav, 경로 자리의 center, ⋯ 앞 actions, ⋯ menu 묶음). ← →는 nav를 올린 탭에만 선다. browser, 파일, agent(session switcher), artifact, 앱 화면이 쓴다. card 밖(float 패널, detached 창)은 올릴 곳이 없어 본문이 자기 줄을 그린다. 고른 탭, 고른 탭이 group 구성원이면 그 group의 leaf 전부를 mount하고, keep kind(앱 panel·browser·artifact)는 keep, 나머지는 render로 그린다.
- 창 틀의 폭과 접힘: 양쪽 sidebar 폭은 끌어서 바꾸고 쪽마다 localStorage에 기억한다. 열림은 저장한 값이 창 폭 기본값을 이긴다. 왼쪽의 열림은 workspace와 무관하게 하나(Settings도 같이 쓴다)이고 오른쪽의 열림은 workspace마다 기억한다.
- 왼쪽 sidebar는 Home·project·앱 창이 같이 쓴다. 위에서부터 Inbox와 Jobs overlay(줄 오른쪽 옆에 열리고 머리의 [Open in tab]이 inbox·jobs 탭을 연다), 지금 workspace의 Agents 탭을 여는 Agents 줄, Workspaces마다 열린 session과 이 workspace의 접힌 Recent, 맨 아래 빠른 실행과 Settings.
  - workspace 줄 오른쪽 끝의 +는 그 workspace의 lophn 새 session이다. 이 workspace는 이 창에서 열고 hover하면 agent 목록(lophn agent 묶음, divider, 즐겨찾기 coding agent 묶음)이 뜬다. 이 목록은 탭 줄 + menu의 Agent 단계와 같은 값 하나이고 고르면 하는 일도 같다(lophn agent는 새 Agent 탭, coding agent는 그 명령어의 docked 새 터미널). 다른 workspace는 route의 `startSession`(`{agent}`·`{command}`, 비면 기본 lophn)으로 그 workspace로 가서 연다. 다른 workspace의 agent 목록은 읽지 않아 기본 lophn agent와 즐겨찾기 coding agent(터미널이 있는 project만)다. 이 workspace의 +는 늘 보이고 다른 workspace의 +는 hover·focus 때만 보인다. project·앱 줄의 톱니가 Project settings·App details 탭을 연다(다른 workspace는 route의 `startSettings`로 간다).
  - current 줄: 그 workspace의 layout에 Agent 탭이 열렸거나(보이는 workspace는 살아 있는 layout, 다른 workspace는 이 창이 아는 layout을 창 focus와 session·workspace 목록이 바뀔 때 다시 읽는다. Agent 탭은 저장하지 않아 이 창 메모리의 layout뿐이므로, 앱을 다시 켠 뒤 이 창이 아직 연 적 없는 workspace는 탭이 없다) 끝나지 않고 상태 점이 있는 session(도는 중, 기다리는 중, 못 본 turn 끝), 이 project의 live 터미널 coding agent, 다른 workspace의 저장된 layout에 남은 coding agent 터미널 탭 가운데 agent가 지금 도는 것(터미널 탭의 `harness`로 후보를 고르고 살아 있는 창의 terminal store가 확인한 agent만. 끝난 agent와 다시 띄운 앱의 터미널은 빠진다), 사람 차례인 workflow다. 탭을 닫아야 Recent로 간다. 줄은 자리를 지킨다(lophn session은 만든 순, 그 뒤 터미널은 탭 key 순). lophn session 줄과 Agent 탭의 이름은 session 제목이고 정본은 창에 하나인 session 제목 값이다(agent × workspace마다 session 목록에서 읽는다. session이 생기거나 끝날 때, turn이 돌기 시작할 때, 창이 focus를 받을 때, 이름을 바꾼 뒤 다시 읽고, 열린 대화가 읽은 제목과 방금 바꾼 이름은 바로 넣는다). 탭 줄은 모든 Agent 탭의 제목을 이 값으로 맞추고 sidebar도 같은 값을 쓴다. 탭 제목을 줄 이름으로 쓰지 않는다: 그려진 탭만 제목을 채우면 고르지 않은 탭과 그 줄이 agent 이름으로 떨어진다. 자동 제목은 사람의 첫 말을 접수할 때, call로 시작한 session은 그 call의 맡긴 글을 받을 때 붙고 event가 없어서 turn 시작을 보고 다시 읽는다. 제목이 아직 없는 열린 session은 agent 이름이다. lophn session은 첫 메시지를 보낼 때 생겨서 그 전의 이 창 Agent 탭은 "New session" draft 줄(누르면 그 탭을 고른다)이다. draft 줄은 이 창이 보이는 workspace의 탭만이고 다른 workspace의 메모리 layout에 있는 session 없는 Agent 탭은 줄이 없다. 다시 켠 뒤에는 Agent 탭이 없으니 열려 있던 session은 Recent로 가고, 도는 session과 못 본 turn 끝만 current(Main 묶음)에 남는다.
  - current 줄은 그 탭이 있는 desk로 나눈다(탭 key, Agent 탭의 session id, workflow desk의 `workflow:<이름>`이 어느 desk에 있나). 묶음은 layout의 desk 순서이고 탭이 없는 줄(core가 탭 요청을 잃었거나 사람이 안 보고 탭을 닫은 session)은 Main desk 묶음에 든다. "탭 없음" 묶음은 없다. 묶음이 둘 이상일 때만 desk 이름 줄을 그린다. 탭 없는 줄을 눌러 여는 길은 그대로다.
  - 줄의 행동: lophn session·draft·터미널(어느 workspace든)은 hover·focus 때 x(Stop: 도는 turn을 멈추고 탭을 닫아 Recent로 보낸다. 터미널은 탭 닫기와 같아 확인을 묻는다)와 연필(Rename)이 뜬다. 다른 workspace의 것은 그 workspace의 layout(이 창이 읽거나 쓴 값)에서 탭을 지우고(터미널은 PTY를 든 창의 terminal store로 닫고 닫았을 때만 지운다), 탭 이름과 coding agent session 이름을 바꾼다. 다른 workspace의 layout을 고친 것은 그 workspace를 다른 창에서 열어 두었으면 그 창이 다음에 저장할 때 덮인다. draft는 이름을 둘 session이 없어 연필이 없다. 이 창이 보이는 workspace에만 Recent를 둔다(펼치면 10줄씩 page, 7일 안, 사람이 지운 줄은 그 뒤 움직이기 전까지 뺀다). Recent의 session을 누르면 이 project의 것은 desk 규칙으로 열고 다른 workspace의 것은 toast 행동으로 그 workspace로 간다. 줄의 아이콘과 상태 점은 lophn agent와 coding agent가 같은 공통 모양을 쓴다.
- 오른쪽 sidebar는 workspace마다 하나이고, panel은 한 목록(key, label, icon, 앱 여부, 어느 workspace 종류에서 서는가, 조건)에서 종류로 걸러 title bar의 icon 줄과 본문이 같이 본다. 내장: Files·Artifacts·Workflows(project), Workspaces(Home), Jobs(project·Home, 통로가 있을 때만), Logs(앱). 그 뒤에 설치된 앱 화면 가운데 `sidebar` 자리를 가진 것이 설정 `shell.sidebar_panels_off`(`{app, screen}[]`, Settings › Quick launch의 Sidebar panels 줄이 끄고 켠다)에 들지 않았으면 workspace 종류와 상관없이 선다. 앱 panel의 view는 `sidebar:<app>:<screen>` key로 view 보관소에 남아 panel을 바꿔도 page가 이어지고, 앱의 머리 줄 단추는 panel 머리 줄의 단추 자리에 그린다. 고른 panel이 목록에 없으면(앱이 지워졌거나 다른 종류로 옮김) 목록의 첫 panel이다. 앱 panel·tray·빠른 실행의 앱 목록은 창이 읽은 화면 목록(`apps/list`와 `apps/tools`)에서 오고, 읽을 때 앱의 활성 판도 싣는다. main은 live view를 판 없이 열지 않으므로(아니면 `invalid_input`) 이 판으로 연다. 목록은 core 연결이 ready가 될 때와 앱 view 바뀜 event(reason `activation`)가 올 때 다시 읽는다.
  - Files panel(Explorer)은 한 번에 여러 줄을 고른다. 고른 줄은 집합 하나(`selection`)이고 Shift 범위의 기준 줄(`anchor`)을 따로 둔다. Ctrl/Cmd+클릭은 더하고 빼고, Shift+클릭은 기준부터의 범위이고, 지우기·쓰레기통·경로 복사·끌어 옮기기는 고른 줄 전부에 한다. 폴더와 그 안의 줄이 같이 골라지면 폴더만 다룬다(안쪽 줄은 이미 딸려 간다).
  - Files panel의 clipboard는 VS Code와 같다. 복사·잘라내기는 앱 안 state(`{mode, paths}`)이고, 복사는 경로 목록을 OS 글 clipboard에도 쓴다. 붙여넣기는 state가 있으면 그것을(잘라내기는 옮기기) 쓰고, 없으면 `paste` 이벤트의 `clipboardData`만 읽는다(글은 절대 경로 목록, 파일은 이미지 바이트). `navigator.clipboard.read`는 쓰지 않는다: shell 창은 clipboard 쓰기만 허락된다.
  - 붙여넣기는 덮어쓰지 않고 비켜 간다(`a copy.md`, `a copy 2.md`, 이미지는 `image 2.png`). 복사와 이미지 저장은 shell main의 `shell:file-copy`·`shell:file-write-bytes`가 하고 둘 다 이미 있는 대상에 `conflict`다.
- 작업 표시줄은 설정 `shell.taskbar`(기본 true, Settings › Appearance의 Switch)가 켜져 있을 때 몸통 밖 맨 아래 줄이다. 왼쪽 끝은 빠른 실행(폭은 열린 왼쪽 sidebar 폭 이상이라 chip이 탭 영역 아래에서 시작한다), 그다음 float chip(전역 float이 먼저, 그 뒤 지금 desk의 float, 4개를 넘으면 +N menu, 누르면 펴고 접는다. 눌린 chip이 펴진 float이다), 오른쪽에 tray(설치된 앱의 `tray` 화면마다 항목 하나. 값과 popup 규칙은 `app-notice.md`), 맨 오른쪽에 설정 톱니다. 끄면 chip은 탭 줄 끝에 아이콘만 서고, 빠른 실행과 톱니는 왼쪽 sidebar 맨 아래로, tray 아이콘은 title bar로 돌아간다. Settings, detached 창, 앱 전용 창에는 작업 표시줄이 없다. tray popup은 pin하면 바깥 누름·창 blur·다른 항목에도 닫히지 않고, 열린 popup은 창에 메모리로만 있어 workspace를 옮겨도 다시 mount되지 않는다(popup이 보는 앱 화면의 workspace는 연 때의 것이다).
- 창의 자리: desktop 창의 마지막 자리는 layout이 아니라 앱에 하나인 `window.json`(`{ bounds, maximized }`)이다. 한 창이 Home·project·settings를 오가므로 창 자리는 project에 속하지 않는다. 옮기거나 크기를 바꾸면 500ms 뒤, 최대화·되돌림·닫기 때는 바로 쓴다. 최대화한 창은 되돌렸을 때의 자리와 `maximized`를 둔다. 최소화와 전체 화면은 쓰지 않는다. 새 desktop 창(시작, tray, 단일 instance 요청)은 그 자리를 지금 화면 작업 영역 안으로 당겨 열고, 다른 desktop 창이 떠 있으면 32px 비켜 연다. agent가 browser를 쓰려고 focus 없이 연 창은 저장한 크기로 뜨되 최대화하지 않고, 사람이 그 창을 최대화하거나 되돌리기 전에는 저장된 `maximized`를 덮지 않는다. detached 창은 이 값을 쓰지도 고치지도 않는다.

### workspace 종류

- Home: 같은 workspace 창에 `{ kind: "home" }`를 주어 그린다(새 기본 창의 첫 화면). project가 없으므로 터미널(통로 없음), Explorer·Artifacts·Workflows panel, 검색 탭, project settings, desk 단추(Main 하나), detached 창이 없다. 그 kind가 Home layout에 있어도(손상) 그리지 않고 크래시하지 않는다. html 파일은 artifact 탭이 project 파일로만 열리므로 Home에서는 문서 탭으로 연다. 오른쪽 sidebar는 Workspaces(project·앱 목록, 등록, New app, 보관)와 Jobs(모든 job)다. layout 파일은 workspace key `home`이고 agent 탭은 `{ kind: "home" }`로 저장한다. 탭이 가리키는 workspace가 이 창과 다르면 그리지 않는다. Home session(workspace가 없는 session)은 그 session의 agent로 연 agent 탭이다. core가 준비되지 않았거나 시작에 실패하면 Home 창 대신 같은 틀에 연결 화면(준비 중, [Retry])이나 시작 실패 화면이 선다. 준비되면 같은 틀의 Home 창으로 바뀌고, 연결이 끊긴 채 마지막 화면이 있으면 card 위 한 줄로 알린다.
- 앱 workspace: `{ kind: "app", id }`. project가 없는 점은 Home과 같고 앱 화면 탭과 앱 panel이 더해진다. layout 파일은 workspace key = 앱 id이고, 저장된 것이 없으면 Main desk에 앱 화면 탭 하나가 고른 채 선다. 앱 화면 탭은 `{ kind: "app_screen", key: "app-screen:<app>", app }`로 저장한다(앱 workspace의 Agent 탭은 저장하지 않는다). 앱 workspace의 오른쪽 sidebar 내장 panel은 Logs 하나다(이 앱의 run 기록. session 줄을 누르면 그 session의 Agent 탭). 연결 폴더 목록은 App details 탭에 있고 Files panel은 두지 않는다. preview는 앱 화면 탭 toolbar의 [Preview]로 연다.
  - 앱 화면 탭은 그 앱의 현재 release의 선언에서 `tab` 자리를 가진 첫 screen을 연다(앱 전용 창과 같은 규칙, `tab` 화면이 없으면 열지 못한다). 앱 workspace마다 하나이고 닫으면 + menu의 App screen이나 앱 줄로 다시 연다. 보관소 key가 탭 key라 Float·desk 바꾸기에도 view가 이어지고, 앱 panel 탭과 달리 화면이 지금 workspace를 안다. 화면이 멈추거나 앱이 멈췄을 때만 상태 줄이 선다. Detach하지 않는다.
  - 새 앱은 앱 화면과 lophn session을 붙인 group(좌우)으로 열린다. session 요청은 일반 desk 규칙으로 탭을 연다.
  - Annotate는 앱 화면 탭 머리 줄 ⋯ 메뉴의 맨 위 항목이다(앱이 머리 줄을 올리지 않아도 선다). artifact 탭도 ⋯ 메뉴 항목이고 card 밖(float)에서만 자기 toolbar의 단추다. 켜진 동안은 머리 줄 전체가 Annotate 줄(가운데 Annotate · 앱 이름, 오른쪽 끝 모두 지우기·Done·보내기와 모은 수)로 바뀐다. 메모는 화면 안 표지 옆 칸에서 고치고 그 칸의 ×로 하나를 지운다. 받는 쪽은 이 앱 workspace의 열린 lophn session이고 없으면 새 session이다. 자세한 모델은 `annotation.md`.
- Settings: workspace가 아니라 같은 shell 틀을 쓰는 창 안의 한 자리다(route `settings`). 왼쪽 sidebar가 Settings 항목 목록과 [Back](열기 전 workspace로)이고 탭 줄에는 Settings 탭 하나뿐이며(닫으면 [Back]과 같다) 오른쪽 sidebar는 없다. desk, group, float, layout 파일이 없고 Inbox overlay와 palette는 workspace 창과 같이 쓴다.
- 앱 전용 창: shell 문서 하나다. main이 선언의 `places`에 `tab`이 든 첫 screen을 골라 `#app-window=<app>/<release>/<screen>` hash의 desktop 창을 연다. 앱 하나에 창 하나이고 다시 요청하면 그 창을 앞으로 가져온다. 앱 이름과 창 단추가 있는 위쪽 bar와 그 화면 하나를 창 본문 전체의 `<webview>`로 그린다(live, place `tab`, workspace는 그 앱 workspace). 전역 palette·tray의 "가장 최근 창"에서 detached 창과 같이 빠진다.

### desk 바꾸기와 닫기

- 바꾸면 저장하고 가는 desk의 detached 창 key 목록 하나를 main에 보낸다. main은 그 project 창의 나머지 detached 창을 숨기고(focus 없이 보인다), 창이 없는 key는 renderer에 돌려주고 renderer가 탭 값과 bounds로 연다. 떠난 desk의 detached 창은 닫지 않고 숨겨 PTY와 그 창의 guest page가 산다. 숨은 창이 예기치 않게 사라지면 그 탭이 있는 desk가 docked를 받는다. 복원 때는 보이는 desk의 detached 창만 열고, 다른 desk의 것은 그 desk로 갈 때 연다. 이 호출은 보낸 project 창의 detached 창만 건드리고 detached 창이 부르면 `forbidden`이다.
- 사라진 workflow의 desk는 Main으로 합친다: tabs는 Main 끝(group은 그대로, Main과 key가 겹치는 leaf는 빠지고 1개가 되면 풀린다), float과 detached는 상한(20)이 남아 있을 때만 그대로 가고 아니면 tab으로 간다. Main에 이미 같은 key가 있으면 옮기지 않는다. 합치기는 workflow 목록 읽기에 성공했을 때만 한다(실패나 읽는 중에 합치면 desk의 탭이 모두 Main으로 옮겨진다). 목록은 project를 연 직후 읽는다.
- 사람이 만든 desk의 x는 그 일을 끝내는 것이다. 몇 탭·터미널·float·창이 닫히는지와 저장이 남은 파일(이름과 경로)을 보이고, 확인하면 그 desk의 탭·float·detached를 보통 닫기 길(kind의 닫기 확인)로 하나씩 닫은 뒤 desk만 지운다(보던 desk면 Main으로 간다). 사람이 이미 확인했으므로 터미널은 되묻지 않고, 저장이 안 되는 파일처럼 잃을 것이 남는 질문은 묻는다. 하나라도 거절하면 거기서 멈추고 desk는 남는다. 탭을 Main으로 옮기지 않는다.
- 탭 menu의 여러 개 닫기(Close others, Close others in pane, Close group, Close to the right, Close saved, Close all)는 한 번만 묻는다. 닫을 탭을 고르고, 파일의 마지막 고침을 먼저 보낸 뒤, 살아 있는 터미널과 그래도 저장이 남은 파일이 있으면 dialog 하나에 줄로 보인다. 물을 것이 없으면 dialog 없이 닫는다. 확인하면 보인 파일의 남은 고침을 버리고 탭마다 터미널을 되묻지 않고 닫는다. 그 사이 새로 저장이 남은 파일만 그 탭에서 묻고 거절하면 거기서 멈춘다.
- workflow 탭은 자기 workflow의 desk에 산다. kind가 home desk를 가진 탭을 여는 길(sidebar의 workflow 줄)은 어디에도 열려 있지 않으면 그 desk로 가서 연다(desk가 없으면 workflow 이름을 key·label·`workflow`로 새로 만든다). 그 desk가 보이면 sidebar Workflows의 그 줄이 강조된다.

### 탭 안에서 연 것의 자리

탭 안에서 다른 탭을 열 때(파일 link, 검색 결과, 터미널의 URL, 대화 코드 블록의 실행) 자리는 열린 정책 하나가 정한다. 여는 쪽은 source 탭의 key만 넘기고 자리를 스스로 계산하지 않는다.

- source가 이 desk의 탭 줄에 있는 터미널(shell, coding agent)이고 새 탭이면, 터미널을 가리지 않도록 그 옆 칸에 연다. 터미널이 group에 없으면 [터미널 | 새 탭] row group(0.5)을 만들고, 이미 group에 있으면 터미널 다음 leaf(끝이면 처음)의 칸 stack 끝에 새 탭이 쌓여 보인다(전에 보이던 탭은 그 칸에 숨고 group은 자라지 않는다).
- 그 밖의 탭(lophn agent 대화의 파일 link, 검색 결과) 안에서 연 새 탭은 source 바로 뒤다(group의 leaf 뒤면 group 뒤로 비킨다). source가 float·detached이거나 없으면 desk 끝, 보이지 않는 desk면 source 바로 뒤(그 desk로 건너간다)다. 대화 코드 블록의 실행은 float 새 터미널이다.
- 이미 열린 탭은 이 정책을 거치지 않고 있는 자리에서 보인다.

### agent가 연 탭

- agent와 사람 token은 `lophn tab open`으로 탭을 열고 `lophn tab close`로 자기가 연 탭만 닫는다. 대상은 같은 workspace의 열린 agent session(대화 탭), http·https url(browser 탭), runtime이 harness인 session의 TUI(터미널 탭, `--tui`), 앱의 지금 preview(`--preview <app>`), 그 workspace의 artifact(`--artifact <name>`), 즐겨찾기 coding agent의 TUI handoff(`--coding <harness> --handoff <글>`, project workspace의 agent만, 사람의 터미널 탭이고 `coding-agent.md` "TUI handoff")다. route는 `tabs/open`·`tabs/close`(actor agent·user)와 `browser/read`(actor agent)이고 caller session은 자격에서 읽는다. 탭의 주인은 연 session이고, 사람 token(터미널의 coding agent와 사람)은 모두 같은 주인 `"person"`이다. 사람 token은 `--url`·`--preview`·`--artifact`만 연다(`--session`·`--tui`는 `invalid_input`). 사람 token의 `--url`·`--artifact` 탭은 입력 `workspace`, 없으면 env `LOPHN_WORKSPACE`(shell이 project 터미널의 PTY에 넣는다), 그것도 없으면 home에 열린다. browser 탭(`--url`)은 page가 붙은 뒤에 답한다(아래). 그 밖의 열기는 요청을 넣고 바로 `accepted`를 답하고 agent는 기다리지 않는다. 남이 연 탭을 닫으면 `forbidden`, 없는 탭은 `not_found`다.
- preview 탭은 그 앱 workspace의 session과 사람 token만 연다. 다른 workspace의 session이면 `not_found`(남의 앱을 알리지 않는다), 돌고 있는 preview가 없으면 `conflict`다. 앱마다 preview 탭은 하나라 표에 이미 있으면 새로 넣지 않고 그 탭 id를 돌려주며 주인을 나중 caller로 바꾼다. `lophn preview start`는 preview가 ready가 되면 같은 자격으로 `tabs/open {preview}`를 불러 탭을 연다(열기가 실패해도 preview는 떠 있다). 탭 kind `app_preview`는 layout에 저장하지 않는다. 앱 view를 `mode: "preview"`로 열고 안내 줄(preview, fixture data, 바깥 연결은 대역, 기기 고르기)과 [Stop]을 두며, target에 `device`가 있으면 그 기기로 연다. preview가 멈추면 "돌고 있는 preview 없음"을 보이고 다시 start되면 같은 탭이 새 preview를 연다. 사람이 앱 화면 탭의 [Preview](돌고 있는 preview가 있을 때만)로 여는 탭은 key `app-preview:<app>`이고 host 표에 없다. 같은 앱의 host preview 탭이 오면 renderer가 그 탭을 닫고 그 자리에 `host:<tab>` 탭을 연다.
- artifact 탭은 그 그릇 workspace의 것만 연다. workspace는 agent면 자기 session의 것, 사람 token이면 입력의 workspace다(남의 workspace를 고를 칸이 없다). home이면 `invalid_input`, `artifacts/<name>/`이 폴더가 아니거나 입구 `index.html`이 일반 file이 아니면(symlink는 세지 않는다) `not_found`다. artifact마다 host 탭은 하나라 표에 이미 있으면 그 탭 id를 돌려주며 주인을 나중 caller로 바꾼다(preview와 같다). renderer는 같은 artifact의 탭(사람이 연 key `artifact:<kind>:<id>:<name>`이나 core가 다시 떠 표에서 빠진 옛 `host:` 탭)이 있으면 그 자리에 `host:<tab>` 탭을 열고 그것을 닫는다(같은 창의 같은 source는 view 하나다). 탭은 사람이 연 artifact 탭과 같은 kind이고 layout에는 사람의 key로 저장한다: core의 표는 core와 같이 사라지므로 되살린 탭은 사람의 탭이다.
- core는 layout을 모르므로 요청을 core 메모리의 host queue에 둔다. queue와 agent가 연 탭의 표(`탭 → 주인(session 또는 "person"), workspace, 종류(agent·browser·preview·artifact), 하나만 두는 탭의 key(preview는 앱, artifact는 그릇과 이름), browser 상태`)는 core 메모리에만 있어 꺼지면 사라진다. shell main이 core에 붙어 있는 동안 사람 token으로 `host/take {workspaces, tui}`를 쉬지 않고 이어 부른다(long-poll). take는 닿는 요청이 있으면 바로, 없으면 요청이 들어오기를 5초까지 기다리다 null을 답한다. 5초인 것은 매 take가 TUI hold의 heartbeat이고 hold 갱신이 10초라서다. 기다리는 동안 보이는 workspace가 바뀌면 그 workspace의 요청은 그 take가 끝난 뒤(5초 안) 간다. take가 실패하거나 창이 탭 요청을 받지 못하면 1초 쉰다. core가 멈출 때 기다리는 take는 null로 끝난다. `workspaces`는 창마다 renderer가 layout을 다 읽은 뒤 `shell:surface-workspace`로 알린 것이다(detached 창은 빠진다). 그 workspace를 보이는 창 가운데 가장 최근에 focus를 받은 하나에만 `shell:surface-request`를 보내고, 1.5초 안에 ack(`shell:surface-ack`)가 오면 `host/done {done}`, 아니면 retry로 queue 끝에 되돌린다. 빌려 간 요청에 10초 동안 done이 없으면 다시 대기한다(결과를 기다리는 요청, 곧 browser 호출과 browser 탭 열기는 두 번 실행하면 안 되어 다시 내놓지 않는다). shell이 없거나 그 workspace를 보이는 창이 없으면 요청은 기다린다(200개를 넘으면 오래된 것부터 버린다). 예외는 browser 탭 열기와 browser 탭 닫기다. page가 창 단위로 사므로 workspace를 가리지 않고 take하는 아무 shell main이 가져가고, 닫기는 shell main이 그 page를 가진 창(bind 전이면 열기를 보낸 창)에 보낸다. queue가 shell에 붙어 있다는 `attached`는 기다리는 take가 있거나 마지막 take가 끝난 지 3초 안이면 참이다.
- browser 호출(`lophn browser snapshot|act|navigate|screenshot|evaluate|logs|wait`, route `browser/*`)은 extension tool 호출과 같은 결과 길을 쓴다. 주인을 확인한 뒤(남의 탭, 사람이 손으로 연 탭, session·TUI 탭은 `not_found`) 요청을 queue에 넣고, 요청에는 workspace가 없어 아무 shell main이 가져가 browser driver로 실행해 `host/done {output}`에 결과를 싣는다. 기한은 30초이고 core가 1초마다 보아 넘으면 `unavailable`로 끝내고 요청을 거둔다(늦은 done은 버린다). 기다리는 동안 shell이 떨어져도 `unavailable`이다. 행동의 꼴과 오류 code는 `browser-tab.md`다.
- 열린 탭의 key는 `host:<tab id>`이고 자리는 relation과 source가 정한다. **agent는 뜻을 정하고 `openAt()`(open-policy)이 자리를 정한다.** agent는 `lophn tab open`의 relation 옵션으로 그 탭이 연 session(source)에게 무엇인지만 말하고(`peer`·`stage`·`aside`·`work`·`glance`) 칸·float·순서는 말하지 않는다. core도 자리를 정하지 않고 relation을 그대로 싣는다(말하지 않으면 null). source는 그 창에서 연 agent의 session을 보이는 agent 탭이다. relation이 null이면 browser는 `work`, session·TUI·preview·artifact는 `aside`다.
  - `work`는 접힌 float(chip)이다. agent가 혼자 쓰는 탭이라 사람이 펴서 지켜보거나 take control한다. `glance`는 펴진 float이고 사람이 밖을 누르면 접힌다(고정하지 않은 float).
  - `aside`는 source 옆 칸이다. source가 group에 없으면 [source | 새 탭](row 0.5)으로 묶는다. group에 칸이 남으면(4칸 미만) source의 칸을 나눠 옆(오른쪽)에 놓는다. 가득 차면 source 바로 다음 칸(돌아서)의 stack에 쌓고, 사람이 보는 칸(selected나 group의 focus가 든 칸)이 아니면 그 칸의 보이는 탭이 되고 맞으면 숨어 쌓인다.
  - `peer`는 source와 같은 group이다. source가 group에 없으면 [source | 새 탭]이다. 칸이 남으면 가장 넓은 칸(나눔 몫을 곱한 넓이, 같으면 뒤쪽)을 그 부모 나눔과 수직으로 나눠 뒤(오른쪽·아래)에 놓는다. 사람이 정리한 배치를 지키고 가는 띠가 생기지 않는다. 가득 차면 마지막 칸에 숨어 쌓인다. 고르거나 focus를 옮기지 않는다.
  - `stage`는 group 안이 아니라 source의 group 바로 뒤(group이 없으면 source 바로 뒤) 탭이다. 이 탭의 `peer` 자식이 나중에 이 탭과 새 group을 이룬다.
  - source가 floated·detached이거나 없으면 desk 끝이다(`work`·`glance`는 어차피 float). 단 source 없는 session 탭(job·run이 연 session, 다른 workspace가 call로 연 session)의 desk 끝은 보던 desk가 아니라 Main desk(`_default`)의 끝이다. project workspace는 desk가 여럿이라 사람이 보던 desk를 어지럽히지 않고 한곳에 쌓아 두려는 것이다(home·앱은 Main뿐이다). source가 보이지 않는 desk에 있으면 desk를 바꾸지 않고 그 desk에서 위 규칙을 푼다. 모두 선택하지 않고(`select: false`) 창을 앞으로 가져오거나 focus하지 않는다. 그 session의 탭이 이미 창에 있으면 새로 열지 않고 ack한다. 사람이 연 같은 앱의 preview·같은 artifact 탭이 있으면 relation과 상관없이 그 자리에서 바꿔 연다. 자식 agent의 relation은 `agent-call.md`다.
- **agent나 run이 연 session은 모두 그 workspace의 Agent 탭으로 열린다.** `lophn call send`가 새 session을 연 경우(agent 이름으로 보냈거나 `fallback`이 새 session으로 간 경우), `team spawn`, run(job의 `agent_run`, CLI의 `lophn run`, workflow의 run)이 새로 연 session이다. 탭은 commit 뒤 core가 host queue에 요청하고 선택하지 않는다(18). call과 team spawn의 주인은 연 session이고, 같은 workspace면 연 session의 탭을 source로 해 relation을 싣는다(team spawn은 `--as`, 그냥 call은 `stage`: 연 탭 바로 뒤에 놓이고 split 칸을 만들지 않는다). 다른 workspace가 연 session은 source 없이 그 session의 workspace에 열린다. run은 session을 연 agent가 없어 주인이 `"person"`이고 source가 없다. run마다 새 session이라 탭이 쌓이고 사람이 닫는다(닫으면 Recent로 간다). `--session`으로 이어 쓴 session과 이미 열린 session으로 보낸 call은 새 탭을 만들지 않는다. workflow step과 program 알림이 연 session도 탭을 열지 않는다(사람의 일을 끊지 않는 자리는 workflow 화면과 알림이다). 앱 화면이 연 session(`opened_by_app`, 앱이 보낸 call 포함)은 앱 화면이 자리라 탭을 열지 않는다(앱이 turn마다 session을 부려 쓰면 탭이 넘친다). 탭이 없는 session은 sidebar의 Main 묶음에 줄로 남는다.
- core의 `tab_show {tab}` 요청은 접힌 float을 그 자리에서 편다. layout과 선택·focus를 바꾸지 않고(맨 위로 올라올 뿐이다), 어느 desk의 float이든 찾아 편다. float이 아니거나 이미 펴져 있거나 없는 탭이면 할 일이 없고, 그래도 그 workspace를 가진 창은 ack한다.
- agent가 연 browser·preview·artifact 탭은 사람이 고르기 전에도 본문을 mount해 page가 붙어 있다(숨은 mount). 고르지 않은 탭뿐 아니라 접힌 float과 다른 desk의 탭·float도 대상이라 같은 workspace 안에서는 사람이 무엇을 보든 agent의 browser 호출이 된다. preview·artifact 탭의 숨은 mount는 그 workspace가 창에 mount된 동안만 돈다. 그 창이 다른 workspace로 가거나 그 workspace를 띄운 창이 없으면 page가 없어 browser 호출은 `unavailable`이다(Keep alive, download, 소리로 남긴 page는 예외). browser 탭(`--url`)은 이 한계가 없다(위 "`<webview>` 그릇"과 아래 browser 탭 열기). detached 창의 탭은 그 창이 mount한다.
- **browser 탭 열기(`--url`)는 page가 붙을 때까지 기다리고, 그 workspace를 띄운 창이 없어도 열린다.** 흐름은 이렇다.
  - core는 shell main이 붙어 있으면(`attached`) 열기를 queue에 넣는다. shell main은 그 workspace를 보이는 창 가운데 가장 최근에 focus를 받은 창에, 없으면 가장 최근의 일반 창(detached 창과 앱 전용 창이 아닌 창)에 `shell:surface-request`를 보낸다. 일반 창이 하나도 없으면 데스크톱 창을 focus 없이 연다(`showInactive`). 창은 저장한 자리와 크기로 뜨고 최대화하지 않으며(최대화는 Windows에서 focus를 가져간다) 최소화하거나 숨기지 않는다(`<webview>`는 보이는 창에서만 그려서다). focus 없이 연 창은 사람이 고른 상태가 아니므로 사람이 그 창을 최대화하거나 되돌리기 전에는 저장된 최대화 상태를 덮지 않는다.
  - 그 workspace를 이 창이 mount하고 있으면 평소처럼 `openAt()`이 자리를 정해 탭을 연다. mount하고 있지 않으면 창 단위 receiver가 그 workspace의 pool에 page를 숨은 항목으로 만들고, 자리(relation, source)는 pending으로 둔다. workspace가 다음에 그 창에 mount될 때 layout을 읽은 뒤 `openAt()`이 그 pending으로 탭 자리를 정하고, 만들어 둔 `<webview>`를 이어 쓰므로 다시 load하지 않는다. layout 파일은 renderer만 쓰므로 pending은 창 메모리에만 있다.
  - 창이 요청을 ack하면 shell main이 page가 붙기(guest의 dom-ready, bind)를 기다렸다가 core에 `done`으로 답한다. 그래서 첫 응답이 기한보다 늦는 site는 열기가 실패한다. 기한은 shell이 붙어 있으면 10초, 앱을 띄워야 했으면 30초(앱 시작, 창 열기, page까지 한 번에)다. 실패는 모두 `unavailable`이고 고정 문장이다(앱을 띄우지 못함, 시간 안에 page가 시작하지 않음, 받을 창을 만들지 못함, page를 둘 창이 답하기 전에 닫힘, 도중에 shell이 떨어짐). 실패하면 core가 표에서 탭을 빼고 page가 만들어졌을지 모르는 창에는 닫기를 보낸다. 탭이 남지 않는다.
  - shell이 없으면(앱이 꺼져 있음) core가 앱을 띄운다. 띄우는 조건과 한 번에 하나만 띄우는 규칙, 실패 뒤 쉬는 시간은 `platform.md` "core 수명"이다. 띄운 앱은 첫 창을 focus 없이 열고(`--agent-window`), 이미 떠 있는 앱은 창이 없을 때만 같은 창을 연다.
  - 이 모든 길이 사람이 하던 일을 끊지 않는다. 창을 앞으로 가져오거나 focus하지 않고 선택도 바꾸지 않는다.
- 사람이 host 탭을 닫거나 layout에서 사라지면 renderer가 `shell:surface-report`로 `closed`를 알리고 main이 `host/report`로 core 표에서 뺀다. browser 탭은 page가 탭 닫기 말고 다른 이유로 없어져도 같다: 상한으로 놓았을 때는 창이, 그 page를 든 창이 닫혔을 때는 main이 알린다(앱을 끌 때는 알릴 길이 없어 core가 shell 없이 온 browser 호출에서 그 탭을 빼고, 아래 not_found를 답한다). 그 뒤 그 탭에 온 `browser/*`는 없는 탭, 닫힌 탭, 남의 탭에 같은 `not_found` 한 문장으로 답한다. 이 문장은 model에 그대로 가서 agent가 다시 열게 한다. state(url, title, loading)와 bind는 창 단위로 알리므로 그 workspace가 mount되지 않은 동안에도 간다. agent가 연 browser 탭의 상태는 `browser-tab.md`다.

### 빠른 실행

작업 표시줄이 켜져 있으면 그 왼쪽 끝, 꺼져 있으면 왼쪽 sidebar 맨 아래 줄이다.

- 값은 전역 하나와 project마다의 덮어쓰기다. 전역은 core가 선언한 설정 셋: `shell.quick_launch`(단추 순서, 고정 앱 panel, 끈 단추. layout `quick`과 같은 모양), `shell.app_launch`(`<app>:<surface>` → `{ open: dock|float, rect? }`), `shell.coding_agents`(`{ favorites, commands }`)이고 `<data>/settings.json`에 있다. project의 layout에 `quick`이 있으면 그 project는 그 값을 통째로 쓰고(합치지 않는다) 없으면 전역 값이다. Home과 앱 workspace는 늘 전역 값이다. 쓰기는 먼저 화면에 반영하고 거절되면 다시 읽는다. 다른 창이 바꾼 값은 창 focus 때 다시 읽는다.
- project만의 값은 project settings 탭의 Quick launch(전역 값 따르기 Switch, 끄면 이 project만의 순서와 고정. 전역 값을 따르면 `quick`을 지운다)와 General(Workspaces panel의 상세 dialog와 같은 form과 project icon), App panels(앱 panel 화면 고정. 끈 동안만)에서 고친다. 진입은 sidebar의 지금 project 줄 톱니와 팔레트 행동 "Project settings"다.
- 단추는 순서를 바꾸고 끌 수 있다. 끈 단추는 `hidden`에 들고 순서에는 남아 다시 켜면 그 자리로 돌아온다. 고정을 풀면 그 id의 꺼짐도 버린다.
- Terminal·Browser·App은 누르기와 hover가 다르다. 누르면 그 탭을 연다(새 터미널, 새 browser 탭, 앱을 고르는 앱 panel 탭). pointer를 올리면 목록이 뜨고 줄을 누르면 바로 연다: Terminal은 즐겨찾기 coding agent(그 명령어로 docked 새 터미널)와 그다음 project의 명령 묶음(Commands, layout의 `commands`, 최대 20개), Browser는 bookmark, App은 앱 workspace의 앱 화면과 설치된 앱의 panel 화면 전부다. 즐겨찾기가 없어도 명령이 있으면 목록이 뜬다. hover 면은 누르기가 면을 토글하지 않는다.
- 앱 panel 화면은 여는 자리를 기억한다. 같은 앱·화면 탭이 어디든 있으면 그 자리에서 보이고, 없으면 `shell.app_launch`의 `open`대로 tab이나 float이다. float은 마지막 rect를 지금 float 층 안으로 당겨 쓰고 없으면 float 층 가운데 60%다. 사람이 앱 panel float을 옮기거나 크기를 바꾸면(놓을 때 한 번) 그 화면의 rect를 쓴다. 그 화면이 이미 전역 float이면 새로 열지 않고 그것을 펴서 맨 위로 올린다. `open`은 Settings › Quick launch의 App panels 줄(Tab · Float)에서만 바꾼다.
- coding agent 즐겨찾기와 명령어는 Settings › Coding agents 표의 Command·Favorite 열이다. 명령어를 비우면 adapter의 첫 명령어이고 기본 즐겨찾기는 Claude Code, Codex, OpenCode다.

### 앱 화면의 머리 줄

앱 화면은 lophn이 감싸는 프레임의 머리 줄에 올린다. 앱 page가 `useTabHead`로 글과 id만인 `TabHead`(경로 조각, 탭, 상태 글, ⋯ 앞 단추, ⋯ menu 묶음, ← →)를 보내면 shell이 머리 줄 값으로 바꾼다. 탭(앱 화면 탭, dock한 앱 panel 탭)은 card의 머리 줄에, card 칸이 없는 프레임(tray popup 머리, 앱 sidebar panel 머리의 단추 자리, 앱 panel float의 bar, session 앱 카드의 줄 끝)은 그 프레임이 같은 값의 가운데·단추·⋯ 메뉴를 그린다(nav는 탭만, tray popup은 앱 단추만 icon 단추로). 단추의 `icon`은 `TAB_HEAD_ICONS`(refresh, add, open, edit, delete, copy, run, stop, download)의 이름이고 모르는 이름은 버려 글 단추가 된다. 그 프레임의 제목과 단추(pin, minimize, dock, close)는 그대로 둔다. 앱 전용 창과 detached 창의 앱 panel은 머리 줄이 없어 앱이 같은 조작을 스스로 그린다.

- 통로는 main을 거치지 않는다. preload가 host로 올리고 webview 그릇이 그 element의 message로 받고 element로 내린다. 머리 줄은 그 탭 안의 표시라 신원이 필요 없고 보낸 element가 곧 그 탭이다. 받은 값은 글·bool만 남기고 자른다(앱 코드가 객체를 보내 React child가 되면 창이 깨진다). page는 preload가 붙자마자 shell이 머리 줄을 그리는지(shown)를 물어 보통 첫 render 전에 답을 쥐고, 답을 못 받았으면 그릇이 dom-ready에 다시 보낸다.
- 살려 두기 신호는 같은 길로 올라간다. 신호는 key별이고(`useKeepAlive`와 agent turn 동안의 자동 신호) preload가 켠 key 집합을 쥐어 "켠 key가 있나" 하나만 올린다. 그릇이 그 화면의 신호로 쥐고 page가 새로 load되면(preload도 새로 만들어져 key 집합이 비므로 어긋나지 않는다) 지운다.
- 앱 panel 탭에는 평소 shell 크롬 줄이 없다. 탭 이름이 이미 앱 이름이고, 탭 줄과 앱 화면 사이에 다른 바탕의 줄이 끼면 탭과 본문이 한 면으로 이어지지 않는다. 화면이 멈추거나 crash했을 때, 앱이 멈췄을 때만 상태와 [Open again] 줄이 선다. 앱 template은 앱 바탕을 탭 본문과 같게 두지만 강제하지 않는다.

### icon

- 앱 icon은 사람이 올린 것이 선언한 것보다 앞서고 layout에 싣지 않는다. 선언의 `icon`(bundle 안 `/…/x.svg|png|webp` 경로, 64 KiB 이하)은 release 준비가 source commit에 그 파일이 있는지 본다. core의 `apps.icon` read(`{app}` → `{icon: {content_type, data(base64)} | null, uploaded}`)가 먼저 사람이 올린 icon을 보고 없으면 active release의 bundle 사본에서 읽는다. bundle 밖을 가리키는 경로, symlink, 큰 파일, 선언 없음은 모두 `null`이고 오류가 아니다. 사람은 App details의 Icon 절에서 올리고 지운다(`app.set_icon {app, icon | null}`. 지우면 선언한 icon, 그것도 없으면 첫 글자 표식으로 돌아간다). 탭의 저장 값에는 들어가지 않고 그릴 때마다 읽는다(10초 cache, 올리거나 지우면 버린다).
- project icon은 사람이 올린 이미지만 있다(선언이 없다). core `projects.icon`(`{project}` → `apps.icon`과 같은 출력)과 `projects.set_icon`(`{project, icon | null}`)이고 올리는 칸은 앱과 같이 쓴다.
- 올린 icon은 ledger 표(`app_icons`·`project_icons`, schema step `apps.registration.icons`·`projects.registry.icons`)에 base64 글 그대로 앱·project당 한 줄로 둔다(64 KiB 이하라 blob 저장소를 거치지 않고 revision도 event도 올리지 않는다). 검사는 하나다: svg·png·webp만, 64 KiB 이하, 선언한 type과 바이트 앞부분이 맞아야 하고 아니면 `invalid_input`, 없는 앱·project는 `not_found`다.

### 저장

- layout 파일은 workspace마다 하나다: `<data>/shell/workspaces/<workspace>.json`, workspace는 `home`, project id, 앱 id. 파일 이름이 되는 key는 `[A-Za-z0-9_-]{1,64}`만 받아 폴더 밖으로 나갈 수 없다(`invalid_input`). 쓰기는 원자 교체다.
- 모양은 `{ schema_version: 10, active_desk, desks: { <key> → { label, workflow?, tabs, selected_tab, groups: [{ layout, focus }], floats: [{tab, rect, minimized, pinned?}], detached: [{tab, bounds}] } }, quick?: { order, apps: [{ app, surface }], hidden? }, commands?: [{ id, label, command }] }`다. desk는 1~200개이고 `_default`가 늘 있다. desk마다 floats·detached는 각 최대 20, tabs는 최대 1200이다. 한 desk 안에서 탭 key는 tabs·floats·detached를 통틀어 한 번만 나오고 `selected_tab`과 group의 leaf는 tabs 안에 있다. group은 leaf 2~4개이고 위 "group과 칸의 stack"의 불변 조건을 schema가 거절로 지킨다. leaf는 `{ tab, stack? }`(stack은 선택 필드라 옛 파일도 읽힌다), `ratio`는 0.15~0.85다.
- `quick`은 project만의 빠른 실행 순서(단추 id), 고정한 앱 panel 화면, 끈 단추 id다. `commands`는 project만의 터미널 명령이라 전역 값과 `quick`의 전역 값 따르기와 상관없이 남는다. 없어진 앱과 모르는 id는 그릴 때 건너뛴다.
- 탭 값은 kind마다 `toStored` 값으로 저장한다. `toStored`·`fromStored`가 없는 kind(Agent 탭)는 저장하지 않는다: 저장 모양에서 그 탭을 빼고(아래 "저장하는 값"의 규칙으로 group·고른 탭을 맞춘다) main의 kind registry에도 없다. plain terminal과 app panel 탭은 선택 칸 `title`을 남기고 되살려 다시 띄워도 이름이 비지 않는다. 터미널 탭은 coding agent가 돈 적이 있으면 `harness`를 지녀 다른 workspace의 창이 저장된 layout만 보고 coding agent 터미널을 알아본다. 그런 탭은 agent가 정한 지금 이름(사람 이름이 없고 자동 이름과 다를 때)을 `agent_title`로 남겨, store가 아직 이름을 모를 때 다른 workspace의 sidebar가 쓴다(복원은 쓰지 않는다). browser 탭은 favicon과 `keep_alive`를 저장한다.
- 읽는 순서: 파일이 있으면 판 10만 읽는다(다른 판은 `unsupported_schema`이고 파일은 그대로다). 없으면 `absent`이고 renderer가 Main 하나인 기본 layout(앱은 앱 화면 탭 하나가 선 layout)을 쓴다. 옛 판은 data step으로 올린다: core의 `artifacts.container`(판 8 → 판 9, domain을 모르는 artifact 탭은 그 탭만 뺀다)와 `shell.workspace-layouts`(옛 `shell/places/`의 판 9 → `shell/workspaces/`의 판 10, 옮길 자리에 파일이 있으면 덮지 않는다). 옛 `layouts/<prj_id>.json`(판 5~7)은 읽지도 올리지도 않는다. 판 10 layout과 전역 float(판 2)에 이미 저장된 Agent 탭은 core의 data step `shell.agent-tabs-unsaved`가 걷어낸다(tabs·floats·detached에서 지우고, Agent 탭이 든 group은 풀며, 고른 탭이 지워졌으면 첫 보이는 탭을 고른다. 모양은 판 그대로다).
- 저장하는 값은 desk 모델 → 저장 모양(transient 탭 빼기, kind registry의 `toStored`, 저장할 수 없거나 저장하지 않는 kind의 탭이 빠지면 그 leaf를 걷어내고 1개가 된 group은 풀며 고른 탭을 남은 탭 안으로 고치기)이고, main이 저장할 때 살아 있는 detached 창의 bounds로 덮는다. 바뀔 때마다 저장하고 읽던 위치·입력 같은 잦은 바뀜은 200ms 모아 쓴다. workspace를 바꾸면 창 본문이 새로 mount되고 배치를 읽은 뒤 desk를 그린다(project·파일 목록은 기다리지 않는다). 읽는 값은 파일에 이 창 메모리의 layout을 얹은 것이다: layout source가 workspace마다 이 창이 마지막으로 읽거나 쓴 layout을 들고 있다가 파일이 그 layout의 저장 모양과 같을 때(detached 창 bounds는 main이 덮으므로 뺀다) 그 layout을 돌려준다. 그래서 Agent 탭이 workspace를 오가는 동안 남고, 다른 창이 그 workspace를 고쳐 파일이 달라졌으면 파일이 이겨 그 workspace의 Agent 탭은 잃는다. 읽기는 같은 workspace의 쓰는 중인 저장이 끝나기를 기다린다. 창 메모리는 창이 닫히면 사라진다. 읽기 전에는 card가 빈 desk 안내 대신 빈 card다. 왼쪽 sidebar가 읽는 목록은 창마다 하나인 메모리의 마지막 값에서 시작해 다시 mount돼도 빈 목록부터 그리지 않는다.
- 전역 float은 `<data>/shell/global-floats.json` 하나다: `{ schema_version: 2, floats: [{ workspace: { kind: home|project|app, id? }, tab: <kind의 toStored 값. layout 파일의 탭과 같다>, rect, minimized, pinned? }] }`(최대 20, 아래에서 위 순서. Agent 탭의 float은 쓰지 않는다. 전역 float 상태는 창 하나에 하나인 store가 메모리로 들고 있어 workspace를 바꿔도 남는다). 없거나 다른 판이면 빈 목록이고 모르는 kind·틀린 탭은 그 float만 빠진다. 판 1(`{ app, screen, rect, … }`)은 core의 data step `shell.global-floats-tabs`가 앱 panel 탭(workspace Home)으로 옮긴다.
- 터미널 탭 정리: 창이 layout을 읽으면 창의 terminal store가 모르는 터미널 탭(docked, floated)은 닫는다. 그대로 두면 탭이 처음 보일 때 새 shell을 띄워 lophn을 다시 켤 때마다 지난 터미널 수만큼 shell이 새로 떴다. 같은 실행에서 workspace를 오가는 동안은 store가 PTY를 들고 있어 남는다. 전역 float도 같고 detached 터미널은 다른 창의 것이라 건드리지 않는다. coding agent session은 sidebar Recent에서 다시 연다.

## 지키는 것

1. **탭 하나는 한 곳에만 있다.** tabs, floats, detached 중 하나다. 같은 탭을 두 자리에 그리면 editor는 session이 둘이 되어 conflict가 나고 terminal은 입력을 받을 수 있는 webContents가 하나뿐이다. 열기, split·swap·ungroup, float, dock, minimize, restore, detach, reattach, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는다. 이미 float·detached인 탭을 열면 새로 붙이지 않고 float이면 펴서 맨 위로 올리고 detached면 그 창을 앞으로 가져온다.
2. **desk를 건너서도 한 곳에만 있다.** 같은 key의 탭은 두 desk에 없다. 탭을 열 때 그 탭이 이미 있는 desk가 있으면 그 desk로 바꿔 보인다(float이면 펴고, detached면 창을 앞으로). 새 탭이라도 열라는 자리(after)가 다른 desk의 탭이면 그 desk로 건너가 그 탭 뒤에 연다(숨은 desk의 terminal이 연 URL). 탭을 빼앗아 오지 않는 까닭은 detached 창과 살아 있는 터미널이 딸려 있어서다. 이 보장은 모델과 그 위험 test가 지키고 schema는 desk 사이의 겹침을 거절하지 않는다.
3. **탭을 찾고 바꾸는 곳은 tabs, floats, detached를 모두, 그리고 모든 desk를 본다.** 탭 열기, 탭 값 바꾸기, 닫기, 닫은 탭 다시 열기, 파일 이름 바꾸기, 대기 목록의 터미널 고르기, agent 탭 번호와 같은 session 재사용이 float 탭에도 같다. 닫은 float 탭은 tab으로 돌아온다. detached 탭을 여는 길은 모두 그 창을 앞으로 가져오고 닫는 길은 그 창을 닫고 항목을 버린다. palette 탭 행에는 보이는 desk의 tabs만 나온다.
4. **화면이 그리고 고치는 것은 보이는 desk뿐이고 `<webview>`는 탭이 사는 동안 모든 desk에서 산다.** 고르지 않은 탭과 떠난 desk의 탭은 React에서 unmount한다. 터미널은 창의 display가 xterm·DOM·출력 구독을 유지해 돌아오면 다시 붙으며 과거 raw 출력을 다시 재생하지 않는다. browser 탭·앱 panel·artifact 탭의 `<webview>`는 탭 key가 어느 desk에든 layout에 있으면 그릇이 숨긴 채 들고 있어 탭이나 desk를 오가도 page를 다시 load하지 않는다. 놓는 것은 탭 key가 모든 desk에서 사라졌거나 그 탭이 detached가 됐을 때뿐이다.
5. **Detach와 Dock은 transfer → main의 창 처리 → 성공했을 때만 layout 바꾸기다.** 어느 단계가 실패해도 탭은 그 자리에 남는다. editor의 저장 안 된 글은 flush가 성공해야 옮기고, 실패하면 옮기지 않는다.
6. **저장하는 곳은 project 창 하나다.** layout 파일은 workspace마다 하나이고 마지막에 쓴 것이 이기므로 detached 항목까지 project 창이 갖고 저장한다. 저장 모양은 읽을 때 schema로 검증한다(key 형식, 개수 상한, 불변 조건). 다른 판은 `unsupported_schema`이고 파일은 그대로다. 폴더 밖으로 나가는 key는 `invalid_input`이다.
7. **저장하지 않는 것과 저장 자리가 다른 것.** transient 탭과 Agent 탭은 저장하지 않고(Agent 탭은 창 메모리에만 있어 앱을 다시 켜면 없다. 어느 자리에 있어도 파일에 남지 않고 남은 탭의 group·고른 탭은 불변 조건을 지킨다) 이동 기록은 메모리뿐이며 desktop 창의 자리는 layout이 아니라 앱 하나의 `window.json`이다. detached 창은 `window.json`을 쓰지도 고치지도 않는다.
8. **desk를 지우는 것은 그 일을 끝내는 것이다.** desk의 탭·float·detached를 모두 보통 닫기 길로 닫은 뒤 desk만 지우고, 하나라도 거절하면 desk는 남는다. 탭을 Main으로 옮기지 않는다. workflow desk가 workflow가 끝나 사라질 때만 Main에 합치고, 그것도 workflow 목록 읽기에 성공했을 때만 한다.
9. **float은 고정과 고정 안 함이 있고 겹침은 z-index로만 정한다.** 고정한 패널은 늘 고정 안 한 패널 위이고 고정 안 한 펴진 패널은 밖을 누르면 접힌다(닫지 않는다). 패널을 raise해도 DOM을 재배열하지 않는다.
10. **rect는 float 층 기준 정수 px이고 저장된 값은 사람이 바꿀 때만 바뀐다.** 최소 320×200, 그릴 때만 층 안으로 당긴다. 층을 아직 못 쟀으면 그리지도 저장하지도 않는다.
11. **전역 float은 workspace layout 파일과 따로 저장하고 층은 workspace 창 밖에 있다.** workspace를 바꿔도 page가 다시 load되지 않는다. 전역 float은 탭이 나온 workspace를 지니고(앱 panel 제외) 받는 쪽이 못 받으면 옮기지 않아 float이 사라지지 않는다.
12. **`<webview>`는 그릇 하나에 탭 key당 한 번 만들고 옮기지 않는다.** 그릇은 workspace 창마다 하나이고 workspace를 넘어 page를 살리는 것은 전역 float과, 살려 둘 이유가 있는 page(상한 6개), agent가 연 browser 탭의 page(상한 12개, 따로 센다)뿐이다.
13. **native view는 browser의 크기 준 popup과 DevTools, overlay뿐이고 층 순서는 그 위에서 정해진다.** 쌓는 순서는 card 화면 < floated 화면 < overlay다. 보내는 창이 가진 view만 옮길 수 있다.
14. **detached 창은 탭 하나만 그리고 ×는 dock이다.** 창이 예기치 않게 사라지면 탭이 layout에 남는다. 앱을 끄는 중에는 자동으로 dock하지 않는다. main은 탭 값을 열어 보지 않고 같은 project 창에만 중계하며 보낸 창의 역할을 가려 `forbidden`으로 막는다.
15. **같은 (project, key)의 detached 창은 하나이고, PTY 참조는 메모리에만 두며 같은 PTY가 두 창에 붙지 않는다.**
16. **살려 둔 page는 이유가 있을 때만, 창마다 6개까지다.** 이유는 앱의 살려 두기 신호, 사람이 켠 Keep alive, download 중, 소리 중이다. 넘치면 가장 오래 안 본 것부터 놓는다. agent가 연 browser 탭의 page는 이 상한과 따로 창마다 12개까지다.
17. **layout을 읽을 때 PTY가 없는 터미널 탭은 뺀다.** 다시 켤 때마다 지난 터미널 수만큼 shell이 새로 뜨지 않게 한다. 같은 실행에서 workspace를 오가는 동안은 PTY가 남는다.
18. **agent가 연 탭은 사람이 하던 일을 끊지 않는다.** 선택하지 않고, 창을 앞으로 가져오거나 focus하지 않는다. browser 탭(`--url`)이 아닌 열기는 요청을 넣고 바로 `accepted`를 답해 기다리지 않는다. browser 탭은 page가 붙었다는 shell의 답을 기다린 뒤 답한다(실패는 `unavailable`이고 탭이 남지 않는다). 남의 탭 닫기는 `forbidden`, 없는 탭은 `not_found`, 다른 workspace의 session이 앱 preview를 열려 하면 `not_found`, 돌고 있는 preview가 없으면 `conflict`다. 요청은 core 메모리에만 있어 꺼지면 사라진다(shell이 없거나 보이는 창이 없으면 기다리고 200개를 넘으면 오래된 것부터 버린다. browser 탭 열기는 이 기다림에 들지 않는다. 받을 shell이 있으면 어느 창이든 받고, 없으면 앱을 띄운다).
19. **앱을 영구히 지우면 그 앱의 layout 파일과 전역 float이 지워지고, 다른 workspace layout의 앱 panel 탭과 고정은 남아 "앱이 없다"로 그려진다.**
20. **desktop 창의 자리는 앱에 하나이고 새 창은 화면 작업 영역 안에서 열린다.** 최소화와 전체 화면은 쓰지 않는다.

## 경계와 계약

- boundary: `host-queue-core`(core의 host queue), `host-queue-interface`.
- 저장 파일:
  - `<data>/shell/workspaces/<workspace>.json`: layout(판 10, 위 "저장").
  - `<data>/shell/global-floats.json`: 전역 float(판 2).
  - `<data>/shell/window.json`: `{ bounds, maximized }`, 앱에 하나.
  - `<data>/settings.json`의 `shell.quick_launch`, `shell.app_launch`, `shell.coding_agents`, `shell.taskbar`, `shell.sidebar_panels_off`, `shell.tray_off`, `shell.tray_order`.
  - ledger: `app_icons`, `project_icons`(step `apps.registration.icons`, `projects.registry.icons`).
- IPC(창과 main):
  - layout: `shell:workspace-layout-read {workspace}`, `shell:workspace-layout-save {workspace, layout: {active_desk, desks}}`(desktop 창 본문만 부른다).
  - 전역 float: `shell:global-floats-read`, `shell:global-floats-save`(main이 schema로 검증해 원자 교체로 쓴다. 검증 실패는 `invalid_input`이고 파일은 그대로, 읽을 때 틀린 파일은 빈 목록).
  - detached: 열기, 가져오기(take), 바뀜 알림, 탭 열기(`open-tab`), 닫힘, 뜸, dock 요청, 보일 desk의 key 목록(`showOnly`, project 창만. detached 창이 부르면 `forbidden`), 창 자리 알림, resume 값을 한 IPC로 묶는다.
  - agent가 연 탭: `shell:surface-workspace`, `shell:surface-request`, `shell:surface-ack`, `shell:surface-report`.
  - 앱 page ↔ shell: `app:keep-alive`, `app:content-size`(tray popup 크기), `useTabHead`의 머리 줄 값(main을 거치지 않는다).
- core route: `tabs/open`, `tabs/close`, `browser/read`, `browser/*`(browser 호출), `host/take {workspaces, tui}`, `host/done {done | output}`, `host/report`, `apps.icon`, `app.set_icon`, `projects.icon`, `projects.set_icon`, `apps/list`, `apps/tools`. 앱 삭제는 core가 commit 뒤 내는 남지 않는 event `AppRemoved`를 shell main이 받는다. 앱 view 바뀜 event `AppViewChanged`(reason `activation`)가 sidebar·tray 목록을 다시 읽게 한다.
- CLI: `lophn tab open|close`(`--session`, `--url`, `--tui`, `--preview <app>`, `--artifact <name>`, `--workspace`), `lophn browser snapshot|act|navigate|screenshot|evaluate|logs|wait`, `lophn preview start`. env `LOPHN_WORKSPACE`.
- 탭 kind 계약: 각 kind가 저장 값(`toStored`/`fromStored`. 둘 다 없으면 저장하지 않는 kind), `transfer`/`receive`(Detach·Dock·전역 이동), `resume`(detached 창이 PTY 참조 같은 것을 알린다), 닫기 확인, `keep`/`render`, `noDetach`, `noGlobal`, `anyWorkspace`, home desk를 가진다.
- 탭 key 규칙: 앱 화면 탭 `app-screen:<app>`, preview 탭 `app-preview:<app>`(사람이 연 것)·`host:<tab id>`(agent가 연 것), artifact 탭 `artifact:<kind>:<id>:<name>`(사람이 연 것)·`host:<tab id>`(agent가 연 것), 전역 앱 panel float `global:<app>:<screen>`, sidebar panel view `sidebar:<app>:<screen>`, 고정 탭 `project-settings`·`app-detail`·`jobs`·`inbox`, workflow desk의 `workflow:<이름>`.
- 빠른 실행 hover 목록과 탭 줄 + menu의 Agent 단계는 같은 agent 목록 값 하나다. + menu의 Agents 항목은 그 workspace의 Agents(관리) 탭을 연다. 사람이 agent 정의를 고치는 유일한 일반 입구라 Home, project, 앱에 모두 둔다(Agents 통로가 없으면 항목이 없다). 왼쪽 sidebar의 Workspaces 줄은 route `startSession`·`startSettings`·`startAppScreen`으로 다른 workspace로 가서 연다.
- 단축키: `pane.split`, `pane.focus`(1~4), `pane.focus-left/right/up/down`, `tab.*`(자세한 값은 `keybindings.md`).
- tab menu 항목: Rename, Close, Close others, Close others in pane, Close group, Close to the right, Close saved, Close all, Split right, Split down, Move out of pane, Remove from split, Unsplit(all), Float, Move to new window, Copy path, Copy relative path, Reveal in Explorer, Keep open. 패널 bar의 Minimize·Dock·Close, detached 창 bar의 [Dock]이 같은 모델 동작을 부른다. Detach는 palette 명령이 없다. palette의 Dock·Minimize 대상은 맨 위의 접히지 않은 패널이고 접힌 패널은 먼저 펴야 Detach할 수 있다.

## 결정

- layout 파일은 workspace마다 하나다. 이유: 하나를 앱 전체가 쓰면 다른 project를 열어 저장할 때 앞 project의 layout을 덮어써 workflow desk를 모두 잃는다. 이름은 `project.update`로 바뀌므로 파일 이름은 id다. (agent)
- desk key는 workflow desk면 그 project 안의 workflow 이름이고 기본 desk는 `_default`다. 사람이 만든 desk는 `desk-<시각>-<번호>`이다. 이유: project 이름을 넣지 않아 project 이름을 바꿔도 desk가 남고 `_`로 시작하는 값은 slug가 아니라 workflow 이름과 겹치지 않는다. 기본 desk 이름은 "Main", 즉시 전환, workflow 목록 읽기 실패는 따로 알리지 않는다. (사람 2026-10-22: 이름·즉시 전환·알리지 않음, key 형식은 agent)
- desk를 건너 탭 key가 겹치는지는 schema가 거절하지 않는다. 이유: 거절하면 읽기가 손상이 되어 layout 전체를 잃는다. 겹침은 모델과 그 위험 test가 막는다. (agent)
- 사라진 workflow desk는 Main으로 합치되 목록 읽기에 성공했을 때만 한다. 합치며 float·detached 상한을 넘는 탭은 tab으로 보낸다. 이유: 읽기 실패에 합치면 desk의 탭이 모두 옮겨진다. (agent)
- desk를 닫는 것은 그 일을 끝내는 것이다. 버린 길: 탭을 Main으로 옮기고 desk만 지우기. (UI 개편 때 정함)
- desk를 바꿀 때 detached 창은 "보일 key 목록" 한 번으로 맞춘다. 이유: 창마다 부르면 중간에 일부만 바뀐 채 남을 수 있다. 창이 없는 key를 main이 열지 않는 까닭은 열기에 필요한 탭 값과 bounds를 renderer가 갖고 있고, 이미 있는 창에 열기를 부르면 앞으로 가져와 focus를 뺏어서다. 보이기는 focus 없이 한다. (agent)
- `<webview>`는 layout에 있는 동안 숨기기만 한다. 이유: desk를 떠났다 돌아오면 쓰던 form·scroll을 잃던 결함이 있었다. 탭 key가 어느 desk에든 있는 동안 element를 들고 있으면 desk 전환에 드는 것이 없고, detached 탭만 그 창에 넘긴다(page가 두 창에 살지 않게). 처음 desk를 도입할 때는 떠난 desk의 탭을 unmount하고 app panel의 native view만 살렸고 일반 browser 탭은 돌아오면 다시 load했다. (agent)
- 앱 화면과 artifact 화면도 `<webview>`로 옮겼다. 이유: native view는 shell HTML 위에 그려져 menu·popover·floated 패널·toast가 앱 page 밑에 깔렸고 피하려고 층·cover·bounds relay가 쌓였다. browser 탭이 같은 이유로 이미 `<webview>`를 쓰고 그 뒤로 겹침 문제가 없다. 버린 길: iframe(preload의 isolated world, 앱별 partition, sender 신원을 잃는다), remote UI(앱이 자기 DOM·CSS component를 못 쓴다). Electron은 `<webview>`를 권하지 않지만 browser 탭이 이미 그 위험을 지고 있어 새 위험이 아니다. (사람, 2026-10-31) artifact 탭도 같은 겹침 문제가 있어 같이 옮겼고 남겨 두면 앱 쪽 장치를 지우지 못한다. (agent)
- 붙이기 ticket은 `src` 하나이고 한 번만 쓴다. 이유: renderer가 붙이기 값을 위조해도 다른 session이나 preload로 갈 수 없다. (agent)
- 앱 저장소 partition 이름(`persist:app-<app>:live`, `persist:app-<app>:preview-<bundle hash>`)은 바꾸지 않는다. 이유: 사람의 `~/.lophn` cookie·localStorage·IndexedDB가 이어지고 migration이 없다. (agent)
- 겹치는 패널은 `<webview>` 위에 DOM으로 그린다. 이유: native view 때는 화면이 DOM 위에 그려져 겹치는 동안 view를 cover로 줄여야 했다. 버린 길: 겹치는 동안 마지막 `capturePage` 그림 보이기(page가 멈춘다), DOM 패널도 native view로 띄우기(패널마다 shell renderer 하나라 가장 크다). 잃는 것은 없다. 밑의 page가 패널에 가려진 채 계속 돈다. (agent. 앱 화면이 `<webview>`가 된 뒤 cover 장치는 없어졌다)
- view 보관소는 renderer에 둔다. 이유: main registry가 이미 view와 붙은 guest를 구분하므로 새 IPC가 필요 없고, 탭을 닫는 길이 여럿이라 길마다 닫지 않고 layout에 없으면 닫는다. (agent)
- 탭 하나는 한 곳에만 있다. 이유: editor session과 terminal 입력이 하나뿐이다. (agent)
- floats 개수(20)는 schema만 막는다. 이유: 사람이 20개를 띄울 일이 없다. 새 패널은 float 층 가운데 60%로 겹쳐 뜨고 비껴 놓기는 하지 않는다. (agent)
- float은 고정(항상 위)과 고정 안 함이 있고, 고정 안 한 패널이 "내려가는" 것은 접기다. 새 float은 고정 안 함이다. 고정 안 한 패널을 접는 조건은 사람이 누른 pointerdown과 webview 안 click(webview 그릇이 쏘는 focusin)뿐이고 코드가 옮긴 focus로는 접지 않는다. 사람이 요청했다(2026-11-04). 닫거나 뒤로 보내는 안은 고르지 않았다. (사람: 요청, agent: 접기·기본값·focus 규칙)
- rect 기준은 stage가 아니라 창 몸통(양쪽 sidebar 포함)이다. 이유: 패널이 card 칸에 갇히지 않고 sidebar 위로도 가게 하려고 사람이 요청했다. 저장된 옛 rect는 옮기지 않았다(옛 rect는 왼쪽 sidebar 폭만큼 왼쪽에 그려진다. 그 폭이 창마다 달라 옮길 값이 없다). (사람, agent)
- 전역 float 층은 workspace 창 밖 `Desktop`에 둔다. 이유: `<webview>` 그릇이 workspace 창마다 새로 생겨서 그 안에 두면 workspace를 옮길 때 page가 다시 load된다. 저장을 workspace layout 파일 밖에 둔 까닭은 한 float이 어느 workspace에도 속하지 않아서다(layout 파일은 workspace마다 하나라 거기 두면 workspace 수만큼 복사본이 생긴다). float에도 전역 범위가 있고 전역 float의 접힘도 전역으로 남는다. extension이라는 사용자 개념은 두지 않고 sidebar panel, tray, 전역 float는 앱이 채우며 lophn은 자리와 hook만 더한다. (사람, 0.19.0)
- 전역 float은 어느 kind든 되고 탭이 나온 workspace를 지닌다. 이유: 터미널의 cwd, agent의 workspace, 파일의 folder가 그 workspace의 것이라 workspace 없이 그리면 뜻이 없다. 앱 panel만 예외다. 본문이 여는 탭은 같은 workspace의 새 전역 float이 된다(버린 길: 지금 창의 desk에 연다. 다른 workspace의 창이면 탭이 그 창에서 렌더되지 않을 수 있다). 터미널은 같은 창 store가 이미 같은 runtime을 가졌으면 receive가 `adopt`하지 않는다(phase를 opening으로 되돌려 붙어 있는 display가 멈춘다). 처음에는 `panel` 자리 앱 화면만 workspace 없이 전역 float으로 했다. (agent, 0.19.0 → 0.23.0)
- 작업 표시줄은 몸통 밖 줄이다. 이유: 몸통 안에 두면 float 층이 덮고 stage 아래 여백과 겹친다. `.shell`의 마지막 줄로 두면 float이 닿지 않고 chip을 늘 누를 수 있다. 접힌 float과 전역 float을 한 곳에서 보이려는 줄이라 이름이 보이고, 필요 없는 사람은 끌 수 있다(끄면 chip은 옛 자리인 탭 줄 끝이다). (agent)
- 오른쪽 sidebar의 열림은 workspace마다 기억하고 왼쪽은 하나, 폭은 쪽마다 하나다. 이유: 오른쪽은 workspace마다 쓰임이 달라 한 workspace에서 접은 것이 다른 workspace의 모양을 정하면 어색하다. 왼쪽은 어느 workspace에서나 같은 목록이다. (사람)
- workspace 이동은 왼쪽 sidebar의 Workspaces 줄이 맡는다. 별도 switcher나 launcher 화면은 없다. 창 하나가 한 번에 workspace 하나를 보이고 옮기면 창 본문을 새로 mount한다. (agent)
- 앱 panel을 여는 길은 activity bar가 아니라 + menu, 빠른 실행의 App, 고정한 빠른 실행 단추, 앱 workspace의 열기다. 고정 앱은 desk가 아니라 project 단위로 layout 파일에 둔다. 이유: 개편 때 칸 grid와 activity bar가 있어 같은 일이 공간마다 달랐고 화면이 무거웠다. 옛 `rail_apps`와 앱 localStorage 배치는 읽지 않는다. (사람)
- 빠른 실행은 project 값이 전역 값을 통째로 덮는다(합치지 않는다). 앱 panel의 여는 자리와 기억한 rect는 앱 panel 화면(`<app>:<surface>`)마다 전역 하나다. 여는 자리는 사람이 고르는 설정이고 기억은 float 자리·크기만 한다(마지막에 dock했는지 float했는지는 따라가지 않는다). 끈 단추는 순서에서 빼지 않고 `hidden`에 따로 둔다(순서에서 빼면 모르는 기본 단추를 끝에 다시 붙여 꺼지지 않는다). 즐겨찾기의 기본값은 전에 고정이던 Claude Code·Codex·OpenCode다. (사람: 덮어쓰기, agent: 나머지)
- 앱 panel 탭에는 평소 shell 크롬 줄을 두지 않고 문제가 있을 때만 띄운다. 이유: 탭과 본문이 한 면으로 이어지지 않는다. 앱 바탕은 template에서 맞추고 강제하지 않는다(같은 판의 SDK byte를 바꾸면 기존 앱의 설치가 깨진다). (agent: 줄, 사람: 강제하지 않음)
- group은 칸 tree가 아니라 tabs 위의 값 하나다. 이유: 옛 칸 tree는 칸마다 탭 줄·focus·drop zone을 따로 갖게 해 탭이 어느 칸에 있는지가 복잡했다. 탭 줄은 하나로 두고 같이 볼 탭 2~4개만 한 칸으로 묶으면 탭 줄·선택·저장이 한 줄로 끝난다. 처음에는 붙은 탭 둘이었으나 자유 배치(위 둘 아래 하나, 2×2)를 위해 나눔 tree를 가진 group(최대 4칸)으로 넓혔다. 칸마다 탭 줄이 있는 옛 방식으로는 돌아가지 않는다. (사람)
- 칸은 구조와 상관없이 평평한 absolute 상자다. 이유: tree를 중첩 flex로 그리면 나눔이 늘거나 줄 때 leaf의 부모가 바뀌어 본문이 다시 mount된다(터미널·editor 상태, webview slot). (agent)
- 칸의 stack: 칸에 쌓인 탭은 탭 줄에 따로 칸을 두지 않고 group 칸 안에 그 칸 자리로 보인다(개수 표시와 밑줄은 쓰지 않는다. 사람 2026-11-02). group 칸 가운데에 놓기는 swap이 아니라 그 칸에 쌓기이고(group이 아닌 칸의 가운데는 swap), 옮기면 group이 풀리는 놓기는 막는다. `stack`은 선택 필드라 판을 올리지 않는다. (agent)
- drag and drop은 HTML5 drag가 아니라 pointer drag다. 이유: `<webview>` 위를 지날 때 guest로 이벤트가 새지 않게 끄는 동안 webview의 pointer를 끈다. (agent)
- 탭 안에서 연 탭의 자리는 정책 하나가 정한다. 이유: float·minimized·detached 자리가 있고 여는 source(터미널, coding agent, lophn agent)가 여럿이라 여는 쪽마다 정하면 규칙이 갈라진다. 처음에는 pane이 하나면 자동으로 나누지 않고 source 뒤에 열었다(버린 길: 자동 split, layout이 바뀐다. 사람). 그 뒤 터미널 source에서는 터미널을 가리지 않도록 옆 칸에 연다. (사람, agent)
- 숨은 desk의 터미널이 연 URL은 그 desk에 탭을 열고 그 desk로 넘어간다. 이유: 로그인 page를 사람이 봐야 해서다. 다른 desk 터미널에는 반대쪽 pane 규칙을 쓰지 않고 터미널 바로 뒤에 연다. (agent)
- detached 창은 탭 하나만 갖는다. 이유: 탭 줄이 있는 detached 창은 workspace를 하나 더 만드는 일이다. 탭 여럿을 보려면 창을 여럿 띄운다. dock은 그 desk의 tabs 끝에 붙이고 떼기 전 자리는 저장하지 않는다. 창 하나가 workspace 하나를 보이고 Detach는 project만 한다. (agent)
- Detach 순서는 transfer → 창 처리 → layout이다. 이유: 어느 단계가 실패해도 탭이 그 자리에 있다. editor flush가 실패하면 알리지 않고 옮기지 않는다(저장 실패는 파일 탭이 이미 보인다). (agent)
- 값은 창이 뜬 뒤 당겨 받는다. 이유: hash는 route 선택용이고 탭 key가 4096자까지이며 transfer가 커질 수 있다. 두 방향(project 창, detached 창)을 IPC 하나로 묶는다. 이유: 같은 renderer bundle과 preload를 쓰는 창이고 main이 보낸 창으로 역할을 가른다. 통로를 둘로 가르면 preload·노출·type이 두 벌이 된다. (agent)
- 창을 여럿 띄우는 Electron test는 만들지 않았다. 위험은 모델의 detach·attach와 editor transfer test가 본다. (agent)
- project 창을 떠날 때 detached terminal은 dock시키지 않고 PTY 참조를 main이 메모리로 든다. 이유: 창을 dock시키면 창이 돌아오지 않는다. 디스크에는 쓰지 않는다. (agent)
- browser 탭·앱 화면·artifact 화면은 Detach하면 다시 load된다. 이유: `<webview>`는 그것을 띄운 shell 문서에 묶여 다른 부모로 옮기면 guest가 다시 만들어진다. 쓰던 form, scroll, 그 page가 연 popup의 `window.opener`를 잃는다. 다시 load 없이 옮길 수 있는 곳은 native view뿐이다. (사람)
- detached 창 안의 popup은 또 하나의 detached 창이다. 이유: 가장 단순하게 `window.opener`를 지킨다. 대안인 project 창 float 층으로 옮기기는 opener 소유 이동이 더 필요하다. (agent)
- Agent 탭(lophn session을 보이는 탭)은 저장하지 않는다. 이유: session은 core가 갖고 있어 탭은 그 화면일 뿐이고, 저장하면 앱을 다시 켤 때마다 지난 session 탭이 한꺼번에 돌아와 탭 줄이 넘치며 사람이 닫은 적 없는 대화가 열린 채 쌓인다. 다시 열 길은 sidebar(Recent, Main 묶음의 도는·못 본 session)가 이미 있다. 터미널의 coding agent TUI는 그 길이 따로 없고 PTY가 이미 새 shell을 띄우므로 그대로 저장한다. 구현은 kind에 `toStored`·`fromStored`를 두지 않는 것 하나다(저장 모양 변환이 그 탭을 빼고 남은 group·고른 탭을 기존 규칙으로 맞춘다). 이 창이 사는 동안 잃지 않게 layout source가 workspace마다 창 메모리 layout을 든다(창을 닫으면 사라진다). 버린 길: Agent 탭만 따로 저장하는 메모리 파일(저장하지 않으려는 뜻과 반대), 저장은 하되 복원 때만 거르기(읽을 때마다 걸러야 하고 session 참조가 파일에 쌓인다). 옛 파일의 Agent 탭은 data step `shell.agent-tabs-unsaved`가 걷어냈다. (사람)
- favicon을 layout에 저장한다. 이유: 접힌 탭은 펴기 전까지 page가 없어 저장한 값 말고는 출처가 없다. (agent)
- 옛 layout 파일(판 1~7, `~/.lophn/shell/layouts/`)과 앱 localStorage 배치는 읽지 않는다. 이유: 사람이 자기 data에서 지웠고 layout은 새로 시작해도 되는 화면 상태라 읽기·올리기 코드를 두지 않는다. 첫 열기는 기본 layout이다. 판 8 → 10은 올린다. (사람)
- agent가 연 탭은 core 메모리의 host queue를 shell main이 가져가는 꼴이다. 이유: core → shell 요청 통로가 없었다. harness queue는 session마다 turn 입력을 담는 run-loop queue라 요청 종류를 실을 자리가 없어 같은 꼴(core 메모리, shell main이 가져감)로 새로 두었다. 창 IPC 직통이나 새 socket push 같은 통로를 더 만들지 않는다. shell main의 poll loop는 extension `harness`의 tick과 합치지 않았다(그 tick은 설정 `extensions.harness.enabled`가 꺼지면 돌지 않고 extension은 shell main 내부를 import하지 못한다). focus를 뺏지 않는 것은 agent의 일이 사람이 하던 일을 끊지 않게 하려는 것이다. host queue는 long-poll로 바꾸고 browser 호출은 extension tool 호출의 결과 길을 같이 쓴다(새 통로 없음). (agent: queue 꼴, 사람: 확인 2026-11-08, long-poll·결과 길은 사람)
- agent가 연 browser page는 창 단위로 살게 하고 창이 없으면 lophn이 창을 연다. 이유: agent가 사람이 있든 없든 로그인한 browser를 써야 하는데 page 수명이 사람의 화면(workspace의 mount)에 묶여 있었다. page를 창에서 떼는 안(main이 소유한 native view를 숨은 창에 두기)은 shell DOM 위에 그려져 menu·패널이 page 밑에 깔리는 문제가 browser 탭에 되돌아오고 그릇이 둘이 된다. 그래서 `<webview>`를 유지하고 창이 하나도 없을 때는 lophn이 창을 focus 없이 연다. 처음 설계(native view)는 접었다. (사람, 2026-11-10)
- page가 없어지면 탭도 없어진다. 마지막 url을 다시 load하는 일, 쉬는 page를 일정 시간 뒤 놓는 일은 하지 않는다. 이유: 사라진 page를 말없이 되살리면 agent는 옛 form과 scroll이 있다고 믿는다. 탭이 없다고 알리고 agent가 다시 열게 하는 쪽이 단순하고 틀리지 않는다. 자원은 상한(창마다 12개)이 막으므로 idle 기한이 따로 필요하지 않다. 버린 길: idle 타이머, 다음 호출 때 마지막 url 다시 load. (agent)
- 창을 연 일은 자동으로 되돌리지 않는다. 이유: 사람이 돌아와 그 창을 쓰거나 닫는다. 닫으면 그 창의 page와 탭이 없어진다. 창이 화면에 뜨는 것이 agent가 browser를 쓰는 중이라는 표시이므로 따로 표시나 승인을 두지 않는다. (agent)
- 자리는 agent가 아니라 renderer가 정한다. 이유: agent는 layout을 모르고(칸이 찼는지, 사람이 무엇을 보는지), 옛 `--place`(beside·group·float)는 자리를 agent가 고르게 해 팀 자식이 부모 칸을 반으로 계속 쪼개 코디네이터가 가장 좁아지고 손자가 같은 group을 채워 새 group이 안 생겼다. agent는 뜻만 말하고 `openAt()`이 뜻과 지금 배치로 자리를 정한다. (사람: 승인 2026-11-09)
- 앱 icon은 사람이 올린 것이 선언한 것보다 앞선다. 이유: 올린 icon은 revision·event·blob 없이 ledger 표 한 줄로 두어 단순하다(64 KiB 이하). `@lophn/declaration`의 판은 올리지 않는다(선언에 icon이 없으면 칸을 두지 않아 옛 선언 hash가 그대로다). (agent)
- 앱 delete 때 다른 workspace layout의 앱 panel 탭과 고정은 지우지 않는다. 이유: "앱이 없다" 안내와 건너뜀으로 이미 안전하게 그려진다. (agent)

## 열린 것

- workflow 폴더 이름을 바꾸면 그 desk가 Main으로 합쳐진다. desk key가 workflow 이름이고 바뀌지 않는 workflow id가 없어서다. 탭은 잃지 않고 배치(group, float, detached)만 Main에 섞인다. 고치려면 바뀌지 않는 workflow id가 필요하다(중간). 이름 바꾸기가 실제로 잦아질 때 한다.
- layout을 읽지 못하면 기본 layout이 저장된 파일을 덮는다. 읽기가 실패했거나 파일이 없음·손상·다른 판(`unsupported_schema`)이면 renderer가 기본 layout을 쓰는데, 그 뒤 사람이 탭을 열거나 옮기는 첫 저장이 파일 전체를 덮는다. main의 읽기는 다른 판이면 "파일은 그대로 둔다"고 하지만 renderer가 그 약속을 이어 가지 않는다. 새 판의 layout을 옛 빌드로 열었다가 탭 하나를 열면 새 판 layout 전체(desk, group, float)가 Main 하나짜리로 덮여 다시 새 판으로 와도 못 돌린다(일시적 읽기 실패 뒤 첫 조작도 같다). 추천: 읽기가 실패했거나 `unsupported_schema`·`corrupt`면 그 workspace의 저장을 끄고 한 번 알린다. 손상은 옛 파일을 `.bak`으로 한 번 옮겨 두면 값이 싸다.
- layout 저장이 거절돼도(디스크가 가득 참, 파일 못 씀) 화면은 그대로이고 사람은 모른다. 저장 결과를 버리고 재시도가 없으며 전역 float의 저장도 같다. 재시작하면 옛 배치로 돌아간다. 추천: 첫 실패에서 toast 하나를 띄우고 다음 변화나 기한에 다시 쓴다.
- desk float과 전역 float을 오갈 때와 Detach할 때 `<webview>` page가 한 번 다시 load된다(그릇이 다르다).
- group의 안쪽 아래 모서리도 둥글다(알려진 모양).
- 전역 float으로 올린 터미널은 그 project layout에서 빠져, 다른 workspace sidebar가 layout만 보고 아는 coding agent 터미널 표시(`harness`)가 그 동안 보이지 않는다.
- 다른 workspace의 저장된 layout을 sidebar에서 고친 것은 그 workspace를 다른 창에서 열어 두었으면 그 창이 다음에 저장할 때 덮인다.
- 살려 둔 page를 놓는 시점은 떠날 때뿐이라 떠난 뒤 소리가 멈추거나 신호를 끈 page도 상한이나 돌아옴까지 남는다.
- 숨은 agent page의 1px 띠가 창 오른쪽 아래에 점으로 보일 수 있다. page가 사는 동안 계속이다. 사람 눈으로는 아직 확인하지 않았다. 설치한 앱에서 보고, 보이면 그때 이슈로 올린다.
- 최소화하거나 숨긴 창은 그리지 않아 그 창에 있는 agent page의 screenshot이 실패한다(Linux x11에서 쟀다). 사람이 창을 최소화해 둔 채 job이 browser를 쓰면 `unavailable`이다. 열 때 쓰는 창이 없으면 lophn이 보이는 창을 연다. Wayland에서는 `showInactive`가 focus를 가져갈 수 있다. macOS와 Windows는 돌려 보지 않았다. 화면이 없는 Linux는 창을 열 수 없어 browser를 쓸 수 없다.
- 두 창이 같은 workspace를 mount하면 agent page가 창마다 하나씩 생긴다(이슈 `agent-browser-page-duplicated-across-windows`).
- 창 닫힘이나 앱 종료 뒤 layout에 남은 agent 탭은 지금 desk의 접힌 float만 mount 때 정리한다. 다른 desk의 것이나 펴진 float, 탭 줄에 있던 것은 사람의 탭으로 남고 열면 다시 load한다.
- 첫 응답이 기한(10초, 앱을 띄웠으면 30초)보다 늦는 site는 열기가 실패한다. dom-ready를 기다려서다.
- agent가 연 artifact 탭은 아직 그 workspace를 띄운 창이 있을 때만 열린다(이슈 `agent-artifact-tab-needs-mounted-workspace`).
