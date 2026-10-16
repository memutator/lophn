import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type {
  ReadSnapshot,
  RequestContext,
  SqlParams,
} from "../../../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../../run-loop/schema.ts";
import { createQuestionReads } from "./reads.ts";
import { questionSchemaSteps } from "./schema.ts";

const SESSION_A = "ses_00000000000000000000000001";
const SESSION_B = "ses_00000000000000000000000002";
const GROUP = "qgr_00000000000000000000000001";

function snapshot(): ReadSnapshot {
  const db = new DatabaseSync(":memory:");
  for (const step of [...turnSchemaSteps, ...questionSchemaSteps]) {
    db.exec(step.sql);
  }
  db.prepare(
    `insert into turns (id, session, input_message, state, basis, started_at, limits, state_seq)
     values ('trn_a', ?, 'msg_a', 'running', 'b', '2026-01-01T00:00:00Z', '{}', 1)`,
  ).run(SESSION_A);
  db.prepare(
    `insert into question_groups (id, turn, status, created_by, created_seq)
     values (?, 'trn_a', 'pending', 'x', 1)`,
  ).run(GROUP);
  return {
    sql: {
      get: (query: string, params: SqlParams) =>
        db.prepare(query).get(...params) as never,
      all: (query: string, params: SqlParams) =>
        db.prepare(query).all(...params) as never,
    },
    as_of_seq: "1",
    port: () => {
      throw new Error("no port");
    },
  };
}

const ctx = (actor: string) => ({ actor }) as RequestContext;

// agent는 자기 session의 turn이 낸 질문 묶음만 읽는다. 사람은 모두 읽는다.
Deno.test("an agent of another session cannot read a question group", () => {
  const db = snapshot();
  const { read, list } = createQuestionReads();
  const readAs = (actor: string) =>
    read.handle(db, ctx(actor), { group: GROUP }).ok;
  const listAs = (actor: string) => {
    const result = list.handle(db, ctx(actor), {});
    return result.ok ? result.value.groups.length : -1;
  };
  assertEquals(
    [
      readAs(`agent:${SESSION_A}`),
      readAs(`agent:${SESSION_B}`),
      readAs("user"),
    ],
    [true, false, true],
  );
  assertEquals(
    [
      listAs(`agent:${SESSION_A}`),
      listAs(`agent:${SESSION_B}`),
      listAs("user"),
    ],
    [1, 0, 1],
  );
});
