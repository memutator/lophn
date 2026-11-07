import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { turnSchemaSteps } from "../run-loop/schema.ts";
import { toolsCloseStuckSteps, toolsSchemaSteps } from "./model.ts";

// 사람의 ledger에 있는 started 행을 새 step이 닫되, 도는 turn의 행과 끝난 행은 건드리지 않는다.
test("close-stuck step finishes unfinished calls of finished turns only", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = off");
  for (const earlier of [...turnSchemaSteps, ...toolsSchemaSteps]) {
    db.exec(earlier.sql);
  }
  const [step] = toolsCloseStuckSteps;

  const turn = (id: string, state: string) =>
    db
      .prepare(
        `insert into turns (id, session, input_message, state, basis, started_at, limits, mode,
           finished_at, outcome_kind, outcome_reason, result, state_seq)
         values (?, 's', ?, ?, 'b', '2026-11-01T00:00:00Z', '{}', 'attended', ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        `m_${id}`,
        state,
        state === "finished" ? "2026-11-01T00:10:00Z" : null,
        state === "finished" ? "completed" : null,
        state === "finished" ? "answer_completed" : null,
        state === "finished" ? "r" : null,
      );
  turn("done", "finished");
  turn("live", "running");
  const call = (id: string, turnId: string, state: string) =>
    db
      .prepare(
        `insert into tool_calls (id, turn, model_call, response_key, response_order, tool,
           definition_revision, effect, confirm, input, attempt, state, state_seq,
           started_at, finished_at, outcome)
         values (?, ?, 'mc', ?, 0, 'web.fetch', 'd', 'read', 0, 'i', 0, ?, 2, ?, ?, ?)`,
      )
      .run(
        id,
        turnId,
        id,
        state,
        state === "requested" ? null : "2026-11-01T00:01:00Z",
        state === "finished" ? "2026-11-01T00:02:00Z" : null,
        state === "finished" ? '{"kind":"success","code":"ok"}' : null,
      );
  call("stuck", "done", "started");
  call("ok", "done", "finished");
  call("running", "live", "started");

  db.exec(step.sql);

  const row = (id: string) =>
    db.prepare("select * from tool_calls where id = ?").get(id) as Record<
      string,
      unknown
    >;
  assert.equal(row("stuck")["state"], "finished");
  assert.equal(row("stuck")["finished_at"], "2026-11-01T00:10:00Z");
  assert.equal(row("stuck")["state_seq"], 3);
  assert.equal(JSON.parse(String(row("stuck")["outcome"])).kind, "uncertain");
  assert.equal(row("ok")["finished_at"], "2026-11-01T00:02:00Z");
  assert.equal(row("ok")["state_seq"], 2);
  assert.equal(row("running")["state"], "started");
});
