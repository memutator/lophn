// scorecard를 쓰거나(인자 없음) 두 run을 비교한다(`diff <idA> <idB>`).
import { systemClock } from "../../../packages/base/mod.ts";
import { latestEntry } from "../versions/mod.ts";
import { currentVersions } from "../versions/mod.ts";
import type { Scenario } from "../types.ts";
import { diffRuns } from "./diff.ts";
import { renderScorecard } from "./markdown.ts";
import { type Current, pickRows } from "./pick.ts";
import { readRuns, RUNS_DIR } from "./runs.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REGISTRY_DIR = `${ROOT}/tests/eval/registry`;
const SCENARIOS_DIR = `${ROOT}/tests/eval/scenarios`;

// 시나리오 찾는 일은 runner 몫이지만 이 CLI는 runner를 기다리지 않아 직접 읽는다.
async function readScenarios(dir: string): Promise<Scenario[]> {
  const found: Scenario[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory) found.push(...await readScenarios(path));
      else if (e.name.endsWith(".scenario.ts")) {
        found.push((await import(path)).default as Scenario);
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

const args = [...Deno.args];
if (args[0] === "diff") {
  const [a, b] = args.slice(1);
  if (a === undefined || b === undefined) {
    throw new Error("usage: main.ts diff <runIdA> <runIdB>");
  }
  const read = async (id: string) =>
    JSON.parse(await Deno.readTextFile(`${RUNS_DIR}/${id}.json`));
  console.log(
    await diffRuns(await read(a), await read(b), {
      registryDir: REGISTRY_DIR,
    }),
  );
} else {
  const flag = args.findIndex((x) => x === "--model");
  const model = flag >= 0 ? args[flag + 1] : "claude-sonnet-5-5";
  const judge = await latestEntry(REGISTRY_DIR, "judge", "judge");
  const current: Current = {
    scenarios: await readScenarios(SCENARIOS_DIR),
    versions: await currentVersions({ root: ROOT, registryDir: REGISTRY_DIR }),
    judge: judge === null
      ? null
      : { kind: "judge", name: judge.name, n: judge.n },
    model,
  };
  const runs = await readRuns(RUNS_DIR);
  const date = systemClock.now().slice(0, 10);
  const file = `${ROOT}/tests/eval/scorecards/${date}.md`;
  await Deno.mkdir(`${ROOT}/tests/eval/scorecards`, { recursive: true });
  await Deno.writeTextFile(
    file,
    renderScorecard(pickRows(runs, current), runs, { date, model }),
  );
  console.log(file);
}
