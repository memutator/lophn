import { type Result } from "../../../../packages/base/mod.ts";
import type { Scenario } from "../../types.ts";
import type { Git } from "../../versions/mod.ts";
import { changedFiles } from "./changes.ts";
import { e2eBoundaries, parseCatalog, selectE2e } from "./e2e.ts";

export { changedFiles } from "./changes.ts";
export {
  type E2eSelection,
  e2eBoundaries,
  parseCatalog,
  type SelectInput,
  selectE2e,
} from "./e2e.ts";
export { defaultGateDeps } from "./exec.ts";

export type StageName = "check" | "e2e" | "dry-run";
export type StageResult = {
  name: StageName;
  ok: boolean;
  skipped: boolean;
  detail: string;
  ms: number;
};
export type GateReport = { ok: boolean; stages: StageResult[]; e2e: string[] };

export type GateDeps = {
  run(
    cmd: string[],
    cwd: string,
    timeoutMs: number,
    env?: Record<string, string>,
  ): Promise<{ code: number; output: string }>; // stdout+stderr
  git: Git; // cwd가 variant인 git
  readText(path: string): Promise<string>;
  listFiles(dir: string): Promise<string[]>; // 폴더의 file 이름
  validateFixtures(
    scenarios: Scenario[],
  ): Promise<{ ok: boolean; problems: string[] }>;
  // 시나리오 하나의 재료 되살리기까지(진짜 model 없이). 끝나면 core를 끄고 run을 지운다. 던지지 않는다.
  dryRun(scenario: Scenario): Promise<Result<void>>;
  now(): number;
  // module-catalog.yaml, boundary-catalog.yaml을 읽는 root. 어느 e2e를 돌릴지는 grader 쪽 규칙이라 늘 지금 checkout이다.
  catalogRoot: string;
};

const CHECK_TIMEOUT_MS = 20 * 60_000;
const E2E_TIMEOUT_MS = 15 * 60_000;

const tail = (text: string) => text.slice(-2000);

type Outcome = Pick<StageResult, "ok" | "skipped" | "detail">;

// 앞 단계가 실패하면 뒤 단계는 돌리지 않는다: e2e와 dry run은 느리고, check가 깨진 checkout에서는 뜻이 없다.
export async function runGate(
  input: { checkout: string; base?: string; scenarios: Scenario[] },
  deps: GateDeps,
): Promise<GateReport> {
  const stages: StageResult[] = [];
  let e2e: string[] = [];

  const stage = async (name: StageName, body: () => Promise<Outcome>) => {
    const t0 = deps.now();
    const out = await body();
    stages.push({ name, ...out, ms: deps.now() - t0 });
    return out.ok;
  };

  const checkOk = await stage("check", async () => {
    const r = await deps.run(
      ["npm", "run", "check"],
      input.checkout,
      CHECK_TIMEOUT_MS,
    );
    return r.code === 0
      ? { ok: true, skipped: false, detail: "" }
      : { ok: false, skipped: false, detail: tail(r.output) };
  });
  if (!checkOk) return { ok: false, stages, e2e };

  const e2eOk = await stage("e2e", async () => {
    const files = await changedFiles(deps.git, input.base);
    const dir = `${input.checkout}/tests/e2e`;
    const root = deps.catalogRoot;
    const catalog = parseCatalog(
      await deps.readText(`${root}/project-docs/module-catalog.yaml`),
      await deps.readText(`${root}/project-docs/boundary-catalog.yaml`),
    );
    const e2eTests = [];
    for (const name of (await deps.listFiles(dir)).sort()) {
      if (!name.endsWith("_test.ts")) continue;
      const boundaries = e2eBoundaries(
        await deps.readText(`${dir}/${name}`),
        catalog.known,
        catalog.aliases,
      );
      e2eTests.push({ file: `tests/e2e/${name}`, boundaries });
    }
    const sel = selectE2e({
      files,
      modules: catalog.modules,
      tree: catalog.tree,
      e2e: e2eTests,
    });
    e2e = sel.files;
    if (sel.files.length === 0) {
      return { ok: true, skipped: true, detail: "고른 e2e 없음" };
    }
    const noContract = e2eTests
      .filter((t) => t.boundaries.includes("*"))
      .map((t) => t.file);
    const info = [
      `고른 e2e ${sel.files.length}개`,
      ...sel.reasons.slice(0, 10),
      ...noContract.map((f) => `contract 줄 없음: ${f}`),
    ].join("\n");
    const target = sel.all ? ["tests/e2e/*_test.ts"] : sel.files;
    // root `e2e` script와 같은 runner다. Electron binary가 Node로 돌려면 ELECTRON_RUN_AS_NODE가 필요하다.
    const r = await deps.run(
      [
        "node_modules/electron/dist/electron",
        "--test",
        "--test-concurrency=1",
        ...target,
      ],
      input.checkout,
      E2E_TIMEOUT_MS,
      { ELECTRON_RUN_AS_NODE: "1" },
    );
    return r.code === 0
      ? { ok: true, skipped: false, detail: info }
      : { ok: false, skipped: false, detail: `${info}\n${tail(r.output)}` };
  });
  if (!e2eOk) return { ok: false, stages, e2e };

  const dryOk = await stage("dry-run", async () => {
    if (input.scenarios.length === 0) {
      return { ok: true, skipped: true, detail: "dry run할 시나리오 없음" };
    }
    const fixtures = await deps.validateFixtures(input.scenarios);
    if (!fixtures.ok) {
      return {
        ok: false,
        skipped: false,
        detail: fixtures.problems.join("\n"),
      };
    }
    const failed: string[] = [];
    for (const s of input.scenarios) {
      const r = await deps.dryRun(s);
      if (!r.ok) failed.push(`${s.id}: ${r.error.message}`);
    }
    return failed.length === 0
      ? { ok: true, skipped: false, detail: `${input.scenarios.length}개 통과` }
      : { ok: false, skipped: false, detail: failed.join("\n") };
  });
  return { ok: dryOk, stages, e2e };
}
