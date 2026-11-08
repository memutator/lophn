// Settings › Agents와 Tools and skills가 읽고 쓰는 통로. 전역 기본 model 하나, 전역 지침, 전역 skill과
// MCP server를 한 곳에서 보고 바꾼다. model 이름·option 이름과 값은 화면 코드에 없고 모두 catalog가 준다.
// lophn은 workspace마다 있어 여기서 고치지 않는다. model picker가 쓰는 통로(`editor`)만 싣는다.
import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../../protocol/lophn-agent/models.ts";
import type { AgentEditorSource } from "../../../workspace/agents/editor/agent-editor.tsx";
import type {
  InstructionsFile,
  McpRow,
  SkillRow,
} from "../../../workspace/agents/views.ts";
import type { SourceResult } from "../source.ts";

export type {
  AgentEditorSource,
  InstructionsFile,
  McpRow,
  ModelChoice,
  SkillRow,
  SourceResult,
};

export interface AgentsSettingsView {
  /** 전역 기본 model 하나. 아직 고르지 않았으면 null이다. */
  readonly defaultModel: ModelChoice | null;
  /** 모든 project의 LOPHN.md. 아직 없으면 빈 글과 null hash다. */
  readonly instructions: InstructionsFile;
}

/** Tools and skills가 보이는 전역 층. */
export interface ExtensionsView {
  readonly skills: readonly SkillRow[];
  readonly servers: readonly McpRow[];
}

/** 정책의 한 줄. from·to는 목록의 option 값이다. */
export interface CallRule {
  readonly from: string;
  readonly to: string;
  readonly allow: boolean;
}

/** 고를 수 있는 값(workspace나 agent)과 그것으로 적힌 줄. */
export interface CallRuleList {
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly rules: readonly CallRule[];
}

/** private으로 고를 수 있는 workspace(project, 앱)와 고른 것. 값은 workspace 쌍 option과 같은 꼴이다. */
export interface PrivateWorkspaces {
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly chosen: readonly string[];
}

export interface CallPolicyView {
  readonly private: PrivateWorkspaces;
  readonly workspaces: CallRuleList;
  readonly agents: CallRuleList;
}

/** 쓸 정책 전체. */
export interface CallPolicyChange {
  readonly private: readonly string[];
  readonly workspaces: readonly CallRule[];
  readonly agents: readonly CallRule[];
}

export interface CallPolicySource {
  read(): Promise<SourceResult<CallPolicyView>>;
  /** 정책 전체를 쓴다. 이 화면만 쓰는 값이라 통째로 쓴다. */
  write(next: CallPolicyChange): Promise<SourceResult<null>>;
}

export interface AgentsSettingsSource {
  /** agent가 보내는 call의 workspace 쌍·agent 쌍 정책. */
  readonly callPolicy: CallPolicySource;
  read(): Promise<SourceResult<AgentsSettingsView>>;
  /** 전역 기본 model을 바꾼다. 새 값은 다음 일부터 적용되고 이미 시작한 일은 바뀌지 않는다. */
  changeDefaultModel(choice: ModelChoice): Promise<SourceResult<null>>;
  /** 기본 model picker가 model 목록을 읽는 통로. */
  readonly editor: AgentEditorSource;
  /** 모든 project의 LOPHN.md를 다시 읽는다. */
  readInstructions(): Promise<SourceResult<InstructionsFile>>;
  /** 모든 project의 LOPHN.md를 통째로 쓴다. hash가 디스크와 다르면 code가 conflict이고 파일은 그대로다. */
  writeInstructions(
    text: string,
    hash: string | null,
  ): Promise<SourceResult<InstructionsFile>>;
  /** Tools and skills 자리로 옮겨 server를 더하게 한다(settings 화면이 감싸 준다). */
  addServer(): Promise<SourceResult<null>>;
  readExtensions(): Promise<SourceResult<ExtensionsView>>;
  /** 전역 skill 더하기를 시작한다(폴더 선택). 그만두면 ok다. */
  addSkill(): Promise<SourceResult<null>>;
  setSkillEnabled(name: string, enabled: boolean): Promise<SourceResult<null>>;
  /** 전역 MCP server를 더한다. 값(key·token)은 이 모양에 없고 필요하면 보호 입력이 받는다. */
  createServer(server: McpServer): Promise<SourceResult<null>>;
  setServerEnabled(name: string, enabled: boolean): Promise<SourceResult<null>>;
  /** OAuth MCP server 로그인을 시작하고 사람이 browser에서 돌아올 때까지 기다린다. */
  signInServer(row: McpRow): Promise<SourceResult<null>>;
  /** 기다리는 로그인을 그만둔다. */
  cancelServerSignIn(row: McpRow): Promise<SourceResult<null>>;
}
