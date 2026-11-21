// 검사를 마친 file 하나를 `FolderApply`로 적용하는 길. stream(폴더에서 바로)과 drain(held 사본)이 같이 쓴다.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { filterChangeset } from "../../../base/mod.ts";
import { clockAhead, maxHlc } from "../../../protocol/apps/sync/mod.ts";
import { nodeSyncDb } from "../../../protocol/apps/sync/node-db.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  CLOCK_AHEAD_MAX_MS,
  type ContainerHead,
  type ContainerHeader,
  changesOf,
  type FolderError,
  type FolderFileError,
} from "../../../protocol/folder/mod.ts";
import type { FolderReader } from "../fs.ts";
import { type FolderImportDeps, folderError, hex16 } from "./deps.ts";
import { copyVerified, IMPORT_TMP_DIR } from "./held.ts";

export type Counts = {
  applied: number;
  skipped: number;
  duplicate: number;
  held: number;
};
export type Invalid = { kind: "invalid"; error: FolderError };
export type Stop = {
  kind: "stop";
  error: FolderError | null;
  backoff: boolean;
};

export type ApplyTarget = {
  app: Id<"app">;
  release: { id: Id<"rel">; code_commit: string; data_schema: number };
  origin: Id<"mch">;
  originName: string;
};

export const fileInvalid = (
  deps: FolderImportDeps,
  rel: string,
  error: FolderFileError,
): Invalid => ({
  kind: "invalid",
  error: folderError(deps.clock, error.code, `${rel}: ${error.message}`),
});

export function applyError(
  deps: FolderImportDeps,
  error: { code: string; message: string },
): Stop {
  switch (error.code) {
    // 사이에 활성 release가 바뀌었다. 다음 번에 새 release로 다시 본다.
    case "conflict":
      return { kind: "stop", error: null, backoff: false };
    case "unavailable":
      return {
        kind: "stop",
        error: folderError(deps.clock, "app_not_running", error.message),
        backoff: true,
      };
    default:
      return {
        kind: "stop",
        error: folderError(deps.clock, "apply_failed", error.message),
        backoff: true,
      };
  }
}

// clock이 받는 쪽 시각보다 5분 넘게 앞섰으면 미루는 멈춤. 물러나지 않고 다음 계기에 다시 본다.
function clockAheadStop(
  deps: FolderImportDeps,
  target: ApplyTarget,
  newest: bigint,
): Stop | null {
  const ahead = clockAhead(newest, deps.clock.nowMs(), CLOCK_AHEAD_MAX_MS);
  if (ahead === 0) return null;
  return {
    kind: "stop",
    error: folderError(
      deps.clock,
      "clock_ahead",
      `The clock of ${target.originName} is ${Math.round(ahead / 60_000)} minutes ahead`,
      {
        machine: target.origin,
        machine_name: target.originName,
        ahead_ms: Math.round(ahead),
      },
    ),
    backoff: false,
  };
}

// snapshot의 가장 큰 clock(숨은 state 표의 hlc). 합치기가 이 값을 받는 쪽 clock으로 받으므로 앞선 시계의 snapshot은
// 합치기 전에 미룬다. 읽지 못하는 file은 0이다: 합치기가 그 file의 오류를 낸다.
function snapshotClock(path: string): bigint {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    return maxHlc(nodeSyncDb(db));
  } catch {
    return 0n;
  } finally {
    db?.close();
  }
}

/** changes file 하나 = 앱 DB transaction 하나. clock이 5분 넘게 앞선 file은 적용하지 않고 미룬다. */
export async function applyChangesFile(
  deps: FolderImportDeps,
  target: ApplyTarget,
  header: ContainerHeader,
  payload: Uint8Array,
): Promise<{ kind: "applied"; counts: Counts } | Stop> {
  const changes = changesOf(header, payload);
  let newest = 0n;
  for (const { meta } of changes) {
    if (BigInt(meta.hlc) > newest) newest = BigInt(meta.hlc);
  }
  const ahead = clockAheadStop(deps, target, newest);
  if (ahead !== null) return ahead;
  // 이 기계 선언이 보내지 않는 표의 구간은 버린다. 그 표의 row는 이 기계에만 있는 data라 다른 기계의 값으로 덮으면 잃는다.
  const sent = deps.apps().find((app) => app.app === target.app)?.sent ?? null;
  const kept = (bytes: Uint8Array): Uint8Array => {
    if (sent === null) return bytes;
    const filtered = filterChangeset(bytes, sent);
    return filtered.ok ? filtered.value : bytes;
  };
  const applied = await deps.apply.applyChanges({
    app: target.app,
    release: target.release.id,
    origin: target.origin,
    changes: changes.map(({ meta, bytes }) => ({
      id: meta.id,
      hlc: meta.hlc,
      operation: meta.operation,
      started_at: meta.started_at,
      changeset: kept(bytes),
    })),
  });
  if (!applied.ok) return applyError(deps, applied.error);
  return { kind: "applied", counts: applied.value };
}

export type AbsentDeletes = {
  below: string;
  keep: readonly { table: string; pk: string }[];
};

/**
 * snapshot의 payload만 data root 아래 임시 file로 풀며 hash를 다시 보고 합친다. 임시 file은 남기지 않는다. `rel`은
 * `reader` 안의 path다(폴더의 file이나 data root의 held 사본). clock이 5분 넘게 앞선 snapshot은 합치지 않고 미룬다.
 */
export async function mergeFile(
  deps: FolderImportDeps,
  target: ApplyTarget,
  n: number,
  reader: FolderReader,
  rel: string,
  head: ContainerHead,
  absentDeletes?: AbsentDeletes,
): Promise<
  Invalid | Stop | { kind: "gone" } | { kind: "merged"; bytes: number }
> {
  const temp = join(
    deps.root,
    IMPORT_TMP_DIR,
    target.app,
    `${hex16(deps.random)}.sqlite`,
  );
  try {
    const copied = await copyVerified(
      reader,
      rel,
      head,
      head.payloadOffset,
      temp,
      deps.random,
    );
    if (!copied.ok) {
      return copied.error.code === "unreadable"
        ? { kind: "gone" }
        : fileInvalid(deps, rel, copied.error as FolderFileError);
    }
    const ahead = clockAheadStop(deps, target, snapshotClock(temp));
    if (ahead !== null) return ahead;
    const merged = await deps.apply.mergeSnapshot({
      app: target.app,
      release: target.release.id,
      origin: target.origin,
      n,
      path: temp,
      ...(absentDeletes === undefined ? {} : { absentDeletes }),
    });
    if (!merged.ok) return applyError(deps, merged.error);
    return { kind: "merged", bytes: head.payloadOffset + copied.value.size };
  } finally {
    await rm(temp, { force: true });
  }
}
