// 세 질문
// - contract: eval roadmap "experiment". 기준 run은 다시 돌리지 않고 X@a를 본 valid run만 기준이 된다.
// - 현실적 회귀: 낡은 run을 기준에 섞거나, X를 안 본 시나리오를 다시 돌려 돈을 쓰거나, 기준 없는 target을 판정하게 두는 수정.
// - 왜 지금 test로 못 잡나: 이 선택은 select module 안에서만 쓰이고 다른 test가 부르지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Metrics, RunRecord, VersionRef } from "../../types.ts";
import type { Current } from "../../scorecard/pick.ts";
import type { ExperimentSpec } from "../spec/mod.ts";
import { selectRuns } from "./mod.ts";

const ref = (
  kind: VersionRef["kind"],
  name: string,
  n: number,
): VersionRef => ({
  kind,
  name,
  n,
});
const X = ref("instruction", "lophn", 3);

const metrics = {
  tokens: {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    reasoning: 0,
    unknown_calls: 0,
  },
  input_total: 0,
  cache_hit_rate: null,
  cost_usd: 0,
  unpriced_calls: 0,
  time_ms: { turns: 0, model_calls: 0 },
  tools: {
    counted: 0,
    excluded: 0,
    format: 0,
    success: 0,
    blocked: 0,
    repeated_calls: 0,
    repeat_groups: 0,
    max_repeat: 0,
    repeated_failure_turns: 0,
  },
  truncated_calls: 0,
  agent_calls: [],
} as Metrics;

const trial = (index: number, components?: VersionRef[]) => ({
  index,
  settle: { kind: "idle", unstarted: [] },
  checks: [{ id: "c1", kind: "program", pass: true, reason: "" }],
  judge: [],
  metrics,
  components,
});

function run(
  id: string,
  scenario: string,
  at: string,
  over: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    started_at: at,
    scenario: ref("scenario", scenario, 1),
    materials: [],
    components: [X],
    core: ref("core", "core", 5),
    grader: { criteria: [], judge: null, checks: ref("checks", "checks", 2) },
    model: "claude-sonnet-5-5",
    source: { commit: "abc", dirty: false },
    trials: [trial(0), trial(1)],
    ...over,
  } as unknown as RunRecord;
}

const scenarios = ["t", "t-none", "g", "stale", "k", "c"].map((id) => ({
  id,
  n: 1,
  proposal: false,
  world: [],
  checks: [],
}));
const current: Current = {
  scenarios,
  versions: new Map([
    ["instruction:lophn", X],
    ["skill:ask", ref("skill", "ask", 2)],
    ["core:core", ref("core", "core", 5)],
    ["checks:checks", ref("checks", "checks", 2)],
  ]),
  judge: null,
  model: "claude-sonnet-5-5",
};

const spec = (target: string[]): ExperimentSpec => ({
  id: "x",
  hypothesis: "h",
  start_run: "r1",
  model: "claude-sonnet-5-5",
  change: { from: X, to: ref("instruction", "lophn", 4) },
  target: target.map((scenario) => ({ scenario, checks: ["c1"] })),
  cases: [{ scenario: "c" }],
  judgment: { rule: "default@1" },
  trials: { base: 1, max: 3 },
  budget_usd: 10,
});

test("selectRuns reruns only scenarios whose valid run saw X@a, drops stale runs into excluded, keeps unseen ones, and rejects a target without a baseline", () => {
  const runs = [
    run("r1", "t", "2026-01-02"),
    // 같은 시나리오의 앞선 run. trial 단위 components가 있어 X를 안 본 trial 1이 빠진다.
    run("r0", "t", "2026-01-01", {
      trials: [trial(0, [X]), trial(1, [ref("skill", "ask", 2)])] as never,
      components: [X, ref("skill", "ask", 2)],
    }),
    run("rg", "g", "2026-01-01"),
    // X는 봤지만 skill:ask가 지금과 다르다.
    run("rs", "stale", "2026-01-01", {
      components: [X, ref("skill", "ask", 1)],
    }),
    run("rk", "k", "2026-01-01", { components: [ref("skill", "ask", 2)] }),
  ];

  const r = selectRuns(spec(["t"]), runs, current);
  assert.ok(r.ok);
  const { entries, keep, excluded } = r.value;
  assert.deepStrictEqual(
    entries.map((e) => `${e.role}:${e.scenario}`),
    ["target:t", "case:c", "guard:g"],
  );
  assert.deepStrictEqual(entries[0].baseline_runs, ["r0", "r1"]);
  assert.deepStrictEqual(
    entries[0].baseline.map((o) => o.index),
    [0, 0, 1],
  );
  assert.deepStrictEqual(entries[0].checks, ["c1"]);
  assert.deepStrictEqual(entries[1].baseline_runs, []);
  assert.deepStrictEqual(entries[2].checks, null);
  assert.deepStrictEqual(keep, [{ scenario: "k", runs: ["rk"] }]);
  assert.deepStrictEqual(excluded.length, 1);
  assert.deepStrictEqual(excluded[0].scenario, "stale");
  assert.ok(excluded[0].reason.includes("skill:ask@1 → @2"));

  // valid run이 없는 target은 거절, valid는 있으나 X를 안 본 target은 다른 이유로 거절
  const noBase = selectRuns(spec(["t", "t-none", "k"]), runs, current);
  assert.ok(!noBase.ok);
  assert.deepStrictEqual(noBase.error.code, "conflict");
  assert.deepStrictEqual(
    (noBase.error.details?.problems as string[]).length,
    2,
  );

  // 기준 checkout의 X 버전이 spec과 다르면 고르지 않는다
  const moved = new Map(current.versions).set(
    "instruction:lophn",
    ref("instruction", "lophn", 4),
  );
  const wrong = selectRuns(spec(["t"]), runs, { ...current, versions: moved });
  assert.ok(!wrong.ok);
  assert.deepStrictEqual(wrong.error.code, "conflict");
});
