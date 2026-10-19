import { assertEquals } from "@std/assert";
import type { AppDriver, CallOutcome, HarnessPlan } from "./driver.ts";
import { exampleMatches, examples } from "./examples.ts";

Deno.test("예시와 맞지 않는 결과는 불일치이고 맞는 결과는 일치다", () => {
  const rows: [string, unknown, unknown, boolean][] = [
    ["actual의 나머지 key는 무시한다", { a: 1 }, { a: 1, id: "x" }, true],
    ["expect의 key가 없으면 불일치다", { a: 1, b: 2 }, { a: 1 }, false],
    ["중첩 객체도 같은 규칙이다", { r: { a: 1 } }, { r: { a: 1, t: 9 } }, true],
    ["배열은 길이가 같아야 한다", [1, 2], [1, 2, 3], false],
    ["배열 원소는 차례로 맞는다", [{ a: 1 }, { a: 2 }], [{ a: 1, x: 0 }, {
      a: 2,
    }], true],
    ["배열 순서가 다르면 불일치다", [1, 2], [2, 1], false],
    ["객체와 배열은 서로 맞지 않는다", {}, [], false],
    ["null은 객체와 맞지 않는다", { a: 1 }, null, false],
    ["원시 값은 ===다", 1, "1", false],
    ["빈 expect 객체는 객체면 맞는다", {}, { a: 1 }, true],
  ];
  for (const [name, expect, actual, matched] of rows) {
    assertEquals(exampleMatches(expect, actual), matched, name);
  }
});

function fake(outcomes: CallOutcome[]): { driver: AppDriver; calls: string[] } {
  const calls: string[] = [];
  const driver = {
    call(tool: string) {
      calls.push(tool);
      return Promise.resolve(outcomes.shift()!);
    },
  } as unknown as AppDriver;
  return { driver, calls };
}

const plan = (
  steps: { tool: string; expect: unknown }[],
): HarnessPlan => ({ examples: steps } as unknown as HarnessPlan);

Deno.test("예시 검사는 맞지 않는 첫 단계에서 멈추고 모두 맞아야 통과한다", async () => {
  const steps = [
    { tool: "a.one", expect: { n: 1 } },
    { tool: "a.two", expect: [1] },
    { tool: "a.three", expect: "x" },
  ];
  const stopped = fake([
    { status: "ok", result: { n: 1, extra: true } },
    { status: "ok", result: [1, 2] },
    { status: "ok", result: "x" },
  ]);
  const failed = await examples(stopped.driver, plan(steps));
  assertEquals(failed.met, false);
  assertEquals(failed.evidence["failed_step"], 1);
  assertEquals(stopped.calls, ["a.one", "a.two"]);

  const errored = await examples(
    fake([{ status: "error", code: "invalid_input" }]).driver,
    plan(steps),
  );
  assertEquals(errored.met, false);

  const passed = await examples(
    fake([
      { status: "ok", result: { n: 1 } },
      { status: "ok", result: [1] },
      { status: "ok", result: "x" },
    ]).driver,
    plan(steps),
  );
  assertEquals(passed.met, true);

  // 큰 결과도 frame 한도 안에 들도록 자른다.
  const big = await examples(
    fake([{ status: "ok", result: "y".repeat(100_000) }]).driver,
    plan([{ tool: "a.one", expect: "z" }]),
  );
  assertEquals((big.evidence["actual"] as string).length <= 2048, true);
});
