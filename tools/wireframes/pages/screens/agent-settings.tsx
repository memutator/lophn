import type { Area } from "../types.ts";
import { BrowserProfilesProvider } from "../../../../packages/shell/renderer/browser/profiles.tsx";
import {
  EVAL_ANALYST_ID,
  PROFILE_SHOP,
  SAMPLE_BROWSER_PROFILES,
} from "../../../../packages/shell/renderer/workspace/agents/fake-data.ts";
import { t } from "@lophn/i18n";
import { press, type Step } from "../../mock/drive.ts";
import { AgentSettingsEditor, agentTab } from "./agents-tab.tsx";
import { ProjectApp } from "./project-app.tsx";
import {
  AgentCreatePage,
  AgentCustomOverviewPage,
  AgentHarnessWorksPage,
  AgentSeesTabPage,
  AgentsCardMenuPage,
  AgentsDuplicatedPage,
  AgentWhoTabPage,
  HomeAgentsCodingPage,
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
  AgentGrantsAppPage,
  AgentGrantsOtherComputerPage,
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

// Eval analyst의 설정. 목록은 Settings에서 만든 profile들이다(Overview·카드·Sees가 그 이름과 색 점을 보인다).
function BrowserProfileEditor(props: {
  profiles: typeof SAMPLE_BROWSER_PROFILES;
  steps?: readonly Step[];
}) {
  const tab = agentTab(EVAL_ANALYST_ID);
  return (
    <BrowserProfilesProvider profiles={props.profiles}>
      <ProjectApp
        sidebar={{ foldersClosed: true }}
        panes={[
          {
            tabs: [
              {
                ...tab,
                body: (
                  <AgentSettingsEditor
                    id={EVAL_ANALYST_ID}
                    onDone={() => {}}
                    steps={props.steps ?? []}
                  />
                ),
              },
            ],
            selected: tab.key,
          },
        ]}
      />
    </BrowserProfilesProvider>
  );
}

const SEES = () => press("[role=tab]", t("agents.label.tab-sees"));

export const agentSettingsArea: Area = {
  id: "agent-settings",
  title: "Agent settings",
  summary:
    "workspace(project, Home, 앱)의 Agents 탭과 agent 편집. agent 정의는 네 묶음(Who · Runs on · Sees · Works how)으로 보인다: 카드 앞면이 한눈에, editor의 Overview가 한 장에, 묶음마다 탭 하나가 고친다.",
  pages: [
    {
      id: "new-project-agents",
      title: "Agent settings · project Agents tab",
      description:
        "project의 Agents 탭. 카드 머리는 누구(avatar, 이름, 역할 한 줄, lophn은 Built-in chip, 오른쪽 끝 ⋯ menu)이고 그 아래 세 줄이 Runs on(runtime, model · effort), Sees(범위, 기본이 아닌 browser profile, 할당 앱 수, MCP 수, custom이 고른 tool 수), Works how(지침 유무, skill 수, memory)다. 아래로 같이 쓰는 지침(LOPHN.md), workspace memory, project 층 model, skill과 MCP가 이어진다.",
      render: () => <ProjectAgentsPage />,
    },
    {
      id: "agents-tab-home",
      title: "Agent settings · Home Agents tab",
      description:
        "Home의 Agents 탭은 모든 agent 카드를 보인다: Home lophn(Workspace memory), lophn runtime의 Eval analyst(Sonnet 5.5 · High, Work profile의 색 점, 앱 2개), custom의 Queue watcher(tool 2개 골라 둠, agent.memory를 안 골라 Memory off), harness의 Codex runner(OpenAI 아이콘, its own model, its own tools and MCP, its own skills and memory), project 범위의 Experiment planner(다른 컴퓨터의 앱 2개), 앱 범위의 Budget reviewer. 즐겨찾기 coding agent(Claude Code)는 아래 Your coding agents 묶음에 같은 모양으로 선다.",
      render: () => <HomeAgentsPage />,
    },
    {
      id: "agents-tab-home-coding",
      title: "Agent settings · Home Agents tab, coding agents",
      description:
        "Home의 Agents 탭을 Your coding agents 묶음까지 내렸다. 내장 coding agent(Claude Code)도 lophn agent와 같은 카드 모양이다: Runs on에 Claude Code 아이콘과 its own model, Sees에 its own tools and MCP, Works how에 its own skills and memory.",
      render: () => <HomeAgentsCodingPage />,
    },
    {
      id: "agents-tab-card-menu",
      title: "Agent settings · card menu",
      description:
        "카드 머리 오른쪽 끝 ⋯을 누르면 menu에 Duplicate가 있다. 정의 file이 틀린 agent의 카드에는 이 menu가 없다.",
      render: () => <AgentsCardMenuPage />,
    },
    {
      id: "agents-tab-duplicated",
      title: "Agent settings · duplicated agent",
      description:
        'Eval analyst 카드의 Duplicate를 누른 결과. 같은 탭에 새 agent editor가 Overview로 열리고 이름은 "Eval analyst copy", handle은 겹치지 않는 eval-analyst-copy다. 나머지 값(model, browser profile, MCP, 지침, 할당 앱)은 같고 Create agent를 눌러야 만들어진다. 올린 이미지 avatar는 옮기지 못해 기본 character로 시작한다(Who 탭에 그 안내가 있다). 저장된 agent의 editor 머리에도 같은 Duplicate 단추가 있다.',
      render: () => <AgentsDuplicatedPage />,
    },
    {
      id: "agents-tab-home-open-scoped",
      title: "Agent settings · Home Agents tab, scoped agent open",
      description:
        "Home 목록에서 project 범위 agent(Experiment planner)를 열었다. 같은 editor가 그 agent 자신의 workspace(phroner)로 열려 Overview의 범위가 phroner · project이고 지침·skill·MCP 층도 phroner의 것이다. 다른 컴퓨터의 앱(Weekly report, Sketch sync)이 Other computers 줄에 선다.",
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
      title: "Agent settings · agent overview",
      description:
        "lophn runtime agent(Eval analyst)의 editor 첫 화면 Overview. 탭은 Overview · Who · Runs on · Sees · Works how이고 머리의 [Duplicate]·[Cancel]·[Save]는 어느 탭에서나 보인다. Overview는 네 절이 위아래로 있고 절마다 오른쪽 끝 [Edit]이 그 탭을 연다: Who(avatar, 이름, handle, 역할 한 줄), Runs on(runtime, model · effort와 가격, 받고 내는 것), Sees(범위, Work profile, 할당 앱, MCP servers, Skip permissions), Works how(지침 첫 줄, 켠 skill, memory 첫 줄).",
      render: () => <BrowserProfileEditor profiles={SAMPLE_BROWSER_PROFILES} />,
    },
    {
      id: "agent-settings-who",
      title: "Agent settings · Who",
      description:
        "Who 탭: profile(character 고르기나 이미지 올리기), 이름, handle(만든 뒤 잠긴다), 역할 한 줄(Role, description 칸), 명함(다른 agent가 읽는 것), Delete.",
      render: () => <AgentWhoTabPage />,
    },
    {
      id: "agent-settings-sees",
      title: "Agent settings · Sees",
      description:
        "Sees 탭 위쪽: 범위(Workspace, 만든 뒤 읽기 전용), Browser profile(Default와 Settings에서 만든 profile, 이 agent는 Work), MCP servers(층 chip과 켬·끔, agent 층 server 더하기). 아래로 Skip permissions와 앱 할당(바로 저장되는 칸이라 선으로 가른다)이 이어진다.",
      render: () => (
        <BrowserProfileEditor
          profiles={SAMPLE_BROWSER_PROFILES}
          steps={[SEES]}
        />
      ),
    },
    {
      id: "agent-settings-browser-profile-deleted",
      title: "Agent settings · deleted browser profile",
      description:
        '정의가 가리키던 profile(Work)을 Settings에서 지운 뒤의 Sees 탭이다. Browser profile 칸은 Default로 보이고 그 아래에 "Deleted profile — uses Default"가 붙는다. 정의 file은 사람이 다른 profile을 고르거나 Default를 고를 때까지 그대로다.',
      render: () => (
        <BrowserProfileEditor
          profiles={SAMPLE_BROWSER_PROFILES.filter(
            (one) => one.id === PROFILE_SHOP,
          )}
          steps={[SEES]}
        />
      ),
    },
    {
      id: "agent-settings-model-picker",
      title: "Agent settings · agent model picker",
      description:
        'Runs on 탭의 Model 칸 picker를 연 상태다. 맨 위에 "Use workspace default — …" 줄이 있고 그 아래에 검색칸, provider별 model이 있다. provider 묶음은 대화의 picker와 같이 접고 펼 수 있다(묶음이 하나뿐이라 늘 펼쳐 있다). 맨 아래에 Manage models 줄이 있다. 칸 아래 한 줄이 층이다.',
      render: () => <AgentModelPickerPage />,
    },
    {
      id: "agent-settings-runtime-tab",
      title: "Agent settings · Runs on",
      description:
        "Runs on 탭이다. runtime(lophn, custom, 켜 둔 harness)을 고르고 그 아래에 Model 칸과 받고 내는 것(Takes·Gives 토글)이 있다. Model은 위 층이 정한 값을 따르는 줄이 맨 위다. harness runtime이면 Model 칸 대신 그 harness가 자기 model과 effort로 돈다는 한 줄이다.",
      render: () => <AgentRuntimeTabPage />,
    },
    {
      id: "agent-settings-instructions-tab",
      title: "Agent settings · Works how",
      description:
        "Works how 탭이다. workspace 지침(LOPHN.md나 AGENTS.md, 그 자리에서 [Edit])과 이 agent의 지침이 위에 있고 아래로 Skills와 Memory가 이어진다.",
      render: () => <AgentInstructionsTabPage />,
    },
    {
      id: "agent-settings-memory-tab",
      title: "Agent settings · Works how, memory",
      description:
        "Works how 탭의 Memory 칸. 이 agent의 memory가 8 KiB 대비 크기와 함께 보이고 [Edit]으로 그 자리에서 고친다. lophn은 workspace memory를 쓴다는 한 줄이고 harness는 자기 memory를 쓴다는 한 줄이다.",
      render: () => <AgentMemoryTabPage />,
    },
    {
      id: "agent-settings-tools-tab",
      title: "Agent settings · Sees, tools",
      description:
        "custom agent의 Sees 탭을 Tools 칸까지 내린 상태. 고르는 tool(체크와 이름 입력)이 MCP servers 아래에 있다. lophn runtime에는 이 칸이 없고 harness에는 자기 tool을 쓴다는 한 줄이 선다.",
      render: () => <AgentToolsTabPage />,
    },
    {
      id: "agents-tab-opened-edited",
      title: "Agent settings · agent opened in the Agents tab",
      description:
        "Agents 탭에서 [Open]을 누르면 같은 탭이 그 agent의 editor로 바뀌고(탭 이름과 아이콘도 그 agent가 된다) 왼쪽 위 ← →로 목록과 연 agent 사이를 오간다. Who 탭에서 이름을 고쳐 저장하지 않은 편집이 있으면 탭 줄에 문서 탭과 같은 표시가 뜨고 Ctrl+S로 저장한다.",
      render: () => <AgentsOpenedEditedPage />,
    },
    {
      id: "agent-settings-create",
      title: "Agent settings · new agent",
      description:
        "같은 화면에서 새 agent를 만든다. Overview는 빈 값이고(No role line yet, 앱은 만든 뒤) 머리 단추가 Create agent다. 앱 할당은 만든 뒤에 Sees에서 한다.",
      render: () => <AgentCreatePage />,
    },
    {
      id: "new-agent-editor-lophn",
      title: "Agent settings · lophn",
      description:
        "project의 lophn Overview다(workspace마다 하나). Who에 handle과 역할 줄이 없고 Memory가 workspace memory다. Who 탭에서 handle과 profile이 잠기고 이름은 바꿀 수 있으며 Delete가 없다.",
      render: () => <LophnEditorPage />,
    },
    {
      id: "agent-settings-app-workspace",
      title: "Agent settings · agent in an app",
      description:
        "앱 자리에서 연 agent의 Works how다. 앱 source의 AGENTS.md가 workspace 지침으로 위에 보이고 그 아래에 이 agent의 본문이 있다.",
      render: () => <AppWorkspaceEditorPage />,
    },
    {
      id: "agent-settings-home-lophn",
      title: "Agent settings · Home lophn",
      description:
        "Home의 lophn Overview다. 범위가 Home이고 Memory는 Home의 workspace memory다(global memory). Who 탭에서 handle과 profile이 잠기고 Delete가 없다.",
      render: () => <HomeLophnEditorPage />,
    },
    {
      id: "new-agent-mcp-server-form",
      title: "Agent settings · add MCP server",
      description:
        "Sees 탭의 MCP servers에서 agent 층 server를 더하는 form에 web 주소와 OAuth 2.1 로그인을 고른 상태다. 이름, 연결 방식, 실행이나 주소, 로그인 방식(None, Bearer, API key, OAuth 2.1)과 OAuth issuer·client ID·scopes를 받고 key·token·client secret은 더한 뒤 보호 입력으로 받는다. OAuth 2.1 server는 정의를 저장한 뒤 그 줄의 [Sign in]으로 로그인한다.",
      render: () => <AgentServerFormPage />,
    },
    {
      id: "agent-settings-custom-overview",
      title: "Agent settings · custom runtime overview",
      description:
        "runtime이 custom인 agent(Queue watcher)의 Overview. Tools 줄이 고른 tool(file.read, file.grep)이고 Memory는 agent.memory tool을 고르지 않아 Off다.",
      render: () => <AgentCustomOverviewPage />,
    },
    {
      id: "agent-settings-custom",
      title: "Agent settings · custom runtime",
      description:
        "custom agent의 Works how 탭이다. workspace 지침 자리에 custom은 전역·workspace 지침을 읽지 않는다는 한 줄이 서고, skill은 켠 것만 받는다(plain-writing을 하나 더 골랐다). Memory 아래에 custom은 이 agent의 memory만 읽고 agent.memory를 골라야 쓴다는 한 줄이 있다.",
      render: () => <AgentEditorCustomPage />,
    },
    {
      id: "agent-settings-harness",
      title: "Agent settings · harness runtime",
      description:
        "runtime이 harness(Codex)인 agent의 Overview. Runtime 줄에 OpenAI 아이콘이 붙고 Model, MCP servers, Tools, Skills, Memory 줄이 Uses its own이다. 칸을 숨기지 않아 왜 효과가 없는지 보인다.",
      render: () => <AgentEditorHarnessPage />,
    },
    {
      id: "agent-settings-harness-works",
      title: "Agent settings · harness runtime, Works how",
      description:
        "harness agent의 Works how. 지침은 고치고, Skills와 Memory 자리에는 Codex가 자기 skill과 memory를 써서 여기 설정이 효과가 없다는 한 줄이 선다.",
      render: () => <AgentHarnessWorksPage />,
    },
    {
      id: "agent-settings-delete-confirm",
      title: "Agent settings · delete confirmation",
      description:
        "Who 탭의 Delete agent를 누르면 뜨는 확인 창이다. 이름이 제목에 있고 Cancel과 Delete(danger)가 있다. 저장에는 확인이 없다.",
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
        "저장이 거절되어 틀린 항목마다 이유(unknown, reserved name)가 그 칸 안에 붙었다. 지금 Sees 탭이고 거절된 skill이 있는 Works how 탭 이름 옆에 점이 뜬다. 저장하지 않은 편집은 그대로다.",
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
        "Who 탭 Profile의 Upload image로 이미지를 올려 character 대신 그 이미지가 profile로 보이는 상태다(저장 전). [Remove image]로 character로 돌아간다.",
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
        "정의 file이 틀린 agent(Broken notes)의 카드다. Works how 줄이 개수를 셀 수 없다고 보이고 ⋯ menu(복제)가 없다. 이 카드에서 [Open]으로 연다.",
      render: () => <AgentsBrokenPage />,
    },
    {
      id: "agent-settings-broken",
      title: "Agent settings · broken definition",
      description:
        "틀린 정의 file의 agent를 연 Overview. 어느 칸에도 속하지 않는 이유(frontmatter)가 머리 아래에 붙고 사람이 고쳐 저장한다.",
      render: () => <AgentEditorBrokenPage />,
    },
    {
      id: "new-agent-grants",
      title: "Agent settings · grants",
      description:
        "Sees 탭 맨 아래의 앱 할당. agent에게 맡길 것은 앱 하나다. 효과별 기본값 표는 없다. MCP server는 설정한 곳이 할당이라는 한 줄과 바로 저장된다는 한 줄이 있다.",
      render: () => <AgentGrantsPage />,
    },
    {
      id: "new-agent-grants-app",
      title: "Agent settings · grants, app expanded",
      description:
        "앱 할당에서 앱 하나를 펼쳐 tool마다 이름, 효과, 넣음과 뺌(Allowed)만 고른다. 뺀 tool(delete_expense)은 꺼져 있다.",
      render: () => <AgentGrantsAppPage />,
    },
    {
      id: "new-agent-grants-other-machine",
      title: "Agent settings · grants, other computers",
      description:
        "앱 할당 아래에 Other computers 묶음이 있고 컴퓨터마다 그 컴퓨터의 앱 줄이 선다. 연결된 Home server의 앱은 그 컴퓨터에 읽어 온 command를 펼쳐 하나씩 넣고 뺀다(그 앱이 다른 컴퓨터에 내놓은 public command만 보이고 비공개는 목록에 없다). 꺼진 Work laptop의 앱(Sketch sync)은 저장된 이름과 Offline 표시로 남고 command는 못 읽지만 [Remove]는 된다. [Assign app]은 연결된 컴퓨터의 아직 안 붙인 앱을 컴퓨터별로 보인다.",
      render: () => <AgentGrantsOtherComputerPage />,
    },
  ],
};
