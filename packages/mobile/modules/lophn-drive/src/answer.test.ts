import assert from "node:assert/strict";
import { test } from "node:test";
import { driveActOutputSchema, driveSnapshotOutputSchema } from "../../../../protocol/phone/drive.ts";
import { readAnswer } from "./answer.ts";

const snapshot = {
  snapshot: "3",
  width_dp: 411,
  height_dp: 600,
  nodes: [
    { node: 1, depth: 0, role: "textbox", name: "Password", value: "••••", flags: [] },
    { node: 2, depth: 1, role: "button", name: "Row 59", flags: ["offscreen"] },
  ],
};

test("a snapshot answer passes only in the contract's shape", () => {
  const good = readAnswer(JSON.stringify({ ok: true, value: snapshot, bounds: [] }), driveSnapshotOutputSchema);
  assert.deepEqual(good, { ok: true, value: snapshot });
  // An extra field on a node (a raw view text, say) is not passed on to core.
  const extra = { ...snapshot, nodes: [{ ...snapshot.nodes[0], text: "hunter2" }] };
  const bad = readAnswer(JSON.stringify({ ok: true, value: extra }), driveSnapshotOutputSchema);
  assert.deepEqual(bad, { ok: false, error: { code: "internal", message: "internal error" } });
});

test("a refused act keeps its code and the contract's reason", () => {
  for (const reason of ["stale_ref", "off_screen"]) {
    const answer = JSON.stringify({ ok: false, code: "conflict", reason, message: "no" });
    assert.deepEqual(readAnswer(answer, driveActOutputSchema), {
      ok: false,
      error: { code: "conflict", message: "no", details: { reason } },
    });
  }
  const off = JSON.stringify({ ok: false, code: "unavailable", reason: "screen_off", message: "off" });
  assert.deepEqual(readAnswer(off, driveActOutputSchema), {
    ok: false,
    error: { code: "unavailable", message: "off", details: { reason: "screen_off" } },
  });
});

test("an answer that is not one of the seven codes, or not JSON, is internal", () => {
  const internal = { ok: false, error: { code: "internal", message: "internal error" } };
  assert.deepEqual(readAnswer(JSON.stringify({ ok: false, code: "gone", message: "x" }), driveActOutputSchema), internal);
  assert.deepEqual(readAnswer("not json", driveActOutputSchema), internal);
});
