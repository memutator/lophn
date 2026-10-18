import type { Area } from "../types.ts";
import {
  AgentGrantsAppPage,
  AgentGrantsPage,
  AgentServerFormPage,
  AppEngineerEditorPage,
  OperatorCreatePage,
  OperatorEditorPage,
  OperatorModelPickerPage,
  ProjectAgentsPage,
} from "./agent-setup/agent-setup-pages.tsx";

export const agentSettingsArea: Area = {
  id: "agent-settings",
  title: "Agent settings",
  summary:
    "프로젝트 Agents 탭, Operator·App Engineer 편집, MCP server 추가, 권한 grants.",
  pages: [
    {
      id: "new-project-agents",
      title: "Agent settings · project Agents tab",
      description:
        "Project Manager 카드(project마다 하나), Operator 카드와 [New Operator], 같이 쓰는 지침(LOPHN.md), project 층 model 하나, 층 표시가 붙은 skill과 MCP가 있다. lophn은 이 탭에 없고 Settings › Agents에서 정한다. sidebar Agents 묶음의 Manage로 연다.",
      render: () => <ProjectAgentsPage />,
    },
    {
      id: "new-operator-editor",
      title: "Agent settings · Operator",
      description:
        "사람이 만든 Operator의 설정이다. 프로필, 이름, 놓인 곳, project 지침과 이 agent 지침을 같이 보이는 블록, model, context, skill, MCP가 있다. Model 칸은 대화와 같은 picker이고(맨 아래 Manage models 줄) 칸 아래에 지금 model이 온 층(이 agent가 골랐다)이 한 줄로 보인다. Built-in instructions 줄과 Permissions 칸은 없고 Definition과 Grants 탭이 있다.",
      render: () => <OperatorEditorPage />,
    },
    {
      id: "new-operator-model-picker",
      title: "Agent settings · Operator model picker",
      description:
        'Operator의 Model 칸 picker를 연 상태다. 맨 위에 "Use project default — …" 줄이 있고 그 아래에 검색칸, provider별 model이 있다. 맨 아래에 Manage models 줄이 있다. 칸 아래 한 줄이 층이다.',
      render: () => <OperatorModelPickerPage />,
    },
    {
      id: "new-operator-create",
      title: "Agent settings · new Operator",
      description:
        "같은 화면에서 새 Operator를 만든다. 놓을 곳(project나 앱)을 고르고, 앱을 고르면 일할 project 폴더를 고른다. Grants 탭은 만든 뒤에 열린다.",
      render: () => <OperatorCreatePage />,
    },
    {
      id: "new-agent-editor-app-engineer",
      title: "Agent settings · App Engineer",
      description:
        "고정 role agent의 설정이다. 이름은 고정이고 놓인 곳은 앱이다. 지침 블록에 앱 source가 속한 등록 project의 LOPHN.md가 나온다.",
      render: () => <AppEngineerEditorPage />,
    },
    {
      id: "new-agent-mcp-server-form",
      title: "Agent settings · add MCP server",
      description:
        "agent 층에서 MCP server를 더하는 form이다. 이름, 연결 방식, 실행이나 주소, 로그인 방식만 받고 key와 token은 더한 뒤 보호 입력으로 받는다.",
      render: () => <AgentServerFormPage />,
    },
    {
      id: "new-agent-grants",
      title: "Agent settings · grants",
      description:
        "agent에게 맡길 것 넷(앱, MCP server의 tool, 부를 수 있는 다른 agent, 설정 고치기)을 붙이고 대상마다 묻는지를 정한다. 위에 효과별 기본값(read와 write는 묻지 않음, external과 설정 고치기는 물음)이 있다.",
      render: () => <AgentGrantsPage />,
    },
    {
      id: "new-agent-grants-app",
      title: "Agent settings · grants, app expanded",
      description:
        "앱 하나를 펼쳐 app-api마다 넣음과 뺌, 묻는지를 보인다. 뺀 것, 사람이 바꾼 것(Changed by you, Reset), 새 release가 더해 기본값으로 들어온 것이 한 표에 있다.",
      render: () => <AgentGrantsAppPage />,
    },
  ],
};
