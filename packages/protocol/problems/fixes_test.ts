import { assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import { routePath } from "../base/route.ts";
import {
  EVENTS,
  fixRecordInputSchema,
  fixRecordSchema,
  listProblemFixes,
  listProblemFixesInputSchema,
  problemFixRecorded,
  recordProblemFix,
  recordProblemFixInputSchema,
  ROUTES,
} from "./mod.ts";

const id = (prefix: string) => `${prefix}_01arz3ndektsv4rrffq69g5fav`;
const hash = "b".repeat(64);

function fix() {
  return {
    before: id("rel"),
    after: `${"rel"}_00000000000000000000000001`,
    summary: hash,
    verification: [id("vrf")],
    ticket: id("tkt"),
    claim_seq: "3",
  };
}

Deno.test("problems/repairs#R1: record and list fix routes match the architecture table", () => {
  const routes = [recordProblemFix, listProblemFixes];
  assertEquals(
    routes.map((route) => [route.name, routePath(route), route.kind]),
    [
      ["RecordProblemFix", "/v1/problems/record-fix", "command"],
      ["ListProblemFixes", "/v1/problems/list-fixes", "read"],
    ],
  );
  assertEquals(recordProblemFix.actors, ["coding_agent"]);
  for (const route of routes) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(
      route.errors.every((error) => ERROR_CODES.includes(error)),
      true,
    );
  }
  assertEquals(problemFixRecorded.type, "ProblemFixRecorded");
  assertEquals(EVENTS.includes(problemFixRecorded), true);
  assertEquals(ALL_EVENTS.includes(problemFixRecorded), true);
});

Deno.test("problems/repairs#R1: a fix names two different releases and a nonblank summary", () => {
  const value = fix();
  assertEquals(fixRecordInputSchema.safeParse(value).success, true);
  assertEquals(
    fixRecordInputSchema.safeParse({ ...value, after: value.before }).success,
    false,
  );
  assertEquals(
    fixRecordInputSchema.safeParse({
      ...value,
      summary: "changed the save path",
    })
      .success,
    false,
  );
  assertEquals(
    recordProblemFixInputSchema.safeParse({
      problem: id("prb"),
      fix: value,
      idempotency_key: "fix-1",
      actor: "coding_agent",
    }).success,
    false,
  );
  assertEquals(
    recordProblemFixInputSchema.safeParse({
      problem: id("rpt"),
      fix: value,
      idempotency_key: "fix-1",
    }).success,
    false,
  );
});

Deno.test("problems/repairs#R2: an empty verification list is recorded and a duplicate is rejected", () => {
  const value = { ...fix(), verification: [] as string[] };
  assertEquals(fixRecordInputSchema.safeParse(value).success, true);
  assertEquals(
    fixRecordInputSchema.safeParse({
      ...fix(),
      verification: [id("vrf"), id("vrf")],
    }).success,
    false,
  );
  // 과거 ticket 없는 이력은 읽기에서만 null이다. 새 제출은 ticket·claim이 필수다.
  assertEquals(
    fixRecordSchema.safeParse({ ...value, ticket: null, claim_seq: null })
      .success,
    true,
  );
  assertEquals(
    fixRecordInputSchema.safeParse({ ...value, ticket: null, claim_seq: null })
      .success,
    false,
  );
});

Deno.test("problems/repairs#R1: fix history rejects a wrong cursor prefix", () => {
  assertEquals(
    listProblemFixesInputSchema.safeParse({ problem: id("prb"), cursor: "8" })
      .success,
    true,
  );
  assertEquals(
    listProblemFixesInputSchema.safeParse({ problem: id("tkt"), cursor: "8" })
      .success,
    false,
  );
  assertEquals(
    listProblemFixesInputSchema.safeParse({ problem: id("prb"), logs: true })
      .success,
    false,
  );
});
