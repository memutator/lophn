import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { RequestContext, Sql } from "../../contracts/platform/mod.ts";
import type { MessageBodyEnvironment } from "./body-read.ts";
import { conversationSchemaSteps } from "./model.ts";
import { sessionSummaryRead } from "./summary-read.ts";
import { cred, id } from "./testing/mod.ts";

// ReadSessionSummary(conversation#R10, R24). Compact가 session에 이은 요약 call의 출력 본문을 읽는다.
// 요약은 원문을 대체하지 않는 derived라서 호출의 출력 blob이 정본이고 session에는 call 참조만 있다.
// blob store 쪽만 메모리로 두고 ledger 표는 실제 schema로 만든다.

const encoder = new TextEncoder();

type Fixture = {
  db: DatabaseSync;
  read: (ctx: RequestContext, session: string) => Promise<Result<unknown>>;
};

function fixture(blobs: Map<string, Uint8Array>): Fixture {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = off");
  for (const step of conversationSchemaSteps) db.exec(step.sql);
  db.exec(
    `create table blob_refs (owner_kind text not null, owner_key text not null,
       field text not null, hash text not null, size_bytes integer not null,
       primary key (owner_kind, owner_key, field))`,
  );
  const environment: MessageBodyEnvironment = {
    snapshot: (read) =>
      read(
        {
          get: (query, params) =>
            db.prepare(query).get(...(params as never[])) as never,
        } as Pick<Sql, "get">,
        "9",
      ),
    bytes: (hash, offset, length) => {
      const found = blobs.get(hash);
      return Promise.resolve(
        found === undefined
          ? err({ code: "not_found" as const, message: "missing" })
          : ok({
            hash,
            sizeBytes: found.length,
            bytes: found.slice(offset, offset + length),
          }),
      );
    },
  };
  const handler = sessionSummaryRead(environment);
  return {
    db,
    read: async (ctx, session) =>
      await handler.handle(ctx as never, { session }),
  };
}

const SESSION = id("ses", 1);
const ASSIGNMENT = id("asg", 1);
const CALL = id("mcl", 1);

function seed(
  db: DatabaseSync,
  compaction: { through: number; call: string } | null,
) {
  db.prepare(
    `insert into sessions (id, assignment, work_place_kind, work_place_id,
       state, compaction_through_seq, compaction_summary_call, created_seq,
       state_seq) values (?, ?, 'project', ?, 'open', ?, ?, 1, 1)`,
  ).run(
    SESSION,
    ASSIGNMENT,
    id("prj", 1),
    compaction?.through ?? null,
    compaction?.call ?? null,
  );
}

function reference(db: DatabaseSync, hash: string, size: number, call = CALL) {
  db.prepare("insert into blob_refs values ('model_call', ?, 'output', ?, ?)")
    .run(call, hash, size);
}

async function stored(value: unknown) {
  const bytes = encoder.encode(JSON.stringify(value));
  return { bytes, hash: await sha256Hex(bytes) };
}

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: the summary read gives the span and the text of the call Compact tied to the session, to a person, the session's agent and machine only", async () => {
  const output = await stored({ text: "Decided: ship the draft.", tools: [] });
  const f = fixture(new Map([[output.hash, output.bytes]]));
  try {
    seed(f.db, { through: 12, call: CALL });
    reference(f.db, output.hash, output.bytes.length);
    for (const actor of ["user", "machine", `agent:${ASSIGNMENT}`]) {
      const read = await f.read(cred(actor) as never, SESSION);
      assert(read.ok, JSON.stringify(read));
      assertEquals(read.value, {
        session: SESSION,
        compaction: { through_seq: "12", summary_call: CALL },
        text: "Decided: ship the draft.",
        as_of_seq: "9",
        next_cursor: null,
      });
    }
    // 다른 agent·coding agent·없는 session은 모두 없는 session과 똑같이 답한다.
    const absent = await f.read(cred("user") as never, id("ses", 2));
    const other = await f.read(
      cred(`agent:${id("asg", 2)}`) as never,
      SESSION,
    );
    const coding = await f.read(
      cred(`coding_agent:${id("cac", 1)}`) as never,
      SESSION,
    );
    assert(!absent.ok && !other.ok && !coding.ok);
    assertEquals(absent.error.code, "not_found");
    assertEquals(other, absent);
    assertEquals(coding, absent);
  } finally {
    f.db.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a session that was never compacted has no summary", async () => {
  const f = fixture(new Map());
  try {
    seed(f.db, null);
    const read = await f.read(cred("user") as never, SESSION);
    assert(!read.ok);
    assertEquals(read.error.code, "not_found");
  } finally {
    f.db.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a summary whose output reference is missing, altered or not a model output is unavailable, never an empty text", async () => {
  const good = await stored({ text: "Decided.", tools: [] });
  const notOutput = await stored({ unexpected: true });
  const cases: [string, Map<string, Uint8Array>][] = [
    ["no reference", new Map()],
    ["the reference names another hash", new Map([[good.hash, good.bytes]])],
    [
      "a body that is not a model output",
      new Map([[notOutput.hash, notOutput.bytes]]),
    ],
  ];
  for (const [label, blobs] of cases) {
    const f = fixture(blobs);
    try {
      seed(f.db, { through: 12, call: CALL });
      if (label === "the reference names another hash") {
        reference(f.db, "c".repeat(64), good.bytes.length);
      } else if (label === "a body that is not a model output") {
        reference(f.db, notOutput.hash, notOutput.bytes.length);
      }
      const read = await f.read(cred("user") as never, SESSION);
      assert(!read.ok, label);
      assertEquals(read.error.code, "unavailable", label);
    } finally {
      f.db.close();
    }
  }
});
