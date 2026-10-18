import { assertEquals } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import { runChecks } from "./checks.ts";
import type { AppDriver, HarnessPlan, RewindRun } from "./driver.ts";
import type { Emitter } from "./emit.ts";

async function rewindMet(
  run: Omit<RewindRun, "reason">,
): Promise<boolean | undefined> {
  const driver = {
    rewind: () => Promise.resolve({ ...run, reason: "" }),
  } as unknown as AppDriver;
  const plan = {
    write_api: ["items.remove"],
    checks: [{ name: "rewind", source: "harness", status: "required" }],
  } as unknown as HarnessPlan;
  const met: (boolean | undefined)[] = [];
  const emitter: Emitter = {
    emit(frame) {
      met.push(frame.expectation_met);
      return ok(null);
    },
    sent: () => 0,
  };
  await runChecks({ driver, plan, emitter });
  assertEquals(met.length, 1);
  return met[0];
}

Deno.test("바꿀 것이 없는 write app-api는 되돌리기 확인을 통과하고 되돌리지 못한 api와 호출에 실패한 api는 떨어진다", async () => {
  const rows: [string, Omit<RewindRun, "reason">, boolean][] = [
    ["바꾼 것이 없다", {
      called: true,
      changed: false,
      applied: false,
      restored: false,
    }, true],
    ["바꾸고 되돌렸다", {
      called: true,
      changed: true,
      applied: true,
      restored: true,
    }, true],
    ["바꿨는데 changeset이 없거나 적용 실패", {
      called: true,
      changed: true,
      applied: false,
      restored: false,
    }, false],
    ["적용했는데 호출 전과 다르다", {
      called: true,
      changed: true,
      applied: true,
      restored: false,
    }, false],
    ["호출에 실패했다", {
      called: false,
      changed: false,
      applied: false,
      restored: false,
    }, false],
  ];
  for (const [name, run, met] of rows) {
    assertEquals(await rewindMet(run), met, name);
  }
});
