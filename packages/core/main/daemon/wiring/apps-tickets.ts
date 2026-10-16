import { ok } from "../../../../base/mod.ts";
import { ticketUploadSummary } from "../../../../protocol/coding-agent/ticket/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import {
  createTicketCheckHandler,
  type TicketCheckClient,
} from "../../../apps/tickets/mod.ts";
import { ticketSummaryUploadHandler } from "../../../apps/tickets/summary-upload.ts";
import { ticketClaimSweepIntervalMs } from "../../../apps/tickets/register.ts";
import { type WiringContext, type WiringFactory } from "./context.ts";

// 만료 정리(sweep)와 보고 검사 handler가 쓰는 machine 자격이다. 기록이 없으면 writer가 거절하므로
// 기동을 여기서 멈춘다.
const ticketMachineContext: RequestContext = {
  principal: "machine:ticket-claims",
  actor: "machine",
  scope: {
    operations: [
      "ExpireTicketClaim",
      "TicketClaimSweep",
      "TicketCheckWork",
      "RecordTicketChecks",
      "SettleTicketSessions",
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
    build(ctx) {
      // 완료 보고가 나면 check를 한 번 확인해 결과를 남긴다.
      const client: TicketCheckClient = {
        work: (input) =>
          ctx.runtime.readers.read(
            { resource: "tickets", method: "check_work" },
            ticketMachineContext,
            input,
          ),
        record: (call, idempotencyKey) =>
          ctx.runtime.writer.command(ticketMachineContext as never, {
            command: "RecordTicketChecks",
            input: call,
            compare: { base_revision: call.base_revision },
            idempotency_key: idempotencyKey,
            prepared: [],
          }),
      };
      ctx.reactor.on(
        "TicketCompletionReported",
        createTicketCheckHandler(client),
      );
      return ok({
        uploads: [[
          // ticket 완료 보고 summary: purpose는 ticket 등록값(ticket_summary)으로 고정이다.
          `${ticketUploadSummary.resource}/${ticketUploadSummary.method}`,
          ticketSummaryUploadHandler({ current: ctx.prepareRelay }),
        ]],
      });
    },
    async start(ctx) {
      // 살아 있는 coding session이 없는 기동이다. claim이 남은 session을 정산한다(보고 없이 끝났으면
      // CodingSessionEndedUnreported가 남는다).
      const settled = await ctx.runtime.writer.command(
        ticketMachineContext as never,
        {
          command: "SettleTicketSessions",
          input: {},
          compare: {},
          idempotency_key: crypto.randomUUID(),
          prepared: [],
        },
      );
      if (!settled.ok) {
        console.error(
          `apps-tickets: could not settle sessions (${settled.error.code})`,
        );
      }
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
