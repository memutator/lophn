import type { Area } from "../types.ts";
import {
  AgentCreatePage,
  AgentEditorPage,
  AgentGrantsAppPage,
  AgentGrantsPage,
  AgentModelPickerPage,
  AgentServerFormPage,
  AppAgentsNoSourcePage,
  AppAgentsPage,
  AppWorkspaceEditorPage,
  HomeAgentsOpenScopedPage,
  HomeAgentsPage,
  HomeLophnEditorPage,
  LophnEditorPage,
  ProjectAgentsPage,
} from "./agent-setup/agent-setup-pages.tsx";

export const agentSettingsArea: Area = {
  id: "agent-settings",
  title: "Agent settings",
  summary:
    "workspace(project, Home, 앱)의 Agents 탭, agent 편집, MCP server 추가, 앱 할당.",
  pages: [
    {
      id: "new-project-agents",
      title: "Agent settings · project Agents tab",
      description:
        "전역 agent 카드 목록(lophn 카드에 Built-in chip)과 [New agent], 같이 쓰는 지침(LOPHN.md), workspace memory(크기가 8 KiB 대비로 보이고 lophn이 쓴다는 안내와 다음 session부터 보인다는 안내가 있다), project 층 model 하나, 층 표시가 붙은 skill과 MCP가 있다. 지침과 memory는 [Edit]으로 그 자리에서 고친다.",
      render: () => <ProjectAgentsPage />,
    },
    {
      id: "agents-tab-home",
      title: "Agent settings · Home Agents tab",
      description:
        "Home에서 여는 Agents 탭은 모든 agent를 보인다: Home lophn, 전역 agent, 모든 project·앱의 범위 agent. 카드마다 범위(All of lophn, <name> · project, <name> · app)가 보이고 [New agent]는 전역 agent를 만든다. Home lophn 카드의 범위는 Home이고, 지침은 Home의 LOPHN.md, memory는 Home의 memory.md이며 model·skill·MCP 층도 Home의 것이다. project·앱의 Agents 탭은 그 범위의 목록 그대로다.",
      render: () => <HomeAgentsPage />,
    },
    {
      id: "agents-tab-home-open-scoped",
      title: "Agent settings · Home Agents tab, scoped agent open",
      description:
        "Home 목록에서 project 범위 agent(Experiment planner)를 열었다. 같은 editor가 그 agent 자신의 workspace(phroner)로 열려 범위가 phroner · project로 보이고, 지침·skill·MCP 층도 phroner의 것이다.",
      render: () => <HomeAgentsOpenScopedPage />,
    },
    {
      id: "agents-tab-app",
      title: "Agent settings · app Agents tab",
      description:
        "앱에서 여는 Agents 탭이다. 지침은 앱 source 폴더의 AGENTS.md이고, memory와 model·skill·MCP 층은 그 앱의 것이다.",
      render: () => <AppAgentsPage />,
    },
    {
      id: "agents-tab-app-no-source",
      title: "Agent settings · app without source",
      description:
        "source 폴더를 잇지 않은 앱의 Agents 탭이다. AGENTS.md 칸이 비어 있고 [Edit]이 없으며 파일이 없다는 안내만 있다.",
      render: () => <AppAgentsNoSourcePage />,
    },
    {
      id: "agent-settings-agent",
      title: "Agent settings · agent",
      description:
        "사람이 만든 agent의 설정이다. 프로필, 이름, workspace 지침과 이 agent 지침을 같이 보이는 블록, 이 agent의 Memory 칸(8 KiB 대비 크기와 [Edit]), model, skill, MCP, 새 session을 Skip permissions로 시작하는 기본값 체크가 있다(사람만 쓰는 칸이고 꺼져 있다). Model 칸은 대화와 같은 picker이고(맨 아래 Manage models 줄) 칸 아래에 지금 model이 온 층(이 agent가 골랐다)이 한 줄로 보인다. MCP 아래의 Shell extensions 칸에는 설치되고 켜진 extension이 줄마다 이름, 설명, tool 수와 할당 check로 보인다(bare면 할당한 extension의 tool을 Tools에서 고른다). MCP 줄 중 OAuth로 로그인하는 server(이 agent 층의 linear 포함)는 아직 로그인하지 않았으면 오른쪽에 [Sign in]이 있다. Built-in instructions 줄과 Permissions 칸은 없고 Definition과 Grants 탭이 있다.",
      render: () => <AgentEditorPage />,
    },
    {
      id: "agent-settings-model-picker",
      title: "Agent settings · agent model picker",
      description:
        'agent의 Model 칸 picker를 연 상태다. 맨 위에 "Use workspace default — …" 줄이 있고 그 아래에 검색칸, provider별 model이 있다. provider 묶음은 대화의 picker와 같이 접고 펼 수 있다(묶음이 하나뿐이라 늘 펼쳐 있다). 맨 아래에 Manage models 줄이 있다. 칸 아래 한 줄이 층이다.',
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
        "project의 lophn이다(workspace마다 하나). handle과 profile 칸이 잠기고 이름은 바꿀 수 있으며 Delete가 없다. 나머지 칸은 다른 agent와 같다.",
      render: () => <LophnEditorPage />,
    },
    {
      id: "agent-settings-app-workspace",
      title: "Agent settings · agent in an app",
      description:
        "앱 자리에서 연 agent의 설정이다. 앱 source의 AGENTS.md가 workspace 지침으로 위에 보이고 그 아래에 이 agent의 본문이 있다.",
      render: () => <AppWorkspaceEditorPage />,
    },
    {
      id: "agent-settings-home-lophn",
      title: "Agent settings · Home lophn",
      description:
        "Home의 lophn이다. 범위 칸이 Home이고 handle과 profile이 잠기며 Delete가 없다. lophn은 따로 agent memory가 없어 Memory 칸도 없다.",
      render: () => <HomeLophnEditorPage />,
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
