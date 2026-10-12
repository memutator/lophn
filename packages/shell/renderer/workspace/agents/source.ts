// Agents 탭과 Operator editor가 읽고 쓰는 통로(shell/workspace#R36~R44). 모양은 contracts(lophn-agent/agents·
// models·extensions)에서 이 화면이 쓰는 field만 옮긴 것이다. 정의 파일의 칸과 칸별 값·출처는 contract의 type을
// 그대로 쓰고, 화면이 contract만으로 만들 수 없는 것(켬·끔 줄, 권한 줄)만 여기서 더한다. 화면은 이 통로를 지나는
// 값으로만 그리고 core를 직접 부르지 않는다.
import type {
  AgentDefinition,
  AgentIssue,
  AgentListRow,
  ValueSource,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type {
  CatalogEntry,
  ModelChoice,
} from "../../../../protocol/lophn-agent/models.ts";
import type { AgentRole } from "../../../../protocol/lophn-agent/scope.ts";
import type { ReadResult } from "../source.ts";
import type {
  AgentEffective,
  PermissionRow,
  ProjectInstructionsView,
  ToggleRow,
} from "./views.ts";

export type { ReadResult };

/** 이 project가 role마다 실제로 쓰는 model과 그 값을 준 층. */
export interface EffectiveModel {
  readonly value: ModelChoice;
  readonly source: ValueSource;
}

/** Agents 탭 본문 한 번에 필요한 값. */
export interface AgentsOverview {
  /** lophn · Context Engineer · Operator들 순서의 목록. */
  readonly agents: readonly AgentListRow[];
  /** project 폴더의 LOPHN.md. 파일이 없거나 읽을 수 없으면 빈 글이다. */
  readonly instructions: ProjectInstructionsView;
  /** 이 project가 role마다 고른 model(자리 설정의 models). */
  readonly chosenModels: Readonly<Partial<Record<AgentRole, ModelChoice>>>;
  /** role마다 실제로 쓰는 model(고른 값이 없으면 Workspace 기본값). */
  readonly effectiveModels: Readonly<
    Partial<Record<AgentRole, EffectiveModel>>
  >;
  /** 이 project에서 발견되는 skill. 꺼진 것도 줄로 남는다. */
  readonly skills: readonly ToggleRow[];
  /** 이 project에 등록한 MCP server. */
  readonly mcpServers: readonly ToggleRow[];
  /** 이 project의 권한 규칙. 줄 이름은 동작 이름이다. */
  readonly permissions: readonly PermissionRow[];
}

/** editor 하나가 여는 agent의 값. 새 Operator는 assignment와 hash가 null이다. */
export interface AgentDetail {
  readonly assignment: string | null;
  readonly role: AgentRole;
  readonly kind: "built_in" | "operator";
  /** 정의 파일의 내용. 파일이 없거나 틀렸으면 본문만 빈 정의다. */
  readonly definition: AgentDefinition;
  /** 읽은 파일의 hash. 저장·삭제가 비교한다. 파일이 없으면 null이다. */
  readonly hash: string | null;
  readonly effective: AgentEffective;
  /** 파일이 틀렸다면 읽기가 알린 항목별 이유다. */
  readonly issues: readonly AgentIssue[];
}

/** 연결된 provider. definition은 catalog 항목과 맞추는 key다. */
export interface ProviderChoice {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
}

export interface ModelFavorite {
  readonly provider: string;
  readonly model_name: string;
}

/** model picker를 그릴 자료. */
export interface ModelsView {
  readonly providers: readonly ProviderChoice[];
  readonly catalog: readonly CatalogEntry[];
  /** 별표를 찍은 순서 그대로. */
  readonly favorites: readonly ModelFavorite[];
}

export interface SaveInput {
  /** 새 Operator는 null이다. */
  readonly assignment: string | null;
  readonly definition: AgentDefinition;
  /** 읽을 때의 파일 hash. 새 Operator는 null이다. */
  readonly hash: string | null;
}

export type SaveResult =
  | {
    readonly ok: true;
    readonly value: {
      readonly assignment: string;
      readonly role: AgentRole;
      readonly hash: string;
    };
  }
  /** 거절이면 항목별 이유가 issues에 있다(R24). 그 밖의 실패는 issues가 비어 있고 message가 core의 오류 code다. */
  | {
    readonly ok: false;
    readonly message: string;
    readonly issues: readonly AgentIssue[];
  };

export interface AgentsSource {
  /** 이 project의 agent 목록. sidebar의 Agents 묶음이 이것만 읽는다. */
  list(project: string): Promise<ReadResult<readonly AgentListRow[]>>;
  overview(project: string): Promise<ReadResult<AgentsOverview>>;
  models(): Promise<ReadResult<ModelsView>>;
  /** 별표 목록 전체를 새 순서로 바꾸고 바뀐 목록을 돌려준다. */
  setFavorites(
    items: readonly ModelFavorite[],
  ): Promise<ReadResult<readonly ModelFavorite[]>>;
  readAgent(
    project: string,
    assignment: string,
  ): Promise<ReadResult<AgentDetail>>;
  /** 첫 저장 전의 Operator. 상속하는 값은 이 project가 정한다. */
  newOperator(project: string): Promise<ReadResult<AgentDetail>>;
  saveAgent(project: string, input: SaveInput): Promise<SaveResult>;
  deleteAgent(
    project: string,
    assignment: string,
    hash: string,
  ): Promise<ReadResult<null>>;
  /** profile 이미지를 올리고 정의의 profile에 쓸 파일 이름을 돌려준다. 저장은 따로다. */
  uploadImage(
    project: string,
    assignment: string,
    file: File,
  ): Promise<ReadResult<{ readonly image: string }>>;
  /** 올린 이미지 avatar를 화면이 읽을 수 있는 주소로 푼다. 풀 수 없으면 빈 글이다. */
  imageSrc(project: string, assignment: string, image: string): string;
  /** role의 model을 고르거나(choice) 비워 Workspace 기본값을 따르게(null) 한다. */
  changeRoleModel(
    project: string,
    role: AgentRole,
    choice: ModelChoice | null,
  ): Promise<ReadResult<null>>;
  setSkill(
    project: string,
    name: string,
    on: boolean,
  ): Promise<ReadResult<null>>;
  setMcp(project: string, name: string, on: boolean): Promise<ReadResult<null>>;
  setPermission(
    project: string,
    tool: string,
    on: boolean,
  ): Promise<ReadResult<null>>;
}
