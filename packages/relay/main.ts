// 실행: node packages/relay/main.ts [--port <n>]. port가 없으면 env PORT, 그것도 없으면 8080이다.
import process from "node:process";
import { parseArgs } from "node:util";
import { cryptoRandom } from "../base/mod.ts";
import { createRelay } from "./relay.ts";
import { openRelayServer } from "./server.ts";

const { values } = parseArgs({ options: { port: { type: "string" } } });
const server = await openRelayServer({
  host: "0.0.0.0",
  port: Number(values.port ?? process.env.PORT ?? 8080),
  relay: createRelay({
    random: cryptoRandom,
    timers: {
      set: (run, ms) => setTimeout(run, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  }),
});
console.log(`lophn relay listening on port ${server.port}`);
