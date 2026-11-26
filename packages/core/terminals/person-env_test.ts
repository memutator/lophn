import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CLIPBOARD_SHIM_NAMES,
  createPersonEnv,
  isHeadlessLinux,
  lophnCliPath,
} from "./mod.ts";

// 설치된 앱의 터미널에서 띄운 저장소 core가 물려받은 `LOPHN_CLI`(설치된 CLI)를 쓰면 dev data root에 설치본 core가 떴다.
// 규칙은 env를 받지 않으므로 저장소 실행의 답은 저장소의 dev launcher이거나 null뿐이다.
test("저장소 실행은 저장소의 dev launcher만 쓰고 없으면 null이다", () => {
  const root = "/repo";
  const launcher = join(root, ".cache", "dev-cli", "lophn");
  const pick = (exists: boolean) =>
    lophnCliPath({
      installed: false,
      platformRoot: root,
      platform: "linux",
      exists: (path) => exists && path === launcher,
    });

  assert.equal(pick(true), launcher);
  assert.equal(pick(false), null);
});

test("DISPLAY와 WAYLAND_DISPLAY가 모두 비어 있는 Linux에서만 PATH 앞에 clipboard shim 폴더를 둔다", async () => {
  assert.equal(isHeadlessLinux("linux", {}), true);
  assert.equal(isHeadlessLinux("linux", { DISPLAY: ":0" }), false);
  assert.equal(
    isHeadlessLinux("linux", { WAYLAND_DISPLAY: "wayland-0" }),
    false,
  );
  assert.equal(isHeadlessLinux("darwin", {}), false);

  const dir = mkdtempSync(join(tmpdir(), "lophn-clip-shim-"));
  const shimDir = join(dir, "shim");
  try {
    const headlessEnv = createPersonEnv({
      platform: "linux",
      env: { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" },
      run: async () => null,
      cli: null,
      clipboardShimDir: shimDir,
    });
    const env = await headlessEnv.env();
    assert.ok(env.PATH?.startsWith(`${shimDir}:`));
    for (const name of CLIPBOARD_SHIM_NAMES) {
      const full = join(shimDir, name);
      assert.ok(
        (statSync(full).mode & 0o100) !== 0,
        `${name} should be executable`,
      );
      assert.match(readFileSync(full, "utf8"), /\\033\]52;c;/);
    }

    const guiEnv = createPersonEnv({
      platform: "linux",
      env: { PATH: "/usr/bin:/bin", DISPLAY: ":0", SHELL: "/bin/sh" },
      run: async () => null,
      cli: null,
      clipboardShimDir: shimDir,
    });
    assert.equal((await guiEnv.env()).PATH, "/usr/bin:/bin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
