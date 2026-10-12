import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import {
  BLOB_READ_MAX_BYTES,
  type RequestContext,
  type Sql,
} from "../../protocol/platform/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  serializeMessageContent,
} from "../../protocol/lophn-agent/mod.ts";
import {
  bodyContentOf,
  type MessageBodyEnvironment,
  messageBodyRead,
  readBodyBytes,
} from "./body-read.ts";
import { conversationSchemaSteps } from "./model.ts";
import { cred, id, textContent } from "./testing/mod.ts";

// ReadMessageBody의 판정과 바이트 조립. blob store 쪽(바이트를 주는 곳)만 메모리로 두고
// ledger 표는 실제 schema로 만든다. 실제 core의 읽기는 apps/core/message-body_test.ts다.

const encoder = new TextEncoder();

function blobStore(blobs: Map<string, Uint8Array>) {
  const reads: [number, number][] = [];
  const bytes: MessageBodyEnvironment["bytes"] = (hash, offset, length) => {
    reads.push([offset, length]);
    const found = blobs.get(hash);
    if (found === undefined) {
      return Promise.resolve(err({ code: "not_found", message: "missing" }));
    }
    return Promise.resolve(ok({
      hash,
      sizeBytes: found.length,
      bytes: found.slice(offset, offset + length),
    }));
  };
  return { bytes, reads };
}

Deno.test("lophn-agent/conversation#R2: a body larger than one blob read window is joined in windows and checked against its hash", async () => {
  const whole = new Uint8Array(BLOB_READ_MAX_BYTES * 2 + 5).map((_, index) =>
    index % 251
  );
  const hash = await sha256Hex(whole);
  const store = blobStore(new Map([[hash, whole]]));
  const read = await readBodyBytes(
    { snapshot: () => err({ code: "unavailable", message: "x" }), ...store },
    hash,
    whole.length,
  );
  assert(read.ok);
  assertEquals(read.value, whole);
  assertEquals(store.reads, [
    [0, BLOB_READ_MAX_BYTES],
    [BLOB_READ_MAX_BYTES, BLOB_READ_MAX_BYTES],
    [BLOB_READ_MAX_BYTES * 2, 5],
  ]);
});

Deno.test("lophn-agent/conversation#R2: missing, short or altered bytes are unavailable, never an empty body", async () => {
  const bytes = encoder.encode("body bytes");
  const hash = await sha256Hex(bytes);
  const unattached = {
    snapshot: () => err({ code: "unavailable" as const, message: "x" }),
  };
  const code = (result: Result<unknown>) =>
    result.ok ? "ok" : result.error.code;
  // 없는 blob.
  assertEquals(
    code(
      await readBodyBytes(
        { ...unattached, ...blobStore(new Map()) },
        hash,
        bytes.length,
      ),
    ),
    "unavailable",
  );
  // 기록된 크기보다 짧게 온다.
  assertEquals(
    code(
      await readBodyBytes(
        { ...unattached, ...blobStore(new Map([[hash, bytes.slice(0, 4)]])) },
        hash,
        bytes.length,
      ),
    ),
    "unavailable",
  );
  // 같은 크기지만 hash가 다른 바이트.
  const altered = encoder.encode("body bytez");
  assertEquals(
    code(
      await readBodyBytes(
        { ...unattached, ...blobStore(new Map([[hash, altered]])) },
        hash,
        bytes.length,
      ),
    ),
    "unavailable",
  );
});

Deno.test("lophn-agent/conversation#R2: a value is read as MessageContent and an old text blob as one text part", () => {
  const content = textContent("값");
  const value = bodyContentOf(serializeMessageContent(content));
  assert(value.ok);
  assertEquals(value.value, content);
  const legacy = bodyContentOf(encoder.encode("예전 글 한 덩어리"));
  assert(legacy.ok);
  assertEquals(legacy.value, textContent("예전 글 한 덩어리"));
  // JSON 객체처럼 보이지만 본문 값이 아니면 글로 바꾸지 않고 읽지 못한다.
  assert(!bodyContentOf(encoder.encode('{"schema_version":2}')).ok);
  assert(!bodyContentOf(new Uint8Array([0xff, 0xfe, 0x00])).ok);
});

type Fixture = {
  db: DatabaseSync;
  environment: MessageBodyEnvironment;
  read: (ctx: RequestContext, message: string) => Promise<Result<unknown>>;
};

async function fixture(): Promise<Fixture & { hash: string }> {
  const db = new DatabaseSync(":memory:");
  // assignments·runs 표는 이 판정이 읽지 않아 만들지 않는다.
  db.exec("pragma foreign_keys = off");
  for (const step of conversationSchemaSteps) db.exec(step.sql);
  db.exec(
    `create table blob_refs (owner_kind text not null, owner_key text not null,
       field text not null, hash text not null, size_bytes integer not null,
       primary key (owner_kind, owner_key, field))`,
  );
  const bytes = serializeMessageContent(textContent("읽을 말"));
  const hash = await sha256Hex(bytes);
  const store = blobStore(new Map([[hash, bytes]]));
  const environment: MessageBodyEnvironment = {
    snapshot: (read) =>
      read(
        {
          get: (query, params) =>
            db.prepare(query).get(...(params as never[])) as never,
        } as Pick<Sql, "get">,
        "9",
      ),
    bytes: store.bytes,
  };
  const handler = messageBodyRead(environment);
  return {
    db,
    environment,
    hash,
    read: async (ctx, message) =>
      await handler.handle(ctx as never, { message }),
  };
}

function seed(f: Fixture, hash: string, size: number, ref = hash) {
  const assignment = id("asg", 1);
  f.db.prepare(
    `insert into sessions (id, assignment, work_place_kind, work_place_id,
       state, created_seq, state_seq)
     values (?, ?, 'project', ?, 'open', 1, 1)`,
  ).run(id("ses", 1), assignment, id("prj", 1));
  f.db.prepare(
    `insert into messages (id, session, actor, body, mode, links, created_seq,
       state_seq) values (?, ?, 'user', ?, 'request', '[]', 2, 2)`,
  ).run(id("msg", 1), id("ses", 1), hash);
  f.db.prepare(
    "insert into blob_refs values (?, ?, ?, ?, ?)",
  ).run(MESSAGE_BODY_OWNER_KIND, id("msg", 1), MESSAGE_BODY_FIELD, ref, size);
  return assignment;
}

Deno.test("lophn-agent/conversation#R2: the body read answers a person, the assignment's agent and machine, and treats every other reader as absent", async () => {
  const f = await fixture();
  try {
    const size = serializeMessageContent(textContent("읽을 말")).length;
    const assignment = seed(f, f.hash, size);
    for (const actor of ["user", "machine", `agent:${assignment}`]) {
      const read = await f.read(cred(actor) as never, id("msg", 1));
      assert(read.ok, JSON.stringify(read));
      assertEquals(read.value, {
        message: id("msg", 1),
        session: id("ses", 1),
        body: f.hash,
        size_bytes: size,
        content: textContent("읽을 말"),
        as_of_seq: "9",
        next_cursor: null,
      });
    }
    const absent = await f.read(cred("user") as never, id("msg", 2));
    const other = await f.read(
      cred(`agent:${id("asg", 2)}`) as never,
      id("msg", 1),
    );
    const coding = await f.read(
      cred(`coding_agent:${id("cac", 1)}`) as never,
      id("msg", 1),
    );
    assert(!absent.ok && !other.ok && !coding.ok);
    assertEquals(absent.error.code, "not_found");
    assertEquals(other, absent);
    assertEquals(coding, absent);
  } finally {
    f.db.close();
  }
});

Deno.test("lophn-agent/conversation#R2: a message whose body reference is missing or differs is unavailable", async () => {
  const f = await fixture();
  try {
    const size = serializeMessageContent(textContent("읽을 말")).length;
    // 참조 hash가 메시지의 body와 다르면 어느 쪽도 믿지 않는다.
    seed(f, f.hash, size, "c".repeat(64));
    const differs = await f.read(cred("user") as never, id("msg", 1));
    assert(!differs.ok);
    assertEquals(differs.error.code, "unavailable");
    f.db.prepare("delete from blob_refs").run();
    const missing = await f.read(cred("user") as never, id("msg", 1));
    assert(!missing.ok);
    assertEquals(missing.error.code, "unavailable");
  } finally {
    f.db.close();
  }
});
