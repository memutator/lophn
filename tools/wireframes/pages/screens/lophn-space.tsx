import type { Area } from "../types.ts";
import { openLophn } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  WorkspaceApps,
  WorkspaceFolderMissing,
  WorkspaceProjects,
  WorkspaceSubfolderAdd,
  WorkspaceSubfolderEdit,
} from "./workspace/pages.tsx";
import { MockDesktop } from "../../mock/mock-desktop.tsx";

export const lophnSpaceArea: Area = {
  id: "lophn-space",
  title: "Lophn Workspace",
  summary:
    "lophn 공간의 Projects와 Apps. 등록한 프로젝트와 설치한 앱을 보고 정리한다.",
  pages: [
    {
      id: "lophn-projects",
      title: "Lophn Workspace · Projects",
      description:
        "lophn 공간의 Projects. 등록한 프로젝트를 목록으로 보고, 고르면 이름·보관·폴더 같은 정리를 상세에서 한다.",
      render: () => <MockDesktop route={openLophn("projects")} />,
    },
    {
      id: "lophn-apps",
      title: "Lophn Workspace · Apps",
      description:
        "lophn 공간의 Apps. 설치한 앱의 상태와 열기, 앱 공간으로 가는 길이 한 목록에 있다.",
      render: () => <MockDesktop route={openLophn("apps")} />,
    },
    {
      id: "new-workspace",
      title: "Workspace · Projects",
      description:
        "Lophn Workspace의 화면은 Projects, Apps, Settings 셋이다. Projects 상세는 이름 하나, 목적, 폴더와 폴더 설명, 보관이고, 등록 폴더 아래에 하위 폴더가 들여 써서 중첩으로 보인다(설명, [Add subfolder], [Remove]). 목록과 상세는 가운데에 놓인다.",
      render: () => <WorkspaceProjects />,
    },
    {
      id: "new-workspace-folder-missing",
      title: "Workspace · folder not found",
      description:
        "등록한 폴더 하나가 사라진 상태다. 탭 위쪽 toast가 알리고, 그 폴더 줄에 Not found와 [Choose new location]이 있다.",
      render: () => <WorkspaceFolderMissing />,
    },
    {
      id: "new-workspace-subfolder-add",
      title: "Workspace · add subfolder",
      description:
        "등록 폴더 안의 하위 폴더를 더하는 dialog다. 폴더 고르기는 그 등록 폴더 안으로만 열리고, 이미 더한 폴더는 Added로 보인다. 고른 폴더에 설명을 달아 더한다.",
      render: () => <WorkspaceSubfolderAdd />,
    },
    {
      id: "new-workspace-subfolder-edit",
      title: "Workspace · edit subfolders",
      description:
        "하위 폴더 설명을 고친 상태와 하위 폴더 하나를 뺀 상태다. 빼도 폴더 자체는 그대로이고 [Undo]가 있다.",
      render: () => <WorkspaceSubfolderEdit />,
    },
    {
      id: "new-workspace-apps",
      title: "Workspace · Apps",
      description:
        "앱 목록(실행 상태, [Open], [Archive])과 보관한 앱([Unarchive])뿐이다. 앱 등록 단추는 없고, 앱은 lophn이나 사람이 등록한다는 안내가 있다.",
      render: () => <WorkspaceApps />,
    },
  ],
};
