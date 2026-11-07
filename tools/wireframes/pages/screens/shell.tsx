import type { Area } from "../types.ts";
import { WorkspacesScene, workspacesSteps } from "./shell/workspaces-scene.tsx";
import { ShellScene } from "./shell/shell-scene.tsx";
import { SidebarAppPanel } from "./shell/sidebar-app-panel.tsx";
import { SidebarScene, sidebarSteps } from "./shell/sidebar-scene.tsx";
import { TrayScene } from "./shell/tray-scene.tsx";

export const shellArea: Area = {
  id: "shell",
  title: "Shell",
  summary:
    "모든 workspace가 쓰는 창 틀. title bar의 tab 줄과 desk 단추, 둥근 card, group(자유 split), float.",
  pages: [
    {
      id: "shell-project",
      title: "Shell · Project",
      description:
        "project workspace의 Main desk. title bar에 sidebar 접기, desk 단추, 곡선으로 card와 이어지는 tab 줄, panel icon tab, 창 단추가 있다. 가운데는 둥근 card 하나이고 맨 아래에 작업 표시줄(float chip)이 있다.",
      render: () => <ShellScene variant="project" />,
    },
    {
      id: "shell-split",
      title: "Shell · Split",
      description:
        "두 tab을 한 칸으로 붙인 group(좌우, Split right). tab 줄에서는 한 칸에 반쪽 둘과 사이의 방향 아이콘이고 card는 좌우로 나뉘어 반쪽마다 머리 줄을 가진다. 누른 쪽이 강조되고 가운데 선을 끌어 몫을 바꾼다(놓을 때 저장, 더블클릭하면 반반).",
      render: () => <ShellScene variant="split" />,
    },
    {
      id: "shell-pane-stack",
      title: "Shell · Pane stack",
      description:
        "coding agent가 문서를 차례로 보내면 첫 것은 agent 옆 split 칸이 되고, 다음 것들은 그 칸에 쌓여 마지막 것이 보인다. 먼저 온 것은 빠지지 않고 tab 줄의 group 칸에 차례로 보이며(누르면 그것이 칸에 보인다) 칸 머리의 ‹ 3/3 ›로도 돌려 본다(끝에서 처음으로). group을 고르면 칸의 tab이 이름까지 보이고, 고르지 않으면 숨은 tab은 아이콘으로 보인다. 줄이 모자라면 다른 group처럼 접힌다. group 칸 안의 tab을 끌면 그 tab 하나가 움직이고(줄에 놓으면 group에서 나온다), 다른 tab을 card의 칸 가운데에 놓으면 그 칸에 쌓이고, tab 줄의 group 칸 안 두 tab 사이에 놓으면 그 자리에 들어간다(세로 줄이 자리를 보인다). 칸의 빈 곳(방향 표시)을 끌면 group 통째다. 칸에서 닫으면 이웃이 보이고, ⋯의 Move out of pane은 보이는 tab을 tab 줄의 tab으로 꺼낸다.",
      render: () => <ShellScene variant="pane-stack" />,
    },
    {
      id: "shell-split-down",
      title: "Shell · Split down",
      description:
        "위아래로 나눈 split. tab 줄의 반쪽 사이 아이콘이 가로 나눔(Rows)이고 card는 위아래로 쌓여 반쪽마다 머리 줄을 가진다. 두 반쪽 사이의 선을 끌어 몫을 바꾼다.",
      render: () => <ShellScene variant="split-down" />,
    },
    {
      id: "shell-group-top2",
      title: "Shell · Group · 2 top + 1 bottom",
      description:
        "group은 tab 2~4개를 한 칸으로 붙이고 배치는 나눔 tree다. 위에 둘(좌우), 아래에 하나. tab 줄은 한 칸에 반쪽 셋과 사이의 방향 아이콘(좌우, 위아래)이다. 선마다 끌어 몫을 바꾼다.",
      render: () => <ShellScene variant="group-top2" />,
    },
    {
      id: "shell-group-right2",
      title: "Shell · Group · 1 left + 2 right",
      description:
        "왼쪽에 하나, 오른쪽에 위아래 둘. 가운데 세로선은 처음 몫이 0.45이고 오른쪽 안의 가로선은 따로 끈다.",
      render: () => <ShellScene variant="group-right2" />,
    },
    {
      id: "shell-group-columns",
      title: "Shell · Group · 3 columns",
      description: "세 열. 두 세로선이 각각 자기 몫을 가진다(처음에는 3등분).",
      render: () => <ShellScene variant="group-columns" />,
    },
    {
      id: "shell-group-grid",
      title: "Shell · Group · 2 x 2",
      description:
        "네 칸이 가득 찬 group(최대). 이 group은 다른 tab을 더 받지 않아 Split right·down이 흐리다. tab 줄에는 반쪽 넷이 한 칸이다.",
      render: () => <ShellScene variant="group-grid" />,
    },
    {
      id: "shell-group-menu",
      title: "Shell · Tab menu on a group pane",
      description:
        "세 칸 group의 오른쪽 위 칸 머리 ⋯. Split right·down은 이 칸 옆에 다음 plain tab을 붙이고, Remove from split은 이 칸만 group에서 꺼내 plain tab으로 두며, Unsplit all은 group을 푼다(tab은 그 자리에 남는다).",
      render: () => (
        <ShellScene
          variant="group-menu"
          open='[data-pane="c1"] [data-tab-menu]'
        />
      ),
    },
    {
      id: "shell-drag",
      title: "Shell · Drag and drop (live)",
      description:
        "직접 끌어 보는 장면. tab 줄의 칸이나 group 칸의 머리 줄을 끌면 알약이 커서를 따라간다. 줄 위에서는 tab이 비켜 자리를 열고(놓으면 순서), 칸 위에서는 가장자리 구역이 미리보기로 켜진다(놓으면 그 쪽에 붙는다). 가운데는 자리 바꾸기, 가득 찬 group은 놓을 수 없다. Esc로 취소한다.",
      render: () => <ShellScene variant="group-top2" />,
    },
    {
      id: "shell-drag-strip",
      title: "Shell · Drag · Reorder in the strip",
      description:
        "README.md를 끌어 Fix gaze interpolation 앞으로 옮기는 도중. 커서를 따라가는 알약, 놓일 자리로 간 옅은 자리 표시, 비켜 서서 자리를 연 이웃 tab.",
      render: () => (
        <ShellScene
          variant="project"
          drag={{
            from: { selector: '[data-entry-key="readme"]', fx: 0.4 },
            to: { selector: '[data-entry-key="c1"]', fx: 0.2 },
            release: false,
          }}
        />
      ),
    },
    {
      id: "shell-drag-edge",
      title: "Shell · Drag · Drop to a pane edge",
      description:
        "tab을 card의 오른쪽 가장자리로 끈 도중. 놓으면 그 쪽 절반에 붙어 group(좌우)이 되는 자리를 --color-focus 반투명 사각형으로 미리 보인다.",
      render: () => (
        <ShellScene
          variant="project"
          drag={{
            from: { selector: '[data-entry-key="readme"]', fx: 0.4 },
            to: { selector: '[data-pane="p1"]', fx: 0.92, fy: 0.5 },
            release: false,
          }}
        />
      ),
    },
    {
      id: "shell-drag-swap",
      title: "Shell · Drag · Drop on a pane center",
      description:
        "group 칸 위 가운데로 끈 도중. 칸 전체가 미리보기가 되고, 놓으면 그 칸과 자리를 바꾼다(끈 tab이 그 칸에 보인다).",
      render: () => (
        <ShellScene
          variant="group-top2"
          drag={{
            from: { selector: '[data-entry-key="plan"]', fx: 0.4 },
            to: { selector: '[data-pane="c1"]', fx: 0.5, fy: 0.5 },
            release: false,
          }}
        />
      ),
    },
    {
      id: "shell-drag-full",
      title: "Shell · Drag · Full group",
      description:
        "네 칸이 가득 찬 group의 가장자리로 밖의 tab을 끈 도중. 점선 사각형과 안내로 놓을 수 없음을 보이고 놓아도 아무 일도 없다.",
      render: () => (
        <ShellScene
          variant="group-grid"
          drag={{
            from: { selector: '[data-entry-key="term"]', fx: 0.4 },
            to: { selector: '[data-pane="p1"]', fx: 0.92, fy: 0.5 },
            release: false,
          }}
        />
      ),
    },
    {
      id: "shell-drag-leaf",
      title: "Shell · Drag · Pane header to the strip",
      description:
        "group 칸의 머리 줄을 끌어 tab 줄로 가져간 도중. 놓으면 그 칸이 group에서 나와 가리킨 자리의 plain tab이 된다.",
      render: () => (
        <ShellScene
          variant="group-right2"
          drag={{
            from: { selector: '[data-pane="c1"] [data-draggable]', fx: 0.5 },
            to: { selector: '[data-entry-key="term"]', fx: 0.3 },
            release: false,
          }}
        />
      ),
    },
    {
      id: "shell-floats",
      title: "Shell · Floats",
      description:
        "접힌 칸 둘을 펴서 card 위에 띄운 상태. 편 칸은 작업 표시줄 chip에서 눌린 모양이다. float의 단추로 접고, tab으로 dock하고, 닫는다.",
      render: () => <ShellScene variant="floats" />,
    },
    {
      id: "shell-global-float",
      title: "Shell · Global float",
      description:
        "workspace를 바꿔도 남는 전역 float. 앱 panel 화면을 desk float에서 float bar의 지구본 단추(Show in all workspaces)로 옮기면 title bar 아래 창 몸통 전체를 덮는 층에 떠서 어느 desk float보다 위에 놓인다(Mahas). 접힌 것은 작업 표시줄 chip 칸에서 desk float의 chip보다 앞에 놓이고 아이콘에 작은 지구본이 붙는다(Masup). chip을 누르면 펴고 접는다. 전역 float의 bar 단추는 Move to this desk(이 desk의 float으로 옮긴다), 고정, 접기, 닫기이고 dock은 없다. 고정 안 한 전역 float은 바깥을 누르면 접힌다.",
      render: () => <ShellScene variant="floats" globalFloats />,
    },
    {
      id: "shell-taskbar",
      title: "Shell · Taskbar",
      description:
        "창 맨 아래 작업 표시줄(설정 Appearance › Taskbar, 기본 켬, 높이는 title bar와 같다). 왼쪽 끝은 빠른 실행 단추(Terminal · Browser · App · Search, 고정 앱 panel)이고 열린 왼쪽 sidebar와 같은 폭이라 그 오른쪽, 곧 tab 줄 아래에서 float chip이 시작한다(sidebar를 접으면 빠른 실행이 왼쪽 끝에 서고 chip이 바로 뒤따른다). chip은 전역 float(지구본 표시)이 먼저, 그 뒤가 지금 desk의 float이고 아이콘과 이름이며 편 것은 눌린 모양이고 누르면 펴고 접는다. 오른쪽은 tray 자리(Shell · Tray)이고 맨 오른쪽 끝에 Settings 톱니가 있다. 왼쪽 sidebar 맨 아래에는 빠른 실행과 Settings가 없다. desk float은 작업 표시줄 위에서 끝나 작업 표시줄을 덮지 않고, 꺼 두면 빠른 실행과 Settings는 sidebar 맨 아래로, chip은 tab 줄 끝으로 돌아간다.",
      render: () => <ShellScene variant="taskbar" globalFloats="chip" />,
    },
    {
      id: "shell-sidebar-app-panel",
      title: "Shell · Sidebar app panel",
      description:
        "project 창 오른쪽 sidebar에 앱 화면 하나가 panel로 켜진 상태. 설치된 앱의 `sidebar` 자리 화면은 선언하면(Settings › Quick launch › Sidebar panels에서 끄지 않은 한) 모든 workspace의 panel icon tab 줄 끝에 앱 icon으로 더해지고, 고르면 sidebar 안에 앱 화면이 선다(Orders). 폭을 바꾸거나 다른 panel을 다녀와도 화면은 다시 load되지 않는다. 앱 화면이 `useTabHead`로 올린 머리 줄(상태 글, 단추, ⋯ 메뉴)은 panel 머리 줄의 오른쪽에 그려진다(New order). 앱이 지워졌거나 화면이 없어지면 그 icon은 보이지 않는다.",
      render: () => <SidebarAppPanel />,
    },
    {
      id: "shell-tray",
      title: "Shell · Tray",
      description:
        "작업 표시줄 오른쪽 tray(설치된 앱의 `tray` 화면마다 항목 하나, Settings › Quick launch › Tray에서 끄지 않은 한, Settings 톱니 바로 앞). 항목은 앱 아이콘이고 앱이 낸 짧은 글이 tone 색으로 붙는다(Usage, 62% left, good). 값이 없는 앱은 아이콘만 있다(Orders). 항목을 누르면 그 앱의 tray 화면이 항목 바로 위에 popup(360×480, 창 밖으로 나가지 않게 당김)으로 뜬다. 앱 화면이 `useTabHead`로 올린 머리 줄(상태 글, 단추, ⋯ 메뉴)은 popup 머리의 제목과 pin 사이에 그려진다(Updated 2 min ago, Refresh). popup 머리의 pin(Keep open)을 켜면 바깥을 누르거나 창이 focus를 잃거나 다른 항목을 눌러도 닫히지 않고, 자기 항목을 다시 누르거나 Esc를 누르면 닫힌다(pin은 lophn을 다시 켜면 풀린다). 작업 표시줄이 꺼져 있으면 항목은 title bar 오른쪽 sidebar 단추 옆에 아이콘만 서고 popup은 그 바로 아래로 뜬다. 값은 lophn을 다시 켜면 사라지고 앱이 시작할 때 다시 낸다.",
      render: () => <TrayScene />,
    },
    {
      id: "shell-workspaces-panel",
      title: "Shell · Workspaces panel",
      description:
        "Home의 오른쪽 sidebar Workspaces panel. Projects와 Apps 줄(이름, 경로나 release), 줄 오른쪽 끝 ⋯ 메뉴(Details, 새 위치 고르기, Archive), 각 구역 머리의 Register project와 New app 단추, 접힌 Archived 구역.",
      render: () => <WorkspacesScene />,
    },
    {
      id: "shell-workspaces-menu",
      title: "Shell · Workspaces row menu",
      description: "Workspaces panel의 project 줄 ⋯ 메뉴를 연 상태.",
      render: () => <WorkspacesScene steps={workspacesSteps.menu} />,
    },
    {
      id: "shell-workspaces-archived",
      title: "Shell · Workspaces archived",
      description:
        "Workspaces panel의 Archived 구역을 펼친 상태. 보관한 project와 앱이 한 줄씩이고 줄 오른쪽 끝 단추로 되살린다.",
      render: () => <WorkspacesScene steps={workspacesSteps.archived} />,
    },
    {
      id: "shell-desk-menu",
      title: "Shell · Desk menu",
      description:
        "desk 단추를 연 상태. 사람이 만든 desk와 workflow desk를 고르고 New desk로 빈 desk를 만든다. 사람이 만든 desk(Main 제외) 줄 오른쪽 끝에 이름 바꾸기(연필)와 지우기(x) 단추가 있다. 지우면 확인 dialog가 뜬다(Shell · Close desk).",
      render: () => <ShellScene variant="project" open="[data-desk-button]" />,
    },
    {
      id: "shell-desk-close",
      title: "Shell · Close desk",
      description:
        "desk 단추의 x를 눌렀을 때. desk를 지우는 것은 그 일을 끝내는 것이라 tab·float·창을 모두 닫고 터미널을 멈춘다. 몇 개가 닫히는지와 저장이 남은 파일(이름과 경로)을 보이고, 취소 또는 Close desk(danger)를 고른다. 닫으면 Main으로 돌아간다.",
      render: () => <ShellScene variant="desk-close" closeDesk="Review" />,
    },
    {
      id: "shell-tabs-close",
      title: "Shell · Close tabs",
      description:
        "tab 메뉴로 여러 tab을 닫을 때(Close group, Close others 등) 한 번만 묻는 dialog. 파일의 마지막 고침을 먼저 보내고, 멈출 터미널·coding agent와 그래도 저장하지 못한 파일을 한 dialog에 줄로 보인다. 물을 것이 없으면 dialog 없이 닫는다. 여기는 [agent | 문서 셋] 칸 아래에 zsh를 붙인 group을 Close group으로 닫는 때다.",
      render: () => <ShellScene variant="tabs-close" closeTabs="c1" />,
    },
    {
      id: "shell-pane-focus",
      title: "Shell · Pane focus by arrow",
      description:
        "2 x 2 group에서 Ctrl+Alt+→, Ctrl+Alt+↓를 누른 뒤(맨 왼쪽 위 칸에서 오른쪽 위, 오른쪽 아래 칸으로). 칸이 맞닿은 방향으로 focus가 옮겨 가고 tab 줄은 focus 칸의 이름만 보인다.",
      render: () => (
        <ShellScene
          variant="group-grid"
          keys={["Ctrl+Alt+ArrowRight", "Ctrl+Alt+ArrowDown"]}
        />
      ),
    },
    {
      id: "shell-tab-menu",
      title: "Shell · Tab menu",
      description:
        "card 머리 줄 ⋯의 tab 메뉴. Float, Split right·Split down(group이면 Unsplit도), Move to new window, Close tab.",
      render: () => <ShellScene variant="project" open="[data-tab-menu]" />,
    },
    {
      id: "shell-tab-menu-edge",
      title: "Shell · Tab menu at the edge",
      description:
        "오른쪽 sidebar를 접어 card 머리의 ⋯가 창 오른쪽 끝에 닿은 상태. 메뉴는 단추의 오른쪽 끝에 맞춰 왼쪽으로 펴져 창 밖으로 나가지 않는다.",
      render: () => (
        <ShellScene variant="project" right={false} open="[data-tab-menu]" />
      ),
    },
    {
      id: "shell-tab-menu-split",
      title: "Shell · Tab menu in a split",
      description:
        "좌우 split(칸 둘)의 반쪽 머리 ⋯. 다음 plain tab을 더 붙이는 Split right·down과 Unsplit이 나온다.",
      render: () => <ShellScene variant="split" open="[data-tab-menu]" />,
    },
    {
      id: "shell-tab-context-menu",
      title: "Shell · Tab context menu",
      description:
        "tab을 오른쪽 클릭한 menu. Rename(이름을 바꿀 수 있는 kind), Close 넷, Split right·down(group이면 Unsplit도), Float, Move to new window(noDetach면 없음), 파일 tab의 Copy path·Reveal, preview tab의 Keep open. 줄에는 preview tab의 italic 이름과 저장 안 된 tab의 ●가 있다.",
      render: () => <ShellScene variant="marks" context="README.md" />,
    },
    {
      id: "shell-tab-marks",
      title: "Shell · Tab marks",
      description:
        "preview tab(README.md)은 이름이 italic이고, 저장 안 된 tab(072-architecture.md)은 닫기 자리에 ●가 있다(hover하면 ×).",
      render: () => <ShellScene variant="marks" />,
    },
    {
      id: "shell-empty",
      title: "Shell · Empty desk",
      description:
        "tab이 하나도 없는 desk. card에 안내와 New session, Open file 단추만 있다.",
      render: () => <ShellScene variant="empty" />,
    },
    {
      id: "shell-overflow",
      title: "Shell · Many tabs",
      description:
        "tab이 많으면 먼저 좁아지고 최소 폭에서 가로 scroll이 된다. 접힌 float은 넷까지 작업 표시줄 chip으로 보이고 나머지는 +N 메뉴에 든다.",
      render: () => <ShellScene variant="overflow" />,
    },
    {
      id: "shell-overflow-end",
      title: "Shell · Many tabs, long selected",
      description:
        "tab이 많아 줄이 scroll될 때 오른쪽 끝의 긴 이름 tab을 고른 상태. 고른 tab은 scroll로 줄 안에 들어와 이름이 다 보이고 다른 tab은 좁다.",
      render: () => <ShellScene variant="overflow-end" />,
    },
    {
      id: "shell-tab-long",
      title: "Shell · Long selected tab",
      description:
        "좁은 파일 tab들 사이에서 긴 이름의 tab을 고른 상태. 고른 tab은 줄지 않고 이름이 다 보이고, 고르지 않은 tab이 먼저 좁아진다(줄 폭의 80%를 넘는 이름만 ...로 잘린다).",
      render: () => <ShellScene variant="long-title" />,
    },
    {
      id: "shell-split-compact",
      title: "Shell · Split tabs compact",
      description:
        "tab 줄이 넘치면 고르지 않은 group은 아이콘과 방향 표시만 보이는 좁은 칸이 되고 이름은 tooltip(모든 이름)에 있다. 둘(좌우), 둘(위아래), 셋 모두 같다. 창이 넓어 줄이 넘치지 않으면 group도 이름을 다 보인다.",
      render: () => <ShellScene variant="split-compact" />,
    },
    {
      id: "shell-left-sidebar",
      title: "Shell · Left sidebar",
      description:
        "왼쪽 sidebar. New session(▾로 lophn agent와 coding agent), Inbox, Jobs, Workspaces 아래 Home·project·앱과 workspace마다 열린 session. phroner의 Recent를 펼쳐 끝난 session과 저장한 터미널 session을 상대 시각으로 보인다. Recent는 지금 workspace에만 있고 10줄이 넘으면 아래 page 줄(‹ 1–10 of 13 ›)로 넘긴다. 지금 workspace는 이름만 진하다.",
      render: () => <ShellScene variant="project" recentOpen />,
    },
    {
      id: "shell-left-sidebar-project",
      title: "Shell · Left sidebar · Project quick launch",
      description:
        "맨 아래 줄은 왼쪽부터 Terminal, Browser, App ▾, Search 빠른 실행이고 맨 오른쪽 끝에 Settings가 있다. Search는 project에서는 Search 탭, Home에서는 팔레트를 연다. + menu와 같은 데이터라 project에서는 App ▾에 App panel이 있고, 눌러 연 모양이다.",
      render: () => (
        <SidebarScene workspace="project" steps={sidebarSteps.appMenu} />
      ),
    },
    {
      id: "shell-left-sidebar-home",
      title: "Shell · Left sidebar · Home quick launch",
      description:
        "Home에는 터미널이 없어서 Terminal 단추가 없고 Browser, App ▾, Search만 있다.",
      render: () => <SidebarScene workspace="home" />,
    },
    {
      id: "shell-left-sidebar-app",
      title: "Shell · Left sidebar · App quick launch",
      description:
        "앱 workspace의 App ▾는 닫은 앱 화면 탭을 다시 여는 App screen과 App panel을 함께 가진다. 눌러 연 모양이다.",
      render: () => (
        <SidebarScene workspace="app" steps={sidebarSteps.appMenu} />
      ),
    },
    {
      id: "shell-collapsed",
      title: "Shell · Sidebars collapsed",
      description:
        "양쪽 sidebar를 접은 상태. card가 shell 가장자리에서 조금 띄워지고 tab 줄이 왼쪽으로 당겨진다.",
      render: () => <ShellScene variant="project" left={false} right={false} />,
    },
  ],
};
