import { assert, assertEquals } from "@std/assert";
import { eventEnvelopeSchema } from "../platform/events.ts";
import { ticketTestLinkInputSchema } from "../problems/tests.ts";
import { conditionHash } from "./ticket-hash.ts";
import {
  ticketCreated,
  ticketCreateInputSchema,
  ticketMadeReady,
  ticketMakeReadyInputSchema,
  ticketShowOutputSchema,
} from "./ticket-routes.ts";
import { acceptanceCheckInputSchema } from "./ticket-values.ts";
import {
  APP,
  AT,
  CAC,
  commandCheck,
  HASH,
  PRB,
  QST,
  readyCreate,
  TKT,
  VER,
  versionRef,
} from "./ticket-fixtures.ts";

const META = { as_of_seq: "4", next_cursor: null };

Deno.test("coding-agent/tickets#R1: 두 종류만 받고 다른 종류와 앱 둘은 거절한다", () => {
  ticketCreateInputSchema.parse(readyCreate);
  ticketCreateInputSchema.parse({
    ...readyCreate,
    kind: "repair",
    problems: [PRB],
    conditions: [
      { kind: "app_test" },
      { kind: "reproduction_test", problem: PRB, test_hash: HASH },
      { kind: "problems_closed" },
    ],
  });
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      kind: "investigation",
    }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      apps: [APP, APP],
    }).success,
  );
});

Deno.test("coding-agent/tickets#R2: 상한·공백·중복 근거를 거절하고 모르는 field를 거절한다", () => {
  assert(
    !ticketCreateInputSchema.safeParse({ ...readyCreate, title: " " }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      title: "x".repeat(121),
    }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      references: [versionRef, versionRef],
    }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      extra: true,
    }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      references: [{ ...versionRef, target: "app_" + VER.slice(4) }],
    }).success,
  );
});

Deno.test("coding-agent/tickets#R4: repair는 문제 1~12개, implementation은 빈 목록이다", () => {
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      kind: "repair",
      problems: [],
    }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      problems: [PRB],
    }).success,
  );
  const many = Array.from(
    { length: 13 },
    (_, index) => "prb_01h455vb4pex5v6nkc6gd5fdw" + index.toString(36),
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      kind: "repair",
      readiness: "needs_confirmation",
      needs: ["which problem"],
      references: [],
      adoption_questions: [],
      conditions: [],
      problems: many,
    }).success,
  );
});

Deno.test("coding-agent/tickets#R7: 조건 kind 여섯만 받고 자유 산문 조건을 거절한다", () => {
  for (
    const kind of [
      "app_test",
      "release_active",
      "problems_closed",
    ] as const
  ) {
    acceptanceCheckInputSchema.parse({ kind });
  }
  acceptanceCheckInputSchema.parse({
    kind: "human_confirmation",
    problem: PRB,
  });
  assert(
    !acceptanceCheckInputSchema.safeParse({
      kind: "prose",
      text: "looks fine",
    }).success,
  );
  assert(
    !acceptanceCheckInputSchema.safeParse({
      ...commandCheck,
      note: "please",
    }).success,
  );
});

Deno.test("coding-agent/tickets#R10: test command는 상대 경로만 받고 절대 경로와 루트 밖을 거절한다", () => {
  acceptanceCheckInputSchema.parse(commandCheck);
  acceptanceCheckInputSchema.parse({ ...commandCheck, argv: ["has space"] });
  assert(
    !acceptanceCheckInputSchema.safeParse({
      ...commandCheck,
      cwd: "/tmp",
    }).success,
  );
  assert(
    !acceptanceCheckInputSchema.safeParse({
      ...commandCheck,
      cwd: "../outside",
    }).success,
  );
  assert(
    !acceptanceCheckInputSchema.safeParse({
      ...commandCheck,
      timeout_ms: 0,
    }).success,
  );
  assert(
    !acceptanceCheckInputSchema.safeParse({
      ...commandCheck,
      executable: "deno\n-c",
    }).success,
  );
});

Deno.test("coding-agent/tickets#R12: needs_confirmation 생성은 근거가 비어도 되고 make_ready는 전체를 요구한다", () => {
  const draft = ticketCreateInputSchema.parse({
    ...readyCreate,
    readiness: "needs_confirmation",
    needs: ["which version was adopted"],
    references: [],
    adoption_questions: [],
    conditions: [],
  });
  assertEquals(draft.readiness, "needs_confirmation");
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      readiness: "needs_confirmation",
      needs: [],
    }).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse({
      ...readyCreate,
      references: [],
    }).success,
  );
  ticketMakeReadyInputSchema.parse({
    ticket: TKT,
    base_revision: "4",
    references: [versionRef],
    adoption_questions: [QST],
    conditions: readyCreate.conditions,
    inspect: [],
    preserve: [],
  });
  assert(
    !ticketMakeReadyInputSchema.safeParse({
      ticket: "ticket_01h455vb4pex5v6nkc6gd5fdw1",
      base_revision: "4",
      references: [versionRef],
      adoption_questions: [QST],
      conditions: readyCreate.conditions,
      inspect: [],
      preserve: [],
    }).success,
  );
});

Deno.test("coding-agent/tickets#R19: show는 state·readiness·claim·condition_hash를 준다", async () => {
  const hash = await conditionHash(commandCheck);
  assertEquals(hash.length, 64);
  const shown = ticketShowOutputSchema.parse({
    ...META,
    ticket: {
      id: TKT,
      state: "claimed",
      readiness: "ready",
      needs: [],
      app: APP,
      kind: "implementation",
      title: "ship the button",
      what: "add the button",
      why: "the screen has no way to save",
      problems: [],
      claim: { connection: CAC, claim_seq: "8", expires_at: AT },
      completion_seq: null,
      conditions: [{
        position: 0,
        kind: "test_command",
        input: commandCheck,
        condition_hash: hash,
      }],
      references: [versionRef],
      adoption_questions: [QST],
      inspect: [],
      preserve: [],
      revision: "8",
    },
  });
  assertEquals(shown.ticket.conditions[0]?.condition_hash, hash);
  ticketTestLinkInputSchema.parse({
    ticket: TKT,
    check_index: 0,
    check_hash: hash,
    completion_seq: "9",
  });
  eventEnvelopeSchema(ticketCreated).parse({
    seq: "4",
    type: "TicketCreated",
    subject: TKT,
    actor: "user",
    run: null,
    payload: {
      app: APP,
      kind: "implementation",
      problems: [],
      readiness: "needs_confirmation",
    },
    at: AT,
  });
  eventEnvelopeSchema(ticketMadeReady).parse({
    seq: "5",
    type: "TicketMadeReady",
    subject: TKT,
    actor: "agent:asg_01h455vb4pex5v6nkc6gd5fdw1",
    run: null,
    payload: { app: APP, kind: "repair", problems: [PRB] },
    at: AT,
  });
});
