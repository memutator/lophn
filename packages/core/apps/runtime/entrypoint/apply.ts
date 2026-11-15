// core가 앱 DB에 직접 하는 일: 뒤집은 changeset 적용(rewind), 폰에서 온 변경 적용, snapshot 뜨기.
// 모두 `exclusive` 문을 지나 write 호출의 session과 겹치지 않는다.
import { APPLY_BODY_MAX_BYTES } from "./limits.ts";
import { decodeChangeset, encodeChangeset } from "./cap-host.ts";
import { fail, type InvokeResult } from "./invoke.ts";
import {
  parseProcessApply,
  parseProcessSnapshot,
  parseProcessSyncApply,
} from "./wire.ts";
import type { RuntimeState } from "./state.ts";
import { applyPhoneChange, syncedRewind, writeSnapshot } from "./sync.ts";

const STATUS: Record<string, number> = {
  invalid_input: 400,
  conflict: 409,
  unavailable: 503,
};

function readBody(raw: Uint8Array): unknown {
  if (raw.byteLength > APPLY_BODY_MAX_BYTES) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return undefined;
  }
}

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
    Promise.resolve(syncedRewind(sync, () => state.store.apply(changesets))),
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

// 폰에서 온 변경 하나를 칸 단위 last-write-wins로 적용한다(`apps.sync_apply`).
export async function handleSyncApply(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  if (!state.ready) return fail(503, "unavailable", "process is not ready");
  const request = parseProcessSyncApply(readBody(raw));
  if (!request) {
    return fail(400, "invalid_input", "sync apply request is invalid");
  }
  const sync = state.sync;
  if (sync === null) return { status: 200, body: { status: "not_sync" } };
  const { hlc, changeset } = request.change;
  const applied = await state.exclusive(() =>
    Promise.resolve(
      applyPhoneChange(sync, { hlc, changeset: decodeChangeset(changeset) }),
    ),
  );
  if (!applied.ok) {
    return fail(
      STATUS[applied.error.code] ?? 500,
      applied.error.code,
      applied.error.message,
    );
  }
  if (applied.value.status === "skipped") {
    // 건너뛴 변경은 앱 problem으로 남는다. 폰의 변경은 아직 invocation이 없다.
    try {
      state.reportCaught?.(
        new Error(`a phone change was skipped: ${applied.value.message}`),
        null,
      );
    } catch {
      // 보고 실패가 응답을 바꾸지 않는다.
    }
    return {
      status: 200,
      body: {
        status: "skipped",
        hlc: String(hlc),
        message: applied.value.message,
      },
    };
  }
  return {
    status: 200,
    body: {
      status: "applied",
      effective: encodeChangeset(applied.value.effective),
      hlc: String(hlc),
    },
  };
}

// 폰이 처음 받을 DB 사본을 core가 준 path에 쓴다(`apps.snapshot`). core가 write 줄을 쥔 채 부른다.
export async function handleSnapshot(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  if (!state.ready) return fail(503, "unavailable", "process is not ready");
  const request = parseProcessSnapshot(readBody(raw));
  if (!request)
    return fail(400, "invalid_input", "snapshot request is invalid");
  const sync = state.sync;
  if (sync === null) return { status: 200, body: { status: "not_sync" } };
  const written = await state.exclusive(() =>
    Promise.resolve(writeSnapshot(sync.db, request.path)),
  );
  if (!written.ok) {
    return fail(
      STATUS[written.error.code] ?? 500,
      written.error.code,
      written.error.message,
    );
  }
  return { status: 200, body: { status: "written", ...written.value } };
}
