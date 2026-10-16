import { ok } from "../../../../base/mod.ts";
import {
  diagnosticsList,
  diagnosticsStatus,
} from "../../../../protocol/diagnostics/mod.ts";
import {
  createComponentChecks,
  createLogRecordSource,
  diagnosticsListRead,
  diagnosticsStatusHandler,
  type StatusSource,
} from "../../../diagnostics/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const diagnosticsWiring: WiringFactory = () => ({
  name: "diagnostics",
  prepare(ctx) {
    // core와 ledger는 여기서 짓는다. 나머지 구성 요소는 owner의 wiring이 componentChecks에 더한다.
    ctx.componentChecks.push(...createComponentChecks({
      ready: () => ctx.ready,
      runtime: () => ctx.peek.runtime,
    }));
    const source: StatusSource = {
      get ready() {
        return ctx.ready;
      },
      schema: LEDGER_SCHEMA_STEPS.length + ctx.assembled.schemaSteps.length,
      dataRoot: ctx.root.path,
      // ledger를 만들거나 복원할 때마다 새로 정한 식별(data root의 ledger-id). 내용은 노출하지 않는다.
      // derived는 출처에 이 값을 적고 다르면 버리고 다시 만든다.
      ledgerId: ctx.ledgerId,
      checks: () => ctx.componentChecks,
    };
    ctx.provide("statusSource", source);
  },
  build(ctx) {
    const list = diagnosticsListRead(
      createLogRecordSource(ctx.root.path, ctx.clock),
    );
    return ok({
      memory: [[
        key(diagnosticsStatus),
        diagnosticsStatusHandler(() => ctx.componentChecks, ctx.clock),
      ]],
      reads: (reads) => reads.set(key(diagnosticsList), list),
    });
  },
});
