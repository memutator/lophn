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

import {
  cliLauncher,
  linuxInstallLayout,
} from "../../base/install/linux-install.ts";
import { winCliLauncher } from "../../base/install/win-install.ts";
import { err } from "../../base/mod.ts";
import { hookStdoutRows } from "../../protocol/coding-agent/mod.ts";
import { runHarnessInstall, runHarnessSyncSkills } from "./harness-run.ts";
import { HOOK_COMMANDS } from "./hook.ts";
import type { LocalContext } from "./types.ts";

const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );

// 사람 home의 skill 폴더에 쓰는 일이라 지킨다: lophn-agent skill은 hook이 없어도 두고, 사람의 같은 이름 폴더는 건드리지 않는다.
test("sync-skills는 lophn-agent skill 사본을 두고 사람의 같은 이름 폴더는 건드리지 않는다", async () => {
  const home = await mkdtemp(join(tmpdir(), "lophn-skill-"));
  try {
    const claude = join(home, ".claude/skills/lophn-agent");
    const codex = join(home, ".agents/skills/lophn-agent");
    await mkdir(codex, { recursive: true });
    await writeFile(join(codex, "SKILL.md"), "mine");

    const synced = await runHarnessSyncSkills(
      { skills: [], deployed: [] },
      home,
      "2026-11-04T00:00:00Z",
    );
    assert.equal(synced.ok, true);
    assert.equal(await exists(join(claude, ".lophn-shared")), true);
    assert.equal(await readFile(join(codex, "SKILL.md"), "utf8"), "mine");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// 사람의 dotfile 관리 도구가 settings.json을 symlink로 두므로 지킨다: 설치가 symlink를 보통 file로 바꾸거나 권한을 잃으면 안 된다.
// 배포하지 않은 앱 skill이 사람의 harness에 복사되면 안 되고, 배포를 거두면 우리가 쓴 사본이 지워진다.
test("sync-skills는 배포에 이름이 적힌 public skill만 복사하고 배포를 거두면 사본을 지운다", async () => {
  const home = await mkdtemp(join(tmpdir(), "lophn-skill-deployed-"));
  try {
    const installed = await runHarnessInstall(
      { harness: "claude" },
      home,
      "2026-11-12T00:00:00Z",
    );
    assert.equal(installed.ok, true);
    const skill = (name: string) => ({
      app: "app_01hzzzzzzzzzzzzzzzzzzzzzza",
      slug: "notes",
      release: "rel_1",
      name,
      skill_md: `---\nname: ${name}\ndescription: d\n---\n`,
      files: [],
    });
    const folder = (name: string) => join(home, ".claude/skills", name);
    const skills = [skill("export"), skill("import")];
    await runHarnessSyncSkills(
      {
        skills,
        deployed: [{ app: "app_01hzzzzzzzzzzzzzzzzzzzzzza", skill: "export" }],
      },
      home,
      "2026-11-12T00:00:00Z",
    );
    assert.equal(await exists(join(folder("export"), "SKILL.md")), true);
    assert.equal(await exists(join(folder("import"), "SKILL.md")), false);

    await runHarnessSyncSkills(
      { skills, deployed: [] },
      home,
      "2026-11-12T00:00:00Z",
    );
    assert.equal(await exists(join(folder("export"), "SKILL.md")), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

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

test("antigravity PreToolUse hook과 launcher는 stdout을 완전히 비우고 Stop·나머지는 JSON을 낸다", async () => {
  const hookCommand = HOOK_COMMANDS[0]!;
  const ctx: LocalContext = {
    env: { get: () => undefined },
    home: "/tmp",
    cwd: "/tmp",
    now: () => "2026-11-25T00:00:00Z",
    stdin: () => Promise.resolve("{}"),
    core: () => err({ code: "unavailable", message: "unused" }),
  };

  const preTool = await hookCommand.run(
    { harness: "antigravity", event: "PreToolUse" },
    ctx,
  );
  assert.deepStrictEqual(preTool, { ok: true, value: undefined });

  const stop = await hookCommand.run(
    { harness: "antigravity", event: "Stop" },
    ctx,
  );
  assert.deepStrictEqual(stop, { ok: true, value: '{"decision":"stop"}' });

  const postTool = await hookCommand.run(
    { harness: "antigravity", event: "PostToolUse" },
    ctx,
  );
  assert.deepStrictEqual(postTool, { ok: true, value: "{}" });

  const rows = hookStdoutRows();
  const sh = cliLauncher(linuxInstallLayout(), rows);
  assert.equal(sh.includes("    antigravity:PreToolUse) ;;"), true);
  assert.equal(sh.includes("antigravity:PreToolUse) printf"), false);
  assert.ok(
    sh.indexOf("antigravity:PreToolUse) ;;") < sh.indexOf("antigravity:*)"),
  );

  const cmd = winCliLauncher(rows);
  assert.equal(
    cmd.includes('if "%~2:%~3"=="antigravity:PreToolUse" exit /b 0'),
    true,
  );
  assert.equal(cmd.includes('antigravity:PreToolUse" (echo'), false);
  assert.ok(
    cmd.indexOf('if "%~2:%~3"=="antigravity:PreToolUse" exit /b 0') <
      cmd.indexOf('if "%~2"=="antigravity"'),
  );
});
