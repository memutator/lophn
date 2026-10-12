import { assert } from "@std/assert";
import { eventEnvelopeSchema } from "../events/events.ts";
import {
  ticketCancelInputSchema,
  ticketClaimInputSchema,
  ticketClaimReleased,
  ticketReportCompletionInputSchema,
} from "./ticket-claims.ts";
import { APP, AT, CAC, HASH, PRB, REL, TKT, VRF } from "./ticket-fixtures.ts";

Deno.test("coding-agent/tickets#R12: claim 입력과 만료 사유를 받는다", () => {
  ticketClaimInputSchema.parse({ ticket: TKT, base_revision: "4" });
  assert(
    !ticketClaimInputSchema.safeParse({
      ticket: TKT,
      base_revision: "4",
      connection: CAC,
    }).success,
  );
  eventEnvelopeSchema(ticketClaimReleased).parse({
    seq: "9",
    type: "TicketClaimReleased",
    subject: TKT,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      problems: [PRB],
      connection: CAC,
      claim_seq: "8",
      reason: "expired",
    },
    at: AT,
  });
  assert(
    !eventEnvelopeSchema(ticketClaimReleased).safeParse({
      seq: "9",
      type: "TicketClaimReleased",
      subject: TKT,
      actor: "machine",
      run: null,
      payload: {
        app: APP,
        problems: [],
        connection: CAC,
        claim_seq: "8",
        reason: "timeout",
      },
      at: AT,
    }).success,
  );
});

Deno.test("coding-agent/tickets#R17: 완료 보고는 claim seq와 release를 요구한다", () => {
  const blob = {
    preparation: "worker-preparation-1",
    principal: CAC,
    purpose: "ticket_summary",
    hash: HASH,
    size_bytes: 64,
  };
  ticketReportCompletionInputSchema.parse({
    ticket: TKT,
    claim_seq: "8",
    base_revision: "8",
    completion: {
      release: REL,
      summary_hash: HASH,
      outputs: [],
      fix_records: [],
      verifications: [VRF],
    },
    summary_blob: blob,
  });
  assert(
    !ticketReportCompletionInputSchema.safeParse({
      ticket: TKT,
      claim_seq: "8",
      base_revision: "8",
      completion: {
        release: "release_" + REL.slice(4),
        summary_hash: HASH,
        outputs: [],
        fix_records: [],
        verifications: [],
      },
      summary_blob: blob,
    }).success,
  );
  // summary blob은 ticket_summary purpose만 받는다.
  assert(
    !ticketReportCompletionInputSchema.safeParse({
      ticket: TKT,
      claim_seq: "8",
      base_revision: "8",
      completion: {
        release: REL,
        summary_hash: HASH,
        outputs: [],
        fix_records: [],
        verifications: [],
      },
      summary_blob: { ...blob, purpose: "document_file" },
    }).success,
  );
  // hash만 싣는 보고는 가리키는 바이트가 저장된 blob이어야 한다(hash 불일치 거절).
  assert(
    !ticketReportCompletionInputSchema.safeParse({
      ticket: TKT,
      claim_seq: "8",
      base_revision: "8",
      completion: {
        release: REL,
        summary_hash: HASH,
        outputs: [],
        fix_records: [],
        verifications: [],
      },
      summary_blob: { ...blob, hash: "cd".repeat(32) },
    }).success,
  );
});

Deno.test("coding-agent/tickets#R22: 취소 사유는 한 줄 1~200자이고 빈 값은 거절한다", () => {
  ticketCancelInputSchema.parse({
    ticket: TKT,
    base_revision: "4",
    reason: "wrong scope",
  });
  assert(
    !ticketCancelInputSchema.safeParse({
      ticket: TKT,
      base_revision: "4",
      reason: " ",
    }).success,
  );
  assert(
    !ticketCancelInputSchema.safeParse({
      ticket: TKT,
      base_revision: "4",
      reason: "x".repeat(201),
    }).success,
  );
  assert(
    !ticketCancelInputSchema.safeParse({
      ticket: TKT,
      base_revision: "4",
      reason: "two\nlines",
    }).success,
  );
});
