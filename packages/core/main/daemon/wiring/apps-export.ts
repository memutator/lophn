// 앱 data export serving. remove-app-extras가 이 file을 지운다.
import { ok } from "../../../../base/mod.ts";
import { appExportWorkers } from "../../../apps/data/export.ts";
import type { WiringFactory } from "./context.ts";

export const appsExportWiring: WiringFactory = () => ({
  name: "apps-export",
  build: (ctx) =>
    ok({
      // 앱 export serving. 준비는 core graph 밖 프로세스가 한다.
      workers: new Map(appExportWorkers({
        dataRoot: ctx.root.path,
        ledgerPath: ctx.ledgerPath,
        current: (ref) => ctx.runtime.current(ref),
        observedAt: () => new Date().toISOString(),
      })),
    }),
});
