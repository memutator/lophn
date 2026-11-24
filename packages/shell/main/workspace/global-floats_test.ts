import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createGlobalFloatsStore } from "./global-floats.ts";

const APP = "app_00000000000000000000000000";
const PRJ = "prj_00000000000000000000000000";
const MACHINE = "mch_00000000000000000000000000";
const HOME = { kind: "home" } as const;
const panel = (screen: string) => ({
  kind: "app_panel",
  key: `global:${APP}:${screen}`,
  app: APP,
  surface: screen,
});
const RECT = { x: 10, y: 20, width: 400, height: 300 };

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lophn-global-floats-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("쓴 전역 float 목록이 그대로 읽히고, 틀린 파일이나 다른 schema_version은 빈 목록으로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createGlobalFloatsStore(root);
    assert.deepEqual(await store.read(), []);
    const floats = [
      { workspace: HOME, tab: panel("main"), rect: RECT, minimized: false },
      {
        workspace: { kind: "project", id: PRJ, machine: MACHINE },
        tab: {
          kind: "document_editor",
          key: "/work/a.md",
          path: "/work/a.md",
          machine: MACHINE,
        },
        rect: RECT,
        minimized: false,
      },
      {
        workspace: { kind: "project", id: PRJ },
        tab: {
          kind: "document_editor",
          key: "/work/b.md",
          path: "/work/b.md",
        },
        rect: RECT,
        minimized: true,
        pinned: true,
      },
    ];
    assert.deepEqual(await store.write(floats), { ok: true, value: null });
    assert.deepEqual(await store.read(), floats);

    // 모양이 틀린 값과 저장하지 않는 kind(터미널)는 쓰지 않고 파일을 그대로 둔다.
    const bad = await store.write([
      { workspace: HOME, tab: { kind: "nope", key: "x" }, rect: RECT },
    ]);
    assert.equal(bad.ok, false);
    const withTerminal = await store.write([
      {
        workspace: { kind: "project", id: PRJ },
        tab: { kind: "terminal", key: "terminal-1", project_folder: "/work" },
        rect: RECT,
        minimized: false,
      },
    ]);
    assert.equal(withTerminal.ok, false);
    assert.deepEqual(await store.read(), floats);

    const file = join(root, "shell", "global-floats.json");
    await writeFile(file, "{not json");
    assert.deepEqual(await store.read(), []);
    await writeFile(file, JSON.stringify({ schema_version: 1, floats }));
    assert.deepEqual(await store.read(), []);

    // 모르는 kind와 옛 파일의 터미널 float은 건너뛰고 나머지 float은 읽는다.
    const unknown = { ...floats[0], tab: { kind: "nope", key: "x" } };
    const legacyTerminal = {
      workspace: { kind: "project", id: PRJ },
      tab: { kind: "terminal", key: "terminal-1", project_folder: "/work" },
      rect: RECT,
      minimized: false,
    };
    await writeFile(
      file,
      JSON.stringify({
        schema_version: 4,
        floats: [unknown, legacyTerminal, floats[1]],
      }),
    );
    assert.deepEqual(await store.read(), [floats[1]]);
    // 판 3은 core의 data step이 올리기 전에는 읽지 않는다.
    await writeFile(file, JSON.stringify({ schema_version: 3, floats }));
    assert.deepEqual(await store.read(), []);
  });
});
