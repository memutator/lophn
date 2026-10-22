// wireframes gallery의 page 목록. 묶음 > 영역 > page 순이고, 영역 하나는 파일 하나다.
//
// page 하나를 더하는 법: 알맞은 영역 파일(`pages/kit/<분류>/index.tsx`, `pages/screens/<영역>.tsx`,
// `drafts/index.tsx`)의 `pages`에 `{ id, title, description, render }`를 더한다. 위치가 구현 여부를 말한다:
// Kit은 실제 design component를, Screens는 renderer를 import한 화면을, Drafts는 아직 renderer에 없는 실험을 그린다.
// fake data와 고정 도구는 `mock/`에 둔다.
//
// 버린 화면은 이 목록에 올리지 않는다: Settings › Backup, project
// Export panel, Documents 화면, 앱 상세 Issues, Report a problem dialog, Waiting · reaction approval,
// Settings › Reactions, Agent · recap.
import { draftsArea } from "../drafts/index.tsx";
import { appUiArea } from "./kit/app-ui/index.tsx";
import { dataArea } from "./kit/data/index.tsx";
import { feedbackArea } from "./kit/feedback/index.tsx";
import { inputArea } from "./kit/input/index.tsx";
import { layoutArea } from "./kit/layout/index.tsx";
import { navigationArea } from "./kit/navigation/index.tsx";
import { overlayArea } from "./kit/overlay/index.tsx";
import { primitivesArea } from "./kit/primitives/index.tsx";
import { readingArea } from "./kit/reading/index.tsx";
import { tokensArea } from "./kit/tokens/index.tsx";
import { agentArea } from "./screens/agent.tsx";
import { agentSettingsArea } from "./screens/agent-settings.tsx";
import { appSpaceArea } from "./screens/app-space.tsx";
import { artifactArea } from "./screens/artifact.tsx";
import { domainArea } from "./screens/domain.tsx";
import { launcherArea } from "./screens/launcher.tsx";
import { projectDeskArea } from "./screens/project-desk.tsx";
import { projectWorkspaceArea } from "./screens/project-workspace.tsx";
import { questionsArea } from "./screens/questions.tsx";
import { settingsArea } from "./screens/settings.tsx";
import { workflowArea } from "./screens/workflow.tsx";
import type { Area, Group, Page } from "./types.ts";

const ALL_GROUPS: readonly Group[] = [
  {
    id: "kit",
    title: "Kit",
    summary:
      "@lophn/ui의 token과 분류별 component, @lophn/app-ui를 실제 component로 그린다. frame 없이 본문에 바로 그리고, 위쪽 Light·Dark 선택을 따른다.",
    inline: true,
    areas: [
      tokensArea,
      primitivesArea,
      inputArea,
      layoutArea,
      navigationArea,
      dataArea,
      feedbackArea,
      overlayArea,
      readingArea,
      appUiArea,
    ],
  },
  {
    id: "screens",
    title: "Screens",
    summary:
      "제품 영역별 화면. renderer의 component를 import해 mock 데이터로 그린 진짜 화면이다.",
    inline: false,
    areas: [
      launcherArea,
      projectWorkspaceArea,
      projectDeskArea,
      agentArea,
      agentSettingsArea,
      appSpaceArea,
      artifactArea,
      domainArea,
      workflowArea,
      settingsArea,
      questionsArea,
    ],
  },
  {
    id: "drafts",
    title: "Drafts",
    summary:
      "승인 전 실험. 아직 renderer에 같은 component가 없어 gallery 안에서만 그린다.",
    inline: false,
    areas: [draftsArea],
  },
];

// page가 없는 영역(Drafts를 모두 Screens로 옮긴 뒤 같은)은 싣지 않는다. 목록이 첫 page로 링크를 건다.
export const GROUPS: readonly Group[] = ALL_GROUPS
  .map((group) => ({
    ...group,
    areas: group.areas.filter((area) => area.pages.length > 0),
  }))
  .filter((group) => group.areas.length > 0);

export interface Located {
  readonly group: Group;
  readonly area: Area;
  readonly page: Page;
}

export function locate(id: string): Located | undefined {
  for (const group of GROUPS) {
    for (const area of group.areas) {
      const page = area.pages.find((p) => p.id === id);
      if (page !== undefined) return { group, area, page };
    }
  }
  return undefined;
}

export function pageById(id: string): Page | undefined {
  return locate(id)?.page;
}
