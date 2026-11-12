import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import { objectPathFor, purposesPathFor, unreferencedPathFor } from "../mod.ts";
import { runMaintenanceGc } from "./maintenance.ts";

const purposesPath = (root: string, hash: string) => {
  const path = purposesPathFor(root, hash);
  assert.ok(path.ok);
  return path.value;
};
const markerPath = (root: string, hash: string) => {
  const path = unreferencedPathFor(root, hash);
  assert.ok(path.ok);
  return path.value;
};

async function put(path: string, body: string): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, body);
}

// 본문이 있는 hash의 목적 기록은 용량 정리의 근거라 남아야 하고, 본문이 없다고
// 확인된 hash의 기록만 지운다.
test("정지 유지보수는 본문이 없는 hash의 기록만 지우고 있는 hash의 기록은 남긴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "maintenance-gc-"));
  try {
    const kept = "a1".padEnd(64, "0");
    const collected = "b2".padEnd(64, "0");
    const orphan = "c3".padEnd(64, "0");
    const nowMs = 10_000_000;
    const purpose = `${JSON.stringify({ purpose: "other" })}\n`;
    const marked = (atMs: number) =>
      `${JSON.stringify({ unreferenced_at_ms: atMs })}\n`;
    for (const hash of [kept, collected, orphan]) {
      await put(purposesPath(root, hash), purpose);
    }
    await put(objectPathFor(root, kept), "kept");
    await put(objectPathFor(root, collected), "collected");
    await put(markerPath(root, kept), marked(nowMs));
    await put(markerPath(root, collected), marked(0));
    await put(markerPath(root, orphan), marked(0));

    const outcome = await runMaintenanceGc({
      root,
      conditions: () => ({
        preparationsBlocked: true,
        commandsBlocked: true,
        writerStopped: true,
      }),
      fields: () => [],
      listReferenceRows: async () => ok([]),
      nowMs: () => nowMs,
      graceMs: 1_000,
    });
    assert.deepStrictEqual(outcome, {
      ok: true,
      value: { deleted: [collected], blocked: [], failed: [] },
    });

    const exists = existsSync;
    assert.ok(exists(objectPathFor(root, kept)));
    assert.ok(exists(purposesPath(root, kept)));
    assert.ok(exists(markerPath(root, kept)));
    for (const hash of [collected, orphan]) {
      assert.ok(!exists(objectPathFor(root, hash)));
      assert.ok(!exists(purposesPath(root, hash)));
      assert.ok(!exists(markerPath(root, hash)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
