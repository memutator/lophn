// `deno task eval`의 진입. 진짜 provider를 부르므로 ANTHROPIC_API_KEY가 있을 때만 trial을 돈다.
// 첫 인자가 experiment, gate이면 experiment 입구로 보낸다.
import { runExperimentCommand, runGateCommand } from "./experiment/mod.ts";
import { main } from "./runner/cli.ts";

const [command, ...rest] = Deno.args;
Deno.exit(
  command === "experiment"
    ? await runExperimentCommand(rest)
    : command === "gate"
    ? await runGateCommand(rest)
    : await main(Deno.args),
);
