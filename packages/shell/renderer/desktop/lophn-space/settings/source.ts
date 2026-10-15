// settings 화면의 일반 설정·skill 폴더·도구 server가 읽고 쓰는 통로. 화면은 이 interface만 보고 core
// route 이름은 core-source.ts만 안다. 모양은 contracts(settings·secrets)에서 이 화면이 쓰는 field만
// 옮긴 것이다. Providers와 Agents 자리는 각자의 통로(providers/settings-source.ts,
// agents/settings-source.ts)를 쓴다. 이 파일의 provider 연결 모양은 Providers 통로가 같이 쓴다.
// secret 값은 이 통로에 없다. credential은 보호 창이 받고 이 통로는 그 창을 여는 일만 한다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** contract가 알려 준 인증 방식. 화면은 이 안에 있는 것만 보인다. */
export type AuthWay = "api_key" | "oauth" | "none";

/** 연결(credential 하나)의 사용 가능 상태. */
export type CredentialState =
  | "available"
  | "rejected"
  | "usage_wait"
  | "revoked";
export type CredentialReason =
  | "authentication"
  | "quota"
  | "plan_access"
  | "refresh_revoked";

/**
 * 연결된 provider 하나. provider에는 연결(credential)이 하나라 계정 목록이나 순서는 없다.
 * 행은 이름·로그인 방법·불가 상태만 말하고 secret 참조는 싣지 않는다.
 */
export interface ProviderRow {
  /** provider id. */
  readonly id: string;
  readonly name: string;
  /** 정의 key. */
  readonly definition: string;
  /** 이 연결의 로그인 방법. */
  readonly way: AuthWay;
  readonly state: CredentialState;
  readonly reason: CredentialReason | null;
  /** 보호 입력이 비교하는 기준. 화면은 보내지 않는다. */
  readonly revision: number;
}

/** 보호 창을 연 결과. 값은 창만 안다. 이 창은 닫혀도 결정이 아니다. */
export type WindowOutcome = SourceResult<null>;

export type ApplyAt = "next_turn" | "current_check" | "next_call";

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

/** server가 등록된 자리(project 또는 app). 전역 server는 자리가 아니므로 null로 쓴다. */
export interface ServerPlace {
  readonly kind: "project" | "app";
  readonly id: string;
}

/**
 * core가 읽어 준 로그인 상태. 끝난 세션의 기억이 아니라 core가 지금 쥔 값이다. 읽지 못했으면 unknown이다.
 * - none: 로그인하지 않았다. in_progress: browser에서 돌아오기를 기다린다. signed_in: 쓸 수 있는 token이 있다.
 * - failed: 마지막 시도나 갱신이 실패했고 reason이 이유 코드다.
 */
export type ServerSignInState =
  | "none"
  | "in_progress"
  | "signed_in"
  | "failed"
  | "unknown";

export type ServerSignInReason =
  | "callback_timeout"
  | "state_mismatch"
  | "exchange_failed"
  | "refresh_rejected"
  | "expired"
  | "store_failed";

/** 켜진 OAuth server의 로그인. 시작하는 데 필요한 것과 core가 읽어 준 상태다. */
export interface ServerSignIn {
  readonly place: ServerPlace | null;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly state: ServerSignInState;
  readonly reason: ServerSignInReason | null;
}

/** 등록한 MCP server 하나. credential 값은 어디에도 없다. */
export interface ServerRow {
  readonly name: string;
  readonly transport: "stdio" | "http";
  readonly enabled: boolean;
  readonly auth: ServerAuth;
  /** credential이 필요한 server만. 값이 들어갈 보관 이름과 저장됐는지(이름만 본다). */
  readonly secret: string | null;
  readonly credential: "set" | "missing" | "unknown" | null;
  /** 켜진 OAuth server만. 아니면 null이다. */
  readonly signIn: ServerSignIn | null;
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
   * OAuth 로그인을 시작해 인증 주소를 OS browser로 연다. callback port를 돌려준다.
   * 열지 못했으면 code는 not_opened이고 시작이 거절됐으면 core가 준 code다.
   */
  beginSignIn(
    server: ServerRow,
  ): Promise<SourceResult<{ callbackPort: number }>>;
  /** browser에서 돌아올 때까지 기다려 로그인을 끝낸다. 거절된 반환은 code가 rejected다. */
  finishSignIn(
    server: ServerRow,
    callbackPort: number,
  ): Promise<SourceResult<null>>;
  /** 기다리는 로그인을 그만둔다. 기다리던 finishSignIn은 conflict로 끝난다. */
  cancelSignIn(server: ServerRow): Promise<SourceResult<null>>;
}
