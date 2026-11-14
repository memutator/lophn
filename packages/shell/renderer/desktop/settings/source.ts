// settings 화면의 선언한 설정을 쓰는 통로와 화면이 같이 쓰는 모양. 쓰기 route 이름은 core-source.ts만 안다.
// 모양은 protocol(settings)에서 이 화면이 쓰는 field만 옮긴 것이다. Providers와 Agents 자리는 각자의 통로(providers/settings-source.ts,
// agents/settings-source.ts)를 쓴다. 이 파일의 provider 연결 모양은 Providers 통로가 같이 쓴다.
// secret 값은 이 통로에 없다. credential은 보호 창이 받고 그 창을 여는 일은 각자의 통로가 한다.
import type { SourceResult } from "../../source-result.ts";

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

/** 선언한 설정 하나. type은 core가 선언의 zod type에서 만든 JSON Schema다. */
export interface SettingEntry {
  readonly key: string;
  readonly type: Readonly<Record<string, unknown>>;
  /** 선언에 기본값이 있는지. 없으면 사람이 골라야 하는 필수 설정이다. */
  readonly hasDefault: boolean;
  readonly defaultValue: unknown;
  /** 사람이 정한 값이 파일에 있는지. 없으면 기본값을 따른다. */
  readonly hasChosen: boolean;
  readonly chosen: unknown;
}

export type SettingRejectReason =
  | "unknown_key"
  | "wrong_type"
  | "out_of_range"
  | "invalid_value";

interface SettingRejection {
  readonly key: string;
  readonly reason: SettingRejectReason;
}

/** 값을 정하거나(set) 정한 값을 지워 기본값으로 돌린다(unset). */
export type SettingChange =
  | { readonly key: string; readonly action: "set"; readonly value: unknown }
  | { readonly key: string; readonly action: "unset" };

/** rejected가 비어 있지 않으면 아무것도 저장하지 않은 것이다. */
export interface SettingsUpdateResult {
  readonly changed: readonly string[];
  readonly rejected: readonly SettingRejection[];
}

export type ServerAuth = "none" | "bearer" | "api_key" | "oauth2";

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

/** 선언한 설정을 바꾸는 통로. 읽기는 화면이 `settings/list`를 useCoreRead로 한다. */
export interface SettingsSource {
  /** 설정을 바꾼다. 틀린 값은 오류가 아니라 rejected에 이유와 함께 온다. */
  update(
    changes: readonly SettingChange[],
  ): Promise<SourceResult<SettingsUpdateResult>>;
}
