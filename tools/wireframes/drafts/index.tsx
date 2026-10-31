import type { Area } from "../pages/types.ts";
import { press, useDrive } from "../mock/drive.ts";
import {
  APP_SCENE,
  APP_SPLIT_SCENE,
  DESK_SCENE,
  FLOAT_SCENE,
  HOME_SCENE,
  PROJECT_SCENE,
  type Scene,
  SPLIT_SCENE,
} from "./shell/data.ts";
import { SettingsDraft } from "./shell/settings.tsx";
import { ShellDraft } from "./shell/shell.tsx";

function NewSessionMenuOpen({ scene }: { scene: Scene }) {
  useDrive(() => press("[data-new-session-menu]"));
  return <ShellDraft scene={scene} />;
}

function TabMenuOpen({ scene }: { scene: Scene }) {
  useDrive(() => press("[data-tab-menu]"));
  return <ShellDraft scene={scene} />;
}

function DeskMenuOpen({ scene }: { scene: Scene }) {
  useDrive(() => press("[data-desk-button]"));
  return <ShellDraft scene={scene} />;
}

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    {
      id: "draft-shell-home",
      title: "Shell · Home",
      description:
        "UI 개편 shell. title bar에 올라간 둥근 tab, 왼쪽 place·session, 오른쪽 panel. Home도 같은 틀의 workspace이고 오른쪽 Places가 옛 launcher를 맡는다.",
      render: () => <ShellDraft scene={HOME_SCENE} />,
    },
    {
      id: "draft-shell-project",
      title: "Shell · Project",
      description:
        "project place의 Main desk. desk 단추는 title bar의 lophn 옆이다. 왼쪽 sidebar는 place마다 열린 session만 보이고 Recent는 접어 둔다(phroner는 펼침). 옆의 session을 누르면 그 session tab이 열린 desk로 가고(PR #42 검토 → 리뷰용), 어디에도 없으면 지금 desk에 tab으로 연다. ← →는 이동 기록을 오간다.",
      render: () => <ShellDraft scene={PROJECT_SCENE} />,
    },
    {
      id: "draft-shell-float",
      title: "Shell · Floats",
      description:
        "접힌 칸 둘을 펴서 card 위에 float으로 띄운 상태. 편 칸은 아래 막대가 붙는다. float의 단추로 다시 접고, tab으로 dock하고, 닫는다.",
      render: () => <ShellDraft scene={FLOAT_SCENE} />,
    },
    {
      id: "draft-shell-split",
      title: "Shell · Split",
      description:
        "칸 split은 두 tab을 한 칸으로 붙인 split tab 하나다(Chrome Split View). 왼쪽 lophn session, 오른쪽 Claude Code session. 누른 쪽이 focus다. grid와 칸마다의 tab 줄은 없다.",
      render: () => <ShellDraft scene={SPLIT_SCENE} />,
    },
    {
      id: "draft-shell-desk",
      title: "Shell · Workflow desk",
      description:
        "workflow desk로 바꾼 상태. tab 줄과 float이 그 desk 것으로 통째로 바뀐다. 사람 차례인 workflow desk는 왼쪽 sidebar의 project 아래에도 있다.",
      render: () => <ShellDraft scene={DESK_SCENE} />,
    },
    {
      id: "draft-shell-desk-menu",
      title: "Shell · Desk menu",
      description:
        "desk 단추를 연 상태. 사람이 만든 desk(Main, 리뷰용)와 workflow desk를 고르고, New desk로 빈 desk를 만든다.",
      render: () => <DeskMenuOpen scene={PROJECT_SCENE} />,
    },
    {
      id: "draft-shell-tab-menu",
      title: "Shell · Tab menu",
      description:
        "card 머리 줄 ⋯의 tab 메뉴. Float, Split with next tab(split이면 Unsplit), Move to new window, Close tab.",
      render: () => <TabMenuOpen scene={PROJECT_SCENE} />,
    },
    {
      id: "draft-shell-new-session",
      title: "Shell · New session",
      description:
        "New session 옆 ▾. lophn agent와 coding agent를 골라 새 session을 연다.",
      render: () => <NewSessionMenuOpen scene={PROJECT_SCENE} />,
    },
    {
      id: "draft-shell-app",
      title: "Shell · App",
      description:
        "app place(MaHas). 가운데 tab에 앱 화면(한도 탭), 오른쪽에 release·preview·grant와 Files·Domain·Logs.",
      render: () => <ShellDraft scene={APP_SCENE} />,
    },
    {
      id: "draft-shell-app-split",
      title: "Shell · App + session",
      description:
        "앱 화면과 그 앱 place의 lophn session을 split tab 하나로 붙여 나란히 본다. 오른쪽 sidebar는 접었다.",
      render: () => <ShellDraft scene={APP_SPLIT_SCENE} />,
    },
    {
      id: "draft-shell-settings",
      title: "Shell · Settings",
      description:
        "같은 shell 안의 Settings. 왼쪽 sidebar가 Settings 항목으로 바뀌고 tab 줄에는 Settings tab 하나, 오른쪽 sidebar는 없다. 가운데는 실제 Settings panel이다.",
      render: () => <SettingsDraft pane="appearance" />,
    },
  ],
};
