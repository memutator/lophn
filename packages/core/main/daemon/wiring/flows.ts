import process from "node:process";
import { ok } from "../../../../base/mod.ts";
import { appEnv } from "../../../apps/runtime/processes/mod.ts";
import {
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
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
        // flow는 lophn의 다른 자식 process와 같이 Electron의 Node로 뜬다. HOME·XDG·PATH만 넘긴다.
        env: appEnv({
          home: process.env.HOME,
          xdgCacheHome: process.env.XDG_CACHE_HOME,
          path: process.env.PATH,
        }),
        clock: ctx.clock,
        runs: ctx.runService,
        // runs wiring의 agents.resolve와 같은 길이다. snapshot이 실패하면 그 오류를 돌려준다.
        resolveAgent(address) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            createSessionDirectory({
              ...placeDepsOf(lookup.sql),
              publish: () => {},
              sql: () => lookup.sql,
            }).resolveAddress(address),
          );
          return found.ok ? found.value : found;
        },
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
