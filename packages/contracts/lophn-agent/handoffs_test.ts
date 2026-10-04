import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { handoffAllowed } from "./decision-values.ts";
import {
  HANDOFF_ROUTES,
  handoffResult,
  handoffSubmit,
  handoffSubmitInputSchema,
} from "./handoffs.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const hash = "c".repeat(64);

const input = {
  sender_run: `run_${suffix}`,
  receiver_run: "run_01brz3ndektsv4rrffq69g5fav",
  receiver_assignment: `asg_${suffix}`,
  from_role: "lophn",
  to_role: "app_engineer",
  original_message: `msg_${suffix}`,
  content: {
    what: "register the app",
    why: "the adopted design says so",
    excludes: [],
    expected_outputs: ["a registered app"],
  },
  body: hash,
  references: [{
    document: `doc_${suffix}`,
    version: `ver_${suffix}`,
    section: null,
    question: `qst_${suffix}`,
  }],
  dedup_key: "handoff-1",
};

Deno.test("lophn-agent/handoff#R1: only the declared role directions are accepted", () => {
  assertEquals(HANDOFF_ROUTES.map(routePath), [
    "/v1/handoffs/submit",
    "/v1/handoffs/status",
    "/v1/handoffs/result",
  ]);
  assertEquals(handoffSubmit.actors, ["agent"]);
  assert(
    HANDOFF_ROUTES.every((route) =>
      route.errors.every((code) => ERROR_CODES.includes(code))
    ),
  );
  assert(handoffAllowed("lophn", "app_engineer"));
  assert(handoffAllowed("context_engineer", "lophn"));
  assert(!handoffAllowed("context_engineer", "app_engineer"));
  assert(!handoffAllowed("operator", "lophn"));
  assert(!handoffAllowed("lophn", "operator"));
  assert(handoffSubmitInputSchema.safeParse(input).success);
  assert(
    !handoffSubmitInputSchema.safeParse({
      ...input,
      from_role: "operator",
      to_role: "lophn",
    }).success,
  );
});

Deno.test("lophn-agent/handoff#R3: a handoff needs the explanation and its fixed references", () => {
  assert(
    !handoffSubmitInputSchema.safeParse({
      ...input,
      content: { ...input.content, why: "   " },
    }).success,
  );
  assert(
    !handoffSubmitInputSchema.safeParse({
      ...input,
      content: { ...input.content, expected_outputs: [] },
    }).success,
  );
  assert(
    !handoffSubmitInputSchema.safeParse({ ...input, references: undefined })
      .success,
  );
});

Deno.test("lophn-agent/handoff#R8: a durable result is a fixed version or an absence reason", () => {
  const output = handoffResult.output;
  const common = { as_of_seq: "9", next_cursor: null };
  assert(
    output.safeParse({
      ...common,
      receiver_run: input.receiver_run,
      finished: true,
      result: hash,
      version: `ver_${suffix}`,
      absent_reason: null,
    }).success,
  );
  assert(
    output.safeParse({
      ...common,
      receiver_run: input.receiver_run,
      finished: true,
      result: hash,
      version: null,
      absent_reason: hash,
    }).success,
  );
  assert(
    !output.safeParse({
      ...common,
      receiver_run: input.receiver_run,
      finished: true,
      result: hash,
      version: `ver_${suffix}`,
      absent_reason: hash,
    }).success,
  );
  assert(
    !output.safeParse({
      ...common,
      receiver_run: input.receiver_run,
      finished: false,
      result: hash,
      version: null,
      absent_reason: null,
    }).success,
  );
});
