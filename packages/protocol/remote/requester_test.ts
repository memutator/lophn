import assert from "node:assert/strict";
import { test } from "node:test";
import { type MachineCandidate, resolveMachine } from "./requester.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${"0".repeat(25)}${n}` as never;
const computer = (n: number, name: string, self = false): MachineCandidate => ({
  machine: id("mch", n),
  device: id("dev", n),
  name,
  self,
});

// 같은 이름의 컴퓨터가 둘일 때 하나를 골라 부르면 엉뚱한 컴퓨터에 명령이 간다. 고르지 않고 후보를 돌려준다.
test("같은 이름의 컴퓨터가 둘이면 고르지 않고 후보를 돌려준다", () => {
  const computers = [
    computer(1, "vm", true),
    computer(2, "work"),
    computer(3, "work"),
  ];
  const cases: [string, string | { code: string; candidates?: number }][] = [
    ["work", { code: "invalid_input", candidates: 2 }],
    [id("dev", 3), computers[2].machine],
    [id("mch", 2), computers[1].machine],
    ["vm", computers[0].machine],
    ["Work", { code: "not_found" }],
    [id("dev", 9), { code: "not_found" }],
  ];
  for (const [ref, want] of cases) {
    const got = resolveMachine(ref, computers);
    if (typeof want === "string") {
      assert.equal(got.ok && got.value.machine, want, ref);
      continue;
    }
    assert.equal(got.ok, false, ref);
    if (got.ok) continue;
    assert.equal(got.error.code, want.code, ref);
    if (want.candidates !== undefined) {
      const { candidates } = got.error.details as { candidates: unknown[] };
      assert.equal(candidates.length, want.candidates);
      assert.match(got.error.message, /device id/);
    }
  }
});
