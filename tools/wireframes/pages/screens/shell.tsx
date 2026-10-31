import type { Area } from "../types.ts";
import { PlacesScene, placesSteps } from "./shell/places-scene.tsx";
import { ShellScene } from "./shell/shell-scene.tsx";

export const shellArea: Area = {
  id: "shell",
  title: "Shell",
  summary:
    "모든 place가 쓰는 창 틀. title bar의 tab 줄과 desk 단추, 둥근 card, split, float.",
  pages: [
    {
      id: "shell-project",
      title: "Shell · Project",
      description:
        "project place의 Main desk. title bar에 sidebar 접기, desk 단추, 곡선으로 card와 이어지는 tab 줄, 오른쪽 끝의 접힌 float 칸과 panel icon tab, 창 단추가 있다. 가운데는 둥근 card 하나다.",
      render: () => <ShellScene variant="project" />,
    },
    {
      id: "shell-split",
      title: "Shell · Split",
      description:
        "두 tab을 한 칸으로 붙인 split tab(좌우, Split right). tab 줄에서는 한 칸에 반쪽 둘과 사이의 방향 아이콘이고 card는 좌우로 나뉘어 반쪽마다 머리 줄을 가진다. 누른 쪽이 강조되고 가운데 선을 끌어 몫을 바꾼다.",
      render: () => <ShellScene variant="split" />,
    },
    {
      id: "shell-split-down",
      title: "Shell · Split down",
      description:
        "위아래로 나눈 split. tab 줄의 반쪽 사이 아이콘이 가로 나눔(Rows)이고 card는 위아래로 쌓여 반쪽마다 머리 줄을 가진다. 두 반쪽 사이의 선을 끌어 몫을 바꾼다.",
      render: () => <ShellScene variant="split-down" />,
    },
    {
      id: "shell-floats",
      title: "Shell · Floats",
      description:
        "접힌 칸 둘을 펴서 card 위에 띄운 상태. 편 칸은 tab 줄 오른쪽 끝에서 눌린 모양이다. float의 단추로 접고, tab으로 dock하고, 닫는다.",
      render: () => <ShellScene variant="floats" />,
    },
    {
      id: "shell-places-panel",
      title: "Shell · Places panel",
      description:
        "Home의 오른쪽 sidebar Places panel. Projects와 Apps 줄(이름, 경로나 release), 줄 오른쪽 끝 ⋯ 메뉴(Details, 새 위치 고르기, Archive), 각 구역 머리의 Register project와 New app 단추, 접힌 Archived 구역.",
      render: () => <PlacesScene />,
    },
    {
      id: "shell-places-menu",
      title: "Shell · Places row menu",
      description: "Places panel의 project 줄 ⋯ 메뉴를 연 상태.",
      render: () => <PlacesScene steps={placesSteps.menu} />,
    },
    {
      id: "shell-places-archived",
      title: "Shell · Places archived",
      description:
        "Places panel의 Archived 구역을 펼친 상태. 보관한 project와 앱이 한 줄씩이고 줄 오른쪽 끝 단추로 되살린다.",
      render: () => <PlacesScene steps={placesSteps.archived} />,
    },
    {
      id: "shell-desk-menu",
      title: "Shell · Desk menu",
      description:
        "desk 단추를 연 상태. 사람이 만든 desk와 workflow desk를 고르고 New desk로 빈 desk를 만든다. 사람이 만든 desk(Main 제외) 줄 오른쪽 끝에 이름 바꾸기(연필)와 지우기(x) 단추가 있다. 지우면 탭은 Main으로 간다.",
      render: () => <ShellScene variant="project" open="[data-desk-button]" />,
    },
    {
      id: "shell-tab-menu",
      title: "Shell · Tab menu",
      description:
        "card 머리 줄 ⋯의 tab 메뉴. Float, Split right·Split down(split이면 다른 방향과 Unsplit), Move to new window, Close tab.",
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
        "좌우 split의 반쪽 머리 ⋯. 방향을 바꾸는 Split down과 Unsplit이 나온다.",
      render: () => <ShellScene variant="split" open="[data-tab-menu]" />,
    },
    {
      id: "shell-tab-context-menu",
      title: "Shell · Tab context menu",
      description:
        "tab을 오른쪽 클릭한 menu. Rename(이름을 바꿀 수 있는 kind), Close 넷, Split/Unsplit, Float, Move to new window(noDetach면 없음), 파일 tab의 Copy path·Reveal, preview tab의 Keep open. 줄에는 preview tab의 italic 이름과 저장 안 된 tab의 ●가 있다.",
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
        "tab이 많으면 먼저 좁아지고 최소 폭에서 가로 scroll이 된다. 접힌 float은 넷까지 아이콘 칸으로 보이고 나머지는 +N 메뉴에 든다.",
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
        "고르지 않은 split tab은 두 아이콘과 방향 표시만 보이는 좁은 칸이고 이름은 tooltip(두 이름)에 있다. 두 번째 split(위아래)도 같다. 고르면 두 이름이 다 보이게 펴진다.",
      render: () => <ShellScene variant="split-compact" />,
    },
    {
      id: "shell-left-sidebar",
      title: "Shell · Left sidebar",
      description:
        "왼쪽 sidebar. New session(▾로 lophn agent와 coding agent), Inbox, Jobs, Places 아래 Home·project·앱과 place마다 열린 session. phroner의 Recent를 펼쳐 끝난 session과 저장한 터미널 session을 상대 시각으로 보인다.",
      render: () => <ShellScene variant="project" recentOpen />,
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
