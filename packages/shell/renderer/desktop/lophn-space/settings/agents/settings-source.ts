// Settings › Agents가 읽고 쓰는 통로(shell/desktop#R50). 모든 project에 적용되는 agent 기본값을
// 한 곳에서 보고 바꾼다. 모양은 contracts(lophn-agent/models의 ModelDefaults·CatalogEntry,
// providers, instructions, skill-settings·mcp-settings)에서 이 화면이 쓰는 field만 옮긴 것이다.
// model 이름·option 이름과 값은 화면 코드에 없고 모두 catalog가 준다(lophn-agent/harness/model).
// 기본 권한 칸은 값의 contract(platform/settings)가 아직 없어 이 통로에 없다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** 기본값 칸 다섯. 앞의 넷은 role별이고 summaries는 제목·요약·압축에 쓰는 한 칸이다(Model for summaries). */
export type DefaultSlot =
  | "lophn"
  | "context_engineer"
  | "app_engineer"
  | "operator"
  | "summaries";

/** 고른 model 하나. 계정은 provider가 고르므로 여기 없다. optionValues는 축 id → 값이고 비면 모델에 맡긴다. */
export interface ModelChoice {
  /** 연결된 provider id. */
  readonly provider: string;
  readonly modelName: string;
  readonly optionValues: Readonly<Record<string, string>>;
}

/** 연결된 provider. definition은 catalog 항목과 맞추는 key다. */
export interface ProviderChoice {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
}

export interface OptionValueRow {
  readonly value: string;
  /** 화면 이름. effort는 고정 이름(Low·Medium·High·Max…)이고 나머지 축은 catalog가 준다. */
  readonly label: string;
}

export interface OptionAxisRow {
  readonly id: string;
  readonly label: string;
  /** 약한 값에서 강한 값 순서. */
  readonly values: readonly OptionValueRow[];
  /** 고르지 않았을 때의 값. null이면 모델에 맡긴다. */
  readonly defaultValue: string | null;
}

/** catalog의 model 하나. options가 null이면 option을 아직 모른다(고를 수 없다), 빈 배열이면 없다고 확인된 것이다. */
export interface CatalogModel {
  readonly providerDefinition: string;
  readonly modelName: string;
  readonly options: readonly OptionAxisRow[] | null;
}

/** 전역 skill 한 줄. */
export interface SkillRow {
  readonly name: string;
  readonly detail: string;
  readonly enabled: boolean;
}

export type ServerStatus = "connected" | "needs-sign-in" | "off";

/** 전역 MCP server 한 줄. credential 값은 어디에도 없다. */
export interface ServerRow {
  readonly name: string;
  readonly detail: string;
  readonly enabled: boolean;
  readonly status: ServerStatus;
}

export interface AgentsSettingsView {
  readonly defaults: Readonly<Record<DefaultSlot, ModelChoice | null>>;
  /** 바꿀 때의 비교 기준. */
  readonly settingsSeq: string;
  /** 연결된 provider(고를 수 있는 model은 이 provider의 것만이다). */
  readonly providers: readonly ProviderChoice[];
  readonly catalog: readonly CatalogModel[];
  /** 모든 project의 LOPHN.md 앞부분. 아직 없으면 null이다. */
  readonly instructionsPreview: string | null;
  readonly skills: readonly SkillRow[];
  readonly servers: readonly ServerRow[];
}

export interface AgentsSettingsSource {
  read(): Promise<SourceResult<AgentsSettingsView>>;
  /**
   * 칸 하나를 바꾼다. seq는 읽을 때의 settingsSeq이고 그 사이 바뀌었으면 conflict다.
   * 새 값은 다음 run부터 적용되고 이미 시작한 일은 바뀌지 않는다.
   */
  changeDefault(
    slot: DefaultSlot,
    choice: ModelChoice,
    settingsSeq: string,
  ): Promise<SourceResult<null>>;
  /** 모든 project의 LOPHN.md를 문서 탭으로 연다. 편집은 그 탭에서 한다. */
  openInstructions(): Promise<SourceResult<null>>;
  /** 전역 skill 더하기를 시작한다(폴더 선택). 그만두면 ok다. */
  addSkill(): Promise<SourceResult<null>>;
  setSkillEnabled(name: string, enabled: boolean): Promise<SourceResult<null>>;
  /** 전역 MCP server 더하기를 시작한다. */
  addServer(): Promise<SourceResult<null>>;
  setServerEnabled(
    name: string,
    enabled: boolean,
  ): Promise<SourceResult<null>>;
}
