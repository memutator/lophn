import { parseArgs } from "node:util";
import { experimentCommand, gateCommand } from "../runner/experiment.ts";

const EXPERIMENT_USAGE =
  "사용법: deno task eval:experiment <id> [--checkout <path>] [--budget <usd>] [--skip-gate] [--prefix-only] [--base <rev>]";
const GATE_USAGE =
  "사용법: deno task eval:gate <id> [--checkout <path>] [--base <rev>]";

// 종료 코드를 돌려준다. 잘못된 인자는 2, 실패는 1이다. 판정(채택, 기각, 판정 불가)은 모두 0이다.
export async function runExperimentCommand(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        checkout: { type: "string" },
        budget: { type: "string" },
        "skip-gate": { type: "boolean" },
        "prefix-only": { type: "boolean" },
        base: { type: "string" },
      },
    });
  } catch (error) {
    console.log(`${(error as Error).message}\n${EXPERIMENT_USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const budget =
    values.budget === undefined ? undefined : Number(values.budget);
  if (positionals.length !== 1 || (budget !== undefined && !(budget > 0))) {
    console.log(
      `<id>는 하나, --budget은 0보다 커야 한다.\n${EXPERIMENT_USAGE}`,
    );
    return 2;
  }
  return await experimentCommand({
    id: positionals[0],
    checkout: values.checkout,
    base: values.base,
    budget,
    skipGate: values["skip-gate"] ?? false,
    prefixOnly: values["prefix-only"] ?? false,
  });
}

export async function runGateCommand(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        checkout: { type: "string" },
        base: { type: "string" },
      },
    });
  } catch (error) {
    console.log(`${(error as Error).message}\n${GATE_USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) {
    console.log(`<id>는 하나여야 한다.\n${GATE_USAGE}`);
    return 2;
  }
  return await gateCommand({
    id: positionals[0],
    checkout: values.checkout,
    base: values.base,
  });
}
