import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { RequestContext, Sql } from "../../contracts/platform/mod.ts";
import { revertSchemaSteps } from "../revert/mod.ts";
import type { MessageBodyEnvironment } from "./body-read.ts";
import { conversationSchemaSteps } from "./model.ts";
import { sessionSummaryRead } from "./summary-read.ts";
import { cred, id } from "./testing/mod.ts";

// ReadSessionSummary에 revert를 주면 "Summarize from here"가 접은 구간의 요약을 읽는다(revert R15,
// prompt-assemble#R31; agent-RW3d). 접힘 구간의 끝은 result_seq다.

const encoder = new TextEncoder();
const SESSION = id("ses", 1);
const ASSIGNMENT = id("asg", 1);
const REVERT = id("rvt", 1);
const CALL = id("mcl", 7);

function fixture(blobs: Map<string, Uint8Array>) {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = off");
  for (const step of conversationSchemaSteps) db.exec(step.sql);
  for (const step of revertSchemaSteps) db.exec(step.sql);
  db.exec(
    `create table blob_refs (owner_kind text not null, owner_key text not null,
       field text not null, hash text not null, size_bytes integer not null,
       primary key (owner_kind, owner_key, field))`,
  );
  db.prepare(
    `insert into sessions (id, assignment, work_place_kind, work_place_id,
       state, created_seq, state_seq) values (?, ?, 'project', ?, 'open', 1, 1)`,
  ).run(SESSION, ASSIGNMENT, id("prj", 1));
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
    read: (ctx: RequestContext, revert: string): Promise<Result<unknown>> =>
      Promise.resolve(
        handler.handle(ctx as never, { session: SESSION, revert }),
      ),
  };
}

function seedRevert(
  db: DatabaseSync,
  over: { choice?: string; outcome?: string; session?: string } = {},
) {
  const choice = over.choice ?? "summarize";
  db.prepare(
    `insert into reverts (id, session, kind, choice, checkpoint, boundary_seq,
       summary_call, outcome, redo, preview_hash, result_seq)
     values (?, ?, 'rewind', ?, ?, 4, ?, ?, 'none', ?, 20)`,
  ).run(
    REVERT,
    over.session ?? SESSION,
    choice,
    id("msg", 1),
    choice === "summarize" ? CALL : null,
    over.outcome ?? "applied",
    "a".repeat(64),
  );
}

async function stored(value: unknown) {
  const bytes = encoder.encode(JSON.stringify(value));
  return { bytes, hash: await sha256Hex(bytes) };
}

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: the summary read gives the text of the call a Summarize-from-here rewind folded, with the fold's end", async () => {
  const output = await stored({
    text: "Folded: the draft was agreed.",
    tools: [],
  });
  const f = fixture(new Map([[output.hash, output.bytes]]));
  try {
    seedRevert(f.db);
    f.db.prepare(
      "insert into blob_refs values ('model_call', ?, 'output', ?, ?)",
    ).run(CALL, output.hash, output.bytes.length);
    for (const actor of ["user", "machine", `agent:${ASSIGNMENT}`]) {
      const read = await f.read(cred(actor) as never, REVERT);
      assert(read.ok, JSON.stringify(read));
      assertEquals(read.value, {
        session: SESSION,
        compaction: { through_seq: "20", summary_call: CALL },
        text: "Folded: the draft was agreed.",
        as_of_seq: "9",
        next_cursor: null,
      });
    }
  } finally {
    f.db.close();
  }
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: a revert that is not an applied summarize rewind of the session has no summary", async () => {
  const output = await stored({ text: "Folded.", tools: [] });
  const cases: [string, Parameters<typeof seedRevert>[1] | null][] = [
    ["missing", null],
    ["not a summarize rewind", { choice: "messages_only" }],
    ["blocked", { outcome: "blocked" }],
  ];
  for (const [label, over] of cases) {
    const f = fixture(new Map([[output.hash, output.bytes]]));
    try {
      if (over !== null) seedRevert(f.db, over);
      f.db.prepare(
        "insert into blob_refs values ('model_call', ?, 'output', ?, ?)",
      ).run(CALL, output.hash, output.bytes.length);
      const read = await f.read(cred("user") as never, REVERT);
      assert(!read.ok, label);
      assertEquals(read.error.code, "not_found", label);
    } finally {
      f.db.close();
    }
  }
});
