// core가 앱 DB에 직접 하는 일: 뒤집은 changeset 적용(rewind). sync 앱의 DB 일은 control-server.ts에 있다.
// `exclusive` 문을 지나 write 호출의 session과 겹치지 않는다.
import { APPLY_BODY_MAX_BYTES } from "./limits.ts";
import { decodeChangeset, encodeChangeset } from "./cap-host.ts";
import { fail, type InvokeResult } from "./invoke.ts";
import { parseProcessApply } from "./wire.ts";
import type { RuntimeState } from "./state.ts";
import { applyAsLocalWrite } from "./sync.ts";

// core가 뒤집어 보낸 changeset을 한 transaction으로 적용한다. 하나라도 충돌하면 하나도 적용하지 않는다.
// sync 앱이면 실제로 바뀐 것(effective)과 그것에 찍은 새 clock을 같이 돌려준다.
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
  const changesets = apply.changesets.map(decodeChangeset);
  // 적용하는 동안 다른 호출은 없다(core가 접수를 닫았다). 늦게 온 write와 session이 겹치지 않게 문도 지난다.
  const sync = state.sync;
  if (sync === null) {
    const outcome = await state.exclusive(() =>
      Promise.resolve(state.store.apply(changesets)),
    );
    return {
      status: 200,
      body: outcome.ok
        ? { status: "applied", count: changesets.length }
        : { status: "conflict", message: outcome.message },
    };
  }
  const outcome = await state.exclusive(() =>
    Promise.resolve(
      applyAsLocalWrite(sync, () => state.store.apply(changesets)),
    ),
  );
  if (!outcome.ok) {
    return {
      status: 200,
      body: { status: "conflict", message: outcome.message },
    };
  }
  return {
    status: 200,
    body: {
      status: "applied",
      count: changesets.length,
      effective: encodeChangeset(outcome.effective),
      ...(outcome.hlc === null ? {} : { hlc: String(outcome.hlc) }),
    },
  };
}
