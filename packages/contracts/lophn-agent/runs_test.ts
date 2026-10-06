import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  DEFAULT_RUN_LIMITS,
  INITIAL_RUN_ELAPSED,
  runRecordSchema,
} from "./run-values.ts";
import {
  acceptRunCompareSchema,
  acceptRunInputSchema,
  confirmNextRunCompareSchema,
  confirmNextRunInputSchema,
  RUN_COMMANDS,
  RUN_EVENTS,
  runFinished,
  startRunInputSchema,
} from "./runs.ts";

import { runList, runRead, runResult } from "./run-reads.ts";

const run = "run_01arz3ndektsv4rrffq69g5fav";
const assignment = "asg_01arz3ndektsv4rrffq69g5fav";
const hash = "b".repeat(64);
const at = "2026-10-04T00:00:00.000Z";

const base = {
  id: run,
  assignment,
  session: null,
  source: { kind: "message", message: "msg_01arz3ndektsv4rrffq69g5fav" },
  continued_from: null,
  start_after: null,
  start_confirmed_seq: null,
  state: "accepted",
  basis: null,
  waiting_on: null,
  started_at: null,
  limits: DEFAULT_RUN_LIMITS,
  elapsed: INITIAL_RUN_ELAPSED,
  finished_at: null,
  outcome: null,
  result: null,
  state_seq: "1",
  accepted_seq: "1",
};

Deno.test("lophn-agent/harness/run-loop#R2: fourteen run routes and six named events", () => {
  assertEquals(RUN_COMMANDS.map(routePath), [
    "/v1/runs/accept",
    "/v1/runs/start",
    "/v1/runs/checkpoint",
    "/v1/runs/finish",
    "/v1/runs/stop",
    "/v1/runs/confirm-next",
    "/v1/runs/wait",
    "/v1/runs/resolve-wait",
    "/v1/runs/correct-waiting",
    "/v1/runs/recover",
    "/v1/runs/read",
    "/v1/runs/list",
    "/v1/runs/result",
    "/v1/runs/body",
  ]);
  assertEquals(RUN_EVENTS.map((event) => event.type), [
    "RunAccepted",
    "RunStarted",
    "RunWaited",
    "RunResumed",
    "RunRecovered",
    "RunFinished",
  ]);
  for (const route of RUN_COMMANDS) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("lophn-agent/harness/run-loop#R19: state fields stay coupled across the four states", () => {
  assert(runRecordSchema.safeParse(base).success);
  assert(
    runRecordSchema.safeParse({
      ...base,
      state: "running",
      basis: hash,
      started_at: at,
    }).success,
  );
  assert(
    runRecordSchema.safeParse({
      ...base,
      state: "waiting_user",
      basis: hash,
      started_at: at,
      waiting_on: "qst_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    runRecordSchema.safeParse({
      ...base,
      state: "finished",
      basis: hash,
      started_at: at,
      finished_at: at,
      outcome: { kind: "stopped", reason: "user_stopped" },
      result: hash,
    }).success,
  );
  assert(!runRecordSchema.safeParse({ ...base, basis: hash }).success);
  assert(
    !runRecordSchema.safeParse({
      ...base,
      state: "finished",
      finished_at: at,
      outcome: { kind: "completed", reason: "no_change" },
    }).success,
  );
  assert(
    !runRecordSchema.safeParse({
      ...base,
      waiting_on: "apr_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R3: accept rejects foreign source fields and self-shaped links", () => {
  const input = {
    id: run,
    assignment,
    session: null,
    source: { kind: "message", message: "msg_01arz3ndektsv4rrffq69g5fav" },
    continued_from: null,
    start_after: null,
  };
  assert(acceptRunInputSchema.safeParse(input).success);
  assert(
    !acceptRunInputSchema.safeParse({
      ...input,
      continued_from: run,
      start_after: run,
    }).success,
  );
  assert(
    !acceptRunInputSchema.safeParse({ ...input, actor: "machine" }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R6: finish event keeps started paired with started_at", () => {
  const payload = {
    assignment,
    started: false,
    started_at: null,
    outcome: { kind: "stopped", reason: "assignment_paused" },
    result: hash,
    finished_at: at,
  };
  assert(runFinished.payload.safeParse(payload).success);
  assert(!runFinished.payload.safeParse({ ...payload, started: true }).success);
  const scope = {
    role: "lophn",
    assignment,
    apps: [],
  };
  assert(
    startRunInputSchema.safeParse({
      run,
      basis: hash,
      limits: DEFAULT_RUN_LIMITS,
      scope,
    }).success,
  );
  assert(
    !startRunInputSchema.safeParse({
      run,
      basis: hash,
      limits: DEFAULT_RUN_LIMITS,
      scope,
      principal: "agent",
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R19: terminal unstarted runs keep null basis and zero elapsed", () => {
  const terminal = {
    ...base,
    state: "finished",
    finished_at: at,
    outcome: { kind: "stopped", reason: "user_stopped" },
    result: hash,
  };
  assert(runRecordSchema.safeParse(terminal).success);
  for (
    const value of [
      { ...terminal, basis: hash },
      { ...terminal, started_at: at },
      { ...terminal, elapsed: { ...INITIAL_RUN_ELAPSED, stall_ms: 1 } },
      { ...terminal, elapsed: { ...INITIAL_RUN_ELAPSED, active_ms: 1 } },
      { ...terminal, elapsed: { ...INITIAL_RUN_ELAPSED, checkpoint_at: at } },
      { ...terminal, accepted_seq: "2", state_seq: "1" },
      { ...terminal, start_confirmed_seq: "1" },
      { ...terminal, continued_from: run },
      { ...terminal, start_after: run },
      { ...terminal, waiting_on: "qst_01arz3ndektsv4rrffq69g5fav" },
    ]
  ) assert(!runRecordSchema.safeParse(value).success);
  assert(
    runRecordSchema.safeParse({
      ...terminal,
      future: true,
      outcome: { ...terminal.outcome, future: true },
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R3: each self link is rejected while equal nonself links remain legal", () => {
  const predecessor = "run_01arz3ndektsv4rrffq69g5faw";
  const input = {
    id: run,
    assignment,
    session: null,
    source: base.source,
    continued_from: predecessor,
    start_after: predecessor,
  };
  assert(acceptRunInputSchema.safeParse(input).success);
  assert(
    runRecordSchema.safeParse({
      ...base,
      continued_from: predecessor,
      start_after: predecessor,
      start_confirmed_seq: "1",
    }).success,
  );
  for (
    const value of [
      { ...input, continued_from: run },
      { ...input, start_after: run },
      { ...input, assignment: run },
      { ...input, source: { kind: "message", message: run } },
    ]
  ) assert(!acceptRunInputSchema.safeParse(value).success);
  assert(confirmNextRunInputSchema.safeParse({ run, predecessor }).success);
  assert(
    !confirmNextRunInputSchema.safeParse({ run, predecessor: run }).success,
  );
  assert(
    !confirmNextRunInputSchema.safeParse({ run, predecessor, confirmed: true })
      .success,
  );
  assert(
    confirmNextRunCompareSchema.safeParse({
      accepted_seq: "9007199254740993",
      predecessor_state_seq: "10",
    }).success,
  );
  assert(
    !confirmNextRunCompareSchema.safeParse({
      accepted_seq: 1,
      predecessor_state_seq: "10",
    }).success,
  );
  assert(acceptRunCompareSchema.safeParse({ assignment_revision: 1 }).success);
  for (const revision of ["1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert(
      !acceptRunCompareSchema.safeParse({ assignment_revision: revision })
        .success,
    );
  }
});

Deno.test("lophn-agent/handoff#R8: run result carries an immutable blob and canonical outcome instead of mutable result content", () => {
  const result = {
    run,
    state: "finished",
    outcome: { kind: "completed", reason: "no_change", future: true },
    result: hash,
    as_of_seq: "20",
    next_cursor: null,
    future: true,
  };
  assert(runResult.output.safeParse(result).success);
  for (
    const value of [
      { ...result, result: null },
      { ...result, outcome: null },
      { ...result, state: "running" },
      { ...result, result: { document: "current" } },
    ]
  ) assert(!runResult.output.safeParse(value).success);
  assert(
    runResult.output.safeParse({
      ...result,
      state: "accepted",
      outcome: null,
      result: null,
    }).success,
  );
  assert(!runResult.input.safeParse({ run, version: "latest" }).success);
});

Deno.test("lophn-agent/harness/run-loop#R2: run reads use strict queries and additive state at a consistent as_of seq", () => {
  const output = {
    run: { ...base, future: true },
    as_of_seq: "1",
    next_cursor: null,
    future: true,
  };
  assert(runRead.output.safeParse(output).success);
  assert(!runRead.output.safeParse({ ...output, as_of_seq: "0" }).success);
  assert(
    runList.output.safeParse({
      runs: [base],
      as_of_seq: "1",
      next_cursor: null,
    }).success,
  );
  assert(
    !runList.output.safeParse({
      runs: [base],
      as_of_seq: "0",
      next_cursor: null,
    }).success,
  );
  assert(!runRead.input.safeParse({ run, future: true }).success);
  assert(!runList.input.safeParse({ assignment, state: "archived" }).success);
});

Deno.test("lophn-agent/harness/run-loop#R19: malformed seq fields return schema failure rather than throwing", () => {
  for (const seq of ["bad", "1.5", "-1", "", "01"]) {
    assert(!runRecordSchema.safeParse({ ...base, accepted_seq: seq }).success);
    assert(!runRecordSchema.safeParse({ ...base, state_seq: seq }).success);
    assert(
      !runRead.output.safeParse({
        run: base,
        as_of_seq: seq,
        next_cursor: null,
      }).success,
    );
    assert(
      !runList.output.safeParse({
        runs: [base],
        as_of_seq: seq,
        next_cursor: null,
      }).success,
    );
  }
});
