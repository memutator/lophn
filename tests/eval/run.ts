// `deno task eval`의 진입. 진짜 provider를 부르므로 ANTHROPIC_API_KEY가 있을 때만 trial을 돈다.
// 첫 인자가 experiment, gate이면 experiment 입구로 보낸다.
import process from "node:process";

import { runExperimentCommand, runGateCommand } from "./experiment/mod.ts";
import { main } from "./runner/cli.ts";

const [command, ...rest] = process.argv.slice(2);
process.exit(
  command === "experiment"
    ? await runExperimentCommand(rest)
    : command === "gate"
      ? await runGateCommand(rest)
      : await main(process.argv.slice(2)),
);
