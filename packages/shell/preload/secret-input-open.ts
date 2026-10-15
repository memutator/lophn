import {
  SECRET_INPUT_OPEN_CHANNEL,
  type SecretInputOpen,
  type SecretInputOpenApi,
  type SecretInputOpenReply,
} from "../ipc/secret-input.ts";

export interface SecretInputOpenTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

/**
 * 일반 shell 창의 보호 입력 창 열기. 창을 열 뿐 값을 보내지 못한다. 부모 창은 main이 IPC를
 * 보낸 창으로 정하고 입력 모양도 main이 검사한다. 통로 실패는 고정 오류로 바꾼다.
 */
export function createSecretInputOpener(
  transport: SecretInputOpenTransport,
): SecretInputOpenApi["open"] {
  return async (input: SecretInputOpen) => {
    try {
      return await transport.invoke(
        SECRET_INPUT_OPEN_CHANNEL,
        input,
      ) as SecretInputOpenReply;
    } catch {
      return { ok: false, code: "unavailable" };
    }
  };
}
