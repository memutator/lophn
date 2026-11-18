import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appearanceThemesStep } from "./appearance-themes.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

// 옛 값이 남으면 settings 전체가 거절된다. 사람이 고른 모양은 새 key로 이어지고 다른 설정은 그대로여야 한다.
test("old theme, background and accent move to mode, themes and an accent color, run twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-appearance-themes-"));
  try {
    const path = join(root, "settings.json");
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [
        {
          "shell.theme": "dark",
          "shell.background": "cool",
          "shell.accent": "purple",
          "shell.density": "compact",
        },
        {
          "shell.mode": "dark",
          "shell.light_theme": "cool-light",
          "shell.dark_theme": "cool-dark",
          "shell.accent": "#6b3fc4",
          "shell.density": "compact",
        },
      ],
      [{ "shell.background": "warm", "shell.accent": "ink" }, {}],
    ];
    for (const [before, after] of cases) {
      await writeFile(path, JSON.stringify(before));
      for (let round = 0; round < 2; round += 1) {
        assert.equal((await appearanceThemesStep.run(root, stepDeps)).ok, true);
      }
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), after);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
