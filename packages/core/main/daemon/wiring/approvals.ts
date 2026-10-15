import { AsyncLocalStorage } from "node:async_hooks";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  agentGrantsSet,
  approvalsDecide,
  approvalsDecideTurn,
} from "../../../../protocol/approvals/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  APPROVAL_INTERNAL_COMMANDS,
  approvalsUnapplied,
  createApprovalLedger,
  createApprovals,
  createGrants,
  createSessionAllowances,
  gate,
  loadAgentGrant,
} from "../../../approvals/mod.ts";
import { appGrantsList } from "../../../../protocol/apps/grants.ts";
import { APPS_CONTROL_CONTEXT } from "../../../apps/control.ts";
import type { Bus } from "../../../events/ports.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { Writer } from "../../../storage/ledger/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

// Approvals가 request 표에 쓰고 읽는 core 내부 machine 자격이다. 기동 때 ledger에 기록한다.
export const APPROVALS_PRINCIPAL = "machine:approvals";

const APPROVALS_CONTEXT: AuthenticatedContext = {
  principal: APPROVALS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      ...APPROVAL_INTERNAL_COMMANDS.map((route) => route.name),
      approvalsUnapplied.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: APPROVALS_PRINCIPAL,
};

export const approvalsWiring: WiringFactory = () => {
  let approvals: ReturnType<typeof createApprovals> | undefined;
  // "항상" 결정은 결정한 사람의 자격으로 agent grant를 쓴다. 결정 handler 안에서만 부른다.
  const human = new AsyncLocalStorage<AuthenticatedContext>();
  return {
    name: "approvals",
    records: () => [APPROVALS_CONTEXT],
    build(ctx) {
      // Bus는 events가 만들어 slot으로 낸다.
      const bus = (ctx.peek as { bus?: Bus }).bus;
      if (bus === undefined) {
        return err({
          code: "unavailable",
          message: "approvals needs the event bus",
        });
      }
      const writer = () => ctx.runtime.writer;
      const send = (
        who: AuthenticatedContext,
        command: string,
        input: unknown,
      ): Promise<Result<unknown>> =>
        writer().command(who, {
          command,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        }).then((done) => done.ok ? ok(done.value.result) : done);
      const read =
        (path: string) => (agent: Parameters<typeof loadAgentGrant>[1]) => {
          const connection = openConnection(path);
          if (!connection.ok) return Promise.resolve(connection);
          try {
            return Promise.resolve(loadAgentGrant(connection.value.sql, agent));
          } finally {
            connection.value.close();
          }
        };
      const service = createApprovals({
        gate,
        grants: createGrants({
          async appGrantsOf(app) {
            const listed = await ctx.runtime.readers.read(
              appGrantsList,
              APPS_CONTROL_CONTEXT,
              { app, limit: 200 },
            );
            if (!listed.ok) return listed;
            return ok((listed.value as { grants: never[] }).grants);
          },
          readAgentGrant: read(ctx.ledgerPath),
          async writeAgentGrant(agent, entries) {
            const who = human.getStore();
            if (who === undefined) {
              return err({
                code: "forbidden",
                message: "only the user changes an agent grant",
              });
            }
            const done = await send(who, agentGrantsSet.name, {
              agent,
              entries,
            });
            if (!done.ok) return done;
            return ok((done.value as { grant: never }).grant);
          },
          settings: ctx.settings,
        }),
        allowances: createSessionAllowances(),
        bus,
        ledger: createApprovalLedger({
          command: (name, input) => send(APPROVALS_CONTEXT, name, input),
          read: (route, input) =>
            ctx.runtime.readers.read(route, APPROVALS_CONTEXT as never, input),
        }),
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
      });
      approvals = service;
      const decideTurn: MemoryHandler = (who, body) =>
        human.run(who, () => service.decideTurn(who, body));
      return ok({
        memory: [[
          `${approvalsDecideTurn.resource}/${approvalsDecideTurn.method}`,
          decideTurn,
        ]],
        // 사람이 허락하면 commit된 뒤 적용한다. 결과는 recordApplied가 남기고 그때 ApprovalDecided가 나간다.
        writer: (inner: Writer): Writer => ({
          async command(who, envelope) {
            const done = await inner.command(who, envelope);
            if (
              done.ok && !done.value.replayed &&
              envelope.command === approvalsDecide.name
            ) {
              const out = approvalsDecide.output.safeParse(done.value.result);
              if (out.success && out.data.request.status === "allow") {
                void service.applyAllowed(out.data.request).then((applied) => {
                  if (!applied.ok) {
                    console.error(
                      `approvals: could not record the apply result (${applied.error.code})`,
                    );
                  }
                });
              }
            }
            return done;
          },
          readResult: (who, key) => inner.readResult(who, key),
          close: () => inner.close(),
        }),
      });
    },
    // 허락됐는데 결과를 남기기 전에 꺼진 request를 다시 적용한다. applier는 다른 wiring이 build에서 등록했다.
    async afterReady() {
      const resumed = await approvals?.resume();
      if (resumed !== undefined && !resumed.ok) {
        console.error(
          `approvals: could not resume applying (${resumed.error.code})`,
        );
      }
    },
  };
};
