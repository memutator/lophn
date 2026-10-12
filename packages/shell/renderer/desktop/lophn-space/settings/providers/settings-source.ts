// Settings › Providers가 읽고 쓰는 통로. provider는 연결과 인증만 다루므로 이
// 통로에는 model 이름·기본값 route가 없다. provider 하나에는 연결 하나라 계정 순서·끄기·연결 테스트도
// 없다. 모양은 contracts(providers·provider definitions)에서 이 화면이 쓰는 field만 옮긴 것이고
// secret 값은 없다: key·로그인 응답은 보호 창이 받고 이 통로는 그 창을 여는 일만 한다
// (platform/secrets#R2). 연결된 provider는 기존 settings의 ProviderRow를 그대로 쓴다.
import type {
  AuthWay,
  CredentialReason,
  CredentialState,
  ProviderRow,
  SourceResult,
  WindowOutcome,
} from "../source.ts";

export type {
  AuthWay,
  CredentialReason,
  CredentialState,
  ProviderRow,
  SourceResult,
  WindowOutcome,
};

/** Add a provider 목록의 한 줄(아직 연결하지 않은 내장 정의 또는 Custom provider). */
export interface ProviderDefinitionRow {
  /** 정의 key. Custom provider는 "custom"이다. */
  readonly key: string;
  readonly name: string;
  /** 줄 옆의 짧은 설명(예: "Gemini models"). */
  readonly hint: string | null;
  /** 정의가 알려 준 인증 방식. 화면은 이 안에 있는 것만 고르게 한다. */
  readonly ways: readonly AuthWay[];
  /** 공식 로그인이 있는 정의만. product는 단추에 쓰는 제품 이름(예: "ChatGPT")이다. */
  readonly signIn: {
    readonly product: string;
    /** lophn 이름으로 허용된 것이 확인됐는지. 아니면 고를 수 없다. */
    readonly verified: boolean;
  } | null;
  /** 사람이 직접 만드는 OpenAI 호환 provider(ID·이름·Base URL 입력). */
  readonly custom: boolean;
}

/**
 * Custom provider 입력. API key 값은 이 모양에 없다: withKey가 참이면 보호 창이 열려 거기서 받는다.
 */
export interface CustomProviderInput {
  /** 소문자·숫자·하이픈·밑줄. */
  readonly id: string;
  readonly name: string;
  /** https 주소이거나 이 컴퓨터(127.0.0.1·::1·localhost)의 http 주소만 받는다. */
  readonly baseUrl: string;
  readonly withKey: boolean;
}

export interface ProviderSettingsSource {
  /** 연결된(등록된) provider. */
  connected(): Promise<SourceResult<readonly ProviderRow[]>>;
  /** 아직 연결하지 않은 정의. 사람이 보는 순서로 온다. */
  available(): Promise<SourceResult<readonly ProviderDefinitionRow[]>>;
  /** 연결을 끊는 확인 창을 연다. 결정은 그 창에서만 받고 창은 닫혀도 결정이 아니다. */
  disconnect(provider: string): Promise<WindowOutcome>;
  /** 고른 방식으로 연결을 시작한다(공식 로그인은 OS browser, key는 보호 창). */
  connect(
    definition: string,
    way: Exclude<AuthWay, "none">,
  ): Promise<WindowOutcome>;
  /**
   * Custom provider를 연결한다. withKey면 key용 보호 창이 열려 거기서 연결을 끝내고, 아니면 이 컴퓨터의
   * 주소에 인증 없이 바로 연결한다.
   */
  registerCustom(input: CustomProviderInput): Promise<WindowOutcome>;
}
