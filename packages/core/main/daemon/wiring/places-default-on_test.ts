import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { placesDefaultOnStep } from "./places-default-on.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

// 옛 key가 남으면 settings 전체가 거절된다. 다른 설정은 그대로여야 한다.
test("the old sidebar panel and tray keys are removed and other settings stay, run twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-places-default-on-"));
  try {
    const path = join(root, "settings.json");
    await writeFile(
      path,
      JSON.stringify({
        "shell.sidebar_panels": [{ app: "orders", screen: "week" }],
        "shell.tray": [{ app: "usage", screen: "usage" }],
        "shell.theme": "dark",
      }),
    );
    for (let round = 0; round < 2; round += 1) {
      assert.equal((await placesDefaultOnStep.run(root, stepDeps)).ok, true);
    }
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      "shell.theme": "dark",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
