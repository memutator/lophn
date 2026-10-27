import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord, TrialResult, VersionRef } from "../../types.ts";
import type { Outcome, Role } from "../spec/mod.ts";
import { flakyScenarios } from "./flaky.ts";
import { nextTrials } from "./policy.ts";

const policy = { base: 1, max: 3 };

const out = (
  state: "pass" | "fail" | "pending",
  cost = 1,
): Outcome => ({
  index: 0,
  passed: state === "pass",
  state,
  pending: state === "pending" ? ["j"] : [],
  checks: { j: state === "pass" },
  cost_usd: cost,
  components: [],
});
const P = () => out("pass");
const F = () => out("fail");
const W = () => out("pending");

test("nextTrials: base first, flaky max first, target/case grow only after a pass, guard only when verdict differs, never past max", () => {
  type Row = [string, Role, boolean, Outcome[], Outcome[], number];
  const rows: Row[] = [
    ["target start", "target", false, [], [], 1],
    ["flaky start", "guard", true, [P()], [], 3],
    ["flaky mid", "target", true, [], [F()], 2],
    ["target passed", "target", false, [], [P()], 2],
    ["target failed stops", "target", false, [], [F()], 0],
    ["target pending waits", "target", false, [], [P(), W()], 0],
    ["case passed", "case", false, [], [P()], 2],
    ["case failed stops", "case", false, [], [F()], 0],
    ["guard same", "guard", false, [P(), P()], [P()], 0],
    ["guard worse", "guard", false, [P(), P()], [F()], 2],
    ["guard better", "guard", false, [F(), F()], [P()], 2],
    ["guard split baseline", "guard", false, [P(), F()], [P()], 2],
    ["guard pending waits", "guard", false, [P()], [W()], 0],
    ["guard max", "guard", false, [P()], [F(), F(), F()], 0],
    ["target max", "target", false, [], [P(), P(), P()], 0],
  ];
  for (const [name, role, flaky, baseline, variant, want] of rows) {
    const state = { role, checks: null, baseline, variant, flaky };
    assert.deepStrictEqual(nextTrials(state, policy), want, name);
  }
});

const ref = (name: string, n: number): VersionRef => ({
  kind: "instruction",
  name,
  n,
});
const trial = (
  index: number,
  pass: boolean,
  components?: VersionRef[],
): TrialResult => ({
  index,
  settle: { kind: "idle", unstarted: [] },
  checks: [{ id: "c", kind: "program", pass, reason: "" }],
  judge: [],
  metrics: { cost_usd: 1 } as TrialResult["metrics"],
  components,
});
const run = (
  id: string,
  trials: TrialResult[],
  over: Partial<RunRecord> = {},
  scenarioN = 1,
): RunRecord => ({
  id,
  started_at: "",
  scenario: { kind: "scenario", name: "s", n: scenarioN },
  materials: [],
  components: [ref("lophn", 1)],
  core: { kind: "core", name: "core", n: 1 },
  grader: {
    criteria: [],
    judge: null,
    checks: { kind: "checks", name: "checks", n: 1 },
  },
  model: "m",
  source: { commit: id, dirty: false },
  trials,
  ...over,
});

test("flakyScenarios: only same-version splits count, not version differences or other scenario n", () => {
  const want = [{ id: "s", n: 1 }];
  const flaky = (runs: RunRecord[]) => flakyScenarios(runs, want).has("s");
  const b = [ref("lophn", 2)];

  // 한 run 안의 갈림
  assert.deepStrictEqual(
    flaky([run("a", [trial(0, true), trial(1, false)])]),
    true,
  );
  // 같은 versionKey인 두 run 사이의 갈림(commit만 다르다)
  assert.deepStrictEqual(
    flaky([run("a", [trial(0, true)]), run("b", [trial(0, false)])]),
    true,
  );
  // components가 다른 두 run 사이의 차이
  assert.deepStrictEqual(
    flaky([
      run("a", [trial(0, true)]),
      run("b", [trial(0, false)], { components: b }),
    ]),
    false,
  );
  // 한 run 안에서 trial의 components가 달라 묶음이 갈림
  assert.deepStrictEqual(
    flaky([run("a", [trial(0, true, [ref("lophn", 1)]), trial(1, false, b)])]),
    false,
  );
  // 시나리오 n이 다른 run은 세지 않는다
  assert.deepStrictEqual(
    flaky([run("a", [trial(0, true)]), run("b", [trial(0, false)], {}, 2)]),
    false,
  );
});
