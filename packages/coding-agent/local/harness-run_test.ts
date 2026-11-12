import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runHarnessInstall, runHarnessSyncSkills } from "./harness-run.ts";

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

// 사람의 dotfile 관리 도구가 settings.json을 symlink로 두므로 지킨다: 설치가 symlink를 보통 file로 바꾸거나 권한을 잃으면 안 된다.
test("`.claude/settings.json`이 symlink면 설치 뒤에도 symlink이고 대상 file에 우리 hook이 들며 mode가 그대로다", async () => {
  const home = await mkdtemp(join(tmpdir(), "lophn-install-"));
  try {
    const target = join(home, "dotfiles/claude-settings.json");
    const link = join(home, ".claude/settings.json");
    await mkdir(join(home, "dotfiles"), { recursive: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(target, JSON.stringify({ theme: "dark" }), {
      mode: 0o600,
    });
    await symlink(target, link);

    const done = await runHarnessInstall(
      { harness: "claude" },
      home,
      "2026-11-12T00:00:00Z",
    );
    assert.equal(done.ok, true);
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    const written = JSON.parse(await readFile(target, "utf8"));
    assert.equal(written.theme, "dark");
    assert.match(JSON.stringify(written.hooks), /lophn hook claude /);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
