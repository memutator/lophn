// 세 질문
// - contract: eval roadmap "scorecard". 낡은 run을 최신 것처럼 보이면 안 된다.
// - 현실적 회귀: 버전 비교를 시나리오 n만 보게 하거나, 본 적 없는 component까지 낡음으로 치거나, 낡은 run이 더 늦다고 유효한 run을 밀어내는 수정.
// - 왜 지금 test로 못 잡나: 낡음 판정은 이 module 안에서만 쓰이고 다른 test가 부르지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Metrics, RunRecord, VersionRef } from "../types.ts";
import { type Current, pickRows } from "./pick.ts";

const ref = (
  kind: VersionRef["kind"],
  name: string,
  n: number,
): VersionRef => ({
  kind,
  name,
  n,
});

const metrics: Metrics = {
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
};

function run(id: string, startedAt: string, over: Partial<RunRecord> = {}) {
  return {
    id,
    started_at: startedAt,
    scenario: ref("scenario", "L4-app", 1),
    materials: [ref("material", "apps-home", 1)],
    components: [ref("instruction", "home", 4)],
    core: ref("core", "core", 32),
    grader: {
      criteria: [],
      judge: null,
      checks: ref("checks", "checks", 4),
    },
    model: "claude-a",
    source: { commit: "abc", dirty: false },
    trials: [
      {
        index: 0,
        settle: { kind: "idle", unstarted: [] },
        checks: [{ id: "relayed", kind: "program", pass: true, reason: "" }],
        judge: [],
        metrics,
      },
    ],
    ...over,
  } as RunRecord;
}

const current: Current = {
  scenarios: [
    { id: "L4-app", n: 1, proposal: false, world: ["apps-home@1"], checks: [] },
    { id: "L5-none", n: 1, proposal: true, world: [], checks: [] },
  ],
  versions: new Map([
    ["instruction:home", ref("instruction", "home", 4)],
    ["skill:other", ref("skill", "other", 9)],
    ["core:core", ref("core", "core", 32)],
    ["checks:checks", ref("checks", "checks", 4)],
  ]),
  judge: null,
  model: "claude-a",
};

test("지금 version을 본 run 가운데 가장 늦은 것을 고르고 다르면 낡음 이유를 담는다", () => {
  const checksMoved = {
    criteria: [],
    judge: null,
    checks: ref("checks", "checks", 3),
  };
  const runs = [
    run("old-instruction", "2026-10-03", {
      components: [ref("instruction", "home", 3)],
    }),
    run("valid-early", "2026-10-01"),
    // current에 skill:other가 있지만 이 run들은 본 적이 없어 낡음이 아니다.
    run("valid-late", "2026-10-02"),
  ];

  const [row, none] = pickRows(runs, current);
  assert.deepStrictEqual(row.run, "valid-late"); // 가장 늦은 old-instruction이 아니다
  assert.deepStrictEqual(row.stale, []);
  assert.deepStrictEqual(
    [none.run, none.stale, none.trials],
    [null, ["run 없음"], 0],
  );

  // 유효한 run이 없으면 가장 늦은 run을 낡음으로 보인다.
  const stale = pickRows(
    [runs[0], run("checks-moved", "2026-10-02", { grader: checksMoved })],
    current,
  )[0];
  assert.deepStrictEqual(stale.run, "old-instruction");
  assert.deepStrictEqual(stale.stale, ["instruction:home@3 → @4"]);

  const checks = pickRows(
    [
      run("checks-only", "2026-10-02", {
        grader: checksMoved,
      }),
    ],
    current,
  )[0];
  assert.deepStrictEqual(checks.stale, ["checks@3 → @4"]);
});
