import { ok } from "../../../../base/mod.ts";
import type { InternalSubscription } from "../../../events/internal-subscription.ts";
import { ticketUploadSummary } from "../../../../protocol/coding-agent/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import {
  startTicketCheckFeed,
  TICKET_CHECK_FEED_CONTEXT,
  TICKET_CHECK_OP,
  TICKET_CHECKER_KIND,
  TICKET_CHECKER_OPERATIONS,
  TICKET_CHECKER_PRINCIPAL,
  ticketCheckerPolicies,
  ticketCheckerSpec,
} from "../../../apps/tickets/checker/connection.ts";
import { ticketSummaryUploadHandler } from "../../../apps/tickets/summary-upload.ts";
import { ticketClaimSweepIntervalMs } from "../../../apps/tickets/register.ts";
import {
  createWorkerChannel,
  type WiringContext,
  type WiringFactory,
} from "./context.ts";

// sweep가 expire_claim을 제출할 machine credential. 기록이 없으면 writer가
// 만료 정리를 거절하므로 기동을 여기서 멈춘다.
const claimSweepContext: RequestContext = {
  principal: "machine:ticket-claims",
  actor: "machine",
  scope: {
    operations: ["ExpireTicketClaim", "TicketClaimSweep"],
    targets: {},
  },
  conditions: {},
  credential_ref: "machine:ticket-claims",
};

export const appsTicketsWiring: WiringFactory = () => {
  // ticket checker worker 요청 통로. 같은 통로 모양을 쓴다.
  const checkerChannel = createWorkerChannel();
  let claimSweep: ReturnType<typeof setInterval> | undefined;
  let ticketCheckFeed: InternalSubscription | undefined;
  return {
    name: "apps-tickets",
    // ticket checker(machine)가 판정 사실을 읽고 결과를 기록한다.
    operations: () => ticketCheckerPolicies(),
    records: () => [claimSweepContext as never],
    build: (ctx) =>
      ok({
        uploads: [[
          // ticket 완료 보고 summary: purpose는 ticket 등록값(ticket_summary)으로 고정이다.
          `${ticketUploadSummary.resource}/${ticketUploadSummary.method}`,
          ticketSummaryUploadHandler({ current: ctx.prepareRelay }),
        ]],
      }),
    async start(ctx) {
      // ticket claim 만료·회수 정리. 60초마다와 재시작 때 후보를 읽고 expire_claim을
      // 제출한다. timer는 표를 쓰지 않는다.
      claimSweep = setInterval(
        () => sweepTicketClaims(ctx),
        ticketClaimSweepIntervalMs,
      );
      await sweepTicketClaims(ctx);
      // coding-agent/checker. 보고된 ticket의 조건을 machine actor로 판정하는 상시 worker다.
      // record_checks를 등록하지 않은 조립은 띄우지 않는다. 띄우지 못해도 core는
      // 계속 선다: 판정이 멈출 뿐 ticket은 reported로 남는다(없는 검사를 성공으로 꾸미지 않는다).
      const checkerSpec = ticketCheckerSpec({ dataRoot: ctx.root.path });
      if (
        !checkerSpec ||
        !ctx.allRoutes.some((route) =>
          route.name === TICKET_CHECKER_OPERATIONS[1]
        )
      ) return ok(undefined);
      const issued = await ctx.registry.issue({
        actor: "machine",
        principal: TICKET_CHECKER_PRINCIPAL,
        scope: {
          operations: [...TICKET_CHECKER_OPERATIONS],
          targets: { task: "coding-agent" },
        },
        conditions: { task: "coding-agent", process: TICKET_CHECKER_KIND },
      });
      const current = issued.ok
        ? ctx.registry.revalidate({
          credential_ref: issued.value.credential_ref,
        })
        : issued;
      const recorded = issued.ok && current.ok
        ? await ctx.runtime.record(current.value)
        : current;
      const feedRecorded = await ctx.runtime.record(TICKET_CHECK_FEED_CONTEXT);
      if (!(issued.ok && recorded.ok && feedRecorded.ok)) return ok(undefined);
      const started = await ctx.io.start(
        checkerSpec,
        {
          type: "hello",
          core_epoch: ctx.epoch,
          process_identity: ctx.epoch,
          kind: TICKET_CHECKER_KIND,
          task: "coding-agent",
          scope: { operations: [], targets: {} },
          credential: issued.value.token,
          api_port: ctx.server.port,
        },
        { onMessage: (message) => checkerChannel.onMessage(message) },
      );
      if (started.ok) {
        checkerChannel.bind((payload) =>
          ctx.io.send(TICKET_CHECKER_KIND, payload).then((sent) => sent.ok)
        );
        // VerificationRecorded·ReleaseActivated·ReleaseSuperseded·TicketCompletionReported가 오면
        // worker가 정본을 다시 읽는다. 구독이 열릴 때도 한 번 깨워 닫혀 있던 동안을 따라잡는다.
        ticketCheckFeed = startTicketCheckFeed({
          runtime: ctx.runtime,
          wake: () => checkerChannel.request(TICKET_CHECK_OP, {}, 30_000),
        });
      }
      return ok(undefined);
    },
    closeIntake() {
      ticketCheckFeed?.stop();
    },
    closeWork() {
      if (claimSweep !== undefined) clearInterval(claimSweep);
    },
  };
};

// 만료·회수된 ticket claim을 정리한다. 60초 timer와 재시작이 부른다. 후보 read 뒤 expire_claim을 제출한다.
function sweepTicketClaims(ctx: WiringContext): Promise<void> {
  const nowMs = ctx.clock.nowMs();
  const now = new Date(nowMs).toISOString();
  return ctx.runtime.prunePrepared(nowMs).then(() =>
    ctx.runtime.readers.read(
      { resource: "tickets", method: "claim_sweep" },
      claimSweepContext,
      { now, revoked: [] },
    )
  ).then(async (found) => {
    if (!found.ok) return;
    const claims = (found.value as {
      claims?: { ticket: string; claim_seq: string }[];
    }).claims ?? [];
    for (const claim of claims) {
      await ctx.runtime.writer.command(claimSweepContext as never, {
        command: "ExpireTicketClaim",
        input: claim,
        compare: {},
        idempotency_key: `expire:${claim.ticket}:${claim.claim_seq}`,
        prepared: [],
      });
    }
  });
}
