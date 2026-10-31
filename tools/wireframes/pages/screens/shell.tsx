import type { Area } from "../types.ts";
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
        "두 tab을 한 칸으로 붙인 split tab. tab 줄에서는 한 칸에 반쪽 둘이고 card는 좌우로 나뉘어 반쪽마다 머리 줄을 가진다. 누른 쪽이 강조된다.",
      render: () => <ShellScene variant="split" />,
    },
    {
      id: "shell-floats",
      title: "Shell · Floats",
      description:
        "접힌 칸 둘을 펴서 card 위에 띄운 상태. 편 칸은 tab 줄 오른쪽 끝에서 눌린 모양이다. float의 단추로 접고, tab으로 dock하고, 닫는다.",
      render: () => <ShellScene variant="floats" />,
    },
    {
      id: "shell-desk-menu",
      title: "Shell · Desk menu",
      description:
        "desk 단추를 연 상태. 사람이 만든 desk와 workflow desk를 고르고 New desk로 빈 desk를 만든다.",
      render: () => <ShellScene variant="project" open="[data-desk-button]" />,
    },
    {
      id: "shell-tab-menu",
      title: "Shell · Tab menu",
      description:
        "card 머리 줄 ⋯의 tab 메뉴. Float, Split with next tab(split이면 Unsplit), Move to new window, Close tab.",
      render: () => <ShellScene variant="project" open="[data-tab-menu]" />,
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
      id: "shell-collapsed",
      title: "Shell · Sidebars collapsed",
      description:
        "양쪽 sidebar를 접은 상태. card가 shell 가장자리에서 조금 띄워지고 tab 줄이 왼쪽으로 당겨진다.",
      render: () => <ShellScene variant="project" left={false} right={false} />,
    },
  ],
};
