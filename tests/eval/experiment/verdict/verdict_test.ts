import assert from "node:assert/strict";
import { test } from "node:test";
import type { Outcome, OutcomeState, Role } from "../spec/mod.ts";
import { decide, type VerdictEntry, type VerdictInput } from "./mod.ts";

const from = { kind: "instruction", name: "lophn", n: 3 } as const;
const to = { kind: "instruction", name: "lophn", n: 4 } as const;

// "p"=통과 "f"=떨어짐 "?"=judge 채점 대기(떨어진 것은 없다) "F"=program check가 떨어졌고 judge는 아직 대기
function outs(s: string): Outcome[] {
  return [...s].map((c, index) => {
    const state: OutcomeState = c === "p"
      ? "pass"
      : c === "f" || c === "F"
      ? "fail"
      : "pending";
    return {
      index,
      passed: state === "pass",
      state,
      pending: c === "?" || c === "F" ? ["j"] : [],
      checks: { j: state === "pass", p: state !== "fail" },
      cost_usd: 1,
      components: [],
    };
  });
}

function entry(
  scenario: string,
  role: Role,
  variant: string,
  baseline: string,
  extra: Partial<VerdictEntry> = {},
): VerdictEntry {
  return {
    scenario,
    n: 1,
    role,
    checks: null,
    baseline_runs: ["b"],
    baseline: outs(baseline),
    variant_runs: ["v"],
    variant: outs(variant),
    remaining: 0,
    ...extra,
  };
}

const okEntries = () => [
  entry("t", "target", "ppp", "fff"),
  entry("c", "case", "pp", ""),
  entry("g", "guard", "p", "p"),
];

function input(entries: VerdictEntry[]): VerdictInput {
  return {
    spec: {
      id: "x",
      hypothesis: "h",
      start_run: "r",
      model: "m",
      change: { from, to },
      target: [{ scenario: "t" }],
      cases: [{ scenario: "c" }],
      judgment: { rule: "default@1" },
      trials: { base: 1, max: 3 },
      budget_usd: 10,
    },
    spec_hash: "h",
    spec_commit: "abc",
    changed: [{ from, to }],
    entries,
    keep: [],
    excluded: [],
    stopped_by_budget: false,
    decided_at: "2026-01-01T00:00:00Z",
  };
}

test("decide splits adopt, reject and inconclusive by the default@1 rule", () => {
  const rows: {
    name: string;
    entries: VerdictEntry[];
    decision: string;
    status?: [string, string];
    weaker?: boolean;
    reason?: string;
  }[] = [
    { name: "all good", entries: okEntries(), decision: "adopt" },
    {
      name: "guard 1/1 -> 1/3 is worse",
      entries: [...okEntries().slice(0, 2), entry("g", "guard", "pff", "p")],
      decision: "reject",
      status: ["g", "worse"],
    },
    {
      name: "guard 1/1 -> 2/3 is ok but weaker",
      entries: [...okEntries().slice(0, 2), entry("g", "guard", "ppf", "p")],
      decision: "adopt",
      status: ["g", "ok"],
      weaker: true,
    },
    {
      name: "target already passing is not improved",
      entries: [entry("t", "target", "ppp", "ppp"), ...okEntries().slice(1)],
      decision: "reject",
      status: ["t", "not_improved"],
    },
    {
      name: "case under 2/3",
      entries: [okEntries()[0], entry("c", "case", "pff", ""), okEntries()[2]],
      decision: "reject",
      status: ["c", "fail"],
    },
    {
      name: "unfinished without a settled failure",
      entries: [
        okEntries()[0],
        okEntries()[1],
        entry("g", "guard", "p", "p", { remaining: 2 }),
      ],
      decision: "inconclusive",
      status: ["g", "incomplete"],
    },
    {
      name: "settled failure beats unfinished",
      entries: [
        entry("t", "target", "fff", "fff"),
        okEntries()[1],
        entry("g", "guard", "p", "p", { remaining: 2 }),
      ],
      decision: "reject",
    },
    {
      name: "pending judge check is not decided early",
      entries: [entry("t", "target", "pp?", "fff"), ...okEntries().slice(1)],
      decision: "inconclusive",
      status: ["t", "incomplete"],
      reason: "채점 대기",
    },
    {
      name: "failed program check stays failed while judge is pending",
      entries: [
        entry("t", "target", "FFF", "fff"),
        ...okEntries().slice(1),
      ],
      decision: "reject",
      status: ["t", "fail"],
    },
  ];
  for (const row of rows) {
    const r = decide(input(row.entries));
    assert(r.ok, row.name);
    assert.deepStrictEqual(r.value.decision, row.decision, row.name);
    if (row.status) {
      const s = r.value.scenarios.find((x) => x.scenario === row.status![0])!;
      assert.deepStrictEqual(s.status, row.status[1], row.name);
      assert.deepStrictEqual(s.weaker, row.weaker ?? false, row.name);
    }
    if (row.reason) {
      assert(r.value.reasons.some((x) => x.includes(row.reason!)), row.name);
    }
  }
});

test("decide refuses an unchanged variant, a missing case entry and a target without baseline", () => {
  const unchanged = input(okEntries());
  unchanged.changed = [{ from: { ...from, n: 2 }, to: from }];
  const rows: [string, VerdictInput, string][] = [
    ["unchanged", unchanged, "conflict"],
    [
      "missing case",
      input(okEntries().filter((e) => e.role !== "case")),
      "invalid_input",
    ],
    [
      "wrong role",
      input([okEntries()[0], { ...okEntries()[1], role: "guard" }]),
      "invalid_input",
    ],
    [
      "target without baseline",
      input([entry("t", "target", "ppp", ""), ...okEntries().slice(1)]),
      "invalid_input",
    ],
  ];
  for (const [name, i, code] of rows) {
    const r = decide(i);
    assert(!r.ok && r.error.code === code, name);
  }
});
