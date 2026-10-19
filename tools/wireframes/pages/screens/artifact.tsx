import type { Area } from "../types.ts";
import { ChatLink } from "./artifact/chat-link.tsx";
import { ArtifactScene } from "./artifact/scene.tsx";
import { ArtifactSidebar, ArtifactSidebarSingle } from "./artifact/sidebar.tsx";

export const artifactArea: Area = {
  id: "artifact",
  title: "Artifact",
  summary:
    "agent가 쓴 HTML을 pane의 탭으로 보는 artifact 탭, annotate, 폴더가 없을 때, 대화 글의 artifact link, project sidebar의 Artifacts 탭.",
  pages: [
    {
      id: "artifact-tab",
      title: "Artifact · tab",
      description:
        "pane 안의 artifact 탭이다. 탭 줄에 종류 아이콘과 page 제목, toolbar에 제목과 폴더 이름, 오른쪽 끝 열에 [Edit source]와 [Annotate]가 있고, 아래 page 영역은 `spending` artifact가 그린 막대 그래프다(page는 native view라 고정 그림이다).",
      render: () => <ArtifactScene tab="named" />,
    },
    {
      id: "artifact-tab-file",
      title: "Artifact · tab from a file",
      description:
        "사람의 폴더에 있는 .html을 연 탭이다. 위와 같고, toolbar 제목 아래 작은 글이 그 파일의 폴더가 읽을 수 있는 root임을 알린다.",
      render: () => <ArtifactScene tab="file" />,
    },
    {
      id: "artifact-annotate",
      title: "Artifact · annotate",
      description:
        "annotate가 켜진 탭이다. 막대에 번호 표지와 메모(고정 그림), 왼쪽 아래에 모은 목록 panel(앱 annotate와 같은 component), 위쪽에 켰다는 toast가 있다.",
      render: () => <ArtifactScene tab="named" annotate />,
    },
    {
      id: "artifact-missing",
      title: "Artifact · folder missing",
      description:
        "폴더가 없어진 artifact를 다시 열었을 때의 placeholder다. 무엇이 없는지 한 문장과 [Try again] 하나이고, 탭 단추는 꺼진다.",
      render: () => <ArtifactScene tab="named" missing />,
    },
    {
      id: "artifact-chat-link",
      title: "Artifact · chat link",
      description:
        "대화 글 안에서 그 project의 domain artifact path가 link로 그려진 모양이다. 앞에 종류 아이콘이 붙고 hover하면 제목, 설명, 누르면 하는 일이 뜬다. 목록에 없는 path는 link가 아닌 글 그대로다.",
      render: () => <ChatLink />,
    },
    {
      id: "artifact-sidebar-list",
      title: "Artifact · sidebar list",
      description:
        "project sidebar의 Artifacts 탭에 domain이 둘 이상일 때의 목록이다. domain 제목 아래에 artifact 묶음이 서고 제목을 누르면 묶음이 접힌다(제목 오른쪽 끝에 개수). 줄마다 종류 아이콘, 제목과 폴더 이름, 설명 한 줄이고 누르면 그 artifact가 탭으로 열린다. artifact가 없는 domain은 묶음에 안내 한 문장이 선다.",
      render: () => <ArtifactSidebar />,
    },
    {
      id: "artifact-sidebar-single",
      title: "Artifact · sidebar one domain",
      description:
        "domain이 하나뿐인 project의 Artifacts 목록이다. 묶음 제목 없이 한 줄 목록이다. 고정 크기 칸에 목록만 그린다.",
      render: () => <ArtifactSidebarSingle />,
    },
    {
      id: "artifact-sidebar-empty",
      title: "Artifact · sidebar empty",
      description:
        "artifact가 하나도 없을 때(domain 개수와 상관없이)의 Artifacts 탭이다. 본문에는 단추 없이 안내 한 문장만 있다.",
      render: () => <ArtifactSidebar empty />,
    },
  ],
};
