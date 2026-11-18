import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import { applyDataSteps, type DataStep } from "./data-steps.ts";

const deps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

// 옛 data root는 적용하지 않은 step만 한 번 돌고, 더 새 판이 쓴 root는 파일을 건드리지 않고 거절한다.
test("옛 data root의 파일만 한 번 옮기고 더 새 판의 root는 건드리지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "data-steps-"));
  try {
    const file = `${root}/settings.json`;
    await writeFile(file, '{"old": 1}');
    let runs = 0;
    const rename: DataStep = {
      id: "settings-rename-old",
      run: async (at) => {
        runs += 1;
        const json = JSON.parse(await readFile(`${at}/settings.json`, "utf8"));
        await writeFile(
          `${at}/settings.json`,
          JSON.stringify({ new: json.old }),
        );
        return ok(undefined);
      },
    };
    assert.deepStrictEqual(await applyDataSteps(root, [rename], false, deps), {
      ok: true,
      value: 1,
    });
    assert.deepStrictEqual(await applyDataSteps(root, [rename], false, deps), {
      ok: true,
      value: 0,
    });
    assert.equal(runs, 1);
    assert.deepStrictEqual(JSON.parse(await readFile(file, "utf8")), {
      new: 1,
    });

    const before = await readFile(file, "utf8");
    const older = await applyDataSteps(root, [], false, deps);
    assert.equal(older.ok, false);
    assert.equal(await readFile(file, "utf8"), before);

    // 새 root는 옮길 옛 파일이 없어 돌리지 않는다.
    const fresh = await mkdtemp(join(tmpdir(), "data-steps-"));
    try {
      assert.deepStrictEqual(
        await applyDataSteps(fresh, [rename], true, deps),
        {
          ok: true,
          value: 0,
        },
      );
      assert.equal(runs, 1);
    } finally {
      await rm(fresh, { recursive: true });
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
