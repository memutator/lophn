import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
import {
  codingGuiFlagStep,
  migrateCodingGuiCommand,
} from "./coding-gui-flag.ts";

const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

test("codingGuiFlagStep migrates `<cmd> gui` to `<cmd> --gui` in shell.coding_agents.commands", async () => {
  assert.equal(migrateCodingGuiCommand("claude gui"), "claude --gui");
  assert.equal(
    migrateCodingGuiCommand("agy gui --dangerously-skip-permissions"),
    "agy --gui --dangerously-skip-permissions",
  );
  assert.equal(
    migrateCodingGuiCommand("agy --dangerously-skip-permissions"),
    "agy --dangerously-skip-permissions",
  );
  assert.equal(migrateCodingGuiCommand("claude --gui"), "claude --gui");

  const root = await mkdtemp(join(tmpdir(), "lophn-coding-gui-flag-"));
  try {
    const file = join(root, "settings.json");
    await writeFile(
      file,
      JSON.stringify({
        "shell.coding_agents": {
          favorites: ["claude", "antigravity"],
          commands: {
            claude: "claude gui",
            antigravity: "agy --dangerously-skip-permissions",
            codex: "codex gui --full-auto",
          },
        },
      }),
      { mode: 0o600 },
    );
    const res = await codingGuiFlagStep.run(root, stepDeps);
    assert.equal(res.ok, true);
    const saved = JSON.parse(await readFile(file, "utf8")) as {
      "shell.coding_agents": { commands: Record<string, string> };
    };
    assert.deepEqual(saved["shell.coding_agents"].commands, {
      claude: "claude --gui",
      antigravity: "agy --dangerously-skip-permissions",
      codex: "codex --gui --full-auto",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
