import type { Area } from "../pages/types.ts";
import {
  ArtifactAnnotatePage,
  ArtifactChatLinkPage,
  ArtifactMissingPage,
  ArtifactSidebarListPage,
  ArtifactTabFilePage,
  ArtifactTabPage,
} from "./artifact/pages.tsx";
import { ContextWays } from "./ways-page.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    {
      id: "new-ways-to-open",
      title: "Context · ways to open",
      description:
        "Context 탭을 여는 길 여덟을 한 장에 모았다. 길마다 try it을 누르면 그 길을 눌러 볼 수 있는 page로 간다.",
      render: () => <ContextWays />,
    },
    {
      id: "artifact-tab",
      title: "Artifact · tab",
      description:
        "pane 안의 artifact 탭이다. 탭 줄에 종류 아이콘과 page 제목, toolbar에 제목과 폴더 이름, 오른쪽 끝 열에 [Edit source]와 [Annotate]가 있고, 아래 page 영역은 `spending` artifact가 그린 막대 그래프다.",
      render: () => <ArtifactTabPage />,
    },
    {
      id: "artifact-tab-file",
      title: "Artifact · tab from a file",
      description:
        "사람의 폴더에 있는 .html을 연 탭이다. 위와 같고, toolbar 제목 아래 작은 글이 그 파일의 폴더가 읽을 수 있는 root임을 알린다.",
      render: () => <ArtifactTabFilePage />,
    },
    {
      id: "artifact-annotate",
      title: "Artifact · annotate",
      description:
        "annotate가 켜진 탭이다. 막대에 번호 표지와 메모, 왼쪽 아래에 모은 목록 panel(앱 annotate와 같은 component)이 있다. 위쪽 toast 둘은 켰을 때와 보낸 뒤의 글이다. 실제로는 한 번에 하나만 뜬다.",
      render: () => <ArtifactAnnotatePage />,
    },
    {
      id: "artifact-missing",
      title: "Artifact · folder missing",
      description:
        "폴더가 없어진 artifact를 다시 열었을 때의 placeholder다. 무엇이 없는지 한 문장과 [Try again] 하나이고, 탭 단추는 꺼진다.",
      render: () => <ArtifactMissingPage />,
    },
    {
      id: "artifact-sidebar-list",
      title: "Artifact · sidebar list",
      description:
        "project sidebar의 네 번째 탭 Artifacts다. 왼쪽 목록은 줄마다 종류 아이콘, 제목과 폴더 이름, 설명 한 줄이고 지우기는 오른쪽 끝 열에서 고른 줄과 hover에서만 보인다. 오른쪽은 artifact가 하나도 없을 때의 안내로, 단추 없이 한 문장이다.",
      render: () => <ArtifactSidebarListPage />,
    },
    {
      id: "artifact-chat-link",
      title: "Artifact · chat link",
      description:
        "대화 글 안에서 그 domain의 artifact path가 link로 그려진 모양이다. 앞에 종류 아이콘이 붙고 hover하면 제목, 설명, 누르면 하는 일이 뜬다. 목록에 없는 path는 link가 아닌 평문 code다.",
      render: () => <ArtifactChatLinkPage />,
    },
  ],
};
