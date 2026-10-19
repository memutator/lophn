import type { Area } from "../pages/types.ts";
import {
  ArtifactSidebarEmptyPage,
  ArtifactSidebarListPage,
} from "./artifact/pages.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    {
      id: "artifact-sidebar-list",
      title: "Artifact · sidebar list",
      description:
        "project sidebar의 Artifacts 탭에 artifact가 있을 때의 목록이다. 탭은 Explorer, Agent, Artifacts 순으로 Artifacts가 세 번째이고, 줄마다 종류 아이콘, 제목과 폴더 이름, 설명 한 줄이며 지우기는 오른쪽 끝 열에서 고른 줄과 hover에서만 보인다.",
      render: () => <ArtifactSidebarListPage />,
    },
    {
      id: "artifact-sidebar-empty",
      title: "Artifact · sidebar empty",
      description:
        "artifact가 하나도 없을 때의 Artifacts 탭이다. Artifacts는 Explorer, Agent 다음의 세 번째 탭이고, 본문에는 단추 없이 안내 한 문장만 있다.",
      render: () => <ArtifactSidebarEmptyPage />,
    },
  ],
};
