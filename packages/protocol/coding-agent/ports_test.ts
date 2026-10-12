import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  TICKET_CLAIM_REJECTS,
  TicketClaimCheck,
  type TicketClaimChecker,
} from "./ports.ts";

const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";

Deno.test("coding-agent/tickets#R13: TicketClaimCheck는 같은 port key로 현재 claim을 판정한다", () => {
  assertEquals(TicketClaimCheck.name, "TicketClaimCheck");
  assert(Object.isFrozen(TicketClaimCheck));
  assertEquals(TICKET_CLAIM_REJECTS, [
    "missing",
    "expired",
    "released",
    "revoked",
    "changed",
    "wrong_connection",
    "not_ready",
    "ticket_closed",
  ]);
  const check: TicketClaimChecker = (input) =>
    input.claim_seq === "8" && input.connection === CAC
      ? ok({ ok: true, expires_at: input.now })
      : ok({ ok: false, reason: "expired" });
  const held = check({
    ticket: TKT,
    claim_seq: "8",
    connection: CAC,
    now: "2026-10-05T00:00:00.000Z",
  });
  assert(held.ok && held.value.ok);
  const stale = check({
    ticket: TKT,
    claim_seq: "7",
    connection: CAC,
    now: "2026-10-05T01:00:00.000Z",
  });
  assert(stale.ok && !stale.value.ok && stale.value.reason === "expired");
  const failed = err({ code: "conflict" as const, message: "closed" });
  assert(!failed.ok);
});
