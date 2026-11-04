import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runHarnessSyncSkills } from "./harness-run.ts";

const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );

// 사람 home의 skill 폴더에 쓰는 일이라 지킨다: harness extension이 꺼지면 lophn이 쓴 사본만 지우고 사람의 같은 이름 폴더는 둔다.
test("harness extension이 꺼지면 lophn-agent skill 사본만 지우고 사람의 같은 이름 폴더는 건드리지 않는다", async () => {
  const home = await mkdtemp(join(tmpdir(), "lophn-skill-"));
  try {
    const claude = join(home, ".claude/skills/lophn-agent");
    const codex = join(home, ".agents/skills/lophn-agent");
    await mkdir(codex, { recursive: true });
    await writeFile(join(codex, "SKILL.md"), "mine");

    const on = await runHarnessSyncSkills(
      { skills: [], harness_enabled: true },
      home,
      "2026-11-04T00:00:00Z",
    );
    assert.equal(on.ok, true);
    assert.equal(await exists(join(claude, ".lophn-shared")), true);
    assert.equal(await readFile(join(codex, "SKILL.md"), "utf8"), "mine");

    const off = await runHarnessSyncSkills(
      { skills: [], harness_enabled: false },
      home,
      "2026-11-04T00:00:00Z",
    );
    assert.equal(off.ok, true);
    assert.equal(await exists(join(claude, "SKILL.md")), false);
    assert.equal(await readFile(join(codex, "SKILL.md"), "utf8"), "mine");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
