// project 창 가운데의 자리(desk) selector. 실제 TopBar의 `center`와 DeskSelector로 그린다. workflow가 없으면 selector가 없고,
// 있으면 눌러 자리를 바꾼다. 자리마다 탭, floated 패널, 접힌 span이 따로 있다.
import type { Area } from "../types.ts";
import { press, useDrive } from "../../mock/drive.ts";
import { DeskWindow, type DeskWindowProps } from "./project-desk/frame.tsx";
import { Platforms } from "./project-desk/platforms.tsx";
import {
  OPTIONS_ALL,
  OPTIONS_FAILED,
  OPTIONS_NONE,
} from "./project-desk/desks.ts";

function MenuOpen(props: DeskWindowProps) {
  useDrive(() => press("[data-desk-selector]"));
  return <DeskWindow {...props} />;
}

export const projectDeskArea: Area = {
  id: "project-desk",
  title: "Project desk",
  summary:
    "project 창 위쪽 바 가운데의 자리(desk) selector. 자리를 바꾸면 탭, floated 패널, 접힌 span이 그 자리 것으로 바뀐다.",
  pages: [
    {
      id: "project-desk-default",
      title: "Project desk · no workflow",
      description:
        "workflow가 없는 project. 고를 자리가 하나뿐이라 가운데에 selector를 두지 않는다.",
      render: () => <DeskWindow options={OPTIONS_NONE} />,
    },
    {
      id: "project-desk-switch",
      title: "Project desk · switch",
      description:
        "workflow 둘과 틀린 선언 하나. 가운데 selector를 눌러 자리를 바꾸면 pane의 탭, floated 패널, 접힌 span이 그 자리 것으로 통째로 바뀐다.",
      render: () => <DeskWindow options={OPTIONS_ALL} />,
    },
    {
      id: "project-desk-menu",
      title: "Project desk · menu",
      description:
        "selector의 menu를 연 모양. 고른 자리에 check가 붙고 틀린 선언 항목에는 오류 표시가 붙지만 고를 수 있다.",
      render: () => <MenuOpen options={OPTIONS_ALL} />,
    },
    {
      id: "project-desk-workflow",
      title: "Project desk · workflow desk",
      description:
        "workflow 자리가 켜진 상태. 그 자리의 탭 둘 칸, floated terminal, 접힌 span 셋이 보인다.",
      render: () => <DeskWindow options={OPTIONS_ALL} active="release-notes" />,
    },
    {
      id: "project-desk-failed",
      title: "Project desk · list failed",
      description:
        "workflow 목록 읽기에 실패한 상태. 기본 자리와 이미 layout에 있는 자리만 고를 수 있다.",
      render: () => <DeskWindow options={OPTIONS_FAILED} />,
    },
    {
      id: "project-desk-narrow",
      title: "Project desk · narrow window",
      description:
        "좁은 창(sidebar 접힘). 왼쪽 경로와 접힌 span이 먼저 줄어들고 selector는 이름을 줄이며 오른쪽 단추는 그대로다.",
      render: () => (
        <DeskWindow
          options={OPTIONS_ALL}
          active="release-notes"
          collapsed
          width={560}
        />
      ),
    },
    {
      id: "project-desk-platforms",
      title: "Project desk · platforms",
      description:
        "macOS 신호등 자리와 Windows 창 단추 자리를 가진 위쪽 바를 나란히. selector는 둘 다 피해 남는 폭의 가운데에 선다.",
      render: () => <Platforms />,
    },
  ],
};
