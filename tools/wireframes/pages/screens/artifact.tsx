import type { Area } from "../types.ts";
import { ChatLink } from "./artifact/chat-link.tsx";
import { ArtifactScene } from "./artifact/scene.tsx";

export const artifactArea: Area = {
  id: "artifact",
  title: "Artifact",
  summary:
    "agent가 쓴 HTML을 pane의 탭으로 보는 artifact 탭, annotate, 폴더가 없을 때, 대화 글의 artifact link.",
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
        "대화 글 안에서 그 project의 artifact path가 link로 그려진 모양이다. 앞에 종류 아이콘이 붙고 hover하면 제목, 설명, 누르면 하는 일이 뜬다. 목록에 없는 path는 link가 아닌 글 그대로다.",
      render: () => <ChatLink />,
    },
  ],
};
