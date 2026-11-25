import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../base/mod.ts";
import {
  LEGACY_SHELL_RULES_SETTING_KEY,
  PERMISSION_RULES_SETTING_KEY,
  permissionRulesSettingSchema,
} from "../../../protocol/approvals/mod.ts";
import { migrateShellRulesDataStep } from "./migrate.ts";

const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const PRJ = "prj_0000000000000000000000000a";

test("approvals.shell_rules의 전역·project 규칙을 approvals.permission_rules로 보존하고 옛 키를 지우며 재실행해도 같다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-perm-migrate-"));
  try {
    const settingsPath = join(dir, "settings.json");
    const initial = {
      "some.other": true,
      [LEGACY_SHELL_RULES_SETTING_KEY]: {
        global: [
          { pattern: "npm test *", action: "allow" },
          { pattern: "git push *", action: "deny" },
        ],
        projects: {
          [PRJ]: [{ pattern: "cargo test *", action: "allow" }],
        },
      },
    };
    await writeFile(settingsPath, `${JSON.stringify(initial, null, 2)}\n`);

    const first = await migrateShellRulesDataStep.run(dir, stepDeps);
    assert.ok(first.ok);

    const afterFirst = JSON.parse(
      await readFile(settingsPath, "utf8"),
    ) as Record<string, unknown>;
    assert.strictEqual(LEGACY_SHELL_RULES_SETTING_KEY in afterFirst, false);
    assert.strictEqual(afterFirst["some.other"], true);

    const parsed = permissionRulesSettingSchema.parse(
      afterFirst[PERMISSION_RULES_SETTING_KEY],
    );
    assert.strictEqual(parsed.global.length, 2);
    assert.deepStrictEqual(
      parsed.global.map((r) => [r.category, r.pattern, r.action, r.source]),
      [
        ["shell", "npm test *", "allow", "global"],
        ["shell", "git push *", "deny", "global"],
      ],
    );
    assert.strictEqual(parsed.projects[PRJ]?.length, 1);
    assert.deepStrictEqual(
      parsed.projects[PRJ].map((r) => [
        r.category,
        r.pattern,
        r.action,
        r.source,
      ]),
      [["shell", "cargo test *", "allow", "project"]],
    );

    // 같은 data root에 다시 돌려도 내용이 바뀌지 않는다(idempotent).
    const snapshotBeforeSecond = await readFile(settingsPath, "utf8");
    const second = await migrateShellRulesDataStep.run(dir, stepDeps);
    assert.ok(second.ok);
    assert.strictEqual(
      await readFile(settingsPath, "utf8"),
      snapshotBeforeSecond,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("이미 있는 permission_rules와 합칠 때 기존 규칙을 유지하고 중복을 만들지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-perm-merge-"));
  try {
    const settingsPath = join(dir, "settings.json");
    const initial = {
      [PERMISSION_RULES_SETTING_KEY]: {
        global: [
          {
            id: "existing-1",
            category: "shell",
            pattern: "npm test *",
            action: "allow",
            source: "global",
          },
          {
            id: "existing-file",
            category: "file",
            pattern: "/docs/*",
            action: "allow",
            source: "global",
          },
        ],
        projects: {},
      },
      [LEGACY_SHELL_RULES_SETTING_KEY]: {
        global: [
          { pattern: "npm test *", action: "allow" },
          { pattern: "rm -rf *", action: "deny" },
        ],
        projects: {},
      },
    };
    await writeFile(settingsPath, `${JSON.stringify(initial, null, 2)}\n`);

    const res = await migrateShellRulesDataStep.run(dir, stepDeps);
    assert.ok(res.ok);

    const after = JSON.parse(await readFile(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
    const parsed = permissionRulesSettingSchema.parse(
      after[PERMISSION_RULES_SETTING_KEY],
    );
    assert.strictEqual(parsed.global.length, 3);
    assert.deepStrictEqual(
      parsed.global.map((r) => `${r.category}:${r.action}:${r.pattern}`),
      ["shell:allow:npm test *", "file:allow:/docs/*", "shell:deny:rm -rf *"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
