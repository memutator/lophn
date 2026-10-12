import { assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  EVENTS,
  exceptionFingerprintInputSchema,
  getProblem,
  getProblemInputSchema,
  getProblemOutputSchema,
  getProblemUserOutputSchema,
  interpretationLinkInputSchema,
  linkProblemInterpretation,
  linkProblemInterpretationInputSchema,
  listProblems,
  listProblemsInputSchema,
  problemInterpretationLinked,
  problemSchema,
  problemWorkEnded,
  problemWorkStarted,
  reconcileProblemWork,
  reconcileProblemWorkInputSchema,
  ROUTES,
  userProblemReadOf,
  userProblemSchema,
} from "./mod.ts";

const id = (prefix: string) => `${prefix}_01arz3ndektsv4rrffq69g5fav`;

Deno.test("problems/grouping#R8: work and read routes match the architecture table", () => {
  const routes = [
    reconcileProblemWork,
    linkProblemInterpretation,
    listProblems,
    getProblem,
  ];
  assertEquals(
    routes.map((route) => [route.name, routePath(route), route.kind]),
    [
      ["ReconcileProblemWork", "/v1/problems/reconcile-work", "command"],
      [
        "LinkProblemInterpretation",
        "/v1/problems/link-interpretation",
        "command",
      ],
      ["ListProblems", "/v1/problems/list", "read"],
      ["GetProblem", "/v1/problems/get", "read"],
    ],
  );
  assertEquals(reconcileProblemWork.actors, ["machine"]);
  assertEquals(linkProblemInterpretation.actors, ["agent"]);
  for (const route of routes) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(
      route.errors.every((error) => ERROR_CODES.includes(error)),
      true,
    );
  }
  const events = [
    problemWorkStarted,
    problemWorkEnded,
    problemInterpretationLinked,
  ];
  assertEquals(events.map((event) => event.type), [
    "ProblemWorkStarted",
    "ProblemWorkEnded",
    "ProblemInterpretationLinked",
  ]);
  for (const event of events) {
    assertEquals(EVENTS.filter((entry) => entry === event).length, 1);
    assertEquals(ALL_EVENTS.filter((entry) => entry === event).length, 1);
  }
});

Deno.test("problems/grouping#R8: one open repair ticket and three statuses only", () => {
  const problem = {
    id: id("prb"),
    app: id("app"),
    group_key: { kind: "declared", code: "save_failed", discriminator: null },
    status: "open",
    work: null,
    interpretation: null,
    closure: null,
    seq: "1",
  };
  assertEquals(problemSchema.safeParse(problem).success, true);
  assertEquals(
    problemSchema.safeParse({ ...problem, status: "fixing" }).success,
    false,
  );
  assertEquals(
    problemSchema.safeParse({ ...problem, status: "fixing", work: id("tkt") })
      .success,
    true,
  );
  // ticket이 이어지면 work는 open 문제도 가진다(질문 Q3). fixing은 work가 있어야 한다.
  assertEquals(
    problemSchema.safeParse({ ...problem, work: id("tkt") }).success,
    true,
  );
  assertEquals(
    problemSchema.safeParse({ ...problem, status: "watching" }).success,
    false,
  );
});

Deno.test("problems/grouping#R1: reconcile work rejects an unknown field and a wrong id prefix", () => {
  const input = {
    problem: id("prb"),
    ticket: id("tkt"),
    ticket_event_seq: "4",
  };
  assertEquals(reconcileProblemWorkInputSchema.safeParse(input).success, true);
  assertEquals(
    reconcileProblemWorkInputSchema.safeParse({ ...input, claim: id("tkt") })
      .success,
    false,
  );
  assertEquals(
    reconcileProblemWorkInputSchema.safeParse({ ...input, problem: id("rpt") })
      .success,
    false,
  );
});

Deno.test("problems/grouping#R13: interpretation links a fixed version and section without changing status", () => {
  const link = { version: id("ver"), section: "cause" };
  assertEquals(interpretationLinkInputSchema.safeParse(link).success, true);
  assertEquals(
    interpretationLinkInputSchema.safeParse({ ...link, section: null }).success,
    true,
  );
  const input = { problem: id("prb"), interpretation: link };
  assertEquals(
    linkProblemInterpretationInputSchema.safeParse(input).success,
    true,
  );
  assertEquals(
    linkProblemInterpretationInputSchema.safeParse({
      ...input,
      status: "closed",
    })
      .success,
    false,
  );
  assertEquals(
    linkProblemInterpretationInputSchema.safeParse({
      ...input,
      interpretation: { ...link, version: id("doc") },
    }).success,
    false,
  );
});

Deno.test("problems/grouping#R2: a fingerprint keeps at most three relative frames", () => {
  const frame = { path: "src/save.ts", function: "save" };
  const input = { name: "TypeError", frames: [frame, frame, frame] };
  assertEquals(exceptionFingerprintInputSchema.safeParse(input).success, true);
  assertEquals(
    exceptionFingerprintInputSchema.safeParse({
      ...input,
      frames: [frame, frame, frame, frame],
    }).success,
    false,
  );
});

Deno.test("problems/grouping#R3: a fingerprint drops line, column, message and absolute paths", () => {
  const input = {
    name: "TypeError",
    frames: [{ path: "src/save.ts", function: "save" }],
  };
  assertEquals(exceptionFingerprintInputSchema.safeParse(input).success, true);
  assertEquals(
    exceptionFingerprintInputSchema.safeParse({
      ...input,
      frames: [{ ...input.frames[0], line: 12 }],
    }).success,
    false,
  );
  assertEquals(
    exceptionFingerprintInputSchema.safeParse({ ...input, message: "nope" })
      .success,
    false,
  );
  assertEquals(
    exceptionFingerprintInputSchema.safeParse({
      ...input,
      frames: [{ path: "/opt/app/src/save.ts", function: "save" }],
    }).success,
    false,
  );
  assertEquals(
    exceptionFingerprintInputSchema.safeParse({ name: "TypeError", frames: [] })
      .success,
    true,
  );
});

Deno.test("problems/grouping#R11: problem list limit is at most 100", () => {
  const input = { app: id("app"), status: "open", limit: 100 };
  assertEquals(listProblemsInputSchema.safeParse(input).success, true);
  assertEquals(
    listProblemsInputSchema.safeParse({ ...input, limit: 101 }).success,
    false,
  );
  assertEquals(
    listProblemsInputSchema.safeParse({ ...input, app: id("prb") }).success,
    false,
  );
  assertEquals(
    getProblemInputSchema.safeParse({ problem: id("prb"), raw: true }).success,
    false,
  );
});

Deno.test("problems/grouping#R11: problem detail carries the release at the first and latest report", () => {
  const detail = {
    problem: {
      id: id("prb"),
      app: id("app"),
      group_key: {
        kind: "declared",
        code: "payment_declined",
        discriminator: null,
      },
      status: "open",
      work: null,
      interpretation: null,
      closure: null,
      seq: "3",
    },
    text: "There is a problem to check in this app.",
    report_count: 2,
    first_observed_at: "2026-10-04T12:00:00.000Z",
    last_observed_at: "2026-10-04T12:05:00.000Z",
    first_release: id("rel"),
    last_release: null,
    as_of_seq: "3",
    next_cursor: null,
  };
  assertEquals(getProblemOutputSchema.safeParse(detail).success, true);
  const { first_release: _dropped, ...without } = detail;
  assertEquals(getProblemOutputSchema.safeParse(without).success, false);
  assertEquals(
    getProblemOutputSchema.safeParse({ ...detail, last_release: id("app") })
      .success,
    false,
  );
});

Deno.test("problems/grouping#R12 problems#T22: 사용자용 GetProblem은 ID 없는 problem과 detail만 준다", () => {
  const detail = {
    progress: { state: "fixing", label: "Fixing" },
    owner: {
      kind: "coding_agent",
      label: "A coding agent is working on this.",
    },
    needed_action: null,
    repair: {
      state: "in_progress",
      label: "In progress",
      needs: [],
      last_check_failed: false,
    },
    result: {
      fix_report: "none",
      fix_report_label: "No fix reported yet.",
      tests: { state: "not_run", label: "No tests have run.", items: [] },
    },
    closed: null,
  };
  const read = getProblemOutputSchema.parse({
    problem: {
      id: id("prb"),
      app: id("app"),
      group_key: { kind: "declared", code: "save_failed", discriminator: null },
      status: "fixing",
      work: id("tkt"),
      interpretation: { version: id("ver"), section: null },
      closure: null,
      seq: "4",
    },
    detail,
    text: "Saving failed.",
    report_count: 1,
    first_observed_at: null,
    last_observed_at: null,
    first_release: null,
    last_release: null,
    as_of_seq: "4",
    next_cursor: null,
  });
  // 내부 문제를 그대로 넘기면 거부한다(연결 식별자가 남으면 안 된다).
  assertEquals(
    getProblemUserOutputSchema.safeParse(read).success,
    false,
  );
  const user = userProblemReadOf(read);
  assertEquals(getProblemUserOutputSchema.safeParse(user).success, true);
  assertEquals(user?.problem, {
    id: id("prb"),
    app: id("app"),
    status: "fixing",
    closure: null,
    seq: "4",
  });
  assertEquals(JSON.stringify(user).includes(id("tkt")), false);
  assertEquals(JSON.stringify(user).includes(id("ver")), false);
  // detail이 없는 이전 응답은 사용자용으로 만들지 않는다.
  const { detail: _old, ...legacy } = read;
  assertEquals(userProblemReadOf(legacy), null);
  assertEquals(
    userProblemSchema.safeParse({ ...user?.problem, status: "closed" }).success,
    false,
  );
});
