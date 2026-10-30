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
  PROJECTS_FAILED,
} from "./project-desk/desks.ts";

function MenuOpen(props: DeskWindowProps & { kind: "desk" | "project" }) {
  useDrive(() => press(`[data-path-selector="${props.kind}"]`));
  return <DeskWindow {...props} />;
}

export const projectDeskArea: Area = {
  id: "project-desk",
  title: "Project desk",
  summary:
    "project 창 위쪽 바 왼쪽의 place switcher(윗줄에 종류, 아랫줄에 이름)와 `/ desk ▾`. place를 고르면 그 place를 이 창에서 연다. 자리(desk)를 바꾸면 탭, floated 패널, 접힌 span이 그 자리 것으로 바뀐다.",
  pages: [
    {
      id: "project-desk-default",
      title: "Project desk · no workflow",
      description:
        "workflow가 없는 project. 고를 자리가 하나뿐이라 왼쪽에 place switcher만 있고 `/ desk ▾`는 없다. 파일 경로 breadcrumb은 없다.",
      render: () => <DeskWindow options={OPTIONS_NONE} />,
    },
    {
      id: "project-desk-switch",
      title: "Project desk · switch",
      description:
        "workflow 둘과 틀린 선언 하나. 왼쪽의 place switcher와 `desk ▾`를 눌러 place와 자리를 바꾼다. 자리를 바꾸면 pane의 탭, floated 패널, 접힌 span이 그 자리 것으로 통째로 바뀐다.",
      render: () => <DeskWindow options={OPTIONS_ALL} />,
    },
    {
      id: "project-desk-menu",
      title: "Project desk · menu",
      description:
        "desk menu를 연 모양. 고른 자리에 check가 붙고 틀린 선언 항목에는 오류 표시가 붙지만 고를 수 있다.",
      render: () => <MenuOpen kind="desk" options={OPTIONS_ALL} />,
    },
    {
      id: "project-desk-project-menu",
      title: "Project desk · project menu",
      description:
        "place switcher를 연 모양. Projects와 Apps 두 묶음이 각각 최근에 연 순서로 서고, 줄마다 첫 글자 표식이 붙는다. 지금 project에 check가 붙고, 고르면 그 place를 이 창에서 연다(launcher에서 card를 누른 것과 같다).",
      render: () => <MenuOpen kind="project" options={OPTIONS_ALL} />,
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
        "workflow 목록과 project 목록을 둘 다 읽지 못한 상태. desk menu에는 기본 자리와 이미 layout에 있는 자리만, project menu에는 지금 project 하나만 있다. 따로 알리지 않는다.",
      render: () => (
        <DeskWindow options={OPTIONS_FAILED} projects={PROJECTS_FAILED} />
      ),
    },
    {
      id: "project-desk-narrow",
      title: "Project desk · narrow window",
      description:
        "좁은 창(sidebar 접힘). 접힌 span이 먼저 +N으로 접히고, 그다음 desk 이름, 그다음 project 이름이 ellipsis로 준다. 오른쪽 단추는 그대로다.",
      render: () => (
        <DeskWindow
          options={OPTIONS_ALL}
          active="release-notes"
          collapsed
          width={480}
        />
      ),
    },
    {
      id: "project-desk-platforms",
      title: "Project desk · platforms",
      description:
        "macOS 신호등 자리와 Windows 창 단추 자리를 가진 위쪽 바를 나란히. macOS는 신호등 오른쪽에서 왼쪽 경로가 시작하고, Windows는 오른쪽 창 단추가 palette 단추 옆을 차지한다.",
      render: () => <Platforms />,
    },
  ],
};
