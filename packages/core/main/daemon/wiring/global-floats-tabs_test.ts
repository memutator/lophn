import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { globalFloatsTabsStep } from "./global-floats-tabs.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const RECT = { x: 10, y: 20, width: 400, height: 300 };

test("판 1 전역 float 파일은 앱 panel 탭 판 2로 옮겨 rect, 접힘, 고정을 잃지 않고 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-global-floats-tabs-"));
  try {
    await mkdir(join(root, "shell"));
    const file = join(root, "shell", "global-floats.json");
    await writeFile(
      file,
      JSON.stringify({
        schema_version: 1,
        floats: [
          { app: APP, screen: "main", rect: RECT, minimized: false },
          {
            app: APP,
            screen: "side",
            rect: RECT,
            minimized: true,
            pinned: true,
          },
        ],
      }),
    );
    assert.deepEqual(await globalFloatsTabsStep.run(root, stepDeps), {
      ok: true,
      value: undefined,
    });
    const moved = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(moved, {
      schema_version: 2,
      floats: [
        {
          workspace: { kind: "home" },
          tab: {
            kind: "app_panel",
            key: `global:${APP}:main`,
            app: APP,
            surface: "main",
          },
          rect: RECT,
          minimized: false,
        },
        {
          workspace: { kind: "home" },
          tab: {
            kind: "app_panel",
            key: `global:${APP}:side`,
            app: APP,
            surface: "side",
          },
          rect: RECT,
          minimized: true,
          pinned: true,
        },
      ],
    });
    await globalFloatsTabsStep.run(root, stepDeps);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), moved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
