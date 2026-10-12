import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_RUN_LIMITS,
  runLimitsSchema,
  runOutcomeSchema,
  runSourceSchema,
} from "./run-values.ts";

const message = "msg_01arz3ndektsv4rrffq69g5fav";
const run = "run_01arz3ndektsv4rrffq69g5fav";
const hash = "a".repeat(64);

Deno.test("lophn-agent/harness/run-loop#R1: source is a strict tagged union", () => {
  assert(runSourceSchema.safeParse({ kind: "message", message }).success);
  assert(
    runSourceSchema.safeParse({
      kind: "handoff",
      sender_run: run,
      original_message: message,
      body: hash,
      references: [],
      dedup_key: "handoff-1",
    }).success,
  );
  assert(
    !runSourceSchema.safeParse({
      kind: "message",
      message,
      scheduled_at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
  assert(
    !runSourceSchema.safeParse({
      kind: "handoff",
      sender_run: run,
      original_message: message,
      body: hash,
      references: [],
      dedup_key: " ",
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R18: outcome reasons stay inside the canonical pairs", () => {
  assert(
    runOutcomeSchema.safeParse({
      kind: "completed",
      reason: "answer_completed",
    }).success,
  );
  assert(
    runOutcomeSchema.safeParse({
      kind: "stopped",
      reason: "no_answer",
    }).success,
  );
  assert(
    !runOutcomeSchema.safeParse({
      kind: "completed",
      reason: "user_stopped",
    }).success,
  );
  assert(
    !runOutcomeSchema.safeParse({
      kind: "failed",
      reason: "answer_completed",
    }).success,
  );
  assert(
    !runOutcomeSchema.safeParse({
      kind: "stopped",
      reason: "model_error",
      detail: "raw",
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R20: limits are positive safe integers with the default triple", () => {
  assertEquals(DEFAULT_RUN_LIMITS, {
    model_attempts: 30,
    stall_ms: 300000,
    active_ms: 1800000,
  });
  assert(runLimitsSchema.safeParse(DEFAULT_RUN_LIMITS).success);
  for (
    const limits of [
      { ...DEFAULT_RUN_LIMITS, model_attempts: 0 },
      { ...DEFAULT_RUN_LIMITS, stall_ms: -1 },
      { ...DEFAULT_RUN_LIMITS, active_ms: 1.5 },
      { ...DEFAULT_RUN_LIMITS, model_attempts: Number.MAX_SAFE_INTEGER + 1 },
    ]
  ) assert(!runLimitsSchema.safeParse(limits).success);
});
