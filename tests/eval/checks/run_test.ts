import assert from "node:assert/strict";
import { test } from "node:test";
import type { Check, CheckInput } from "../types.ts";
import { fixtureTrial } from "./fixtures.ts";
import { runProgramChecks } from "./run.ts";

// observation check가 앞 check가 바꾼 world를 본다. 순서가 깨지면 조용히 틀려진다.
test("runProgramChecks는 check를 배열 순서대로 하나씩 돌고, 던진 check 뒤에도 돈다", async () => {
  let state = "before";
  const checks: Check[] = [
    {
      kind: "program",
      id: "first",
      run: async () => {
        await Promise.resolve();
        state = "changed";
        return { pass: true, reason: "ok" };
      },
    },
    {
      kind: "program",
      id: "second",
      run: () => ({ pass: state === "changed", reason: state }),
    },
    {
      kind: "program",
      id: "third",
      run: () => {
        throw new Error("boom");
      },
    },
    {
      kind: "program",
      id: "fourth",
      run: () => ({ pass: true, reason: "ok" }),
    },
  ];
  const input: CheckInput = { trial: fixtureTrial([]), core: null };
  const results = await runProgramChecks(checks, input);
  assert.deepStrictEqual(results.map((r) => [r.id, r.pass]), [
    ["first", true],
    ["second", true],
    ["third", false],
    ["fourth", true],
  ]);
});
