// 제출: 보호 입력의 값을 UTF-8 byte로 만들어 core `secrets/put` upload로 올린다. 값이 있는 곳은
// 이 제출 동안의 main 메모리와 upload 본문뿐이고, 끝나면 byte를 0으로 덮는다. 결과는 고정 오류만
// 돌려준다. 값, core 오류 원문, OS 오류 원문은 log·오류·IPC 결과 어디에도 넣지 않는다.
import {
  SECRET_INPUT_MAX_BYTES,
  type SecretInputSubmitReply,
} from "../../ipc/secret-input.ts";

/** desktop/core CoreSession 중 upload만 쓴다. */
export interface SecretCore {
  upload(
    resource: string,
    method: string,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<
    { ok: true; value: unknown } | { ok: false; error: { code: string } }
  >;
}

export async function submitSecret(
  core: SecretCore,
  input: { name: string; value: string },
): Promise<SecretInputSubmitReply> {
  const bytes = new TextEncoder().encode(input.value);
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > SECRET_INPUT_MAX_BYTES) {
      return { ok: false, code: "invalid_input" };
    }
    const uploaded = await core.upload(
      "secrets",
      "put",
      {
        name: input.name,
        bytes: bytes.byteLength,
      },
      bytes,
    );
    if (uploaded.ok) return { ok: true };
    return {
      ok: false,
      code:
        uploaded.error.code === "invalid_input"
          ? "invalid_input"
          : "unavailable",
    };
  } catch {
    return { ok: false, code: "unavailable" };
  } finally {
    bytes.fill(0);
  }
}
