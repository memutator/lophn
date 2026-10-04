import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import {
  TERM_EVENTS,
  termDefined,
  termDefineInputSchema,
  termProposeInputSchema,
} from "./terms.ts";
import {
  GLOSSARY_PAGE_LIMIT,
  questionActionEvidenceSchema,
  TERM_ROUTES,
  termDefine,
  termListOutputSchema,
  termUpdate,
} from "./term-routes.ts";

const context = "ctx_01arz3ndektsv4rrffq69g5fav";
const term = "trm_01arz3ndektsv4rrffq69g5fav";
const document = "doc_01arz3ndektsv4rrffq69g5fav";
const version = "ver_01arz3ndektsv4rrffq69g5fav";
const question = "qst_01arz3ndektsv4rrffq69g5fav";
const evidence = [{
  document,
  version,
  section: "용어",
  start_line: 4,
  end_line: 6,
}];
const propose = { id: term, context, name: "범위", evidence };

// deno-fmt-ignore
const termRoutePaths = ["/v1/terms/propose", "/v1/terms/define", "/v1/terms/update", "/v1/terms/archive", "/v1/terms/unarchive", "/v1/terms/list", "/v1/terms/get"];
// deno-fmt-ignore
const termEventTypes = ["TermProposed", "TermDefined", "TermUpdated", "TermArchived", "TermUnarchived"];

Deno.test("documents/terms#R2: route and event names match architecture and define is user only", () => {
  assertEquals(TERM_ROUTES.map(routePath), termRoutePaths);
  assertEquals(TERM_EVENTS.map((event) => event.type), termEventTypes);
  assertEquals(
    ROUTES.filter((route) => route.resource === "terms").map(routePath),
    termRoutePaths,
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Term")).map((event) =>
      event.type
    ),
    termEventTypes,
  );
  for (const route of TERM_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assertEquals(termDefine.actors, ["user"]);
  assertEquals(termUpdate.actors, ["user", "agent"]);
  assert(
    questionActionEvidenceSchema.safeParse({
      question,
      option_key: "accept",
      answered_seq: "12",
    }).success,
  );
  assert(
    !questionActionEvidenceSchema.safeParse({
      question: question.replace("qst_", "run_"),
      option_key: "accept",
      answered_seq: "12",
    }).success,
  );
});

Deno.test("documents/terms#R1: an agent candidate requires fixed occurrence evidence", () => {
  assert(termProposeInputSchema.safeParse(propose).success);
  assert(
    termProposeInputSchema.safeParse({
      ...propose,
      evidence: [{ ...evidence[0], section: null }],
    }).success,
  );
  for (
    const value of [
      { ...propose, evidence: [] },
      {
        ...propose,
        evidence: [{
          ...evidence[0],
          section: null,
          start_line: null,
          end_line: null,
        }],
      },
      { ...propose, evidence: [...evidence, ...evidence] },
      { ...propose, extra: true },
      { ...propose, name: "   " },
      { ...propose, id: term.replace("trm_", "ctx_") },
    ]
  ) assert(!termProposeInputSchema.safeParse(value).success);
});

Deno.test("documents/terms#R2: defining a term is a person decision", () => {
  assert(
    termDefineInputSchema.safeParse({
      term,
      name: "범위",
      definition: "이번 판단의 대상",
    }).success,
  );
  assert(
    termDefineInputSchema.safeParse({
      id: term,
      context,
      name: "범위",
      definition: "이번 판단의 대상",
      evidence: [],
    }).success,
  );
  assert(
    !termDefineInputSchema.safeParse({
      term,
      id: term,
      context,
      name: "범위",
      definition: "이번 판단의 대상",
    }).success,
  );
  assert(
    !termDefineInputSchema.safeParse({
      term,
      name: "범위",
      definition: "   ",
    }).success,
  );
  assert(
    termDefined.payload.safeParse({
      context,
      name: "범위",
      before_definition: null,
      definition: "이번 판단의 대상",
      before_revision: null,
    }).success,
  );
});

Deno.test("documents/terms#R4: glossary reads definitions and candidates apart", () => {
  assertEquals(GLOSSARY_PAGE_LIMIT, 30);
  const defined = {
    id: term,
    context,
    name: "범위",
    definition: "이번 판단의 대상",
    evidence,
    revision: "5",
    status: "active",
  };
  const candidate = { ...defined, definition: null, name: "후보" };
  assert(
    termListOutputSchema.safeParse({
      definitions: [defined],
      candidates: [candidate],
      complete: true,
      next_cursor: null,
      as_of_seq: "9",
    }).success,
  );
  assert(
    !termListOutputSchema.safeParse({
      definitions: Array.from({ length: 31 }, () => defined),
      candidates: [],
      complete: false,
      next_cursor: "next",
      as_of_seq: "9",
    }).success,
  );
});
