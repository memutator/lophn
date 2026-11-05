import type { Area } from "../types.ts";
import {
  AgentCreatePage,
  AgentEditorPage,
  AgentGrantsAppPage,
  AgentGrantsPage,
  AgentModelPickerPage,
  AgentServerFormPage,
  AppWorkspaceEditorPage,
  LophnEditorPage,
  ProjectAgentsPage,
} from "./agent-setup/agent-setup-pages.tsx";

export const agentSettingsArea: Area = {
  id: "agent-settings",
  title: "Agent settings",
  summary: "프로젝트 Agents 탭, agent 편집, MCP server 추가, 앱 할당.",
  pages: [
    {
      id: "new-project-agents",
      title: "Agent settings · project Agents tab",
      description:
        "전역 agent 카드 목록(lophn 카드에 Built-in chip)과 [New agent], 같이 쓰는 지침(LOPHN.md), project 층 model 하나, 층 표시가 붙은 skill과 MCP가 있다. sidebar Agents 묶음의 Manage로 연다.",
      render: () => <ProjectAgentsPage />,
    },
    {
      id: "agent-settings-agent",
      title: "Agent settings · agent",
      description:
        "사람이 만든 agent의 설정이다. 프로필, 이름, project 지침과 이 agent 지침을 같이 보이는 블록, model, skill, MCP, 새 session을 Skip permissions로 시작하는 기본값 체크가 있다(사람만 쓰는 칸이고 꺼져 있다). Model 칸은 대화와 같은 picker이고(맨 아래 Manage models 줄) 칸 아래에 지금 model이 온 층(이 agent가 골랐다)이 한 줄로 보인다. MCP 줄 중 OAuth로 로그인하는 server(이 agent 층의 linear 포함)는 아직 로그인하지 않았으면 오른쪽에 [Sign in]이 있다. Built-in instructions 줄과 Permissions 칸은 없고 Definition과 Grants 탭이 있다.",
      render: () => <AgentEditorPage />,
    },
    {
      id: "agent-settings-model-picker",
      title: "Agent settings · agent model picker",
      description:
        'agent의 Model 칸 picker를 연 상태다. 맨 위에 "Use project default — …" 줄이 있고 그 아래에 검색칸, provider별 model이 있다. 맨 아래에 Manage models 줄이 있다. 칸 아래 한 줄이 층이다.',
      render: () => <AgentModelPickerPage />,
    },
    {
      id: "agent-settings-create",
      title: "Agent settings · new agent",
      description:
        "같은 화면에서 새 agent를 만든다. Grants 탭은 만든 뒤에 열린다.",
      render: () => <AgentCreatePage />,
    },
    {
      id: "new-agent-editor-lophn",
      title: "Agent settings · lophn",
      description:
        "lophn은 고정 id의 내장 agent다. 이름과 profile 칸이 잠기고 Delete가 없다. 나머지 칸은 다른 agent와 같다.",
      render: () => <LophnEditorPage />,
    },
    {
      id: "agent-settings-app-workspace",
      title: "Agent settings · agent in an app",
      description:
        "앱 자리에서 연 agent의 설정이다. 앱에는 project 지침이 없어 지침은 이 agent의 본문뿐이다.",
      render: () => <AppWorkspaceEditorPage />,
    },
    {
      id: "new-agent-mcp-server-form",
      title: "Agent settings · add MCP server",
      description:
        "agent 층에서 MCP server를 더하는 form에 web 주소와 OAuth 2.1 로그인을 고른 상태다. 이름, 연결 방식, 실행이나 주소, 로그인 방식(None, Bearer, API key, OAuth 2.1)과 OAuth issuer·client ID·scopes를 받고 key·token·client secret은 더한 뒤 보호 입력으로 받는다. OAuth 2.1 server는 정의를 저장한 뒤 그 줄의 [Sign in]으로 로그인한다.",
      render: () => <AgentServerFormPage />,
    },
    {
      id: "new-agent-grants",
      title: "Agent settings · grants",
      description:
        "agent에게 맡길 것은 앱 하나다. 효과별 기본값 표는 없다. 아래에 MCP server는 설정한 곳(Global, project, 이 agent의 Definition)이 할당이라는 한 줄만 있다.",
      render: () => <AgentGrantsPage />,
    },
    {
      id: "new-agent-grants-app",
      title: "Agent settings · grants, app expanded",
      description:
        "앱 하나를 펼쳐 tool마다 이름, 효과, 넣음과 뺌(Allowed)만 고른다. 뺀 tool(delete_expense)은 꺼져 있다.",
      render: () => <AgentGrantsAppPage />,
    },
  ],
};
