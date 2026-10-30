import type { Area } from "../types.ts";
import {
  AppDomainDoc,
  AppDomains,
  NewDomainDialogPage,
  ProjectDomains,
  ProjectDomainsEmpty,
} from "./domain/pages.tsx";

export const domainArea: Area = {
  id: "domain",
  title: "Domain",
  summary:
    "project 창 sidebar의 Domains 탭과 앱 상세의 Domains 절. 목록, 줄 menu, 새 domain dialog, 앱의 마지막 domain.",
  pages: [
    {
      id: "domain-project-a",
      title: "Domains in a project",
      description:
        "sidebar의 네 번째 탭 Domains다. 탭 넷은 240px에서 이름이 잘려 아이콘만 두고 이름은 tooltip이다. 위쪽에 [New domain], 줄마다 이름과 한 줄 목적이고 줄 끝 menu에 Open DOMAIN.md와 Archive가 있다(첫 줄 menu를 열어 둠).",
      render: () => <ProjectDomains />,
    },
    {
      id: "domain-project-empty",
      title: "Domains in a project · no domains yet",
      description:
        "domain이 0개인 project의 Domains 탭이다. 안내 한 문단과 [New domain]이 있다.",
      render: () => <ProjectDomainsEmpty />,
    },
    {
      id: "domain-create-dialog",
      title: "Domains in a project · New domain dialog",
      description:
        "[New domain]이 여는 dialog다. name(slug), title, 목적 한 줄을 받고 name은 만든 뒤 바꿀 수 없다. 채운 채 Create를 누를 수 있는 상태다.",
      render: () => <NewDomainDialogPage />,
    },
    {
      id: "domain-app-b",
      title: "Domains in an app",
      description:
        "앱 상세 패널 이름 아래의 Domains 절이다. 줄마다 tool 수와 public tool 수가 있고 줄 menu는 project와 같다(첫 줄 menu를 열어 둠).",
      render: () => <AppDomains />,
    },
    {
      id: "domain-app-last",
      title: "Domains in an app · last domain",
      description:
        "앱의 마지막 domain 줄이다. menu의 Archive가 꺼지고 이유를 tooltip으로 보인다. 앱은 domain이 하나 이상 있어야 한다.",
      render: () => <AppDomains last />,
    },
    {
      id: "domain-app-doc",
      title: "Domains in an app · editing DOMAIN.md",
      description:
        "줄 menu의 Open DOMAIN.md를 누르면 그 줄 바로 아래가 파일 탭과 같은 markdown 편집기가 된다. [Cancel]·[Save]가 오른쪽 끝이고 다른 화면으로 옮겨 가지 않는다.",
      render: () => <AppDomainDoc />,
    },
  ],
};
