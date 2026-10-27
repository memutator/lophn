// core가 뒤집어 보낸 changeset을 한 transaction으로 적용한다. 하나라도 충돌하면 하나도 적용하지 않는다.
import { APPLY_BODY_MAX_BYTES } from "./limits.ts";
import { decodeChangeset } from "./cap-host.ts";
import { fail, type InvokeResult } from "./invoke.ts";
import { parseProcessApply } from "./wire.ts";
import type { RuntimeState } from "./state.ts";

export async function handleApply(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  if (!state.ready) return fail(503, "unavailable", "process is not ready");
  if (raw.byteLength > APPLY_BODY_MAX_BYTES) {
    return fail(400, "invalid_input", "apply body is too large");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail(400, "invalid_input", "apply body is not JSON");
  }
  const apply = parseProcessApply(json);
  if (!apply) return fail(400, "invalid_input", "apply request is invalid");
  // 적용하는 동안 다른 호출은 없다(core가 접수를 닫았다). 늦게 온 write와 session이 겹치지 않게 문도 지난다.
  const outcome = await state.exclusive(() =>
    Promise.resolve(state.store.apply(apply.changesets.map(decodeChangeset))),
  );
  return {
    status: 200,
    body: outcome.ok
      ? { status: "applied", count: apply.changesets.length }
      : { status: "conflict", message: outcome.message },
  };
}
