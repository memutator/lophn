// (이 기계, 앱, 출처 기계)의 data stream을 번호 순서로 따라간다. file은 전부 검사한 뒤에만 적용하거나 held로 둔다:
// 깨지거나 반만 온 file에서는 아무것도 적용하지 않고 그 번호에서 기다린다. 다음 번호가 없거나 맞지 않을 때 그보다 큰
// 번호의 맞는 snapshot이 있으면 그것을 합치고 cursor를 그 번호로 둔다(주인이 compaction한 뒤에 온 기계).
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ok, type Result, sha256Hex } from "../../../base/mod.ts";
import { clockAhead } from "../../../protocol/apps/sync/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AppRecord,
  CHANGES_PAYLOAD_MAX_BYTES,
  CLOCK_AHEAD_MAX_MS,
  CONTAINER_HEAD_MAX_BYTES,
  type ContainerHead,
  type ContainerHeader,
  changesOf,
  type DataKind,
  dataDir,
  dataEntryPath,
  decodeContainer,
  type FolderError,
  type FolderFileError,
  parseDataEntry,
  RUN_MAX_BYTES,
  readContainerHead,
} from "../../../protocol/folder/mod.ts";
import type { FolderReader } from "../fs.ts";
import {
  backoffUntil,
  type FolderImportDeps,
  folderError,
  hex16,
  loadRead,
  type ReadRow,
  saveRead,
} from "./deps.ts";
import {
  copyVerified,
  heldFile,
  heldPath,
  IMPORT_TMP_DIR,
  recordHeld,
  writeAtomic,
} from "./held.ts";

export type StreamOutcome = {
  machine: Id<"mch">;
  cursor: number;
  /** 적용한 file 수와 held로 넘긴 file 수. */
  applied_files: number;
  held_files: number;
  /** 적용한 file 안의 변경 수(apply 쪽이 센 것). */
  changes: {
    applied: number;
    skipped: number;
    duplicate: number;
    held: number;
  };
  waiting_for: number | null;
  error: FolderError | null;
  /** 한 번의 양(64 MiB)을 채워 멈췄다. 곧 다시 부른다. */
  more: boolean;
};

export type StreamInput = {
  app: Id<"app">;
  release: { id: Id<"rel">; bundle_hash: string; data_schema: number };
  origin: Id<"mch">;
  originName: string;
  /** 출처의 그 앱 기록 사본. 없으면 `data.head`를 모른다(끝으로 본다). */
  record: AppRecord | null;
  reader: FolderReader;
  /** scan이 그 기계를 `newer_format`으로 봤다. */
  blocked: FolderError | null;
};

// 한 file을 다룬 결과. invalid는 그 file에서 아무것도 적용하지 않았다는 뜻이다.
type Counts = {
  applied: number;
  skipped: number;
  duplicate: number;
  held: number;
};
type Invalid = { kind: "invalid"; error: FolderError };
type Stop = { kind: "stop"; error: FolderError | null; backoff: boolean };
type Step =
  | { kind: "done"; n: number; bytes: number; held: boolean; changes?: Counts }
  | Invalid
  | { kind: "gone" }
  | Stop;

export async function followStream(
  deps: FolderImportDeps,
  input: StreamInput,
): Promise<Result<StreamOutcome>> {
  const followed = await followFiles(deps, input);
  if (!followed.ok) return followed;
  const passed = await absentPass(deps, input);
  if (!passed.ok) return passed;
  const row = loadRead(deps.sql, deps.machine(), input.app, input.origin);
  return ok({ ...followed.value, error: row.error });
}

async function followFiles(
  deps: FolderImportDeps,
  input: StreamInput,
): Promise<Result<StreamOutcome>> {
  const me = deps.machine();
  const { app, origin, reader } = input;
  let row: ReadRow = loadRead(deps.sql, me, app, origin);
  const outcome: StreamOutcome = {
    machine: origin,
    cursor: row.cursor,
    applied_files: 0,
    held_files: 0,
    changes: { applied: 0, skipped: 0, duplicate: 0, held: 0 },
    waiting_for: row.waiting_for,
    error: row.error,
    more: false,
  };
  if (row.next_try_at !== null && row.next_try_at > deps.clock.now()) {
    return { ok: true, value: outcome };
  }
  const save = (next: ReadRow): Result<StreamOutcome> => {
    const saved = deps.transaction((tx) => {
      saveRead(tx.sql, me, app, origin, next);
      return { ok: true, value: undefined };
    });
    if (!saved.ok) return saved;
    row = next;
    outcome.cursor = next.cursor;
    outcome.waiting_for = next.waiting_for;
    outcome.error = next.error;
    return { ok: true, value: outcome };
  };
  const fail = (error: FolderError, backoff: boolean) =>
    save({
      ...row,
      waiting_for: null,
      error,
      attempts: backoff ? row.attempts + 1 : row.attempts,
      next_try_at: backoff
        ? backoffUntil(deps.clock.nowMs(), row.attempts)
        : null,
    });
  if (input.blocked !== null) return fail(input.blocked, false);

  const listed = await reader.list(dataDir(origin, app));
  if (!listed.ok) return { ok: true, value: outcome };
  const entries = new Map<number, DataKind[]>();
  for (const name of listed.value) {
    const entry = parseDataEntry(name)!;
    entries.set(entry.n, [...(entries.get(entry.n) ?? []), entry.kind]);
  }
  const snapshotsAbove = (n: number) =>
    [...entries]
      .filter(
        ([m, kinds]) => m > n && kinds.length === 1 && kinds[0] === "snapshot",
      )
      .map(([m]) => m)
      .sort((a, b) => b - a);

  // 가장 큰 맞는 snapshot부터. 맞지 않는 snapshot은 건너뛰고 다음으로 큰 것을 본다.
  const jumpToSnapshot = async (above: number): Promise<Step | null> => {
    for (const m of snapshotsAbove(above)) {
      const step = await processFile(deps, input, m, "snapshot");
      if (step.kind !== "invalid" && step.kind !== "gone") return step;
    }
    return null;
  };

  let budget = RUN_MAX_BYTES;
  for (;;) {
    if (budget <= 0) {
      outcome.more = true;
      return { ok: true, value: outcome };
    }
    const next = row.cursor + 1;
    const kinds = entries.get(next);
    let step: Step | null;
    if (kinds === undefined) {
      step = await jumpToSnapshot(row.cursor);
    } else {
      step =
        kinds.length === 1
          ? await processFile(deps, input, next, kinds[0]!)
          : {
              kind: "invalid",
              error: folderError(
                deps.clock,
                "invalid_file",
                `both a changes and a snapshot file have number ${next}`,
              ),
            };
      if (step.kind === "invalid" || step.kind === "gone") {
        const jumped = await jumpToSnapshot(next);
        if (jumped !== null) step = jumped;
      }
    }
    if (step === null || step.kind === "gone") {
      // 다음 번호가 아직 없다. 앱 기록의 head가 더 크면 기다리는 번호를 알린다.
      const head = input.record?.data.head ?? 0;
      const waiting_for = head > row.cursor ? row.cursor + 1 : null;
      if (waiting_for === row.waiting_for && row.error === null) {
        return { ok: true, value: outcome };
      }
      return save({
        ...row,
        waiting_for,
        error: null,
        attempts: 0,
        next_try_at: null,
      });
    }
    switch (step.kind) {
      case "invalid":
        return fail(step.error, true);
      case "stop":
        if (step.error === null) return { ok: true, value: outcome };
        return fail(step.error, step.backoff);
      case "done": {
        // cursor와 read 행(빚진 합치기 표지 포함)은 processFile이 같은 transaction에서 바꿨다.
        row = loadRead(deps.sql, me, app, origin);
        outcome.cursor = step.n;
        outcome.waiting_for = null;
        outcome.error = null;
        budget -= step.bytes;
        if (step.held) outcome.held_files += 1;
        else outcome.applied_files += 1;
        if (step.changes !== undefined) {
          outcome.changes.applied += step.changes.applied;
          outcome.changes.skipped += step.changes.skipped;
          outcome.changes.duplicate += step.changes.duplicate;
          outcome.changes.held += step.changes.held;
        }
        break;
      }
    }
  }
}

const fileInvalid = (
  deps: FolderImportDeps,
  rel: string,
  error: FolderFileError,
): Invalid => ({
  kind: "invalid",
  error: folderError(deps.clock, error.code, `${rel}: ${error.message}`),
});

async function processFile(
  deps: FolderImportDeps,
  input: StreamInput,
  n: number,
  kind: DataKind,
): Promise<Step> {
  return kind === "changes"
    ? processChanges(deps, input, n)
    : processSnapshot(deps, input, n);
}

// cursor를 n으로. 빚진 합치기 표지는 그대로 두고, `owesAbsentPass`면 없을 때 새로 단다.
function advance(
  deps: FolderImportDeps,
  input: StreamInput,
  n: number,
  header: ContainerHeader,
  owesAbsentPass = false,
): Result<void> {
  const me = deps.machine();
  return deps.transaction((tx) => {
    const current = loadRead(tx.sql, me, input.app, input.origin).absent;
    saveRead(tx.sql, me, input.app, input.origin, {
      absent: current ?? (owesAbsentPass ? { caught_up_at: null } : null),
      cursor: n,
      bundle_hash: header.release.bundle_hash,
      read_at: deps.clock.now(),
      attempts: 0,
      next_try_at: null,
      waiting_for: null,
      error: null,
    });
    return { ok: true, value: undefined };
  });
}

function applyError(
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

async function holdStep(
  deps: FolderImportDeps,
  input: StreamInput,
  n: number,
  header: ContainerHeader,
  file: { size: number; sha256: string },
): Promise<Step> {
  const held = recordHeld(deps, {
    app: input.app,
    origin: input.origin,
    n,
    kind: header.kind,
    bundle_hash: header.release.bundle_hash,
    data_schema: header.release.data_schema,
    sha256: file.sha256,
    size: file.size,
  });
  if (!held.ok) {
    return {
      kind: "stop",
      error: folderError(deps.clock, "apply_failed", held.error.message),
      backoff: true,
    };
  }
  return { kind: "done", n, bytes: file.size, held: true };
}

async function processChanges(
  deps: FolderImportDeps,
  input: StreamInput,
  n: number,
): Promise<Step> {
  const rel = dataEntryPath(input.origin, input.app, n, "changes");
  const read = await input.reader.read(
    rel,
    CONTAINER_HEAD_MAX_BYTES + CHANGES_PAYLOAD_MAX_BYTES,
  );
  if (!read.ok) {
    if (read.error.code === "not_found") return { kind: "gone" };
    return fileInvalid(deps, rel, {
      code: read.error.code === "too_large" ? "too_large" : "invalid_file",
      message: read.error.message,
    });
  }
  const decoded = await decodeContainer(read.value, rel);
  if (!decoded.ok) return fileInvalid(deps, rel, decoded.error);
  const { header, payload } = decoded.value;

  if (header.release.bundle_hash !== input.release.bundle_hash) {
    try {
      await writeAtomic(
        heldFile(deps.root, heldPath(input.app, input.origin, n, "changes")),
        read.value,
        deps.random,
      );
    } catch (thrown) {
      return {
        kind: "stop",
        error: folderError(
          deps.clock,
          "apply_failed",
          `could not keep ${rel}: ${String(thrown)}`,
        ),
        backoff: true,
      };
    }
    return holdStep(deps, input, n, header, {
      size: read.value.byteLength,
      sha256: await sha256Hex(read.value),
    });
  }

  const changes = changesOf(header, payload);
  let newest = 0n;
  for (const { meta } of changes) {
    if (BigInt(meta.hlc) > newest) newest = BigInt(meta.hlc);
  }
  const ahead = clockAhead(newest, deps.clock.nowMs(), CLOCK_AHEAD_MAX_MS);
  if (ahead > 0) {
    return {
      kind: "stop",
      error: folderError(
        deps.clock,
        "clock_ahead",
        `The clock of ${input.originName} is ${Math.round(ahead / 60_000)} minutes ahead`,
        {
          machine: input.origin,
          machine_name: input.originName,
          ahead_ms: Math.round(ahead),
        },
      ),
      backoff: false,
    };
  }
  const applied = await deps.apply.applyChanges({
    app: input.app,
    release: input.release.id,
    origin: input.origin,
    changes: changes.map(({ meta, bytes }) => ({
      id: meta.id,
      hlc: meta.hlc,
      operation: meta.operation,
      started_at: meta.started_at,
      changeset: bytes,
    })),
  });
  if (!applied.ok) return applyError(deps, applied.error);
  const advanced = advance(deps, input, n, header);
  if (!advanced.ok) {
    return {
      kind: "stop",
      error: folderError(deps.clock, "apply_failed", advanced.error.message),
      backoff: true,
    };
  }
  return {
    kind: "done",
    n,
    bytes: read.value.byteLength,
    held: false,
    changes: applied.value,
  };
}

async function processSnapshot(
  deps: FolderImportDeps,
  input: StreamInput,
  n: number,
): Promise<Step> {
  const rel = dataEntryPath(input.origin, input.app, n, "snapshot");
  const headRead = await input.reader.readHead(rel, CONTAINER_HEAD_MAX_BYTES);
  if (!headRead.ok) {
    if (headRead.error.code === "not_found") return { kind: "gone" };
    return fileInvalid(deps, rel, {
      code: "invalid_file",
      message: headRead.error.message,
    });
  }
  const head = await readContainerHead(headRead.value.bytes, rel);
  if (!head.ok) return fileInvalid(deps, rel, head.error);
  const { header } = head.value;

  if (header.release.bundle_hash !== input.release.bundle_hash) {
    const copied = await copyVerified(
      input.reader,
      rel,
      head.value,
      0,
      heldFile(deps.root, heldPath(input.app, input.origin, n, "snapshot")),
      deps.random,
    );
    if (!copied.ok) {
      return copied.error.code === "unreadable"
        ? { kind: "gone" }
        : fileInvalid(deps, rel, copied.error as FolderFileError);
    }
    return holdStep(deps, input, n, header, copied.value);
  }

  const merged = await mergeFile(deps, input, n, rel, head.value);
  if (merged.kind !== "merged") return merged;
  // horizon 밖에서 지우기 없이 합쳤다. 출처가 이 기계의 것을 다 받은 뒤의 snapshot으로 다시 합칠 빚을 남긴다.
  const owes =
    deps.exportState(input.app).away_since !== null &&
    (input.record?.horizon ?? null) !== null;
  const advanced = advance(deps, input, n, header, owes);
  if (!advanced.ok) {
    return {
      kind: "stop",
      error: folderError(deps.clock, "apply_failed", advanced.error.message),
      backoff: true,
    };
  }
  return { kind: "done", n, bytes: merged.bytes, held: false };
}

type AbsentDeletes = {
  below: string;
  keep: readonly { table: string; pk: string }[];
};

// payload만 data root 아래 임시 file로 풀며 hash를 다시 보고 합친다. 임시 file은 남기지 않는다.
async function mergeFile(
  deps: FolderImportDeps,
  input: StreamInput,
  n: number,
  rel: string,
  head: ContainerHead,
  absentDeletes?: AbsentDeletes,
): Promise<
  Exclude<Step, { kind: "done" }> | { kind: "merged"; bytes: number }
> {
  const temp = join(
    deps.root,
    IMPORT_TMP_DIR,
    input.app,
    `${hex16(deps.random)}.sqlite`,
  );
  try {
    const copied = await copyVerified(
      input.reader,
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
    const merged = await deps.apply.mergeSnapshot({
      app: input.app,
      release: input.release.id,
      origin: input.origin,
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

/**
 * 빚진 합치기. 출처의 앱 기록이 이 기계가 낸 것(`data_head`)을 다 받았다고 처음 보이면 그때의 `read[이 기계].at`을 적고,
 * cursor 안쪽에서 그 뒤에 만든 가장 큰 맞는 snapshot을 출처의 horizon 아래 "없는 row 지우기"와 함께 다시 합친다.
 * cursor는 움직이지 않고 변경을 다시 적용하지 않는다(합치기는 같은 것을 두 번 해도 같다). 그런 snapshot이 아직
 * 없으면 오류 없이 기다린다.
 */
async function absentPass(
  deps: FolderImportDeps,
  input: StreamInput,
): Promise<Result<void>> {
  const me = deps.machine();
  const { app, origin } = input;
  let row = loadRead(deps.sql, me, app, origin);
  if (row.absent === null || input.blocked !== null) return ok(undefined);
  if (row.next_try_at !== null && row.next_try_at > deps.clock.now()) {
    return ok(undefined);
  }
  const save = (next: ReadRow): Result<void> =>
    deps.transaction((tx) => {
      saveRead(tx.sql, me, app, origin, next);
      return ok(undefined);
    });
  if (row.absent.caught_up_at === null) {
    const read = input.record?.read[me];
    if (read === undefined || read.n < deps.exportState(app).data_head) {
      return ok(undefined);
    }
    row = { ...row, absent: { caught_up_at: read.at } };
    const saved = save(row);
    if (!saved.ok) return saved;
  }
  const caughtUpAt = row.absent!.caught_up_at!;
  const horizon = input.record?.horizon ?? null;
  if (horizon === null) return ok(undefined);
  const listed = await input.reader.list(dataDir(origin, app));
  if (!listed.ok) return ok(undefined);
  const snapshots = listed.value
    .map((name) => parseDataEntry(name)!)
    .filter((entry) => entry.kind === "snapshot" && entry.n <= row.cursor)
    .map((entry) => entry.n)
    .sort((a, b) => b - a);
  for (const n of snapshots) {
    const rel = dataEntryPath(origin, app, n, "snapshot");
    const headRead = await input.reader.readHead(rel, CONTAINER_HEAD_MAX_BYTES);
    if (!headRead.ok) continue;
    const head = await readContainerHead(headRead.value.bytes, rel);
    if (!head.ok) continue;
    // 번호가 작을수록 옛 snapshot이다. 출처가 다 받기 전에 만든 것의 "없음"은 "지워짐"이 아니다.
    if (head.value.header.created_at < caughtUpAt) break;
    if (head.value.header.release.bundle_hash !== input.release.bundle_hash) {
      continue;
    }
    const merged = await mergeFile(deps, input, n, rel, head.value, {
      below: horizon,
      keep: deps.heldRows(app),
    });
    if (merged.kind === "invalid" || merged.kind === "gone") continue;
    row = loadRead(deps.sql, me, app, origin);
    if (merged.kind === "merged") return save({ ...row, absent: null });
    if (merged.error === null) return ok(undefined);
    return save({
      ...row,
      error: merged.error,
      attempts: merged.backoff ? row.attempts + 1 : row.attempts,
      next_try_at: merged.backoff
        ? backoffUntil(deps.clock.nowMs(), row.attempts)
        : null,
    });
  }
  return ok(undefined);
}
