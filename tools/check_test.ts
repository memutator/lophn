import { assertEquals } from "@std/assert";
import { runSteps, type Step } from "./check.ts";

function fakeRunner(codes: Record<string, number>) {
  const calls: string[][] = [];
  const runner = (command: string[]) => {
    calls.push(command);
    return Promise.resolve(codes[command.join(" ")] ?? 0);
  };
  return { calls, runner };
}

function sample(shell: Step["when"]): Step[] {
  return [
    { name: "fmt", command: ["deno", "fmt", "--check"] },
    { name: "lint", command: ["deno", "lint"] },
    { name: "check", command: ["deno", "check"] },
    { name: "test", command: ["deno", "test"] },
    { name: "shell", command: ["npm", "run", "check"], when: shell },
    { name: "docs", command: ["node", "tools/check-docs.ts"] },
  ];
}

const absent: Step["when"] = () =>
  Promise.resolve({ run: false, note: "건너뜀: apps/shell/main 없음" });

Deno.test("tools/check: 단계를 적은 순서로 모두 돌린다", async () => {
  const { calls, runner } = fakeRunner({});
  const { ok } = await runSteps(sample(absent), runner);
  assertEquals(ok, true);
  assertEquals(
    calls.map((c) => c[0]),
    ["deno", "deno", "deno", "deno", "node"],
  );
  assertEquals(
    calls.map((c) => c[1]),
    ["fmt", "lint", "check", "test", "tools/check-docs.ts"],
  );
});

Deno.test("tools/check: 하나라도 실패하면 전체가 실패하고 나머지는 계속 돈다", async () => {
  const { calls, runner } = fakeRunner({ "deno fmt --check": 1 });
  const { results, ok } = await runSteps(sample(absent), runner);
  assertEquals(ok, false);
  assertEquals(results.find((r) => r.name === "fmt")?.status, "실패");
  assertEquals(results.filter((r) => r.status === "통과").length, 4);
  assertEquals(calls.length, 5);
});

Deno.test("tools/check: 건너뛴 단계는 실패로 세지 않고 표에 이유를 남긴다", async () => {
  const { calls, runner } = fakeRunner({});
  const { results, ok } = await runSteps(sample(absent), runner);
  const shell = results.find((r) => r.name === "shell");
  assertEquals(ok, true);
  assertEquals(shell?.status, "건너뜀");
  assertEquals(shell?.note, "건너뜀: apps/shell/main 없음");
  assertEquals(calls.some((c) => c[0] === "npm"), false);
});

Deno.test("tools/check: node_modules가 없으면 npm ci를 먼저 돌리고 표에 적는다", async () => {
  const installed: Step["when"] = () =>
    Promise.resolve({
      run: true,
      note: "npm ci를 먼저 돌림",
      before: ["npm", "--prefix", "apps/shell/main", "ci"],
    });
  const { calls, runner } = fakeRunner({});
  const { results, ok } = await runSteps(sample(installed), runner);
  const shell = results.find((r) => r.name === "shell");
  assertEquals(ok, true);
  assertEquals(shell?.status, "통과");
  assertEquals(shell?.note, "npm ci를 먼저 돌림");
  const shellCalls = calls.filter((c) => c[0] === "npm");
  assertEquals(shellCalls[0].at(-1), "ci");
  assertEquals(shellCalls[1].at(-1), "check");
});

Deno.test("tools/check: npm ci가 실패하면 shell check를 돌리지 않고 실패다", async () => {
  const installed: Step["when"] = () =>
    Promise.resolve({
      run: true,
      note: "npm ci를 먼저 돌림",
      before: ["npm", "--prefix", "apps/shell/main", "ci"],
    });
  const { calls, runner } = fakeRunner({
    "npm --prefix apps/shell/main ci": 1,
  });
  const { results, ok } = await runSteps(sample(installed), runner);
  assertEquals(ok, false);
  assertEquals(results.find((r) => r.name === "shell")?.status, "실패");
  assertEquals(calls.filter((c) => c[0] === "npm").length, 1);
});
