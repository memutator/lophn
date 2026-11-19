// 제출: 보호 입력의 값을 UTF-8 byte로 만들어 core upload로 올린다. 이름 갈래는 `secrets/put`, 새 provider는
// `providers/connect-key`, agent의 secret 요청은 `input_request/answer_secret`이다. 결과는 고정 오류만 돌려준다. 값, core
// 오류 원문, OS 오류 원문은 log·오류·IPC 결과 어디에도 넣지 않는다.
import {
  SECRET_INPUT_MAX_BYTES,
  type SecretInputOpenReply,
  type SecretInputSubmitReply,
} from "../../ipc/secret-input.ts";
import {
  type ProviderConnectTarget,
  providerConnectTargetSchema,
} from "../../../protocol/lophn-agent/provider-inputs.ts";

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

/** core의 오류 code만 돌려준다. 값을 담을 수 있는 message는 버린다. */
async function uploadValue(
  core: SecretCore,
  resource: string,
  method: string,
  input: Record<string, unknown>,
  value: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const bytes = new TextEncoder().encode(value);
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > SECRET_INPUT_MAX_BYTES) {
      return { ok: false, code: "invalid_input" };
    }
    const uploaded = await core.upload(
      resource,
      method,
      { ...input, bytes: bytes.byteLength },
      bytes,
    );
    return uploaded.ok
      ? { ok: true }
      : { ok: false, code: uploaded.error.code };
  } catch {
    return { ok: false, code: "unavailable" };
  } finally {
    bytes.fill(0);
  }
}

function fixed(
  reply: { ok: true } | { ok: false; code: string },
): SecretInputSubmitReply {
  if (reply.ok) return reply;
  return {
    ok: false,
    code: reply.code === "invalid_input" ? "invalid_input" : "unavailable",
  };
}

function normalizeProviderKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  return trimmed;
}

export async function submitSecret(
  core: SecretCore,
  input: { name: string; value: string },
): Promise<SecretInputSubmitReply> {
  let value = input.value;
  if (input.name.startsWith("provider.")) {
    const normalized = normalizeProviderKey(value);
    if (normalized === null) return { ok: false, code: "invalid_input" };
    value = normalized;
  }
  return fixed(
    await uploadValue(core, "secrets", "put", { name: input.name }, value),
  );
}

/** agent의 secret 요청에 답한다. 새 provider 자리면 core가 이어서 잇는다. 저장하지 못하면 요청은 열린 채다. */
export async function answerSecret(
  core: SecretCore,
  target: { session: string; tool_call: string },
  value: string,
): Promise<SecretInputSubmitReply> {
  return fixed(
    await uploadValue(
      core,
      "input_request",
      "answer_secret",
      { session: target.session, tool_call: target.tool_call },
      value,
    ),
  );
}

export type ProviderKeyFailure = Extract<
  SecretInputOpenReply,
  { ok: false }
>["code"];

/**
 * 새 provider를 key로 잇는다. 대상은 renderer가 보낸 것이라 protocol schema로 다시 본다. 실패는 다시 넣어 고칠 수 있는
 * 것이 아니라(정의, 주소, 이미 이어짐) 창을 닫고 연 화면에 돌려줄 code다.
 */
export async function connectProviderKey(
  core: SecretCore,
  target: ProviderConnectTarget,
  value: string,
): Promise<{ ok: true } | { ok: false; code: ProviderKeyFailure }> {
  const checked = providerConnectTargetSchema.safeParse(target);
  if (!checked.success) return { ok: false, code: "invalid_input" };
  const normalized = normalizeProviderKey(value);
  if (normalized === null) return { ok: false, code: "invalid_input" };
  const reply = await uploadValue(
    core,
    "providers",
    "connect-key",
    { target: checked.data },
    normalized,
  );
  if (reply.ok) return reply;
  return {
    ok: false,
    code:
      reply.code === "invalid_input" ||
      reply.code === "forbidden" ||
      reply.code === "conflict"
        ? reply.code
        : "unavailable",
  };
}
