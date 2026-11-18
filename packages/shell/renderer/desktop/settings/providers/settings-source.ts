// Settings › Providers가 읽고 쓰는 통로. provider는 연결과 인증만 다루므로 이
// 통로에는 model 이름·기본값 route가 없다. provider 하나에는 연결 하나다. 모양은 protocol(providers·provider definitions)에서 이 화면이 쓰는 field만 옮긴 것이고
// secret 값은 없다: API key는 보호 창이 받고, 구독 로그인의 token은 core가 받아 저장한다.
// 연결된 provider는 기존 settings의 ProviderRow를 그대로 쓴다.
import type { CustomProtocol } from "../../../../../protocol/lophn-agent/custom-provider.ts";
import type { SignInProgress } from "../sign-in.ts";
import type {
  AuthWay,
  CredentialReason,
  CredentialState,
  ProviderRow,
  SourceResult,
  WindowOutcome,
} from "../source.ts";

export { CUSTOM_PROTOCOLS } from "../../../../../protocol/lophn-agent/custom-provider.ts";
export type { CustomProtocol } from "../../../../../protocol/lophn-agent/custom-provider.ts";
export type { SignInProgress } from "../sign-in.ts";
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
  /**
   * 구독 로그인이 있는 정의만. product는 단추에 쓰는 제품 이름(예: "ChatGPT")이다. deviceCode면 어느 browser에서나 끝나고,
   * 아니면 core가 있는 기계의 browser로 돌아와야 한다(다른 기계의 범위은 그 단추를 두지 않는다).
   */
  readonly signIn: {
    readonly product: string;
    readonly deviceCode: boolean;
  } | null;
  /** 사람이 직접 만드는 provider(ID·이름·Base URL·API 입력). */
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
  readonly protocol: CustomProtocol;
  readonly withKey: boolean;
}

/** 화면의 provider 목록과 Add a provider 목록은 `providers/list`·`providers/definitions`를 useCoreRead로 읽는다. */
export interface ProviderSettingsSource {
  /** 연결된(등록된) provider. 연결이 끝난 뒤 새 provider를 찾는 흐름(connect-host)이 한 번 읽는다. */
  connected(): Promise<SourceResult<readonly ProviderRow[]>>;
  /**
   * 연결을 끊는다. provider와 연결(credential)을 함께 지운다. 화면이 Dialog로 사람에게 한 번 묻고 부르며,
   * 그 결정은 source가 결정 handle로 core에 싣는다(다른 기계의 범위은 그 기계의 core가 붙인다).
   */
  disconnect(provider: string): Promise<SourceResult<null>>;
  /**
   * 고른 방식으로 연결한다. key는 보호 창이 받는다. 공식 로그인은 OS browser를 열고 사람이 마칠 때까지
   * 기다린다. 그만두면 code "cancelled", 기한이 지나면 "not_found", 계정이 거절되면 "forbidden"이다.
   */
  connect(
    definition: string,
    way: Exclude<AuthWay, "none">,
    progress?: SignInProgress,
  ): Promise<WindowOutcome>;
  /**
   * Custom provider를 연결한다. withKey면 key용 보호 창이 열려 거기서 연결을 끝내고, 아니면 이 컴퓨터의
   * 주소에 인증 없이 바로 연결한다.
   */
  registerCustom(input: CustomProviderInput): Promise<WindowOutcome>;
}
