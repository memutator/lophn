import process from "node:process";
import { ok } from "../../../../base/mod.ts";
import { appEnv } from "../../../apps/runtime/processes/mod.ts";
import { denoBinary } from "../../../supervision/security/node-command.ts";
import { createFlowHost } from "../../flow-host/host.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

const SOURCE = { concern: "flows", revision: "1", scope: "stderr" };

// flow process를 띄우고 이끄는 host를 workflows에 잇기만 한다. 업무 규칙은 두지 않는다.
// runs·workflows 뒤다: 둘이 runService·workflowService를 build에서 낸다.
export const flowsWiring: WiringFactory = () => {
  let host: ReturnType<typeof createFlowHost> | undefined;
  return {
    name: "flows",
    build(ctx) {
      const redactor = createProductRedactor(ctx.knownSecrets);
      host = createFlowHost({
        dataRoot: ctx.root.path,
        deno: denoBinary(),
        env: appEnv({
          home: process.env.HOME,
          denoDir: process.env.DENO_DIR,
          xdgCacheHome: process.env.XDG_CACHE_HOME,
          path: process.env.PATH,
        }),
        clock: ctx.clock,
        runs: ctx.runService,
        workflows: ctx.workflowService,
        redact: (line) => redactor(SOURCE, "text/plain", line),
      });
      ctx.provide("flowHost", host);
      return ok({});
    },
    // 새 launch를 막고 process를 끄는 일을 server가 서기·내려가기와 무관하게 가장 먼저 한다.
    async closeIntake() {
      await host?.close();
    },
  };
};
