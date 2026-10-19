// domain 화면 Drafts. 사람이 고를 질문 넷의 A·B를 질문 순서로 놓는다(gallery도 이 순서다). 모든 page는 mock/domain의 고정 data로
// 그린다. 고르면 그 모양을 renderer로 옮긴다(page id는 바꾸지 않는다). 보고서의 page 표가 옮길 자리를 적는다.
import type { Page } from "../../pages/types.ts";
import { PaddedTab } from "../../../../packages/shell/renderer/workspace/panes/padded-tab.tsx";
import { ProjectApp } from "../../pages/screens/project-app.tsx";
import {
  APP_DOMAINS,
  OPERATOR_NAME,
  PROJECT_DOMAINS,
} from "../../mock/domain/data.ts";
import { ArtifactsPage } from "./artifacts.tsx";
import {
  DetailsWithDomains,
  DraftAppSpace,
  ManagePanel,
} from "./app-frame.tsx";
import { OperatorDraft } from "./operator.tsx";
import {
  AppDomainsSection,
  DomainChips,
  DomainList,
  NewDomainDialog,
} from "./parts.tsx";
import {
  AgentTabBody,
  DraftProjectWindow,
  DraftSidebar,
  SIDEBAR_KEYS,
  SIDEBAR_KEYS_NO_DOMAIN,
} from "./project-frame.tsx";
import { DomainEmptyPair } from "./empty.tsx";

const projectA = (domains = PROJECT_DOMAINS) => (
  <DraftProjectWindow
    sidebar={
      <DraftSidebar keys={SIDEBAR_KEYS} selected="domain">
        <DomainList domains={domains} openFirst={domains.length > 0} />
      </DraftSidebar>
    }
  />
);

function OperatorPage({ variant }: { variant: "a" | "b" }) {
  const tab = {
    key: "agent-edit:eval-analyst",
    kind: "operator" as const,
    title: OPERATOR_NAME,
    sub: "eval-analyst",
    body: (
      <PaddedTab bare>
        <OperatorDraft variant={variant} />
      </PaddedTab>
    ),
  };
  return (
    <ProjectApp
      sidebar={{ foldersClosed: true }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

export const domainPages: readonly Page[] = [
  {
    id: "domain-project-a",
    title: "Domains in a project · A: Domains tab",
    description:
      "질문 1의 A. sidebar의 네 번째 탭 Domains다. 위쪽에 [New domain], 줄마다 이름, 한 줄 목적, kind·skill·artifact 수이고 줄 끝 menu에 Open DOMAIN.md와 Archive가 있다(첫 줄 menu를 열어 둠).",
    render: () => projectA(),
  },
  {
    id: "domain-project-b",
    title: "Domains in a project · B: chips on the Agent tab",
    description:
      "질문 1의 B. Agent 탭 위쪽에 domain chip 줄이 있고 chip 하나가 domain 하나, 끝에 + chip이다. chip을 누르면 A의 줄 menu와 같은 항목이 열린다(첫 chip menu를 열어 둠).",
    render: () => (
      <DraftProjectWindow
        sidebar={
          <DraftSidebar keys={SIDEBAR_KEYS_NO_DOMAIN} selected="agent">
            <DomainChips domains={PROJECT_DOMAINS} openFirst />
            <AgentTabBody />
          </DraftSidebar>
        }
      />
    ),
  },
  {
    id: "domain-project-empty",
    title: "Domains in a project · no domains yet",
    description:
      "질문 1의 A·B 공통 빈 상태. domain이 0개인 project다. 왼쪽이 A(Domains 탭 안내와 [New domain]), 오른쪽이 B(Agent 탭에 + chip 하나와 같은 안내)다.",
    render: () => <DomainEmptyPair />,
  },
  {
    id: "domain-create-dialog",
    title: "Domains in a project · New domain dialog",
    description:
      "질문 1의 A·B 공통. [New domain]이나 + chip이 여는 dialog다. name(slug), title, 목적 한 줄을 받고 name은 만든 뒤 바꿀 수 없다.",
    render: () => (
      <DraftProjectWindow
        sidebar={
          <DraftSidebar keys={SIDEBAR_KEYS} selected="domain">
            <DomainList domains={[]} />
          </DraftSidebar>
        }
      >
        <NewDomainDialog />
      </DraftProjectWindow>
    ),
  },
  {
    id: "domain-app-a",
    title: "Domains in an app · A: chips in the top bar",
    description:
      "질문 2의 A. 앱 공간 위쪽 바의 agent select 옆에 domain chip 줄이 있다. chip menu는 project의 것과 같다(첫 chip menu를 열어 둠).",
    render: () => (
      <DraftAppSpace
        agentExtra={<DomainChips bar domains={APP_DOMAINS} openFirst />}
      />
    ),
  },
  {
    id: "domain-app-b",
    title: "Domains in an app · B: Domains section in App details",
    description:
      "질문 2의 B. 앱 상세 패널 이름 아래에 Domains 절이 있고 줄마다 tool 수와 public tool 수가 있다. 줄 menu는 같다(첫 줄 menu를 열어 둠).",
    render: () => (
      <DraftAppSpace
        details={
          <DetailsWithDomains
            domains={<AppDomainsSection domains={APP_DOMAINS} openFirst />}
          />
        }
      />
    ),
  },
  {
    id: "domain-app-last",
    title: "Domains in an app · last domain",
    description:
      "질문 2의 A·B 공통. 앱의 마지막 domain 줄이다. menu의 Archive가 꺼지고 이유를 tooltip으로 보인다. B 모양으로 그렸고 A의 chip menu도 같다.",
    render: () => (
      <DraftAppSpace
        details={
          <DetailsWithDomains
            domains={
              <AppDomainsSection
                domains={APP_DOMAINS.slice(0, 1)}
                openFirst
                lastOne
              />
            }
          />
        }
      />
    ),
  },
  {
    id: "domain-operator-a",
    title: "Operator domains · A: multi-select",
    description:
      "질문 3의 A. Operator 편집의 Domains 칸이 다중 선택이고 비우면 그릇의 domain 전부라는 안내가 뜬다. Skills 칸은 고른 domain의 skill만 한 목록에 나온다.",
    render: () => <OperatorPage variant="a" />,
  },
  {
    id: "domain-operator-b",
    title: "Operator domains · B: checkboxes and grouped skills",
    description:
      "질문 3의 B. Skills 칸 위에 domain 체크 목록이 있고 체크한 domain별로 skill 묶음이 나온다.",
    render: () => <OperatorPage variant="b" />,
  },
  {
    id: "domain-operator-app",
    title: "Operator domains · app Operator (A)",
    description:
      "질문 3의 A 모양으로 그린 앱 그릇의 Operator다. 앱에는 LOPHN.md가 없어 지침 층 안내가 다르고, 오른쪽 패널의 Manage agents 탭에서 연다.",
    render: () => (
      <DraftAppSpace
        aside={
          <ManagePanel>
            <OperatorDraft variant="a" place="app" />
          </ManagePanel>
        }
      />
    ),
  },
  {
    id: "domain-artifacts-a",
    title: "Artifacts by domain · A: groups",
    description:
      "질문 4의 A. Artifacts 탭이 domain 제목 아래 artifact 줄을 묶고 묶음을 접을 수 있다(Docs는 접힘).",
    render: () => <ArtifactsPage variant="a" />,
  },
  {
    id: "domain-artifacts-b",
    title: "Artifacts by domain · B: badges and a domain select",
    description:
      "질문 4의 B. 한 목록에 줄마다 domain 배지가 있고 위쪽 select로 한 domain만 걸러 본다.",
    render: () => <ArtifactsPage variant="b" />,
  },
  {
    id: "domain-artifacts-single",
    title: "Artifacts by domain · only one domain",
    description:
      "질문 4의 A·B 공통. domain이 하나뿐이면 묶음 제목, 배지, select를 모두 없애 지금의 평평한 목록과 같다.",
    render: () => <ArtifactsPage variant="single" />,
  },
];
