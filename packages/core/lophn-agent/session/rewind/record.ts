import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  recordRewindFile,
  REWIND_MAX_CHECKPOINTS,
  REWIND_MAX_FILE_BYTES,
  REWIND_MAX_SESSION_BYTES,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  Tx,
} from "../../../../protocol/server/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import type { RewindStore } from "./store.ts";

// 문서 tool이 파일을 쓰기 직전에 pre-image를 남기는 기록(RecordRewindFile)과, 그 호출을 쓰기에
// 감싸는 harness 쪽 배선이다.
// 실제 문서 쓰기 tool(harness/tools/bundles/document.ts의 document.create·document.save_version)에
// 이 배선을 거는 일은 documents가 파일 기반 쓰기로 바뀐 뒤 따로 한다(지금 그 tool은 documents의
// version 저장 contract를 부른다).

function reject(
  code: "invalid_input" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

type FilesReason = NonNullable<
  Output<typeof recordRewindFile>["files_reason"]
>;

type Held = { message: string };

// 기록이 있는 checkpoint를 오래된 것부터 읽는다(메시지의 생성 순서).
function checkpointsWithRecords(tx: Tx, session: string): Held[] {
  return tx.sql.all(
    `select c.message as message
       from checkpoints c join messages m on m.id = c.message
      where c.session = ?
        and exists (select 1 from rewind_files f where f.checkpoint = c.message)
      order by m.created_seq`,
    [session],
  ).map((row) => ({ message: String(row["message"]) }));
}

// session 안 서로 다른 저장물의 크기 합이다. 같은 내용은 한 번만 센다.
function storedBytes(tx: Tx, session: string): number {
  const row = tx.sql.get(
    `select coalesce(sum(size), 0) as total from (
       select max(f.before_size) as size
         from rewind_files f join checkpoints c on c.message = f.checkpoint
        where c.session = ? and f.before_blob is not null
        group by f.before_blob)`,
    [session],
  );
  return Number(row?.["total"] ?? 0);
}

function lower(
  tx: Tx,
  checkpoint: string,
  reason: FilesReason,
): void {
  // 처음 이유를 지킨다.
  tx.sql.run(
    `update checkpoints set files_restorable = 0, files_reason = ?
      where message = ? and files_restorable = 1`,
    [reason, checkpoint],
  );
}

// 한도를 넘은 가장 오래된 checkpoint의 기록을 지우고 낮춘다. 지운 checkpoint들을 돌려준다.
function enforceLimits(tx: Tx, session: string): string[] {
  const pruned: string[] = [];
  const prune = (checkpoint: string, reason: FilesReason) => {
    tx.sql.run("delete from rewind_files where checkpoint = ?", [checkpoint]);
    lower(tx, checkpoint, reason);
    pruned.push(checkpoint);
  };
  for (;;) {
    const held = checkpointsWithRecords(tx, session);
    if (held.length <= REWIND_MAX_CHECKPOINTS) break;
    prune(held[0]!.message, "limit_count");
  }
  for (;;) {
    if (storedBytes(tx, session) <= REWIND_MAX_SESSION_BYTES) break;
    const oldest = checkpointsWithRecords(tx, session)[0];
    if (oldest === undefined) break;
    prune(oldest.message, "limit_total");
  }
  return pruned;
}

type Stored = {
  checkpoint: string;
  recorded: boolean;
};

function result(
  tx: Tx,
  input: Input<typeof recordRewindFile>,
  stored: Stored,
  replayed: boolean,
): Result<Output<typeof recordRewindFile>> {
  const row = tx.sql.get(
    "select files_restorable, files_reason from checkpoints where message = ?",
    [stored.checkpoint],
  );
  const restorable = Number(row?.["files_restorable"]) === 1;
  return ok({
    tool_call: input.tool_call,
    path: input.path,
    checkpoint: stored.checkpoint,
    recorded: stored.recorded,
    files_restorable: restorable,
    files_reason: restorable || row?.["files_reason"] == null
      ? null
      : String(row["files_reason"]) as FilesReason,
    replayed,
  });
}

// 한도 판정과 같은 `(tool_call, path)` 중복 처리는 이 command가 한다. 한도를 넘는 쓰기는 막지
// 않고 그 checkpoint를 `files_restorable=false`로 낮춘다. 한 번 낮아진 checkpoint는 되돌아가지 않고 이유도
// 처음 것을 지킨다. 이유: 크기가 한도(10 MB)를 넘으면 `limit_file`, 크기는 한도 안인데 blob이 없으면(저장소
// 쓰기 실패) `record_failed`, 개수·총량은 `limit_count`·`limit_total`.
export function createRecordRewindFile(): CommandDefinition<
  typeof recordRewindFile
> {
  return {
    route: recordRewindFile,
    handle(tx, ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "agent" || ctx.run === undefined) {
        return reject("forbidden", "only a run's agent records its writes");
      }
      const call = tx.sql.get(
        "select turn, state_seq from tool_calls where id = ?",
        [input.tool_call],
      );
      if (call === undefined) {
        return reject("invalid_input", "tool call not found");
      }
      if (String(call["turn"]) !== ctx.run) {
        return reject("forbidden", "an agent records only for its own run");
      }
      const existing = tx.sql.get(
        `select checkpoint, before_exists, before_blob from rewind_files
          where tool_call = ? and path = ?`,
        [input.tool_call, input.path],
      );
      if (existing !== undefined) {
        return result(tx, input, {
          checkpoint: String(existing["checkpoint"]),
          recorded: Number(existing["before_exists"]) === 0 ||
            existing["before_blob"] !== null,
        }, true);
      }
      // 기록은 run을 시작한 사람 메시지(checkpoint)에 붙는다.
      const owner = tx.sql.get(
        `select c.message as message, c.session as session
           from runs r join checkpoints c on c.message = r.source_message
          where r.id = ?`,
        [ctx.run],
      );
      if (owner === undefined) {
        return reject("invalid_input", "the run has no checkpoint");
      }
      const checkpoint = String(owner["message"]);
      const session = String(owner["session"]);

      const before = input.before;
      let blob = before.blob;
      let reason: FilesReason | null = null;
      if (before.exists) {
        if (input.before_size_bytes! > REWIND_MAX_FILE_BYTES) {
          // 크기는 쓰는 쪽이 보낸 값을 믿고, 한도를 넘는 내용은 blob이 와도 두지 않는다.
          blob = null;
          reason = "limit_file";
        } else if (blob === null) {
          reason = "record_failed";
        }
      }
      tx.sql.run(
        `insert into rewind_files
           (tool_call, path, checkpoint, seq, before_exists, before_sha256, before_blob,
            before_size, after_exists, after_sha256, moved_from, reverted_by)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
        [
          input.tool_call,
          input.path,
          checkpoint,
          Number(call["state_seq"]),
          before.exists ? 1 : 0,
          before.sha256,
          blob,
          input.before_size_bytes,
          input.after.exists ? 1 : 0,
          input.after.sha256,
          input.moved_from,
        ],
      );
      if (reason !== null) lower(tx, checkpoint, reason);
      const pruned = enforceLimits(tx, session);
      return result(tx, input, {
        checkpoint,
        recorded: reason === null && !pruned.includes(checkpoint),
      }, false);
    },
  };
}

export type RecorderPorts = {
  store: Pick<RewindStore, "put">;
  // project 폴더 기준 상대 경로의 지금 내용. 파일이 없으면 null.
  read(path: string): Promise<Uint8Array | null>;
  // RecordRewindFile command를 부른다(실행 중인 run의 agent 자격).
  record(
    input: Input<typeof recordRewindFile>,
  ): Promise<Result<Output<typeof recordRewindFile>>>;
};

export type RecordedWrite = {
  // 기록이 한도 안에서 pre-image를 남겼나. 기록에 실패했거나 한도를 넘었으면 false다.
  recorded: boolean;
};

type Observed = { exists: false } | {
  exists: true;
  sha256: string;
  size: number;
  bytes: Uint8Array;
};

async function observe(
  read: RecorderPorts["read"],
  path: string,
): Promise<Observed | null> {
  try {
    const bytes = await read(path);
    if (bytes === null) return { exists: false };
    return {
      exists: true,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      bytes,
    };
  } catch {
    return null;
  }
}

// 쓰기 직전에 before를 읽고 pre-image를 저장소에 두고, write()를 부르고, 쓴 직후에 after를 읽어
// RecordRewindFile을 부른다. 기록이나 저장이 실패해도 쓰기는 막지 않는다. 쓰기 자체가 실패하면
// 기록하지 않고 그 오류를 돌려준다. 이름 변경은 옛 경로(moved_from)의 내용을 before로 남긴다.
// 파일을 읽지 못해 before나 after를 알 수 없으면 기록을 남기지 못한다(recorded=false). 이때도 쓰기는
// 하고, 이 경로는 이후 판정에서 지금 hash가 기록과 맞지 않아 건너뛴다.
export async function recordBeforeWrite(
  ports: RecorderPorts,
  write: {
    session: string;
    tool_call: string;
    path: string;
    moved_from: string | null;
    run(): Promise<Result<void>>;
  },
): Promise<Result<RecordedWrite>> {
  const before = await observe(ports.read, write.moved_from ?? write.path);
  let blob: string | null = null;
  if (
    before?.exists === true && before.size <= REWIND_MAX_FILE_BYTES
  ) {
    try {
      blob = (await ports.store.put(write.session, before.bytes)).key;
    } catch {
      // 저장소가 실패해도 쓰기를 막지 않는다. blob 없이 기록하면 command가 checkpoint를 낮춘다.
      blob = null;
    }
  }
  const written = await write.run();
  if (!written.ok) return written;
  const after = await observe(ports.read, write.path);
  if (before === null || after === null) return ok({ recorded: false });
  const recorded = await ports.record({
    tool_call: write.tool_call,
    path: write.path,
    before: before.exists
      ? { exists: true, sha256: before.sha256, blob }
      : { exists: false, sha256: null, blob: null },
    before_size_bytes: before.exists ? before.size : null,
    after: after.exists
      ? { exists: true, sha256: after.sha256 }
      : { exists: false, sha256: null },
    moved_from: write.moved_from,
  }).catch(() => undefined);
  return ok({ recorded: recorded?.ok === true && recorded.value.recorded });
}
