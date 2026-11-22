// Agents 탭과 agent editor가 읽고 쓰는 통로. 정의 파일의 칸과 칸별 값·출처는 protocol/lophn-agent의
// agents를, 할당은 approvals/assignment를 그대로 따르고, 화면이 contract만으로 만들 수 없는 것
// (켬·끔 줄, 놓을 곳 후보, 붙일 앱 목록)만 여기서 더한다. 화면은 이 통로를 지나는 값으로만 그리고 core를 직접 부르지 않는다.

import type { AssignmentEntry } from "../../../../protocol/approvals/assignment.ts";
import type {
  AgentCard,
  AgentDefinitionIssue,
  AgentValueLayer,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  AgentAvatar,
  AgentCounts,
  AgentRuntime,
  AgentWorkspace,
  McpOff,
  Modality,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type { McpServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type {
  CatalogEntry,
  ModelChoice,
  UserModelItem,
  UserModelRecord,
} from "../../../../protocol/lophn-agent/models.ts";
import type { ToolEffect } from "../../../../protocol/lophn-agent/tool-values.ts";
import type { ReadResult } from "../source.ts";
import type {
  InstructionsFile,
  McpLogin,
  McpRow,
  MemoryTarget,
  SkillRow,
  Sourced,
  WorkspaceInstructionsView,
} from "./views.ts";

export type { ReadResult };

/** core의 명함에 browser profile을 붙인 것. 그 줄은 사람만 보고 core의 명함(다른 agent도 읽는다)에는 없다. null은 기본 profile이다. */
export type AgentCardView = AgentCard & {
  readonly browserProfile: string | null;
};

/**
 * 목록의 줄. `assignment`는 agent id(그 workspace의 lophn이거나 `agt_…`)다. lophn이 첫 줄이다.
 */
export interface AgentListRow {
  readonly assignment: string;
  /** agent의 주소다. 만들 때 정하고 바뀌지 않는다. */
  readonly handle: string;
  /** 범위 workspace. null이면 전역이다. */
  readonly workspace: AgentWorkspace | null;
  /** 범위 workspace의 이름. Home의 목록(모든 agent)에서 범위 agent의 줄에만 있다. */
  readonly workspaceName?: string;
  /** 보이는 이름이다. 겹쳐도 되고 바꿀 수 있다. */
  readonly name: string;
  readonly avatar: AgentAvatar;
  readonly description?: string;
  readonly model: {
    readonly provider: string;
    readonly model_name: string;
    readonly source: AgentValueLayer;
  } | null;
  readonly issues: readonly AgentDefinitionIssue[];
  readonly counts: AgentCounts;
  /** 정의에 적힌 browser profile id. 지운 profile이어도 그대로 온다. null은 기본 profile이다. */
  readonly browserProfile: string | null;
  /** core가 계산한 명함. 틀린 정의 file이면 없다. */
  readonly card?: AgentCardView;
  /** 카드 앞면이 네 묶음을 한눈에 보이는 데 쓰는 정의의 요약. 틀린 정의 file이면 없다. */
  readonly glance?: AgentGlance;
}

/**
 * 카드 앞면의 요약. 목록 행과 명함에 없는 것(effort, 지침 유무, 할당 앱 수, 고른 tool, skip)을 정의에서 센다.
 * 화면이 다시 계산하는 것은 이 셈뿐이고 model 층·skill·MCP 수는 core가 준 값을 쓴다.
 */
export interface AgentGlance {
  /** 정의 → workspace → 전역 순으로 정해진 model(option 값 포함). 어느 층에도 없으면 null이다. */
  readonly model: ModelChoice | null;
  /** 정의 본문(이 agent의 지침)이 비어 있지 않은가. */
  readonly instructions: boolean;
  /** 이 컴퓨터의 할당 앱 수. */
  readonly apps: number;
  /** 다른 컴퓨터의 할당 앱 수. */
  readonly remoteApps: number;
  /** custom이 고른 tool 이름. */
  readonly tools: readonly string[];
  readonly skip: boolean;
}

/** Agents 탭 본문 한 번에 필요한 값. */
export interface AgentsOverview {
  /** 전역 agent와 이 workspace 범위 agent(lophn이 첫 줄). Home은 모든 workspace의 범위 agent도 싣는다. */
  readonly agents: readonly AgentListRow[];
  /** 같이 쓰는 지침. 파일이 없거나 읽을 수 없으면 빈 글이다. source를 잇지 않은 앱은 고치지 못하는 빈 글이다. */
  readonly instructions: WorkspaceInstructionsView;
  /** 이 workspace가 고른 model 하나(null이면 전역 기본을 따른다)와 따를 전역 기본. */
  readonly workspaceModel: {
    readonly chosen: ModelChoice | null;
    readonly inherited: ModelChoice | null;
  };
  /** 이 workspace에서 발견되는 skill. 꺼진 것도 줄로 남는다. */
  readonly skills: readonly SkillRow[];
  /** 이 workspace가 쓰는 MCP server(전역과 workspace 층). */
  readonly mcpServers: readonly McpRow[];
  /** workspace memory. 파일이 없거나 읽을 수 없으면 빈 글이다. */
  readonly memory: InstructionsFile;
}

/**
 * 정의 파일 한 개의 값. 모든 agent가 같은 칸을 갖는다. `skills_off`는 이 agent가 끈 skill 이름이고 없으면 보이는 skill을 모두 받는다.
 * lophn의 `handle`·`avatar`는 바꾸지 못하고(name은 바꾼다), `handle`과 `workspace`는 만들 때만 정한다.
 * `mcp_servers`·`skip`은 사람만 쓴다. 파일에는 사람이 바꾼 칸만 있어 없는 칸은 상속이다.
 */
export interface AgentDraft {
  /** 새 agent가 만들 때 정하는 주소. 비우면 name에서 만든다(영문 소문자·숫자가 없으면 만들지 못한다). 저장된 agent는 읽기만 한다. */
  readonly handle?: string;
  readonly name?: string;
  /** 범위 workspace. 없으면 전역이다. 저장된 값을 그대로 돌려보낸다. */
  readonly workspace?: AgentWorkspace;
  readonly avatar?: AgentAvatar;
  /** 없으면 lophn이다. custom은 본문과 `tools`, `skills`가 고른 것만 싣는다. */
  readonly runtime?: AgentRuntime;
  /** 한 줄 목적. */
  readonly description?: string;
  /** 받고 내는 내용 종류. 없는 칸은 셋 다다. */
  readonly modality?: {
    readonly input?: readonly Modality[];
    readonly output?: readonly Modality[];
  };
  /** custom이 고른 tool 이름. runtime이 custom일 때만 둔다. */
  readonly tools?: readonly string[];
  /** custom이 고른 skill 이름. runtime이 custom일 때만 둔다. */
  readonly skills?: readonly string[];
  readonly model?: ModelChoice;
  readonly skills_off?: readonly string[];
  readonly mcp_off?: readonly McpOff[];
  readonly mcp_servers?: readonly McpServer[];
  /** 새 session을 skip으로 시작한다. 사람만 쓴다. */
  readonly skip?: boolean;
  /** 이 agent가 여는 browser 탭의 profile(core의 browser profile 목록의 id). 없으면 기본이다. 사람만 쓴다. */
  readonly browser_profile?: string;
  readonly body: string;
}

/** 화면을 연 자리. `kind: "none"`은 Settings다. Home은 id가 없다. */
export interface WorkspaceView {
  readonly kind: "home" | "project" | "app" | "none";
  readonly id: string | null;
  readonly name: string;
}

/** editor 하나가 여는 agent의 값. 새 agent는 assignment와 hash가 null이다. */
export interface AgentDetail {
  /** 저장된 agent의 `AgentId`. 새 agent는 null이다. */
  readonly assignment: string | null;
  /**
   * 새 agent가 저장 전에 미리 가진 id(`agt_…`). credential 이름 `mcp.<agt id>.<server>`에 id가 먼저 필요해서다.
   * 저장된 agent는 null이다.
   */
  readonly draftId: string | null;
  /** 화면을 연 자리. Settings는 `none`이다. */
  readonly workspace: WorkspaceView;
  /** 정의 파일의 내용. 파일이 없거나 틀렸으면 본문만 빈 정의다. */
  readonly definition: AgentDraft;
  /** 읽은 파일의 hash. 저장·삭제가 비교한다. 파일이 없으면 null이다. */
  readonly hash: string | null;
  /** 정의에 칸이 없을 때 보일 상속 값. */
  readonly effective: {
    readonly name: Sourced<string>;
    readonly avatar: Sourced<AgentAvatar>;
  };
  /** 이 agent가 model을 고르지 않으면 따르는 값. 어느 층에도 model이 없으면 null이다. */
  readonly inheritedModel: Sourced<ModelChoice> | null;
  /** 파일이 틀렸다면 읽기가 알린 항목별 이유다. */
  readonly issues: readonly AgentDefinitionIssue[];
  /** 저장된 정의로 계산한 명함. 새 agent와 틀린 file은 없다. */
  readonly card?: AgentCardView;
  /** 이 agent가 놓인 곳에서 보이는 skill(내장, 전역, workspace). 이 agent가 끈 것은 정의의 skills_off가 말한다. */
  readonly skills: readonly SkillRow[];
  /** 전역과 workspace 층 MCP server. 이 agent 층은 정의의 mcp_servers다. */
  readonly mcpServers: readonly McpRow[];
  /**
   * 저장된 정의가 가진 OAuth server의 로그인 상태(이름별). core가 읽는 정의 파일의 서버만 있어 저장하지 않은
   * 편집의 새 server에는 로그인이 없다.
   */
  readonly agentMcpLogins: Readonly<Record<string, McpLogin>>;
  /** workspace 지침. 놓인 곳이 없으면(Settings) null이다. */
  readonly instructions: WorkspaceInstructionsView | null;
  /**
   * 이 agent의 memory. lophn은 따로 agent memory가 없어(workspace memory를 쓴다) null이고, 저장 전의 새 agent도 null이다.
   */
  readonly memory: InstructionsFile | null;
}

/** provider가 이 model에 적용하는 한도(core의 providerModelLimits). context는 Codex처럼 provider가 정한 운영 window다. */
export interface EffectiveModelLimits {
  readonly context_limit: number;
  readonly input_limit: number;
  readonly output_limit: number;
}

/** 연결된 provider. definition은 catalog 항목과 맞추는 key다. */
export interface ProviderChoice {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  /** credential 종류(`oauth`, `api_key` …). */
  readonly kind: string;
  /** provider가 알려 준 model 이름. null이면 아직 모르는 것이다. */
  readonly reportedModels: readonly string[] | null;
  /** model 목록을 다시 읽을 수 있는가: custom provider와 목록을 알려 주는 내장 provider다. */
  readonly refreshable: boolean;
  /** core의 내장 정의 목록에 없는 provider(custom)인가. custom만 정보 전체를 적고 model을 더한다. */
  readonly custom: boolean;
  /** model 이름 → 이 model이 실제로 쓰는 한도. 사람이 적은 값, provider가 알려 준 값, catalog 순서로 정해진다. */
  readonly limits: Readonly<Record<string, EffectiveModelLimits>>;
}

export interface ShownModel {
  readonly provider: string;
  readonly model_name: string;
}

/** 사람이 적은 model 정보 전체와 그 판. 저장·지우기의 compare 기준이다. */
export interface UserModels {
  readonly seq: string;
  readonly items: readonly UserModelRecord[];
}

/** 사람이 적은 model 정보의 열쇠: catalog와 같은 (provider 정의 key, model 이름)이다. */
export interface UserModelKey {
  readonly provider_definition: string;
  readonly model_name: string;
}

/** model picker와 Manage models 창을 그릴 자료. */
export interface ModelsView {
  readonly providers: readonly ProviderChoice[];
  readonly catalog: readonly CatalogEntry[];
  /** 사람이 켠 model. 여기 없는 model은 꺼져 있다. */
  readonly shown: readonly ShownModel[];
}

export interface SaveInput {
  /** 새 agent는 null이다. */
  readonly assignment: string | null;
  /** 새 agent가 만들 때 쓸 id(`AgentDetail.draftId`). 저장된 agent는 null이다. */
  readonly draftId: string | null;
  readonly definition: AgentDraft;
  /** 읽을 때의 파일 hash. 새 agent는 null이다. */
  readonly hash: string | null;
}

export type SaveResult =
  | {
      readonly ok: true;
      readonly value: { readonly assignment: string; readonly hash: string };
    }
  /** 거절이면 항목별 이유가 issues에 있다. 그 밖의 실패는 issues가 비어 있고 message가 core의 오류 code다. */
  | {
      readonly ok: false;
      readonly message: string;
      readonly issues: readonly AgentDefinitionIssue[];
    };

/** 붙일 앱의 tool 하나. */
interface GrantTool {
  readonly tool: string;
  readonly detail: string;
  readonly effect: ToolEffect;
  /** 다른 앱의 agent에 보이는 tool인가. */
  readonly public: boolean;
}

export interface GrantApp {
  readonly app: string;
  readonly name: string;
  readonly tools: readonly GrantTool[];
}

/** 붙일 수 있는 대상 전체. 붙은 것은 entries가 말한다. */
export interface GrantCatalog {
  readonly apps: readonly GrantApp[];
}

export interface GrantsView {
  readonly entries: readonly AssignmentEntry[];
  readonly catalog: GrantCatalog;
  /** 읽은 때의 저장 판. 저장할 때 compare로 보내고, 그 사이 다른 창이 고쳤으면 core가 conflict로 거절한다. */
  readonly revision: number;
}

export interface AgentsSource {
  /**
   * 전역 agent와 화면을 연 자리 범위 agent의 목록(lophn이 첫 줄). 자리는 "home"이거나 project·앱 id다. sidebar의 Agents 묶음이
   * 이것만 읽는다.
   */
  list(workspace: string): Promise<ReadResult<readonly AgentListRow[]>>;
  overview(workspace: string): Promise<ReadResult<AgentsOverview>>;
  /** 모든 workspace의 lophn 이름(agent id → 보이는 이름). 사람이 workspace마다 바꾼 이름을 다른 workspace 줄에서도 보이려고 읽는다. */
  lophnNames(): Promise<ReadResult<Readonly<Record<string, string>>>>;
  models(): Promise<ReadResult<ModelsView>>;
  /** custom provider의 model 목록을 다시 읽는다. 성공하면 true다. */
  refreshModels(provider: string): Promise<boolean>;
  /** 켠 model 목록 전체를 바꾸고 바뀐 목록을 돌려준다. */
  setShown(
    items: readonly ShownModel[],
  ): Promise<ReadResult<readonly ShownModel[]>>;
  /** 사람이 적은 custom provider model 정보와 그 판. */
  userModels(): Promise<ReadResult<UserModels>>;
  /** model 정보 하나를 더하거나 고친다. 판이 어긋나면 message가 conflict다. */
  saveModelInfo(
    item: UserModelItem,
    seq: string,
  ): Promise<ReadResult<UserModels>>;
  /** model 정보 하나를 지운다. 판이 어긋나면 message가 conflict다. */
  removeModelInfo(
    key: UserModelKey,
    seq: string,
  ): Promise<ReadResult<UserModels>>;
  /** 첫 인자는 화면을 연 자리("home", project나 앱 id, Settings는 null)다. agent는 두 번째 인자 하나로 가리킨다. */
  readAgent(
    workspace: string | null,
    assignment: string,
  ): Promise<ReadResult<AgentDetail>>;
  /** 첫 저장 전의 agent. 상속하는 값과 기본 범위는 화면을 연 자리가 정한다(null이나 "home"이면 전역). */
  newAgent(workspace: string | null): Promise<ReadResult<AgentDetail>>;
  saveAgent(workspace: string | null, input: SaveInput): Promise<SaveResult>;
  deleteAgent(
    workspace: string,
    assignment: string,
    hash: string,
  ): Promise<ReadResult<null>>;
  /** avatar 이미지를 올리고 정의의 avatar에 쓸 파일 이름을 돌려준다. 저장은 따로다. */
  uploadImage(
    workspace: string | null,
    assignment: string,
    file: File,
  ): Promise<ReadResult<{ readonly image: string }>>;
  /** 올린 이미지 avatar를 화면이 읽을 수 있는 주소로 푼다. 풀 수 없으면 빈 글이다. */
  imageSrc(workspace: string | null, assignment: string, image: string): string;
  /** workspace 층 model을 고르거나(choice) 비워 전역 기본을 따르게(null) 한다. */
  setWorkspaceModel(
    workspace: string,
    choice: ModelChoice | null,
  ): Promise<ReadResult<null>>;
  /** workspace 층에서 skill을 켜고 끈다. agent 층은 정의의 skills_off로 저장한다. */
  setSkill(
    workspace: string,
    name: string,
    on: boolean,
  ): Promise<ReadResult<null>>;
  /** workspace 층 MCP server를 켜고 끈다. agent 층은 정의의 mcp_off로 저장한다. */
  setMcp(
    workspace: string,
    name: string,
    on: boolean,
  ): Promise<ReadResult<null>>;
  /** OAuth MCP server 로그인을 시작하고 사람이 browser에서 돌아올 때까지 기다린다. */
  signInMcp(name: string, login: McpLogin): Promise<ReadResult<null>>;
  /** 기다리는 MCP 로그인을 그만둔다. */
  cancelMcpSignIn(
    name: string,
    login: Pick<McpLogin, "workspace" | "agent">,
  ): Promise<ReadResult<null>>;
  /** MCP server의 secret 한 자리(`mcp.…` 이름)에 값을 넣는 보호 입력 창을 열고 닫힐 때까지 기다린다. 값은 이 길을 지나지 않는다. */
  enterMcpSecret(name: string, server: string): Promise<void>;
  /** 이 agent에 붙은 할당과 붙일 수 있는 앱. */
  grants(
    workspace: string | null,
    assignment: string,
  ): Promise<ReadResult<GrantsView>>;
  /** 붙은 할당 전체를 새 내용으로 바꾸고 새 저장 판을 돌려준다. revision이 지금과 다르면 `conflict`다. */
  setGrants(
    workspace: string | null,
    assignment: string,
    entries: readonly AssignmentEntry[],
    revision: number,
  ): Promise<ReadResult<{ readonly revision: number }>>;
  /** workspace 지침(project·Home은 `LOPHN.md`, 앱은 source의 `AGENTS.md`)을 다시 읽는다. source가 없는 앱은 unavailable이다. */
  readInstructions(workspace: string): Promise<ReadResult<InstructionsFile>>;
  /**
   * workspace 지침을 통째로 쓴다. hash는 읽은 때의 값이고, 그사이 파일이 바뀌었으면 message가 conflict이고
   * 파일은 그대로다.
   */
  writeInstructions(
    workspace: string,
    text: string,
    hash: string | null,
  ): Promise<ReadResult<InstructionsFile>>;
  /** memory 파일을 다시 읽는다. 파일이 없으면 빈 글이다. */
  readMemory(target: MemoryTarget): Promise<ReadResult<InstructionsFile>>;
  /** memory 파일을 통째로 쓴다. hash 규칙은 writeInstructions와 같다. */
  writeMemory(
    target: MemoryTarget,
    text: string,
    hash: string | null,
  ): Promise<ReadResult<InstructionsFile>>;
}
