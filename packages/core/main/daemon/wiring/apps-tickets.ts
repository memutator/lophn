import { ok } from "../../../../base/mod.ts";
import { ticketUploadSummary } from "../../../../protocol/coding-agent/ticket/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import {
  createExamplesCheckHandler,
  createTicketCheckHandler,
  type TicketCheckClient,
} from "../../../apps/tickets/mod.ts";
import { requestExamples } from "../../../problems/tests/mod.ts";
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

// examples test 요청 자격이다. RequestTest는 scope.targets가 정확히 { app }이기를 요구하므로 앱마다
// 만든다. machine 자격은 기동마다 새 값으로 덮이니 요청 때 기록한다.
function examplesRequestContext(app: string): RequestContext {
  return {
    principal: "machine:ticket-examples",
    actor: "machine",
    scope: { operations: ["RequestTest"], targets: { app } },
    // 대상 판정은 conditions의 app을 본다. 비면 RequestTest가 forbidden이다(coding token과 같은 꼴).
    conditions: { app },
    credential_ref: `machine:ticket-examples:${app}`,
  };
}

export const appsTicketsWiring: WiringFactory = () => {
  let claimSweep: ReturnType<typeof setInterval> | undefined;
  return {
    name: "apps-tickets",
    records: () => [ticketMachineContext as never],
    build(ctx) {
      // 완료 보고가 나면 check를 한 번 확인해 결과를 남긴다. examples check는 test를 요청하고, 검증이
      // 끝나면 그 결과를 남긴다.
      const work: TicketCheckClient["work"] = (input) =>
        ctx.runtime.readers.read(
          { resource: "tickets", method: "check_work" },
          ticketMachineContext,
          input,
        );
      const examples = requestExamples({
        dataRoot: ctx.root.path,
        work,
        request: async (input) => {
          const requester = examplesRequestContext(input.app);
          const recorded = await ctx.runtime.record(requester as never);
          if (!recorded.ok) return recorded;
          return ctx.writer.command(requester as never, {
            command: "RequestTest",
            input,
            compare: {},
            idempotency_key: input.request_key,
            prepared: [],
          });
        },
      });
      const client: TicketCheckClient = {
        work,
        requestExamples: (input) => examples(input),
        record: (call, idempotencyKey) =>
          ctx.writer.command(ticketMachineContext as never, {
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
      ctx.reactor.on(
        "VerificationRecorded",
        createExamplesCheckHandler(client),
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
      const settled = await ctx.writer.command(
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
      await ctx.writer.command(ticketMachineContext as never, {
        command: "ExpireTicketClaim",
        input: claim,
        compare: {},
        idempotency_key: `expire:${claim.ticket}:${claim.claim_seq}`,
        prepared: [],
      });
    }
  });
}
