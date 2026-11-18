import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type MachineCandidate,
  requesterName,
  requesterSchema,
  resolveMachine,
} from "./requester.ts";

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

// frame이 schema 밖이면 받는 기계가 연결 전체를 닫는다. 이름이 어떤 글이든 요청한 쪽은 유효해야 한다.
test("아무리 긴 이름이나 빈 이름이나 이모지 이름으로 만든 요청한 쪽도 schema를 지난다", () => {
  const names = [
    "x".repeat(300),
    "😀".repeat(100),
    `  ${"가".repeat(70)}  `,
    "   ",
    "",
    `${"a".repeat(63)}😀`,
  ];
  for (const text of names) {
    const name = requesterName(text);
    const parsed = requesterSchema.safeParse({
      kind: "agent",
      agent: "lophn_home",
      session: null,
      name,
    });
    assert.ok(parsed.success, text.slice(0, 10));
    assert.equal(name, name.toWellFormed(), text.slice(0, 10));
  }
  assert.equal(requesterName("x".repeat(300)).length, 64);
  assert.equal(requesterName("   "), "unnamed");
});
