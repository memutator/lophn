import { assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import { routePath } from "../base/route.ts";
import {
  applyProblemDecision,
  applyProblemDecisionInputSchema,
  closeProblemVerified,
  closeProblemVerifiedInputSchema,
  closureSchema,
  EVENTS,
  PROBLEM_DECISION,
  problemClosed,
  problemConfirmationRecorded,
  problemReopened,
  ROUTES,
  userProblemDecisionInputSchema,
} from "./mod.ts";

const id = (prefix: string) => `${prefix}_01arz3ndektsv4rrffq69g5fav`;

Deno.test("problems/closing#R6: close and decision routes match the architecture table", () => {
  const routes = [closeProblemVerified, applyProblemDecision];
  assertEquals(
    routes.map((route) => [route.name, routePath(route), route.kind]),
    [
      ["CloseProblemVerified", "/v1/problems/close-verified", "command"],
      ["ApplyProblemDecision", "/v1/problems/apply-decision", "command"],
    ],
  );
  assertEquals(closeProblemVerified.actors, ["machine"]);
  assertEquals(applyProblemDecision.actors, ["user"]);
  assertEquals(applyProblemDecision.confirmation, "required");
  assertEquals(applyProblemDecision.display_read, "/v1/problems/get");
  assertEquals(PROBLEM_DECISION, "problem_decision");
  for (const route of routes) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(
      route.errors.every((error) => ERROR_CODES.includes(error)),
      true,
    );
  }
  const events = [problemClosed, problemReopened, problemConfirmationRecorded];
  assertEquals(events.map((event) => event.type), [
    "ProblemClosed",
    "ProblemReopened",
    "ProblemConfirmationRecorded",
  ]);
  for (const event of events) {
    assertEquals(EVENTS.includes(event), true);
    assertEquals(ALL_EVENTS.includes(event), true);
  }
});

Deno.test("problems/closing#R13: the four closure reasons stay distinct", () => {
  const base = {
    basis_seq: "9",
    release: id("rel"),
    verification: null,
    confirmation: "a".repeat(43),
    last_report: null,
    note: null,
  };
  assertEquals(
    closureSchema.safeParse({
      ...base,
      reason: "verified",
      verification: id("vrf"),
      confirmation: null,
    }).success,
    true,
  );
  assertEquals(
    closureSchema.safeParse({ ...base, reason: "user_confirmed" }).success,
    true,
  );
  assertEquals(
    closureSchema.safeParse({
      ...base,
      reason: "recovered",
      last_report: id("rpt"),
    }).success,
    true,
  );
  assertEquals(
    closureSchema.safeParse({
      ...base,
      reason: "dismissed",
      note: "not our bug",
    })
      .success,
    true,
  );
  assertEquals(
    closureSchema.safeParse({ ...base, reason: "verified" }).success,
    false,
  );
  assertEquals(
    closureSchema.safeParse({ ...base, reason: "quiet" }).success,
    false,
  );
});

Deno.test("problems/closing#R8: dismiss needs one nonblank line and rejects an unknown field", () => {
  const decision = {
    choice: "dismiss",
    problem: id("prb"),
    basis_seq: "9",
    release: id("rel"),
    last_report: null,
    note: "expected this row",
  };
  assertEquals(
    userProblemDecisionInputSchema.safeParse(decision).success,
    true,
  );
  assertEquals(
    userProblemDecisionInputSchema.safeParse({ ...decision, note: "  " })
      .success,
    false,
  );
  assertEquals(
    userProblemDecisionInputSchema.safeParse({ ...decision, note: "a\nb" })
      .success,
    false,
  );
  assertEquals(
    applyProblemDecisionInputSchema.safeParse({ ...decision, actor: "user" })
      .success,
    false,
  );
  assertEquals(
    applyProblemDecisionInputSchema.safeParse({
      ...decision,
      problem: id("rpt"),
    })
      .success,
    false,
  );
});

Deno.test("problems/closing#R6: a human confirmation does not invent a verification", () => {
  const fixed = {
    choice: "fixed",
    problem: id("prb"),
    basis_seq: "9",
    release: id("rel"),
    last_report: null,
    note: null,
  };
  assertEquals(userProblemDecisionInputSchema.safeParse(fixed).success, true);
  assertEquals(
    userProblemDecisionInputSchema.safeParse({
      ...fixed,
      verification: id("vrf"),
    })
      .success,
    false,
  );
  assertEquals(
    closeProblemVerifiedInputSchema.safeParse({
      problem: id("prb"),
      verification: id("vrf"),
      problem_seq: "9",
      release: id("rel"),
    }).success,
    true,
  );
  assertEquals(
    closeProblemVerifiedInputSchema.safeParse({
      problem: id("app"),
      verification: id("vrf"),
      problem_seq: "9",
      release: id("rel"),
    }).success,
    false,
  );
});

Deno.test("problems/closing#R7: not visible names the release and the last report", () => {
  const decision = {
    choice: "not_visible",
    problem: id("prb"),
    basis_seq: "9",
    release: id("rel"),
    last_report: id("rpt"),
    note: null,
  };
  assertEquals(
    userProblemDecisionInputSchema.safeParse(decision).success,
    true,
  );
  assertEquals(
    userProblemDecisionInputSchema.safeParse({ ...decision, last_report: null })
      .success,
    false,
  );
});
