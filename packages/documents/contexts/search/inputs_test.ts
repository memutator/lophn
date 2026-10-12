import { assertEquals } from "@std/assert";
import { declaredSearchSchema } from "../../../protocol/projects/mod.ts";
import { resolveInputs } from "./inputs.ts";
import { fixtureBundle } from "./testing.ts";
import type { SearchErrorCode } from "./types.ts";

// searches: 0 findings_for_experiment(experiment: entity, required)
//           1 experiments_by_status(status: value, many) 2 experiments_on_scenario(scenario: entity, required)
const [findings, byStatus] = fixtureBundle().searches;
const ok = (inputs: Record<string, unknown>) => ({ ok: true as const, inputs });
const error = (code: SearchErrorCode, input: string) => ({
  ok: false as const,
  error: { code, input },
});

Deno.test("documents/contexts#R15 [ctx-I17]: declared inputs with the right shape pass through", () => {
  assertEquals(
    resolveInputs(findings, { experiment: "002" }),
    ok({ experiment: "002" }),
  );
  assertEquals(
    resolveInputs(byStatus, { status: ["running", "planned"] }),
    ok({ status: ["running", "planned"] }),
  );
});

Deno.test("documents/contexts#R15 [ctx-I17]: an optional input left out or given as null is omitted", () => {
  assertEquals(resolveInputs(byStatus, {}), ok({}));
  assertEquals(resolveInputs(byStatus, { status: null }), ok({}));
});

Deno.test("documents/contexts#R15 [ctx-I17]: a missing or null required input is input_required", () => {
  assertEquals(
    resolveInputs(findings, {}),
    error("input_required", "experiment"),
  );
  assertEquals(
    resolveInputs(findings, { experiment: null }),
    error("input_required", "experiment"),
  );
});

Deno.test("documents/contexts#R15 [ctx-I17]: undeclared names and wrong shapes are input_invalid", () => {
  assertEquals(
    resolveInputs(findings, { experiment: "002", extra: 1 }),
    error("input_invalid", "extra"),
  );
  // entity는 key 문자열 하나, many면 배열
  assertEquals(
    resolveInputs(findings, { experiment: 2 }),
    error("input_invalid", "experiment"),
  );
  assertEquals(
    resolveInputs(findings, { experiment: ["002"] }),
    error("input_invalid", "experiment"),
  );
  assertEquals(
    resolveInputs(byStatus, { status: "running" }),
    error("input_invalid", "status"),
  );
  // value의 값은 string·number·boolean
  assertEquals(
    resolveInputs(byStatus, { status: [{ a: 1 }] }),
    error("input_invalid", "status"),
  );
});

Deno.test("documents/contexts#R15 [ctx-I17]: declared inputs are checked first in declaration order, then undeclared names in code unit order", () => {
  assertEquals(
    resolveInputs(findings, { zzz: 1 }),
    error("input_required", "experiment"),
  );
  assertEquals(
    resolveInputs(findings, { experiment: "002", b: 1, a: 1 }),
    error("input_invalid", "a"),
  );
});

const custom = declaredSearchSchema.parse({
  name: "custom",
  title: "Custom",
  inputs: [
    { name: "between", label: "Between", type: "range", of: "Doc.when" },
    { name: "words", label: "Words", type: "text" },
  ],
  query: { from: "Doc" },
  result: { kind: "table", columns: [{ label: "Key", path: "key" }] },
});

Deno.test("documents/contexts#R15 [ctx-I17]: a range is {from?, to?} with at least one end and text is a string", () => {
  assertEquals(
    resolveInputs(custom, {
      between: { from: "2026-01-01", to: "2026-02-01" },
    }),
    ok({ between: { from: "2026-01-01", to: "2026-02-01" } }),
  );
  assertEquals(
    resolveInputs(custom, { between: { to: 5 } }),
    ok({ between: { to: 5 } }),
  );
  for (const bad of [{}, { start: 1 }, "2026", [1, 2]]) {
    assertEquals(
      resolveInputs(custom, { between: bad }),
      error("input_invalid", "between"),
      JSON.stringify(bad),
    );
  }
  assertEquals(resolveInputs(custom, { words: "arm" }), ok({ words: "arm" }));
  assertEquals(
    resolveInputs(custom, { words: 3 }),
    error("input_invalid", "words"),
  );
});
