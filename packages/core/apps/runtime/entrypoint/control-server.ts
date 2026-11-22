// control socket의 앱 쪽 구현. supervisor만 이 socket을 부르므로 서명·Authorization 검사가 없다.
// sync 앱의 DB 일(변경 묶음 적용, snapshot 뜨기·합치기, 흔적 정리, held 다시 적용)의 요청 검증과 처리도 여기 있다.
// 모두 `exclusive` 문을 지나 write 호출의 session과 겹치지 않는다.
import process from "node:process";
import type { LophnError } from "../../../../base/errors.ts";
import { handleApply } from "./apply.ts";
import { decodeChangeset, encodeChangeset } from "./cap-host.ts";
import { handleControl } from "./control.ts";
import { type HttpHandler, jsonResponse, serveUnix } from "./http.ts";
import { fail, handleCall, type InvokeResult } from "./invoke.ts";
import {
  APPLY_BODY_MAX_BYTES,
  CONTROL_PATHS,
  MERGE_EFFECTIVE_MAX_BYTES,
  PROCESS_PATHS,
  SYNC_APPLY_MAX_BYTES,
  SYNC_APPLY_MAX_CHANGES,
} from "./limits.ts";
import type { RuntimeState } from "./state.ts";
import {
  applyAsLocalWrite,
  applyRemoteChanges,
  releaseLocalChange,
  cleanupTombstones,
  mergeSnapshotFile,
  type SyncStore,
  writeFolderSnapshot,
  writeSnapshot,
} from "./sync.ts";
import { BASE64, exact, record } from "./wire-check.ts";

const STATUS: Record<string, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
};

function failWith(error: LophnError): InvokeResult {
  return fail(STATUS[error.code] ?? 500, error.code, error.message);
}

function readBody(raw: Uint8Array): unknown {
  if (raw.byteLength > APPLY_BODY_MAX_BYTES) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return undefined;
  }
}

// processWire의 hlcSchema와 같다: 63 bit 정수의 십진 문자열.
function hlcOf(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    return;
  }
  const hlc = BigInt(value);
  return hlc < BigInt(2) ** BigInt(63) ? hlc : undefined;
}

function bytesOf(value: unknown): Uint8Array | undefined {
  return typeof value === "string" && BASE64.test(value)
    ? decodeChangeset(value)
    : undefined;
}

// processSyncApplyRequestSchema와 같고, changeset 합의 상한을 더 본다.
function parseSyncApply(
  value: unknown,
): { hlc: bigint; changeset: Uint8Array }[] | undefined {
  const source = record(value);
  if (!source || exact(source, ["changes"])) return;
  const list = source.changes;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.length > SYNC_APPLY_MAX_CHANGES
  ) {
    return;
  }
  const changes: { hlc: bigint; changeset: Uint8Array }[] = [];
  let size = 0;
  for (const item of list) {
    const change = record(item);
    if (!change || exact(change, ["hlc", "changeset"])) return;
    const hlc = hlcOf(change.hlc);
    const changeset = bytesOf(change.changeset);
    if (hlc === undefined || changeset === undefined) return;
    size += changeset.byteLength;
    changes.push({ hlc, changeset });
  }
  return size > SYNC_APPLY_MAX_BYTES ? undefined : changes;
}

// processSnapshotMergeRequestSchema와 같다.
function parseSnapshotMerge(value: unknown):
  | {
      path: string;
      destination: string;
      absentDeletes?: {
        below: bigint;
        keep: { table: string; pk: Uint8Array }[];
      };
    }
  | undefined {
  const source = record(value);
  if (
    !source ||
    exact(
      source,
      ["path", "destination", "absent_deletes"],
      ["path", "destination"],
    ) ||
    typeof source.path !== "string" ||
    source.path === "" ||
    typeof source.destination !== "string" ||
    source.destination === ""
  ) {
    return;
  }
  const base = { path: source.path, destination: source.destination };
  if (source.absent_deletes === undefined) return base;
  const absent = record(source.absent_deletes);
  if (!absent || exact(absent, ["below", "keep"])) return;
  const below = hlcOf(absent.below);
  if (below === undefined || !Array.isArray(absent.keep)) return;
  const keep: { table: string; pk: Uint8Array }[] = [];
  for (const item of absent.keep) {
    const row = record(item);
    if (!row || exact(row, ["table", "pk"])) return;
    const pk = bytesOf(row.pk);
    if (typeof row.table !== "string" || row.table === "" || !pk) return;
    keep.push({ table: row.table, pk });
  }
  return { ...base, absentDeletes: { below, keep } };
}

// sync 앱이 아니면 not_sync로 답하고, 맞으면 요청을 읽어 문 안에서 돈다.
async function syncControl<T>(
  state: RuntimeState,
  raw: Uint8Array,
  parse: (value: unknown) => T | undefined,
  work: (sync: SyncStore, request: T) => InvokeResult,
): Promise<InvokeResult> {
  if (!state.ready) return fail(503, "unavailable", "process is not ready");
  const request = parse(readBody(raw));
  if (request === undefined) {
    return fail(400, "invalid_input", "sync request is invalid");
  }
  const sync = state.sync;
  if (sync === null) return { status: 200, body: { status: "not_sync" } };
  return state.exclusive(() => Promise.resolve(work(sync, request)));
}

// 폰이나 다른 기계에서 온 변경 묶음을 한 transaction으로 적용한다(`apps.sync_apply`).
export function handleSyncApply(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  return syncControl(state, raw, parseSyncApply, (sync, changes) => {
    const applied = applyRemoteChanges(sync, changes);
    if (!applied.ok) return failWith(applied.error);
    const results = applied.value.map((result) => {
      if (result.status === "skipped") {
        // 건너뛴 변경은 앱 problem으로 남는다. 받은 변경은 아직 invocation이 없다.
        try {
          state.reportCaught?.(
            new Error(`a synced change was skipped: ${result.message}`),
            null,
          );
        } catch {
          // 보고 실패가 응답을 바꾸지 않는다.
        }
        return result;
      }
      return result.status === "held"
        ? result
        : { status: "applied", effective: encodeChangeset(result.effective) };
    });
    return { status: 200, body: { status: "applied", results } };
  });
}

// 폰이 받을 DB 사본이나 폴더의 한 destination으로 갈 사본(그리 보내는 표만)을 core가 준 path에 쓴다(`apps.snapshot`). core가 write 줄을 쥔 채
// 부른다.
export function handleSnapshot(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  return syncControl(
    state,
    raw,
    (value) => {
      const source = record(value);
      if (
        !source ||
        exact(source, ["path", "for", "destination"], ["path", "for"])
      )
        return;
      if (typeof source.path !== "string" || source.path === "") return;
      if (source.for === "phone" && source.destination === undefined) {
        return { path: source.path, destination: null };
      }
      return source.for === "folder" &&
        typeof source.destination === "string" &&
        source.destination !== ""
        ? { path: source.path, destination: source.destination }
        : undefined;
    },
    (sync, request) => {
      const written =
        request.destination === null
          ? writeSnapshot(sync.db, request.path)
          : writeFolderSnapshot(sync, request.path, request.destination);
      if (!written.ok) return failWith(written.error);
      return { status: 200, body: { status: "written", ...written.value } };
    },
  );
}

// 다른 기계의 snapshot file을 합친다(`apps.snapshot_merge`). core가 write 줄을 쥔 채 부른다.
export function handleSnapshotMerge(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  return syncControl(state, raw, parseSnapshotMerge, (sync, request) => {
    const merged = mergeSnapshotFile(sync, request);
    if (!merged.ok) return failWith(merged.error);
    const { effective, deleted, held } = merged.value;
    const fits =
      effective === null || effective.byteLength <= MERGE_EFFECTIVE_MAX_BYTES;
    return {
      status: 200,
      body: {
        status: "merged",
        effective: fits ? encodeChangeset(effective) : null,
        ...(fits ? {} : { effective_dropped: "too_large" }),
        deleted,
        held: held.map((row) => ({
          hlc: String(row.hlc),
          changeset: encodeChangeset(row.changeset),
        })),
      },
    };
  });
}

// core가 정한 clock보다 옛 흔적을 지운다(`apps.sync_cleanup`).
export function handleSyncCleanup(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  return syncControl(
    state,
    raw,
    (value) => {
      const source = record(value);
      if (!source || exact(source, ["before"])) return;
      return hlcOf(source.before);
    },
    (sync, before) => {
      const cleaned = cleanupTombstones(sync, before);
      return {
        status: 200,
        body: {
          status: "cleaned",
          dropped: cleaned.dropped,
          horizon: cleaned.horizon === null ? null : String(cleaned.horizon),
          max_hlc: String(cleaned.maxHlc),
        },
      };
    },
  );
}

// held 변경을 이 기계의 새 write로 다시 적용한다(`apps.sync_reapply`). 지금 data와 부딪으면 하나도 적용하지 않는다.
// `release`면 이 기계가 낸 변경이라 다시 적용하지 않고 지금 값을 새 clock으로 찍어 내보낼 changeset을 돌려준다.
export function handleSyncReapply(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  return syncControl(
    state,
    raw,
    (value) => {
      const source = record(value);
      if (!source || exact(source, ["changeset", "release"], ["changeset"])) {
        return;
      }
      if (source.release !== undefined && source.release !== true) return;
      const changeset = bytesOf(source.changeset);
      return changeset && { changeset, release: source.release === true };
    },
    (sync, { changeset, release }) => {
      if (release) {
        const released = releaseLocalChange(sync, changeset);
        if (!released.ok) {
          return released.error.code === "conflict"
            ? {
                status: 200,
                body: { status: "conflict", message: released.error.message },
              }
            : failWith(released.error);
        }
        return {
          status: 200,
          body: {
            status: "applied",
            effective: encodeChangeset(released.value.changeset),
            hlc:
              released.value.hlc === null ? null : String(released.value.hlc),
          },
        };
      }
      const applied = applyAsLocalWrite(sync, () =>
        state.store.apply([changeset]),
      );
      return {
        status: 200,
        body: applied.ok
          ? {
              status: "applied",
              effective: encodeChangeset(applied.effective),
              hlc: applied.hlc === null ? null : String(applied.hlc),
            }
          : { status: "conflict", message: applied.message },
      };
    },
  );
}

// shutdown 요청을 받은 프로세스는 새 호출을 닫은 채 진행 중인 호출이 끝나는 대로 스스로 끝난다.
// 유예(grace_ms)가 지나도 끝나지 않은 호출은 기다리지 않는다. 그래도 끝나지 않으면 supervisor가
// 유예 뒤 강제 종료한다.
function exitWhenIdle(
  state: RuntimeState,
  graceMs: number,
  exit: (code: number) => void,
): void {
  const startedAt = Date.now();
  const tick = () => {
    if (state.running === 0 || Date.now() - startedAt >= graceMs) {
      exit(0);
      return;
    }
    setTimeout(tick, 25);
  };
  // 종료 요청의 응답이 먼저 나가도록 한 걸음 미룬다.
  setTimeout(tick, 50);
}

const CONTROLS: readonly string[] = Object.values(CONTROL_PATHS);

// 본문을 그대로 넘기는 경로. 나머지(CONTROL_PATHS)는 JSON으로 읽어 handleControl이 본다.
const BODY_HANDLERS = new Map<
  string,
  (state: RuntimeState, raw: Uint8Array) => Promise<InvokeResult>
>([
  [PROCESS_PATHS.call, handleCall],
  [PROCESS_PATHS.apply, handleApply],
  [PROCESS_PATHS.sync_apply, handleSyncApply],
  [PROCESS_PATHS.snapshot, handleSnapshot],
  [PROCESS_PATHS.snapshot_merge, handleSnapshotMerge],
  [PROCESS_PATHS.sync_cleanup, handleSyncCleanup],
  [PROCESS_PATHS.sync_reapply, handleSyncReapply],
]);

export function startControlServer(
  state: RuntimeState,
  options: { exit?: (code: number) => void } = {},
) {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let exiting = false;
  const handler: HttpHandler = async (request) => {
    const direct = BODY_HANDLERS.get(request.path);
    const known = direct !== undefined || CONTROLS.includes(request.path);
    if (!known) {
      return jsonResponse(404, {
        error: { code: "not_found", message: "unknown path" },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(400, {
        error: { code: "invalid_input", message: "control is POST" },
      });
    }
    if (direct !== undefined) {
      const result = await direct(state, request.body);
      return jsonResponse(result.status, result.body);
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(request.body));
    } catch {
      return jsonResponse(400, {
        error: { code: "invalid_input", message: "control body is not JSON" },
      });
    }
    const control = handleControl(state, request.path, body);
    if ("error" in control) {
      return jsonResponse(control.status, { error: control.error });
    }
    if (request.path === CONTROL_PATHS.shutdown && !exiting) {
      exiting = true;
      exitWhenIdle(state, (body as { grace_ms: number }).grace_ms, exit);
    }
    return jsonResponse(control.status, control.body);
  };
  return serveUnix(state.controlSocket, handler);
}
