import { ok } from "../../../../base/mod.ts";
import { ticketUploadSummary } from "../../../../protocol/coding-agent/ticket/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import { ticketSummaryUploadHandler } from "../../../apps/tickets/summary-upload.ts";
import { ticketClaimSweepIntervalMs } from "../../../apps/tickets/register.ts";
import { type WiringContext, type WiringFactory } from "./context.ts";

// 만료 정리(sweep)와 보고 검사 handler가 쓰는 machine 자격이다. 기록이 없으면 writer가 거절하므로
// 기동을 여기서 멈춘다.
export const ticketMachineContext: RequestContext = {
  principal: "machine:ticket-claims",
  actor: "machine",
  scope: {
    operations: [
      "ExpireTicketClaim",
      "TicketClaimSweep",
      "TicketCheckWork",
      "RecordTicketChecks",
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: "machine:ticket-claims",
};

export const appsTicketsWiring: WiringFactory = () => {
  let claimSweep: ReturnType<typeof setInterval> | undefined;
  return {
    name: "apps-tickets",
    records: () => [ticketMachineContext as never],
    build: (ctx) =>
      ok({
        uploads: [[
          // ticket 완료 보고 summary: purpose는 ticket 등록값(ticket_summary)으로 고정이다.
          `${ticketUploadSummary.resource}/${ticketUploadSummary.method}`,
          ticketSummaryUploadHandler({ current: ctx.prepareRelay }),
        ]],
      }),
    async start(ctx) {
      // ticket claim 만료 정리. 60초마다와 재시작 때 후보를 읽고 expire_claim을 제출한다.
      // timer는 표를 쓰지 않는다.
      claimSweep = setInterval(
        () => sweepTicketClaims(ctx),
        ticketClaimSweepIntervalMs,
      );
      await sweepTicketClaims(ctx);
      return ok(undefined);
    },
    closeWork() {
      if (claimSweep !== undefined) clearInterval(claimSweep);
    },
  };
};

// 만료된 ticket claim을 정리한다. 60초 timer와 재시작이 부른다. 후보 read 뒤 expire_claim을 제출한다.
function sweepTicketClaims(ctx: WiringContext): Promise<void> {
  const nowMs = ctx.clock.nowMs();
  const now = new Date(nowMs).toISOString();
  return ctx.runtime.prunePrepared(nowMs).then(() =>
    ctx.runtime.readers.read(
      { resource: "tickets", method: "claim_sweep" },
      ticketMachineContext,
      { now },
    )
  ).then(async (found) => {
    if (!found.ok) return;
    const claims = (found.value as {
      claims?: { ticket: string; claim_seq: string }[];
    }).claims ?? [];
    for (const claim of claims) {
      await ctx.runtime.writer.command(ticketMachineContext as never, {
        command: "ExpireTicketClaim",
        input: claim,
        compare: {},
        idempotency_key: `expire:${claim.ticket}:${claim.claim_seq}`,
        prepared: [],
      });
    }
  });
}
