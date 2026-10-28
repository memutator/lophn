// Agents 탭과 agent editor가 읽고 쓰는 통로. 정의 파일의 칸과 칸별 값·출처는 protocol/lophn-agent의
// agents를, 할당은 approvals/assignment를 그대로 따르고, 화면이 contract만으로 만들 수 없는 것
// (켬·끔 줄, 놓을 곳 후보, 붙일 앱 목록)만 여기서 더한다. 화면은 이 통로를 지나는 값으로만 그리고 core를 직접 부르지 않는다.
import type {
  AgentDefinitionIssue,
  AgentValueLayer,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  AgentCounts,
  McpOff,
  Profile,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type { McpServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type {
  CatalogEntry,
  ModelChoice,
  UserModelItem,
  UserModelRecord,
} from "../../../../protocol/lophn-agent/models.ts";
import type { AssignmentEntry } from "../../../../protocol/approvals/assignment.ts";
import type { ToolEffect } from "../../../../protocol/lophn-agent/tool-values.ts";
import type { DomainView, ReadResult } from "../source.ts";
import type {
  McpRow,
  ProjectInstructionsView,
  SkillRow,
  Sourced,
} from "./views.ts";

export type { ReadResult };

/**
 * 목록의 줄. `assignment`는 agent id(`lophn`이거나 `agt_…`)다. 목록은 전역이고 lophn이 첫 줄이다.
 */
export interface AgentListRow {
  readonly assignment: string;
  readonly name: string;
  readonly profile: Profile;
  readonly model: {
    readonly provider: string;
    readonly model_name: string;
    readonly source: AgentValueLayer;
  } | null;
  readonly issues: readonly AgentDefinitionIssue[];
  readonly counts: AgentCounts;
}

/** Agents 탭 본문 한 번에 필요한 값. */
export interface AgentsOverview {
  /** 전역 목록 전부(lophn이 첫 줄). */
  readonly agents: readonly AgentListRow[];
  /** 같이 쓰는 `LOPHN.md`. 파일이 없거나 읽을 수 없으면 빈 글이다. */
  readonly instructions: ProjectInstructionsView;
  /** 이 project가 고른 model 하나(null이면 Workspace 기본을 따른다)와 따를 Workspace 기본. */
  readonly projectModel: {
    readonly chosen: ModelChoice | null;
    readonly inherited: ModelChoice | null;
  };
  /** 이 project에서 발견되는 skill. 꺼진 것도 줄로 남는다. */
  readonly skills: readonly SkillRow[];
  /** 이 project가 쓰는 MCP server(전역과 project 층). */
  readonly mcpServers: readonly McpRow[];
}

/**
 * 정의 파일 한 개의 값. 모든 agent가 같은 칸을 갖는다. `skills`는 받을 skill 이름이고 비면 보이는 skill을 모두 받는다.
 * `domains`는 일할 domain의 id이고 비면 그 그릇의 domain 전부다. lophn의 `name`·`profile`은 바꾸지 못하고
 * `mcp_servers`·`skip`은 사람만 쓴다. 파일에는 사람이 바꾼 칸만 있어 없는 칸은 상속이다.
 */
export interface AgentDraft {
  readonly name?: string;
  readonly profile?: Profile;
  readonly model?: ModelChoice;
  readonly skills?: readonly string[];
  readonly domains?: readonly string[];
  readonly mcp_off?: readonly McpOff[];
  readonly mcp_servers?: readonly McpServer[];
  /** 새 session을 skip으로 시작한다. 사람만 쓴다. */
  readonly skip?: boolean;
  readonly body: string;
}

/** 화면을 연 자리. `kind: "none"`은 Settings다. */
export interface PlaceView {
  readonly kind: "project" | "app" | "none";
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
  readonly place: PlaceView;
  /** 정의 파일의 내용. 파일이 없거나 틀렸으면 본문만 빈 정의다. */
  readonly definition: AgentDraft;
  /** 읽은 파일의 hash. 저장·삭제가 비교한다. 파일이 없으면 null이다. */
  readonly hash: string | null;
  /** 정의에 칸이 없을 때 보일 상속 값. */
  readonly effective: {
    readonly name: Sourced<string>;
    readonly profile: Sourced<Profile>;
  };
  /** 이 agent가 model을 고르지 않으면 따르는 값. 어느 층에도 model이 없으면 null이다. */
  readonly inheritedModel: Sourced<ModelChoice> | null;
  /** 파일이 틀렸다면 읽기가 알린 항목별 이유다. */
  readonly issues: readonly AgentDefinitionIssue[];
  /** 이 agent가 놓인 곳에서 보이는 skill(내장, 전역, project). 이 agent가 받을 것은 정의의 skills가 말한다. */
  readonly skills: readonly SkillRow[];
  /** 전역과 project 층 MCP server. 이 agent 층은 정의의 mcp_servers다. */
  readonly mcpServers: readonly McpRow[];
  /** project 지침. lophn은 project 지침을 받지 않아 null이다. */
  readonly instructions: ProjectInstructionsView | null;
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
  /** model 목록을 다시 읽을 수 있는가: catalog에 그 정의의 model이 하나도 없는 provider(custom)다. catalog를 못 읽었으면 false다. */
  readonly refreshable: boolean;
}

export interface HiddenModel {
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
  /** 사람이 끈 model. 여기 없는 model은 켜져 있다. */
  readonly hidden: readonly HiddenModel[];
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
  /** 다른 domain에 보이는 tool인가. */
  readonly public: boolean;
  /** tool이 다루는 객체의 domain 이름. */
  readonly domain: string;
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
  /** 전역 agent 목록(lophn이 첫 줄). sidebar의 Agents 묶음이 이것만 읽는다. 첫 인자는 화면을 연 자리다. */
  list(project: string): Promise<ReadResult<readonly AgentListRow[]>>;
  overview(project: string): Promise<ReadResult<AgentsOverview>>;
  models(): Promise<ReadResult<ModelsView>>;
  /** 이 자리(project나 앱) 그릇의 active domain 목록. agent가 고를 수 있는 domain이다. */
  domains(place: string): Promise<ReadResult<readonly DomainView[]>>;
  /** custom provider의 model 목록을 다시 읽는다. 성공하면 true다. */
  refreshModels(provider: string): Promise<boolean>;
  /** 끈 model 목록 전체를 바꾸고 바뀐 목록을 돌려준다. */
  setHidden(
    items: readonly HiddenModel[],
  ): Promise<ReadResult<readonly HiddenModel[]>>;
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
  /** 첫 인자는 화면을 연 자리(project나 앱, Settings는 null)다. agent는 두 번째 인자 하나로 가리킨다. */
  readAgent(
    project: string | null,
    assignment: string,
  ): Promise<ReadResult<AgentDetail>>;
  /** 첫 저장 전의 agent. 상속하는 값은 화면을 연 자리가 정한다. */
  newAgent(project: string): Promise<ReadResult<AgentDetail>>;
  saveAgent(project: string | null, input: SaveInput): Promise<SaveResult>;
  deleteAgent(
    project: string,
    assignment: string,
    hash: string,
  ): Promise<ReadResult<null>>;
  /** profile 이미지를 올리고 정의의 profile에 쓸 파일 이름을 돌려준다. 저장은 따로다. */
  uploadImage(
    project: string | null,
    assignment: string,
    file: File,
  ): Promise<ReadResult<{ readonly image: string }>>;
  /** 올린 이미지 avatar를 화면이 읽을 수 있는 주소로 푼다. 풀 수 없으면 빈 글이다. */
  imageSrc(project: string | null, assignment: string, image: string): string;
  /** project 층 model을 고르거나(choice) 비워 Workspace 기본을 따르게(null) 한다. */
  setProjectModel(
    project: string,
    choice: ModelChoice | null,
  ): Promise<ReadResult<null>>;
  /** project 층에서 skill을 켜고 끈다. agent 층은 정의의 skills로 저장한다. */
  setSkill(
    project: string,
    name: string,
    on: boolean,
  ): Promise<ReadResult<null>>;
  /** project 층 MCP server를 켜고 끈다. agent 층은 정의의 mcp_off로 저장한다. */
  setMcp(project: string, name: string, on: boolean): Promise<ReadResult<null>>;
  /** 이 agent에 붙은 할당과 붙일 수 있는 앱. project가 null이면 lophn이다. */
  grants(
    project: string | null,
    assignment: string,
  ): Promise<ReadResult<GrantsView>>;
  /** 붙은 할당 전체를 새 내용으로 바꾸고 새 저장 판을 돌려준다. revision이 지금과 다르면 `conflict`다. */
  setGrants(
    project: string | null,
    assignment: string,
    entries: readonly AssignmentEntry[],
    revision: number,
  ): Promise<ReadResult<{ readonly revision: number }>>;
}
