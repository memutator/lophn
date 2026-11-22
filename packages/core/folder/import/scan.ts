// 다른 기계의 기록(`record.json`, `apps/*/app.json`)을 읽어 `folder_records`에 destination마다 사본으로 둔다(앱 기록은
// destination마다 그 destination의 data stream을 싣는다).
// 한 출처 기계의 기록이 모두 읽혀야 그 기계의 행을 한 transaction에서 바꾼다. 읽기에 실패하거나 `newer_format`이면 옛
// 행을 그대로 두고 그 기계의 오류로 남긴다. 폴더에서 기계나 file이 사라져도("아직 안 옴") 행을 지우지 않는다.
// 꼴 판이 범위 밖인 기계(compat.ts)는 기계 기록만 사본으로 두고(누가 올려야 하는지 보인다) 앱 기록은 읽지 않으며
// `newer_format` 오류로 남긴다.
import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AppRecord,
  appRecordPath,
  appRecordSchema,
  decodeRecord,
  type FolderError,
  type MachineRecord,
  machineDir,
  machineRecordSchema,
  RECORD_MAX_BYTES,
  recordPath,
} from "../../../protocol/folder/mod.ts";
import { createFolderReader, type FolderReader } from "../fs.ts";
import { exchangeError, exchangeWith } from "./compat.ts";
import { type FolderImportDeps, folderError } from "./deps.ts";

export type ScanOutcome = {
  /** 기록이 바뀐(더 큰 revision을 읽은) 출처 기계. */
  updated: Id<"mch">[];
  /** 기록을 읽지 못해 옛 사본을 그대로 둔 출처 기계와 읽지 못한 destination. */
  errors: {
    machine: Id<"mch"> | null;
    destination: string;
    error: FolderError;
  }[];
};

type Found<R> = { record: R; destination: string };

// destination마다 읽은 것. 앱 기록의 key는 `<앱>\0<destination>`이다.
type Gathered = {
  machines: Found<MachineRecord>[];
  apps: Map<string, Found<AppRecord>>;
  error: { destination: string; error: FolderError } | null;
};

type ReadOne<R> =
  | { kind: "found"; record: R }
  | { kind: "absent" }
  | { kind: "failed"; error: FolderError };

async function readRecord<R>(
  deps: Pick<FolderImportDeps, "clock">,
  reader: FolderReader,
  rel: string,
  decode: (
    bytes: Uint8Array,
  ) => Result<R, { code: FolderError["code"]; message: string }>,
): Promise<ReadOne<R>> {
  const read = await reader.read(rel, RECORD_MAX_BYTES);
  if (!read.ok) {
    if (read.error.code === "not_found") return { kind: "absent" };
    return {
      kind: "failed",
      error: folderError(
        deps.clock,
        read.error.code === "too_large" ? "too_large" : "invalid_file",
        `${rel}: ${read.error.message}`,
      ),
    };
  }
  const decoded = decode(read.value);
  if (!decoded.ok) {
    return {
      kind: "failed",
      error: folderError(
        deps.clock,
        decoded.error.code,
        `${rel}: ${decoded.error.message}`,
      ),
    };
  }
  return { kind: "found", record: decoded.value };
}

// 한 destination에서 한 기계의 기록. 기계 기록이 아직 없으면 그 destination에서는 그 기계를 보지 않는다.
async function readMachine(
  deps: Pick<FolderImportDeps, "clock">,
  reader: FolderReader,
  origin: Id<"mch">,
): Promise<
  | { kind: "absent" }
  | { kind: "failed"; error: FolderError }
  | { kind: "found"; machine: MachineRecord; apps: AppRecord[] }
> {
  const machine = await readRecord(deps, reader, recordPath(origin), (bytes) =>
    decodeRecord(machineRecordSchema, bytes),
  );
  if (machine.kind !== "found") return machine;
  if (machine.record.machine !== origin) {
    return {
      kind: "failed",
      error: folderError(
        deps.clock,
        "invalid_file",
        `${recordPath(origin)}: machine does not match its folder`,
      ),
    };
  }
  // 범위 밖이면 앱 기록을 읽지 않는다. 막을지는 destination마다가 아니라 가장 큰 revision의 기록으로 정한다.
  if (exchangeWith(machine.record.lophn.folder) !== "ok") {
    return { kind: "found", machine: machine.record, apps: [] };
  }
  const names = await reader.list(`${machineDir(origin)}/apps`);
  if (!names.ok) {
    return {
      kind: "failed",
      error: folderError(
        deps.clock,
        "invalid_file",
        `${machineDir(origin)}/apps: ${names.error.message}`,
      ),
    };
  }
  const apps: AppRecord[] = [];
  for (const name of names.value as Id<"app">[]) {
    const rel = appRecordPath(origin, name);
    const app = await readRecord(deps, reader, rel, (bytes) =>
      decodeRecord(appRecordSchema, bytes),
    );
    if (app.kind === "failed") return app;
    if (app.kind === "absent") continue;
    if (app.record.machine !== origin || app.record.app !== name) {
      return {
        kind: "failed",
        error: folderError(
          deps.clock,
          "invalid_file",
          `${rel}: machine or app does not match its folder`,
        ),
      };
    }
    apps.push(app.record);
  }
  return { kind: "found", machine: machine.record, apps };
}

export async function scan(
  deps: FolderImportDeps,
): Promise<Result<ScanOutcome>> {
  const me = deps.machine();
  const outcome: ScanOutcome = { updated: [], errors: [] };
  const gathered = new Map<Id<"mch">, Gathered>();
  for (const destination of deps.destinations.list()) {
    if (destination.state === "missing") continue;
    const reader = createFolderReader(destination.path);
    const machines = await reader.listMachines();
    if (!machines.ok) {
      outcome.errors.push({
        machine: null,
        destination: destination.name,
        error: folderError(
          deps.clock,
          "destination_missing",
          machines.error.message,
        ),
      });
      continue;
    }
    for (const origin of machines.value) {
      if (origin === me) continue;
      const read = await readMachine(deps, reader, origin);
      if (read.kind === "absent") continue;
      const into: Gathered = gathered.get(origin) ?? {
        machines: [],
        apps: new Map(),
        error: null,
      };
      gathered.set(origin, into);
      if (read.kind === "failed") {
        into.error ??= { destination: destination.name, error: read.error };
        continue;
      }
      into.machines.push({
        record: read.machine,
        destination: destination.name,
      });
      for (const app of read.apps) {
        into.apps.set(`${app.app}\0${destination.name}`, {
          record: app,
          destination: destination.name,
        });
      }
    }
  }

  for (const [origin, found] of gathered) {
    if (found.error !== null) {
      outcome.errors.push({ machine: origin, ...found.error });
      continue;
    }
    // 막을지는 destination마다가 아니라 가장 큰 revision의 기계 기록으로 정한다.
    const largest = found.machines.reduce<Found<MachineRecord> | null>(
      (max, each) =>
        max === null || each.record.revision > max.record.revision ? each : max,
      null,
    );
    const exchange =
      largest === null ? "ok" : exchangeWith(largest.record.lophn.folder);
    if (exchange !== "ok") {
      // 옛 앱 기록 사본은 그대로 둔다.
      found.apps.clear();
      outcome.errors.push({
        machine: origin,
        destination: largest!.destination,
        error: exchangeError(
          deps.clock,
          origin,
          largest!.record.name,
          exchange,
        ),
      });
    }
    const at = deps.clock.now();
    const written = deps.transaction((tx) => {
      let changed = false;
      const put = (
        kind: "machine" | "app",
        key: string,
        value: Found<{ revision: number }>,
      ) => {
        const stored = tx.sql.get(
          `SELECT revision FROM folder_records
           WHERE machine = ? AND origin = ? AND kind = ? AND key = ? AND destination = ?`,
          [me, origin, kind, key, value.destination],
        );
        if (
          stored !== undefined &&
          Number(stored.revision) >= value.record.revision
        )
          return;
        tx.sql.run(
          `INSERT INTO folder_records (machine, origin, kind, key, revision, record, destination, read_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (machine, origin, kind, key, destination) DO UPDATE SET
             revision = excluded.revision, record = excluded.record, read_at = excluded.read_at`,
          [
            me,
            origin,
            kind,
            key,
            value.record.revision,
            JSON.stringify(value.record),
            value.destination,
            at,
          ],
        );
        changed = true;
      };
      for (const machine of found.machines) put("machine", "", machine);
      for (const value of found.apps.values()) {
        put("app", value.record.app, value);
      }
      // 사람이 목록에서 지운 기계가 다시 기록을 쓰면 알려진 기계로 돌아온다.
      if (changed) {
        tx.sql.run(
          `UPDATE folder_records SET forgotten_at = NULL WHERE machine = ? AND origin = ?`,
          [me, origin],
        );
      }
      return ok(changed);
    });
    if (!written.ok) return written;
    if (written.value) outcome.updated.push(origin);
  }
  return ok(outcome);
}
