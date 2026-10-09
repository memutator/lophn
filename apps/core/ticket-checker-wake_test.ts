// ticket checker의 깨움 event와 공개 정책(coding-agent/tickets#R20; plan coding-agent T45).
// ProblemClosed·ProblemReopened는 problems owner의 정책을 거쳐 checker 구독자에게도 열리고,
// 기존 공개(notifications)는 그대로이며 다른 자격은 계속 못 본다.
import { assert, assertEquals } from "@std/assert";
import type { RequestContext } from "../../packages/contracts/platform/mod.ts";
import { createEventRegistration } from "./problems.ts";
import { NOTIFICATIONS_CONTEXT } from "./platform.ts";
import {
  isTicketCheckWake,
  TICKET_CHECK_FEED_CONTEXT,
} from "./ticket-checker.ts";

const USER: RequestContext = {
  principal: "user-1",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "cred-user",
};
const OTHER_MACHINE: RequestContext = {
  ...USER,
  principal: "machine:other",
  actor: "machine",
};

function visible(type: string, ctx: RequestContext): boolean | undefined {
  const policy = createEventRegistration().visibility?.find((item) =>
    item.event.type === type
  );
  if (policy === undefined) return undefined;
  const seen = policy.handle({} as never, ctx, {} as never);
  assert(seen.ok);
  return seen.value;
}

Deno.test("coding-agent/tickets#R20: ProblemClosed and ProblemReopened wake the checker", () => {
  assert(isTicketCheckWake("ProblemClosed"));
  assert(isTicketCheckWake("ProblemReopened"));
  assert(isTicketCheckWake("ProblemConfirmationRecorded"));
  // 문제 접수 같은 다른 problems event는 깨움이 아니다.
  assert(!isTicketCheckWake("ProblemOpened"));
});

Deno.test("coding-agent/tickets#R20: the problems owner policy opens closure events to the checker feed and notifications only", () => {
  for (const type of ["ProblemClosed", "ProblemReopened"]) {
    assertEquals(visible(type, TICKET_CHECK_FEED_CONTEXT), true);
    assertEquals(visible(type, NOTIFICATIONS_CONTEXT), true);
    assertEquals(visible(type, USER), false);
    assertEquals(visible(type, OTHER_MACHINE), false);
  }
  // 사람의 not_fixed 결정은 checker feed에만 열린다.
  assertEquals(
    visible("ProblemConfirmationRecorded", TICKET_CHECK_FEED_CONTEXT),
    true,
  );
  assertEquals(visible("ProblemConfirmationRecorded", USER), false);
  assertEquals(visible("ProblemConfirmationRecorded", OTHER_MACHINE), false);
  // 열지 않은 event는 checker feed에도 계속 숨김이다.
  assertEquals(visible("ProblemOpened", TICKET_CHECK_FEED_CONTEXT), false);
});
