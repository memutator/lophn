import { assertEquals } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import { runChecks } from "./checks.ts";
import type { AppDriver, HarnessPlan, RewindRun } from "./driver.ts";
import type { Emitter } from "./emit.ts";

async function rewindFrame(run: Omit<RewindRun, "reason">) {
  const driver = {
    rewind: () => Promise.resolve({ ...run, reason: "" }),
  } as unknown as AppDriver;
  const plan = {
    write_api: ["items.remove"],
    checks: [{ name: "rewind", source: "harness", status: "required" }],
  } as unknown as HarnessPlan;
  const frames: { met?: boolean; unproven: unknown }[] = [];
  const emitter: Emitter = {
    emit(frame) {
      frames.push({
        met: frame.expectation_met,
        unproven: (frame.actual as { unproven?: unknown }).unproven,
      });
      return ok(null);
    },
    sent: () => 0,
  };
  await runChecks({ driver, plan, emitter });
  assertEquals(frames.length, 1);
  return frames[0];
}

Deno.test("호출이 성공하고 되돌리기가 틀린 write app-api는 떨어지고 호출이 실패한 api는 떨어지지 않고 unproven에 실린다", async () => {
  const rows: [string, Omit<RewindRun, "reason">, boolean, string[]][] = [
    [
      "바꾼 것이 없다",
      {
        called: true,
        changed: false,
        applied: false,
        restored: false,
      },
      true,
      [],
    ],
    [
      "바꾸고 되돌렸다",
      {
        called: true,
        changed: true,
        applied: true,
        restored: true,
      },
      true,
      [],
    ],
    [
      "바꿨는데 changeset이 없거나 적용 실패",
      {
        called: true,
        changed: true,
        applied: false,
        restored: false,
      },
      false,
      [],
    ],
    [
      "적용했는데 호출 전과 다르다",
      {
        called: true,
        changed: true,
        applied: true,
        restored: false,
      },
      false,
      [],
    ],
    [
      "호출에 실패했다",
      {
        called: false,
        changed: false,
        applied: false,
        restored: false,
      },
      true,
      ["items.remove"],
    ],
  ];
  for (const [name, run, met, unproven] of rows) {
    const frame = await rewindFrame(run);
    assertEquals(frame.met, met, name);
    assertEquals(frame.unproven, unproven, name);
  }
});
