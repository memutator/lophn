// MCP·CLI가 같은 credential provider interface를 쓰는 자리(connection#R17).
// 입력은 connection 참조뿐이다. token 인자·env 참조·파일 입력은 interface에 없다.
// 실제 keychain loader가 이 interface를 채운다. 잠김·누락은 unavailable이고
// 평문 파일·user credential fallback은 없다(R9, R17).
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ConnectionId,
  connectionIdSchema,
  CREDENTIAL_DELIVERY_FAILURES,
  type CredentialDeliveryFailure,
  LOPHN_CONNECTION,
} from "../../../contracts/coding-agent/mod.ts";

export { LOPHN_CONNECTION };

// provider가 돌려주는 credential. token 원문은 process 메모리에만 있고
// 설정·파일·환경 변수·진단에 쓰지 않는다(R17).
export type ConnectionCredential = {
  token: string;
};

// connection 참조만 받는 provider interface. 계약에서 정한 실패 네 이유만
// 실패로 돌려준다. interface는 IO와 keychain을 모른다.
export type CredentialProvider = (
  connection: ConnectionId,
) => Promise<Result<ConnectionCredential, CredentialDeliveryFailure>>;

export function credentialProviderError(
  reason: CredentialDeliveryFailure,
): Result<never, CredentialDeliveryFailure> {
  // 네 이유 모두 unavailable 계열이다(connection-auth 계약이 code를 붙인다).
  return err(reason);
}

// provider 실패 네 이유가 계약의 실패 목록 그대로인지 검사한다.
export function isCredentialProviderFailure(
  value: string,
): value is CredentialDeliveryFailure {
  return (CREDENTIAL_DELIVERY_FAILURES as readonly string[]).includes(value);
}

// 인증 실패 뒤의 재연결 안내(R9). 새 token 발급·user credential 요청은 없다.
// 사람이 기존 연결을 회수하고 새 연결을 만드는 방식만 안내한다.
export function reconnectionGuidance(connection: ConnectionId): {
  message: string;
  commands: string[];
} {
  return {
    message:
      "연결 credential을 쓸 수 없다. 사람이 기존 연결을 회수하고 새 연결을 만들어야 한다.",
    commands: [`connection show ${connection}`],
  };
}

// connection 참조 입력을 검사한다. 참조 이외의 입력은 interface에 없다.
export function acceptConnectionRef(
  value: string | undefined,
): Result<ConnectionId> {
  if (value === undefined) {
    return err({ code: "invalid_input", message: "connection 참조가 없다" });
  }
  const parsed = connectionIdSchema.safeParse(value.trim());
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "connection 참조가 올바르지 않다",
    });
  }
  return ok(parsed.data);
}
