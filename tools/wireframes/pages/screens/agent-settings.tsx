import type { Area } from "../types.ts";
import {
  AgentCreatePage,
  AgentDeleteConfirmPage,
  AgentDeleteFailedPage,
  AgentEditorCustomPage,
  AgentEditorBrokenPage,
  AgentEditorHarnessPage,
  AgentImageUploadedPage,
  AgentImageUploadFailedPage,
  AgentSaveConflictPage,
  AgentSaveIssuesPage,
  AgentsBrokenPage,
  AgentEditorPage,
  AgentGrantsAppPage,
  AgentGrantsPage,
  AgentInstructionsTabPage,
  AgentMemoryTabPage,
  AgentModelPickerPage,
  AgentRuntimeTabPage,
  AgentToolsTabPage,
  AgentsOpenedEditedPage,
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
        "사람이 만든 agent의 설정이고 General 탭이 열려 있다. 탭은 General · Runtime · Instructions · Skills · Memory · Tools · Grants이고, 머리의 [Cancel]·[Save]는 어느 탭에서나 보인다(스크롤해도 머리가 남는다). General에는 프로필, 이름, handle, 범위, 설명, 받는 것(Takes)과 내는 것(Gives) 토글(text·image·file 아이콘 단추가 줄 오른쪽 고정 열에 있다), 명함(runtime, model과 가격, 받고 내는 것, 답 방식), 새 session을 Skip permissions로 시작하는 기본값 체크(사람만 쓰는 칸이고 꺼져 있다), Delete가 있다. 저장하지 못한 항목이 숨은 탭에 있으면 그 탭 이름 옆에 점이 뜬다.",
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
      id: "agent-settings-runtime-tab",
      title: "Agent settings · Runtime tab",
      description:
        "Runtime 탭이다. runtime(lophn, custom, 켜 둔 harness)을 고르고 그 아래에 Model 칸이 있다. Model은 위 층이 정한 값을 따르는 줄이 맨 위다. harness runtime이면 model 칸이 없다.",
      render: () => <AgentRuntimeTabPage />,
    },
    {
      id: "agent-settings-instructions-tab",
      title: "Agent settings · Instructions tab",
      description:
        "Instructions 탭이다. workspace 지침(LOPHN.md나 AGENTS.md, 그 자리에서 [Edit])과 이 agent의 지침을 같이 보인다.",
      render: () => <AgentInstructionsTabPage />,
    },
    {
      id: "agent-settings-memory-tab",
      title: "Agent settings · Memory tab",
      description:
        "Memory 탭이다. 이 agent의 memory가 8 KiB 대비 크기와 함께 보이고 [Edit]으로 그 자리에서 고친다. lophn과 harness agent에는 이 탭이 없다.",
      render: () => <AgentMemoryTabPage />,
    },
    {
      id: "agent-settings-tools-tab",
      title: "Agent settings · Tools tab",
      description:
        "custom agent의 Tools 탭이다. 고르는 tool(체크와 이름 입력), MCP servers, Shell extensions가 위에서 아래로 있다. custom이 아니면 첫 칸이 없다. harness agent에는 이 탭이 없다.",
      render: () => <AgentToolsTabPage />,
    },
    {
      id: "agents-tab-opened-edited",
      title: "Agent settings · agent opened in the Agents tab",
      description:
        "Agents 탭에서 [Open]을 누르면 같은 탭이 그 agent의 editor로 바뀌고(탭 이름과 아이콘도 그 agent가 된다) 왼쪽 위 ← →로 목록과 연 agent 사이를 오간다. 이름을 고쳐 저장하지 않은 편집이 있으면 탭 줄에 문서 탭과 같은 표시가 뜨고 Ctrl+S로 저장한다.",
      render: () => <AgentsOpenedEditedPage />,
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
        "agent 층에서 Tools 탭에서 MCP server를 더하는 form에 web 주소와 OAuth 2.1 로그인을 고른 상태다. 이름, 연결 방식, 실행이나 주소, 로그인 방식(None, Bearer, API key, OAuth 2.1)과 OAuth issuer·client ID·scopes를 받고 key·token·client secret은 더한 뒤 보호 입력으로 받는다. OAuth 2.1 server는 정의를 저장한 뒤 그 줄의 [Sign in]으로 로그인한다.",
      render: () => <AgentServerFormPage />,
    },
    {
      id: "agent-settings-custom",
      title: "Agent settings · custom runtime",
      description:
        "runtime이 custom인 agent의 Skills 탭이다. skill은 켠 것만 받는다(plain-writing을 하나 더 골랐다). Tools 탭에서 내장 tool을 체크로 고른다. lophn 지침과 built-in은 받지 않는다.",
      render: () => <AgentEditorCustomPage />,
    },
    {
      id: "agent-settings-harness",
      title: "Agent settings · harness runtime",
      description:
        "runtime이 harness(Codex)인 agent의 Runtime 탭이다. Skills와 Tools 탭이 없고 model 칸도 없다. harness가 자기 도구를 쓴다. General에는 지침과 입력·출력 칸이 있다.",
      render: () => <AgentEditorHarnessPage />,
    },
    {
      id: "agent-settings-delete-confirm",
      title: "Agent settings · delete confirmation",
      description:
        "Delete agent를 누르면 뜨는 확인 창이다. 이름이 제목에 있고 Cancel과 Delete(danger)가 있다. 저장에는 확인이 없다.",
      render: () => <AgentDeleteConfirmPage />,
    },
    {
      id: "agent-settings-delete-failed",
      title: "Agent settings · delete failed",
      description:
        "Delete를 확인했는데 그 사이 다른 곳이 정의를 바꿔(hash가 달라) 지워지지 않았다. 설정 탭 위쪽에 toast가 뜨고 화면은 그대로 남는다.",
      render: () => <AgentDeleteFailedPage />,
    },
    {
      id: "agent-settings-save-issues",
      title: "Agent settings · save issues",
      description:
        "저장이 거절되어 틀린 항목마다 이유(unknown, reserved name)가 그 칸 안에 붙었다. 저장하지 않은 편집은 그대로다.",
      render: () => <AgentSaveIssuesPage />,
    },
    {
      id: "agent-settings-save-conflict",
      title: "Agent settings · save conflict",
      description:
        "낡은 화면으로 저장해 hash 충돌로 거절됐다. 항목별 이유 없이 toast만 뜬다.",
      render: () => <AgentSaveConflictPage />,
    },
    {
      id: "agent-settings-image-uploaded",
      title: "Agent settings · profile image uploaded",
      description:
        "Profile의 Upload image로 이미지를 올려 character 대신 그 이미지가 profile로 보이는 상태다(저장 전). [Remove image]로 character로 돌아간다.",
      render: () => <AgentImageUploadedPage />,
    },
    {
      id: "agent-settings-image-upload-failed",
      title: "Agent settings · image upload failed",
      description:
        "이미지가 틀려(형식, 크기) 올리기가 거절됐다. toast가 뜨고 profile은 그대로다.",
      render: () => <AgentImageUploadFailedPage />,
    },
    {
      id: "agents-tab-broken",
      title: "Agent settings · broken definition in the list",
      description:
        "정의 file이 틀린 agent(Broken notes)의 줄이다. skill·MCP 개수를 셀 수 없다고 보이고 명함이 없어 범위만 보인다. 이 줄에서 [Open]으로 연다.",
      render: () => <AgentsBrokenPage />,
    },
    {
      id: "agent-settings-broken",
      title: "Agent settings · broken definition",
      description:
        "틀린 정의 file의 agent를 연 설정이다. 틀린 칸의 이유가 form 밑에 붙고 사람이 고쳐 저장한다.",
      render: () => <AgentEditorBrokenPage />,
    },
    {
      id: "new-agent-grants",
      title: "Agent settings · grants",
      description:
        "agent에게 맡길 것은 앱 하나다. 효과별 기본값 표는 없다. 아래에 MCP server는 설정한 곳(Global, project, 이 agent의 Tools 탭)이 할당이라는 한 줄만 있다.",
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
