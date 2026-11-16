import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import { createDrive, type DriveNative } from "./controller.ts";

const VIEW = "view_preview_1";
const LIVE = "view_live_1";

// A native module that counts every call, so a test can say "nothing reached it".
function setup() {
  const calls: string[] = [];
  const native: DriveNative = {
    snapshot: async (view) => (calls.push(`snapshot ${view}`), ok({ snapshot: "s1", width_dp: 400, height_dp: 800, nodes: [] })),
    act: async (view) => (calls.push(`act ${view}`), ok({})),
    screenshot: async (view) => (
      calls.push(`screenshot ${view}`), ok({ media_type: "image/jpeg", data_base64: "", width: 1, height: 1 })
    ),
    waitText: async (view) => (calls.push(`wait ${view}`), ok({ found: true })),
  };
  const drive = createDrive({ native, now: () => 0 });
  return { calls, drive };
}

const by = "Builder";
const asks = (view: string) => ({
  snapshot: { view, by },
  act: { view, by, snapshot: "s1", act: { type: "click" as const, node: 1 } },
  screenshot: { view, by, format: "jpeg" as const },
  wait: { view, by, text: "Done", timeout_ms: 1000 },
});

async function askAll(port: ReturnType<ReturnType<typeof setup>["drive"]["port"]>, view: string) {
  const input = asks(view);
  return [
    await port.snapshot(input.snapshot),
    await port.act(input.act),
    await port.screenshot(input.screenshot),
    await port.wait(input.wait),
  ];
}

test("drive.* on a view that is not a preview this phone opened for that computer never reaches the native module", async () => {
  const { calls, drive } = setup();
  const preview = drive.open("computer-a");
  preview.show(VIEW);
  const closed = drive.open("computer-a");
  closed.show("view_closed_1");
  closed.close();

  const refused = [
    // a live view (never registered), a closed preview, an unknown id, and this preview asked by another computer
    ...(await askAll(drive.port("computer-a"), LIVE)),
    ...(await askAll(drive.port("computer-a"), "view_closed_1")),
    ...(await askAll(drive.port("computer-a"), "view_unknown")),
    ...(await askAll(drive.port("computer-b"), VIEW)),
  ];
  for (const result of refused) {
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "unavailable");
    assert.deepEqual(result.ok ? null : result.error.details, { reason: "no_preview" });
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(preview.line(), { kind: "none" });

  preview.close();
  assert.ok((await askAll(drive.port("computer-a"), VIEW)).every((result) => !result.ok));
  assert.deepEqual(calls, []);
});

test("while the person has control act is conflict taken_over and snapshot, screenshot and wait still answer", async () => {
  const { calls, drive } = setup();
  const preview = drive.open("computer-a");
  preview.show(VIEW);
  const port = drive.port("computer-a");

  await port.snapshot(asks(VIEW).snapshot);
  assert.deepEqual(preview.line(), { kind: "driving", by });

  preview.takeControl();
  const [snapshot, act, screenshot, wait] = await askAll(port, VIEW);
  assert.equal(snapshot?.ok, true);
  assert.equal(screenshot?.ok, true);
  assert.equal(wait?.ok, true);
  assert.equal(act?.ok, false);
  assert.equal(act?.ok ? null : act?.error.code, "conflict");
  assert.deepEqual(act?.ok ? null : act?.error.details, { reason: "taken_over" });
  assert.ok(!calls.includes(`act ${VIEW}`));
  assert.deepEqual(preview.line(), { kind: "control" });

  preview.handBack();
  assert.equal((await port.act(asks(VIEW).act)).ok, true);
  assert.ok(calls.includes(`act ${VIEW}`));
});
