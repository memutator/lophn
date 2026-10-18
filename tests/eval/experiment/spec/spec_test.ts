import { assert, assertEquals } from "@std/assert";
import { checkSpecLocked, type LockFacts } from "./lock.ts";
import { parseSpec } from "./parse.ts";
import { readResult, writeResult } from "./files.ts";
import type { ExperimentResult } from "./types.ts";

const good = () => ({
  id: "ask-once",
  hypothesis: "fewer repeated asks",
  start_run: "run-1",
  model: "claude-sonnet-5-5",
  change: { from: "instruction:lophn@3", to: "instruction:lophn@4" },
  target: [{ scenario: "a" }],
  cases: [{ scenario: "b", checks: ["c1"] }],
  judgment: { rule: "default@1" },
  trials: { base: 1, max: 3 },
  budget_usd: 100,
});

Deno.test("parseSpec rejects specs without a prior case, with two components changed, or on grader/core", () => {
  const rows: [string, (s: ReturnType<typeof good>) => void][] = [
    ["no cases", (s) => (s.cases = [])],
    ["case is a target", (s) => (s.cases = [{ scenario: "a" }] as never)],
    ["two components", (s) => (s.change.to = "instruction:other@4")],
    [
      "grader kind",
      (s) => (s.change = { from: "criterion:x@1", to: "criterion:x@2" }),
    ],
    [
      "core kind",
      (s) => (s.change = { from: "core:core@1", to: "core:core@2" }),
    ],
  ];
  assertEquals(parseSpec(good(), "ask-once").ok, true);
  for (const [name, edit] of rows) {
    const s = good();
    edit(s);
    assertEquals(parseSpec(s).ok, false, name);
  }
});

Deno.test("checkSpecLocked rejects a missing, dirty or misplaced spec commit", () => {
  const ok: LockFacts = {
    spec_commit: "abc",
    spec_dirty: false,
    spec_commit_on_current: true,
    variant_has_spec_commit: true,
    variant_spec_same: true,
    cases_missing_at_spec_commit: [],
  };
  assertEquals(checkSpecLocked(ok), {
    ok: true,
    value: { spec_commit: "abc" },
  });
  const bad: Partial<LockFacts>[] = [
    { spec_commit: null },
    { spec_dirty: true },
    { spec_commit_on_current: false },
    { variant_has_spec_commit: false },
    { variant_spec_same: false },
    { cases_missing_at_spec_commit: ["b"] },
  ];
  for (const b of bad) {
    const r = checkSpecLocked({ ...ok, ...b });
    assert(!r.ok && r.error.code === "conflict", JSON.stringify(b));
  }
});

Deno.test("writeResult keeps a decided result and overwrites inconclusive", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/x`);
    await Deno.writeTextFile(`${dir}/x/spec.json`, "{}");
    const result = (decision: ExperimentResult["decision"]) =>
      ({ id: "x", decision }) as ExperimentResult;
    assert((await writeResult(dir, result("inconclusive"))).ok);
    assert((await writeResult(dir, result("adopt"))).ok);
    const again = await writeResult(dir, result("reject"));
    assert(!again.ok && again.error.code === "conflict");
    const read = await readResult(dir, "x");
    assert(read.ok && read.value?.decision === "adopt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
