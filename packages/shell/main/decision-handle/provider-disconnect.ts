// provider 끊기. provider와 credential(secret)을 함께 지우므로 Settings › Providers 화면이 묻고, 사람이
// 확인하면 이 정본에 묶은 handle로 `DisconnectProvider`를 부른다. 값은 받지 않는다.
import {
  bindingOf,
  type DecisionCore,
  failed,
  type Read,
  readFailure,
  record,
} from "./core.ts";

export const PROVIDER_CONCERN = "lophn-agent/providers";
export const PROVIDER_DISCONNECT = "provider_disconnect";
/** core가 handle 사용을 비교하는 결정 이름(= command route 이름). */
const DISCONNECT_PROVIDER = "DisconnectProvider";

/** `DisconnectProvider`의 binding. */
const BINDING = ["provider"] as const;

export async function readProviderDisconnect(
  core: DecisionCore,
  request: { targets?: string[] },
): Promise<Read> {
  const provider = request.targets?.[0];
  if (provider === undefined || request.targets?.length !== 1) {
    return failed("invalid_input", "provider 하나를 가리켜야 한다");
  }
  const got = await core.internal("read", "providers", "read", { provider });
  if (!got.ok) return readFailure(got);
  if (record(record(got.value).provider).id !== provider) {
    return failed("not_found", "연결을 찾지 못했다");
  }
  const bound = bindingOf(BINDING, { provider });
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      allowed: [DISCONNECT_PROVIDER],
      expiresAt: null,
    },
  };
}
