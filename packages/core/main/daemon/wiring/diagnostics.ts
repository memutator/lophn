import { APPS_SUPERVISOR_KIND } from "../../../apps/control.ts";
import type { StatusSource } from "../../../diagnostics/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../../storage/ledger/mod.ts";
import type { Supervisor, WiringFactory } from "./context.ts";

export const diagnosticsWiring: WiringFactory = () => ({
  name: "diagnostics",
  prepare(ctx) {
    const source: StatusSource = {
      get ready() {
        return ctx.ready;
      },
      schema: LEDGER_SCHEMA_STEPS.length + ctx.assembled.schemaSteps.length,
      dataRoot: ctx.root.path,
      // ledger를 만들거나 복원할 때마다 새로 정한 식별(data root의 ledger-id). 내용은 노출하지 않는다.
      // derived는 출처에 이 값을 적고 다르면 버리고 다시 만든다.
      ledgerId: ctx.ledgerId,
      components() {
        const runtime = ctx.peek.runtime;
        return [
          ["ledger", { available: true }],
          // unavailable 관측은 안전한 이유가 있어야 한다(healthObservationSchema).
          ["api", {
            available: ctx.ready,
            ...(ctx.ready ? {} : { reason: "API가 아직 요청을 받지 않는다" }),
          }],
          ["writer", {
            available: runtime !== undefined,
            ...(runtime ? {} : { reason: "writer가 아직 없다" }),
          }],
          ["reader", {
            available: runtime?.readers.health().every((health) =>
              health === "healthy"
            ) ?? false,
            ...(runtime ? {} : { reason: "reader가 아직 없다" }),
          }],
          ["io", ioComponent(ctx.io)],
          ["apps", appsComponent(ctx.appsSupervision)],
        ];
      },
    };
    ctx.provide("statusSource", source);
  },
});

function appsComponent(
  supervision: Supervisor,
): { available: boolean; reason?: string } {
  const observed = supervision.observation(APPS_SUPERVISOR_KIND);
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "apps supervisor가 없다" };
}

function ioComponent(
  io: Supervisor,
): { available: boolean; reason?: string } {
  const observed = io.observation("platform/io");
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "platform/io가 없다" };
}
