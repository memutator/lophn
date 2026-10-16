import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type FileState,
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

// file tool(file.write, file.edit)이 파일을 쓰기 직전에 pre-image를 남기는 기록(RecordRewindFile)과, 그
// 호출을 쓰기에 감싸는 runtime 쪽 배선(recordBeforeWrite)이다. shell이 바꾼 파일은 기록하지 않는다.

function reject(
  code: "invalid_input" | "forbidden" | "conflict",
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

// 한도 판정과 같은 `(tool_call, path)` 중복 처리는 이 command가 한다. 한도를 넘는 쓰기는 막지 않고 그
// checkpoint를 `files_restorable=false`로 낮춘다. 한 번 낮아진 checkpoint는 되돌아가지 않고 이유도 처음 것을
// 지킨다. 이유: 크기가 한도(10 MB)를 넘으면 `limit_file`, 크기는 한도 안인데 blob이 없으면(저장소 쓰기 실패)
// `record_failed`, 개수·총량은 `limit_count`·`limit_total`. 낸 쪽은 core의 machine 자격이고, 허용 폴더
// 확인은 그 앞에서 끝났다. 기록은 turn을 시작한 입력 메시지(checkpoint)에 붙는다.
export function createRecordRewindFile(): CommandDefinition<
  typeof recordRewindFile
> {
  return {
    route: recordRewindFile,
    handle(tx, ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return reject("forbidden", "only core records a write");
      }
      const call = tx.sql.get(
        "select turn from tool_calls where id = ?",
        [input.tool_call],
      );
      if (call === undefined) {
        return reject("invalid_input", "tool call not found");
      }
      if (String(call["turn"]) !== input.turn) {
        return reject("invalid_input", "the tool call is of another turn");
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
      const turn = tx.sql.get(
        "select session, input_message, state from turns where id = ?",
        [input.turn],
      );
      if (turn === undefined || String(turn["session"]) !== input.session) {
        return reject("invalid_input", "turn not found in the session");
      }
      if (String(turn["state"]) !== "running") {
        return reject("conflict", "the turn is finished");
      }
      const owner = tx.sql.get(
        "select message from checkpoints where message = ? and session = ?",
        [String(turn["input_message"]), input.session],
      );
      if (owner === undefined) {
        return reject("invalid_input", "the turn has no checkpoint");
      }
      const checkpoint = String(owner["message"]);
      const session = input.session;

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
      // 기록한 차례. 같은 경로의 기록 순서를 이 값이 정한다.
      const next = tx.sql.get(
        "select coalesce(max(seq), 0) + 1 as next from rewind_files",
        [],
      );
      tx.sql.run(
        `insert into rewind_files
           (tool_call, root, path, checkpoint, seq, before_exists, before_sha256, before_blob,
            before_size, after_exists, after_sha256, moved_from, reverted_by)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
        [
          input.tool_call,
          input.root,
          input.path,
          checkpoint,
          Number(next!["next"]),
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

// runtime이 쓰기 직전과 직후에 부르는 길이다. session·turn은 부르는 turn의 것이어야 한다(agent 자격).
export type RecorderPorts = {
  // core가 그 파일의 지금 내용을 읽어 pre-image로 session 저장소에 두고 before 상태를 돌려준다. 내용은 오가지
  // 않는다. 허용 폴더가 아니거나 읽지 못하면 오류다.
  stage(
    input: { session: string; turn: string; root: string; path: string },
  ): Promise<
    Result<{ before: FileState; before_size_bytes: number | null }>
  >;
  // 쓴 직후 파일 내용. 파일이 없으면 null. root는 허용 폴더(절대 경로)고 path는 그 안의 상대 경로다.
  read(root: string, path: string): Promise<Uint8Array | null>;
  // 쓴 결과를 core에 기록한다(RecordRewindWrite).
  record(
    input: Input<typeof recordRewindFile>,
  ): Promise<Result<Output<typeof recordRewindFile>>>;
};

type RecordedWrite = {
  // 기록이 한도 안에서 pre-image를 남겼나. 기록에 실패했거나 한도를 넘었으면 false다.
  recorded: boolean;
};

type After = { exists: false } | { exists: true; sha256: string };

async function observe(
  read: RecorderPorts["read"],
  root: string,
  path: string,
): Promise<After | null> {
  try {
    const bytes = await read(root, path);
    if (bytes === null) return { exists: false };
    return {
      exists: true,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return null;
  }
}

// 쓰기 직전에 core가 before를 읽어 두게 하고, write()를 부르고, 쓴 직후에 after를 읽어 RecordRewindWrite를
// 부른다. file tool(write, edit)이 쓰기 직전에 부른다. path는 허용 폴더(root) 안의 상대 경로(`Resolved`의
// `root`와 `relative`)다. 기록이나 저장이 실패해도 쓰기는 막지 않는다. 쓰기 자체가 실패하면 기록하지 않고 그
// 오류를 돌려준다. 이름 변경은 옛 경로(moved_from)의 내용을 before로 남긴다. 파일을 읽지 못해 before나
// after를 알 수 없으면 기록을 남기지 못한다(recorded=false). 이때도 쓰기는 하고, 이 경로는 이후 판정에서 지금
// hash가 기록과 맞지 않아 건너뛴다.
export async function recordBeforeWrite(
  ports: RecorderPorts,
  write: {
    session: string;
    turn: string;
    tool_call: string;
    root: string;
    path: string;
    moved_from: string | null;
    run(): Promise<Result<void>>;
  },
): Promise<Result<RecordedWrite>> {
  const staged = await ports.stage({
    session: write.session,
    turn: write.turn,
    root: write.root,
    path: write.moved_from ?? write.path,
  }).catch(() => undefined);
  const written = await write.run();
  if (!written.ok) return written;
  const after = await observe(ports.read, write.root, write.path);
  if (staged === undefined || !staged.ok || after === null) {
    return ok({ recorded: false });
  }
  const recorded = await ports.record({
    session: write.session,
    turn: write.turn,
    tool_call: write.tool_call,
    root: write.root,
    path: write.path,
    before: staged.value.before,
    before_size_bytes: staged.value.before_size_bytes,
    after: after.exists
      ? { exists: true, sha256: after.sha256 }
      : { exists: false, sha256: null },
    moved_from: write.moved_from,
  }).catch(() => undefined);
  return ok({ recorded: recorded?.ok === true && recorded.value.recorded });
}
