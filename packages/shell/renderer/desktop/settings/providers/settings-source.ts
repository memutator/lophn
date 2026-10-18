// Settings › Providers가 읽고 쓰는 통로. provider는 연결과 인증만 다루므로 이
// 통로에는 model 이름·기본값 route가 없다. provider 하나에는 연결 하나다. 모양은 protocol(providers·provider definitions)에서 이 화면이 쓰는 field만 옮긴 것이고
// secret 값은 없다: API key는 보호 창이 받고, 구독 로그인의 token은 core가 받아 저장한다.
// 연결된 provider는 기존 settings의 ProviderRow를 그대로 쓴다.
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
    /** 단추 문구. ChatGPT는 OpenAI의 branding 규칙대로 "Continue with"다. */
    readonly button: "continue" | "sign-in";
  } | null;
  /** 사람이 직접 만드는 provider(ID·이름·Base URL·API 입력). */
  readonly custom: boolean;
}

/** Custom provider가 말하는 API. 주소 뒤에 `/chat/completions`, `/responses`, `/messages`가 붙는다. */
export const CUSTOM_PROTOCOLS = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
] as const;
export type CustomProtocol = (typeof CUSTOM_PROTOCOLS)[number];

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

/** 구독 로그인의 진행. source가 browser를 연 뒤 started를 한 번 부르고, signal이 끊기면 로그인을 그만둔다. */
export interface SignInProgress {
  readonly signal: AbortSignal;
  /** device code 로그인이면 사람이 browser에 넣을 code가 온다. 아니면 null이다. */
  started(info: { readonly userCode: string | null }): void;
}

export interface ProviderSettingsSource {
  /** 연결된(등록된) provider. */
  connected(): Promise<SourceResult<readonly ProviderRow[]>>;
  /** 아직 연결하지 않은 정의. 사람이 보는 순서로 온다. */
  available(): Promise<SourceResult<readonly ProviderDefinitionRow[]>>;
  /**
   * 연결을 끊는다. provider와 연결(credential)을 함께 지운다. 화면이 Dialog로 사람에게 한 번 묻고 부르며,
   * 그 결정은 source가 결정 handle로 core에 싣는다.
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
