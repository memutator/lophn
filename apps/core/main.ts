import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import { problemsTestDefinitions } from "./problems.ts";

// 최상위 팀마다 등록 파일 하나. main은 이 목록만 부른다.
const TEAMS = [
  { createLedgerRegistration },
  { problemsTestDefinitions },
  { codingAgentConnectionDefinitions },
];

const portArg = Deno.args.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

// Electron main이 물려 준 pipe. 터미널에서 직접 띄우면(stdin이 터미널) 신호로만 끝난다.
const parent = Deno.stdin.isTerminal()
  ? undefined
  : { stdin: Deno.stdin.readable, stdout: Deno.stdout.writable };

const started = await startCore({
  port,
  teams: TEAMS,
  teamModules: [
    new URL("./documents.ts", import.meta.url).href,
    new URL("./problems.ts", import.meta.url).href,
    new URL("./coding-agent.ts", import.meta.url).href,
  ],
  parent,
});
if (!started.ok) {
  console.error(`core: ${started.error.message}`);
  Deno.exit(1);
}
const core = started.value;

Deno.addSignalListener(
  "SIGINT",
  () => void core.shutdown().then(() => Deno.exit(0)),
);
Deno.addSignalListener(
  "SIGTERM",
  () => void core.shutdown().then(() => Deno.exit(0)),
);
