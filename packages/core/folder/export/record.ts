// 기계 기록 `machines/<자기 id>/record.json`을 destination마다 쓴다. 내용이 바뀌었거나 처음일 때만 쓰고 revision을 올린다.
// 싣는 것은 schema의 칸뿐이다(id, 이름, always_on, 주소, 판, git project 목록). 공개 key, pairing code, binding, 자격, data root path는
// 칸이 없어 실리지 않는다.
import { canonicalize, ok, type Result } from "../../../base/mod.ts";
import {
  decodeRecord,
  encodeRecord,
  FOLDER_FORMAT,
  type MachineRecord,
  machineRecordSchema,
  RECORD_MAX_BYTES,
  recordPath,
} from "../../../protocol/folder/mod.ts";
import { createFolderReader, createFolderWriter } from "../fs.ts";
import type { FolderExportDeps } from "./mod.ts";
import { readStream, type StreamKey, updateStream } from "./status.ts";

const sameContent = (a: MachineRecord, b: MachineRecord) =>
  canonicalize({ ...a, revision: 0, updated_at: "" }) ===
  canonicalize({ ...b, revision: 0, updated_at: "" });

export async function publishRecords(
  deps: FolderExportDeps,
): Promise<Result<void>> {
  const me = deps.machine();
  const facts = deps.facts();
  const now = deps.clock.now();
  const content = (revision: number): MachineRecord =>
    machineRecordSchema.parse({
      format: FOLDER_FORMAT.version,
      machine: me.id,
      revision,
      updated_at: now,
      name: me.name,
      always_on: facts.alwaysOn,
      addresses: facts.addresses,
      lophn: {
        version: facts.lophn.version,
        protocol: facts.lophn.protocol,
        folder: {
          version: FOLDER_FORMAT.version,
          min_version: FOLDER_FORMAT.min_version,
        },
      },
      projects: facts.projects,
    });
  const rel = recordPath(me.id);
  let failed: Result<void> = ok(undefined);
  for (const destination of deps.destinations.list()) {
    if (destination.state !== "ok") continue;
    const key: StreamKey = {
      machine: me.id,
      app: "",
      destination: destination.name,
      stream: "record",
    };
    const row = readStream(deps.sql, key);
    const read = await createFolderReader(destination.path).read(
      rel,
      RECORD_MAX_BYTES,
    );
    const decoded = read.ok
      ? decodeRecord(machineRecordSchema, read.value)
      : null;
    const current = decoded?.ok ? decoded.value : null;
    if (
      row !== null &&
      current !== null &&
      current.revision === row.next_n - 1 &&
      sameContent(current, content(1))
    ) {
      continue;
    }
    const revision = Math.max(row?.next_n ?? 1, (current?.revision ?? 0) + 1);
    const written = await createFolderWriter({
      root: destination.path,
      machine: me.id,
      random: deps.random,
    }).writeFile(rel, encodeRecord(machineRecordSchema, content(revision)));
    if (!written.ok) {
      if (failed.ok) failed = written;
      continue;
    }
    const saved = deps.transaction((tx) => {
      updateStream(tx.sql, key, { next_n: revision + 1, written_at: now });
      return ok(undefined);
    });
    if (!saved.ok) return saved;
  }
  return failed;
}
