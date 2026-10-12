import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type recordRewindFile,
  REWIND_MAX_CHECKPOINTS,
  REWIND_MAX_FILE_BYTES,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { Input, Output } from "../../../../protocol/server/mod.ts";
import { createRecordRewindFile, recordBeforeWrite } from "./record.ts";
import {
  agentCtx,
  failed,
  MSG,
  must,
  openWorld,
  RUN,
  sha256,
  TCL,
  userCtx,
  type World,
} from "./testing/mod.ts";

// RecordRewindFile(한도 판정, 중복)과 문서 tool 쪽 배선 recordBeforeWrite(agent-RW3a).
// ledger는 가짜 Tx 위의 메모리 DB이고 저장소는 메모리 가짜다.

type RecordInput = Input<typeof recordRewindFile>;

const definition = () => createRecordRewindFile();

function input(
  tool: number,
  path: string,
  before: string | null,
  after: string | null,
  extra: Partial<RecordInput> = {},
): RecordInput {
  const content = before === null ? null : before;
  return {
    tool_call: TCL(tool),
    path,
    before: content === null
      ? { exists: false, sha256: null, blob: null }
      : { exists: true, sha256: sha256(content), blob: sha256(content) },
    before_size_bytes: content === null ? null : content.length,
    after: after === null
      ? { exists: false, sha256: null }
      : { exists: true, sha256: sha256(after) },
    moved_from: null,
    ...extra,
  };
}

// n번째 사람 요청과 그 run의 tool call 하나를 만든다.
function turn(world: World, n: number) {
  const { message, run } = world.addRequest(n);
  world.addToolCall(n, run);
  return { message, run, tool: n };
}

function record(world: World, n: number, rest: RecordInput) {
  return world.call(definition(), agentCtx(RUN(n)), rest);
}

function checkpointOf(world: World, message: string) {
  const row = world.query(
    "select files_restorable, files_reason from checkpoints where message = ?",
    [message],
  )[0]!;
  return {
    restorable: Number(row["files_restorable"]) === 1,
    reason: row["files_reason"] === null ? null : String(row["files_reason"]),
  };
}

function rowsOf(world: World, checkpoint: string): number {
  return Number(
    world.query(
      "select count(*) as n from rewind_files where checkpoint = ?",
      [checkpoint],
    )[0]!["n"],
  );
}

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: a write keeps its before and after state under the checkpoint of its run", () => {
  const world = openWorld();
  world.addSession();
  const { message } = turn(world, 1);
  const out = must(record(world, 1, input(1, "notes/a.md", "old", "new")));
  assertEquals(out.checkpoint, message);
  assertEquals(out.recorded, true);
  assertEquals(out.files_restorable, true);
  assertEquals(out.replayed, false);
  const row = world.query(
    `select tool_call, path, checkpoint, before_exists, before_sha256, before_blob,
            after_exists, after_sha256, moved_from, reverted_by
     from rewind_files`,
  )[0]!;
  assertEquals(row["tool_call"], TCL(1));
  assertEquals(row["path"], "notes/a.md");
  assertEquals(row["checkpoint"], message);
  assertEquals(Number(row["before_exists"]), 1);
  assertEquals(row["before_sha256"], sha256("old"));
  assertEquals(row["before_blob"], sha256("old"));
  assertEquals(Number(row["after_exists"]), 1);
  assertEquals(row["after_sha256"], sha256("new"));
  assertEquals(row["moved_from"], null);
  assertEquals(row["reverted_by"], null);
});

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: create, delete and rename are recorded, a rename with both paths", () => {
  const world = openWorld();
  world.addSession();
  const { run } = turn(world, 1);
  world.addToolCall(2, run);
  world.addToolCall(3, run);
  // 만들기: 이전에 없었다.
  must(record(world, 1, input(1, "new.md", null, "text")));
  // 삭제: 쓴 뒤에 없다.
  must(record(world, 1, input(2, "gone.md", "was here", null)));
  // 이름 변경: before는 옛 경로의 내용이다.
  must(
    record(
      world,
      1,
      input(3, "moved.md", "same", "same", { moved_from: "from.md" }),
    ),
  );
  const rows = world.query(
    `select path, before_exists, after_exists, moved_from from rewind_files order by seq`,
  );
  assertEquals(
    rows.map((row) => [
      row["path"],
      Number(row["before_exists"]),
      Number(row["after_exists"]),
      row["moved_from"],
    ]),
    [["new.md", 0, 1, null], ["gone.md", 1, 0, null], [
      "moved.md",
      1,
      1,
      "from.md",
    ]],
  );
});

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: the same (tool_call, path) records once and replays the stored result", () => {
  const world = openWorld();
  world.addSession();
  turn(world, 1);
  const first = must(record(world, 1, input(1, "a.md", "old", "new")));
  const second = must(record(world, 1, input(1, "a.md", "old", "new")));
  assertEquals(first.replayed, false);
  assertEquals(second.replayed, true);
  assertEquals(second.checkpoint, first.checkpoint);
  assertEquals(
    Number(world.query("select count(*) as n from rewind_files")[0]!["n"]),
    1,
  );
});

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: a record for an unknown tool call or a run without a checkpoint is invalid, and a person cannot record", () => {
  const world = openWorld();
  world.addSession();
  turn(world, 1);
  failed(record(world, 1, input(7, "a.md", "old", "new")), "invalid_input");
  // correction만 있는 run은 checkpoint가 없다.
  const request = world.addRequest(2);
  const correction = world.addRequest(3, { mode: "correction" });
  assertEquals(correction.run, request.run);
  world.db.prepare("delete from checkpoints where message = ?").run(
    request.message,
  );
  world.addToolCall(2, request.run);
  failed(record(world, 2, input(2, "a.md", "old", "new")), "invalid_input");
  failed(
    world.call(definition(), userCtx, input(1, "a.md", "old", "new")),
    "forbidden",
  );
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: a write over the per-file limit still succeeds and lowers its checkpoint to limit_file", () => {
  const world = openWorld();
  world.addSession();
  const { message } = turn(world, 1);
  world.addToolCall(2, RUN(1));
  const big = REWIND_MAX_FILE_BYTES + 1;
  // 쓰는 쪽이 이미 저장하지 않았다: exists인데 blob이 없다.
  const out = must(
    record(world, 1, {
      ...input(1, "big.bin", "x", "y"),
      before: { exists: true, sha256: sha256("big"), blob: null },
      before_size_bytes: big,
    }),
  );
  assertEquals(out.recorded, false);
  assertEquals(out.files_restorable, false);
  assertEquals(out.files_reason, "limit_file");
  assertEquals(checkpointOf(world, message), {
    restorable: false,
    reason: "limit_file",
  });
  // 기록은 남고 pre-image(blob)는 없다.
  const row = world.query(
    "select before_sha256, before_blob from rewind_files",
  )[0]!;
  assertEquals(row["before_sha256"], sha256("big"));
  assertEquals(row["before_blob"], null);
  // 한 번 낮아진 checkpoint는 뒤 기록이 한도 안이어도 되살아나지 않는다.
  const small = must(record(world, 1, input(2, "small.md", "a", "b")));
  assertEquals(small.files_restorable, false);
  assertEquals(checkpointOf(world, message).reason, "limit_file");
  // blob을 주었더라도 크기가 한도를 넘으면 command가 blob을 버린다.
  const world2 = openWorld();
  world2.addSession();
  turn(world2, 1);
  const kept = must(
    record(world2, 1, {
      ...input(1, "big.bin", "x", "y"),
      before: { exists: true, sha256: sha256("big"), blob: sha256("big") },
      before_size_bytes: big,
    }),
  );
  assertEquals(kept.recorded, false);
  assertEquals(
    world2.query("select before_blob from rewind_files")[0]!["before_blob"],
    null,
  );
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: a pre-image that could not be stored lowers the checkpoint to record_failed, apart from the limits", () => {
  const world = openWorld();
  world.addSession();
  const { message } = turn(world, 1);
  world.addToolCall(2, RUN(1));
  // 크기는 한도 안인데 blob이 없다: 저장소가 실패했다.
  const out = must(
    record(world, 1, {
      ...input(1, "a.md", "abc", "def"),
      before: { exists: true, sha256: sha256("abc"), blob: null },
      before_size_bytes: 3,
    }),
  );
  assertEquals(out.recorded, false);
  assertEquals(out.files_reason, "record_failed");
  assertEquals(checkpointOf(world, message), {
    restorable: false,
    reason: "record_failed",
  });
  // 처음 이유를 지킨다: 뒤에 한도를 넘는 쓰기가 와도 바뀌지 않는다.
  must(
    record(world, 1, {
      ...input(2, "big.bin", "x", "y"),
      before: { exists: true, sha256: sha256("big"), blob: null },
      before_size_bytes: REWIND_MAX_FILE_BYTES + 1,
    }),
  );
  assertEquals(checkpointOf(world, message).reason, "record_failed");
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: the 101st checkpoint with records lowers the oldest to limit_count and drops its rows", () => {
  const world = openWorld();
  world.addSession();
  const messages: string[] = [];
  for (let n = 1; n <= REWIND_MAX_CHECKPOINTS + 1; n++) {
    const made = turn(world, n);
    messages.push(made.message);
    const out = must(
      record(world, n, input(n, `f${n}.md`, `old${n}`, `new${n}`)),
    );
    // 쓴 checkpoint 자신은 항상 복원 가능으로 남는다.
    assertEquals(out.files_restorable, true);
  }
  assertEquals(checkpointOf(world, messages[0]!), {
    restorable: false,
    reason: "limit_count",
  });
  assertEquals(rowsOf(world, messages[0]!), 0);
  for (const kept of messages.slice(1)) {
    assertEquals(checkpointOf(world, kept).restorable, true);
    assertEquals(rowsOf(world, kept), 1);
  }
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: the session total over the limit lowers the oldest checkpoints to limit_total", () => {
  const world = openWorld();
  world.addSession();
  const each = 10_000_000;
  const messages: string[] = [];
  // 서로 다른 내용 21개 x 10 MB는 200 MiB(209,715,200)를 넘는다.
  for (let n = 1; n <= 21; n++) {
    messages.push(turn(world, n).message);
    must(
      record(world, n, {
        ...input(n, `f${n}.bin`, `body ${n}`, "after"),
        before_size_bytes: each,
      }),
    );
  }
  assertEquals(checkpointOf(world, messages[0]!), {
    restorable: false,
    reason: "limit_total",
  });
  assertEquals(rowsOf(world, messages[0]!), 0);
  assertEquals(checkpointOf(world, messages[20]!).restorable, true);
});

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: the same content counts once toward the session total", () => {
  const world = openWorld();
  world.addSession();
  const messages: string[] = [];
  for (let n = 1; n <= 25; n++) {
    messages.push(turn(world, n).message);
    must(
      record(world, n, {
        ...input(n, `f${n}.bin`, "identical body", "after"),
        before_size_bytes: 10_000_000,
      }),
    );
  }
  for (const message of messages) {
    assertEquals(checkpointOf(world, message).restorable, true);
  }
});

// ---- recordBeforeWrite ----

type Fake = {
  files: Map<string, Uint8Array>;
  log: string[];
  stored: Map<string, Uint8Array>;
  recorded: RecordInput[];
  storeFails: boolean;
  recordResult: () => Result<Output<typeof recordRewindFile>>;
};

function fake(): Fake {
  return {
    files: new Map(),
    log: [],
    stored: new Map(),
    recorded: [],
    storeFails: false,
    recordResult: () =>
      ok({
        tool_call: TCL(1),
        path: "a.md",
        checkpoint: MSG(1),
        recorded: true,
        files_restorable: true,
        files_reason: null,
        replayed: false,
      }),
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);

function ports(state: Fake) {
  return {
    store: {
      put: (_session: string, content: Uint8Array) => {
        state.log.push("put");
        if (state.storeFails) return Promise.reject(new Error("disk full"));
        const key = sha256(content);
        state.stored.set(key, content);
        return Promise.resolve({ key, size: content.length, created: true });
      },
    },
    read: (path: string) => {
      state.log.push(`read ${path}`);
      return Promise.resolve(state.files.get(path) ?? null);
    },
    record: (recorded: RecordInput) => {
      state.log.push("record");
      state.recorded.push(recorded);
      return Promise.resolve(state.recordResult());
    },
  };
}

function writeOf(
  state: Fake,
  path: string,
  content: string | null,
  extra: { moved_from?: string | null; fail?: boolean } = {},
) {
  return {
    session: "ses_x",
    tool_call: TCL(1),
    path,
    moved_from: extra.moved_from ?? null,
    run: () => {
      state.log.push("write");
      if (extra.fail === true) {
        return Promise.resolve(
          err({ code: "unavailable" as const, message: "write failed" }),
        );
      }
      if (content === null) state.files.delete(path);
      else state.files.set(path, bytes(content));
      return Promise.resolve(ok(undefined));
    },
  };
}

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: recordBeforeWrite reads before, stores the pre-image, writes, reads after, then records", async () => {
  const state = fake();
  state.files.set("a.md", bytes("old"));
  const result = must(
    await recordBeforeWrite(ports(state), writeOf(state, "a.md", "new")),
  );
  assertEquals(result.recorded, true);
  assertEquals(state.log, ["read a.md", "put", "write", "read a.md", "record"]);
  assertEquals(state.recorded.length, 1);
  assertEquals(state.recorded[0], {
    tool_call: TCL(1),
    path: "a.md",
    before: { exists: true, sha256: sha256("old"), blob: sha256("old") },
    before_size_bytes: 3,
    after: { exists: true, sha256: sha256("new") },
    moved_from: null,
  });
  assertEquals(state.stored.get(sha256("old")), bytes("old"));
});

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: creating, deleting and renaming record the state the file had", async () => {
  const created = fake();
  must(await recordBeforeWrite(ports(created), writeOf(created, "n.md", "x")));
  assertEquals(created.recorded[0]!.before, {
    exists: false,
    sha256: null,
    blob: null,
  });
  assertEquals(created.recorded[0]!.before_size_bytes, null);
  assert(!created.log.includes("put"));

  const deleted = fake();
  deleted.files.set("d.md", bytes("body"));
  must(await recordBeforeWrite(ports(deleted), writeOf(deleted, "d.md", null)));
  assertEquals(deleted.recorded[0]!.after, { exists: false, sha256: null });
  assertEquals(deleted.recorded[0]!.before.sha256, sha256("body"));

  // 이름 변경은 옛 경로의 내용을 before로 읽고 새 경로의 내용을 after로 읽는다.
  const moved = fake();
  moved.files.set("old.md", bytes("body"));
  const move = writeOf(moved, "new.md", null, { moved_from: "old.md" });
  move.run = () => {
    moved.log.push("write");
    moved.files.set("new.md", moved.files.get("old.md")!);
    moved.files.delete("old.md");
    return Promise.resolve(ok(undefined));
  };
  must(await recordBeforeWrite(ports(moved), move));
  assertEquals(moved.log[0], "read old.md");
  assertEquals(moved.recorded[0]!.moved_from, "old.md");
  assertEquals(moved.recorded[0]!.before.sha256, sha256("body"));
  assertEquals(moved.recorded[0]!.after, {
    exists: true,
    sha256: sha256("body"),
  });
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: a pre-image over the file limit is not stored but the write and the record still happen", async () => {
  const state = fake();
  state.files.set("big.bin", new Uint8Array(REWIND_MAX_FILE_BYTES + 1));
  must(
    await recordBeforeWrite(ports(state), writeOf(state, "big.bin", "small")),
  );
  assert(!state.log.includes("put"));
  assertEquals(state.log.includes("write"), true);
  assertEquals(state.recorded[0]!.before.blob, null);
  assertEquals(state.recorded[0]!.before.exists, true);
  assertEquals(state.recorded[0]!.before_size_bytes, REWIND_MAX_FILE_BYTES + 1);
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: a storage or record failure never blocks the write", async () => {
  const storeDown = fake();
  storeDown.files.set("a.md", bytes("old"));
  storeDown.storeFails = true;
  // 저장소가 실패해 blob이 없으면 ledger가 checkpoint를 낮추고 recorded=false로 답한다.
  storeDown.recordResult = () =>
    ok({
      tool_call: TCL(1),
      path: "a.md",
      checkpoint: MSG(1),
      recorded: false,
      files_restorable: false,
      files_reason: "record_failed" as const,
      replayed: false,
    });
  const stored = must(
    await recordBeforeWrite(
      ports(storeDown),
      writeOf(storeDown, "a.md", "new"),
    ),
  );
  assertEquals(storeDown.files.get("a.md"), bytes("new"));
  assertEquals(stored.recorded, false);
  // 저장이 실패하면 pre-image 없이 기록해 checkpoint를 낮춘다.
  assertEquals(storeDown.recorded[0]!.before.blob, null);

  const recordDown = fake();
  recordDown.files.set("a.md", bytes("old"));
  recordDown.recordResult = () =>
    err({ code: "unavailable", message: "ledger down" });
  const lost = must(
    await recordBeforeWrite(
      ports(recordDown),
      writeOf(recordDown, "a.md", "new"),
    ),
  );
  assertEquals(recordDown.files.get("a.md"), bytes("new"));
  assertEquals(lost.recorded, false);
});

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: a failed write is not recorded and returns its own error", async () => {
  const state = fake();
  state.files.set("a.md", bytes("old"));
  const result = await recordBeforeWrite(
    ports(state),
    writeOf(state, "a.md", "new", { fail: true }),
  );
  failed(result, "unavailable");
  assert(!state.log.includes("record"));
  assertEquals(state.files.get("a.md"), bytes("old"));
});
