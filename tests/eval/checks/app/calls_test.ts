import { assertEquals } from "@std/assert";
import type { SentCall, TrialRecord } from "../../types.ts";
import { aeCallsOnlyToCodingAgent } from "./calls.ts";

function sent(over: Partial<SentCall>): SentCall {
  return {
    tool_call: "tcl_x",
    order: 0,
    to: null,
    reply: "conversation",
    body: "",
    outcome: { kind: "success", code: "ok" },
    call: null,
    state: "accepted",
    fail_reason: null,
    record: null,
    receiver: null,
    receiver_session: null,
    receiver_place: null,
    ...over,
  } as SentCall;
}

function trialOf(calls: SentCall[]): TrialRecord {
  return {
    sessions: [{ agent: { role: "app_engineer" }, sent_calls: calls }],
    coding: [{ session: "ses_coding" }],
  } as unknown as TrialRecord;
}

function pass(calls: SentCall[]): boolean {
  const check = aeCallsOnlyToCodingAgent("x");
  const r = check.run({ trial: trialOf(calls) } as never) as { pass: boolean };
  return r.pass;
}

Deno.test("실패한 role+place call 뒤에 열린 coding session으로 간 답은 통과한다", () => {
  assertEquals(
    pass([
      sent({
        to: { role: "coding_agent", place: { app: "app_1" } },
        reply: "none",
        outcome: { kind: "failure", code: "unavailable" },
        state: "failed",
      }),
      sent({ to: { session: "ses_coding" } }),
    ]),
    true,
  );
});

Deno.test("lophn이나 다른 App Engineer에게 간 call은 떨어진다", () => {
  const coding = sent({ to: { session: "ses_coding" } });
  assertEquals(pass([coding, sent({ to: { role: "lophn" } })]), false);
  assertEquals(pass([coding, sent({ to: { session: "ses_other" } })]), false);
  assertEquals(
    pass([
      coding,
      sent({ to: { role: "app_engineer", place: { app: "a" } } }),
    ]),
    false,
  );
});
