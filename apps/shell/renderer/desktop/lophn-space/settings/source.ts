// settings 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 모양은 contracts(providers·provider-credentials·agent-model-*·agent-usage·settings·secrets)에서
// 이 화면이 쓰는 field만 옮긴 것이다. secret 값은 이 통로에 없다. key·로그인 응답은 보호 창이
// 받고 이 통로는 그 창을 여는 일만 한다(platform/secrets#R2).
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** contract가 알려 준 인증 방식. 화면은 이 안에 있는 것만 보인다. */
export type AuthWay = "api_key" | "oauth" | "none";

export type AccountState = "available" | "rejected" | "usage_wait" | "revoked";
export type AccountReason =
  | "authentication"
  | "quota"
  | "plan_access"
  | "refresh_revoked";

export interface ModelBlock {
  readonly model: string;
  readonly reason: "not_found" | "retired" | "account_model_access";
  readonly until: string | null;
}

/** 같은 연결에 붙은 계정 하나. 계정·조직·요금제는 확인한 값만 있고 모르면 null이다. */
export interface AccountRow {
  readonly key: string;
  readonly label: string;
  readonly way: AuthWay;
  readonly enabled: boolean;
  /** 같은 연결 안의 순서. 작은 것이 먼저다. */
  readonly order: number;
  readonly account: string | null;
  readonly organization: string | null;
  readonly plan: string | null;
  readonly state: AccountState;
  readonly reason: AccountReason | null;
  /** 사용량 한도가 풀리는 시각. 서버가 알려 준 시각인지 lophn이 정한 대기인지는 값에 없다. */
  readonly until: string | null;
  readonly modelBlocks: readonly ModelBlock[];
}

export interface ConnectionCheck {
  readonly at: string;
  readonly result: "success" | "failure";
  readonly kind: "text" | "tool_call";
  readonly model: string;
}

/** 연결 하나(Claude, ChatGPT 같은 제품 또는 로컬 model). */
export interface ProviderRow {
  /** 등록된 연결은 provider id이고 아직 등록하지 않은 내장 정의는 정의에서 만든 임시 id다. */
  readonly id: string;
  /** false면 내장 정의만 있고 이 컴퓨터에 등록된 연결이 아직 없다(계정·확인 기록 없음). */
  readonly registered: boolean;
  readonly name: string;
  readonly enabled: boolean;
  /** 정의 key. model 목록을 찾는 기준이다. */
  readonly definition: string;
  readonly ways: readonly AuthWay[];
  /** 공식 로그인이 있는 연결만. verified는 lophn 이름으로 허용된 것이 확인됐다는 뜻이다. */
  readonly signIn: { readonly verified: boolean } | null;
  /** 이 컴퓨터 안에서 도는 연결. */
  readonly local: boolean;
  readonly accounts: readonly AccountRow[];
  readonly lastCheck: ConnectionCheck | null;
  /** 보호 입력이 비교하는 기준. 화면은 보내지 않는다. */
  readonly revision: number;
}

export type CostKind =
  | "reported"
  | "estimated"
  | "subscription"
  | "free"
  | "unknown";

export interface CostLine {
  readonly kind: CostKind;
  /** reported·estimated·free일 때만 있다. */
  readonly amount: string | null;
  readonly currency: string | null;
  readonly calls: number;
}

/** 계정 하나의 최근 30일 사용. 모르는 비용은 0으로 채우지 않는다. */
export interface UsageRow {
  readonly calls: number;
  readonly costs: readonly CostLine[];
  /** 기록이 빠진 호출이 있다. */
  readonly complete: boolean;
}

export type TestKind = "text" | "tool_call";

export interface TestInput {
  readonly provider: string;
  readonly account: string;
  readonly model: string;
}

/** 연결 테스트 한 번(한 종류). calls는 실제 시도 수이고 사용량은 따로 읽는다. */
export interface TestResult {
  readonly kind: TestKind;
  /** 시도하지 않았거나 결과가 없으면 null이다. 성공으로 채우지 않는다. */
  readonly result: "success" | "failure" | null;
  readonly timeoutSeconds: number;
}

export interface SignIn {
  readonly login: string;
  /** 공식 로그인 주소. 없으면 열 곳이 없다. */
  readonly url: string | null;
  readonly code: string | null;
  /** 최종 주소를 붙여 넣어 끝내는 방식. */
  readonly paste: boolean;
}

/** 보호 창을 연 결과. 값은 창만 안다. 이 창은 닫혀도 결정이 아니다. */
export type WindowOutcome = SourceResult<null>;

export interface ModelChoice {
  readonly provider: string;
  readonly model: string;
}

/** 새로 고르는 model. 계정은 그 연결에서 쓸 수 있는 것을 사람이 정한 순서로 담는다. */
export interface ModelPick extends ModelChoice {
  readonly accounts: readonly string[];
}

/** model 기본값. 값을 정하지 않은 agent가 따르는 Workspace 층 기본이다. */
export interface ModelDefaults {
  readonly decisions: ModelChoice | null;
  readonly summaries: ModelChoice | null;
  /** 바꿀 때의 비교 기준. */
  readonly seq: string;
}

export type ModelUse = "decisions" | "summaries";

export type ApplyAt = "next_run" | "current_check" | "next_call";

/** 설정 하나. title은 정의를 가진 concern이 준 문장이다. */
export interface SettingRow {
  readonly key: string;
  readonly title: string;
  readonly value: unknown;
  /** 값이 정해졌는지. 정의에 기본이 없고 고르지 않았으면 false다. */
  readonly resolved: boolean;
  /** 사람이 바꾼 값인지 기본값인지. */
  readonly changed: boolean;
  readonly defaultValue: unknown;
  readonly hasDefault: boolean;
  readonly applyAt: ApplyAt;
}

export interface SettingsView {
  readonly rows: readonly SettingRow[];
  /** 확장 설정을 바꿀 때의 비교 기준. */
  readonly revision: number;
  readonly defaultsRevision: string;
  readonly folders: readonly string[];
  readonly servers: readonly ServerRow[];
  /** 새 server를 더할 때 기존 설정을 그대로 돌려보내는 원본. 화면은 읽지 않는다. */
  readonly rawServers: readonly unknown[];
}

export type ServerAuth = "none" | "bearer" | "api_key" | "oauth2";

/** 등록한 MCP server 하나. credential 값은 어디에도 없다. */
export interface ServerRow {
  readonly name: string;
  readonly transport: "stdio" | "http";
  readonly enabled: boolean;
  readonly auth: ServerAuth;
  /** credential이 필요한 server만. 값이 들어갈 보관 이름과 저장됐는지(이름만 본다). */
  readonly secret: string | null;
  readonly credential: "set" | "missing" | "unknown" | null;
}

/** 새 MCP server. credential 값은 이 모양에 없다. */
export type NewServer =
  | {
    readonly transport: "stdio";
    readonly name: string;
    readonly executable: string;
    readonly args: readonly string[];
  }
  | {
    readonly transport: "http";
    readonly name: string;
    readonly url: string;
    readonly auth: "none" | "bearer" | "api_key";
    /** api_key일 때 key를 실을 header 이름. */
    readonly header: string | null;
  };

export interface SettingsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  providers(): Promise<SourceResult<readonly ProviderRow[]>>;
  /** 계정 하나의 최근 30일 사용. */
  usage(account: string): Promise<SourceResult<UsageRow>>;
  /** 그 정의가 알려진 model 이름들. 확인하지 못했으면 실패다. */
  models(definition: string): Promise<SourceResult<readonly string[]>>;
  /** 사람이 누를 때만 부른다. 두 종류(글·도구 호출)를 하나씩 시도한다. */
  testConnection(
    input: TestInput,
  ): Promise<SourceResult<readonly TestResult[]>>;

  /** 공식 로그인을 시작하고 열 주소를 받는다. 이 route가 없으면 unavailable이다. */
  beginSignIn(provider: string): Promise<SourceResult<SignIn>>;
  cancelSignIn(provider: string, login: string): Promise<SourceResult<null>>;
  /** shell 크롬 링크. main이 검사하고 확인 없이 OS browser로 연다. */
  openLink(url: string): Promise<boolean>;

  /** 보호 창을 연다. 이름만 넘기고 값은 창이 받는다. */
  connectKey(provider: string, label: string): Promise<WindowOutcome>;
  /** 로그인 응답(코드 또는 최종 주소)을 보호 창에 넣는다. */
  enterSignInResponse(provider: string, label: string): Promise<WindowOutcome>;
  replaceKey(provider: string, account: string): Promise<WindowOutcome>;
  removeAccount(provider: string, account: string): Promise<WindowOutcome>;

  modelDefaults(): Promise<SourceResult<ModelDefaults>>;
  setModelDefault(
    use: ModelUse,
    pick: ModelPick,
    defaults: ModelDefaults,
  ): Promise<SourceResult<ModelDefaults>>;

  settings(): Promise<SourceResult<SettingsView>>;
  /** OS 폴더 선택기로 고른 skill 폴더를 등록한다. 그만두면 null이다. */
  addSkillFolder(
    view: SettingsView,
  ): Promise<SourceResult<{ readonly path: string } | null>>;
  addServer(
    view: SettingsView,
    server: NewServer,
  ): Promise<SourceResult<null>>;
  /** MCP credential을 보호 창에 넣는다. secret은 ServerRow.secret이다. */
  enterServerCredential(secret: string): Promise<WindowOutcome>;
  /**
   * 사람이 고른 앱의 자료를 밖으로 내보낸다(settings [Export] 항목, shell#T58). 준비 결과
   * (ready·failed)만 답하고 실제 묶음은 core가 처리한다. 준비 중이면 preparing이다.
   */
  exportApp(app: string): Promise<
    SourceResult<{
      readonly app: string;
      readonly state: "preparing" | "ready" | "failed";
      readonly reason?: string;
      readonly includesExternalData: boolean;
    }>
  >;
}
