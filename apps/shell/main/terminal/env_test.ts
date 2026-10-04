import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveLoginShell,
  stripPlatformEnv,
} from "../../terminal-host/env.ts";

test("shell/terminal#R5: 일반 shell 환경에서 token·handle·내부 endpoint를 뺀다", () => {
  const cleaned = stripPlatformEnv({
    PATH: "/usr/bin",
    HOME: "/home/person",
    USER_TOKEN: "secret-token",
    LOPHN_HOME: "/tmp/lophn",
    LOPHN_API: "lophn-core://127.0.0.1:9",
    CONFIRMATION_HANDLE: "once",
    CONNECTION_SECRET: "conn",
    EDITOR: "vim",
    NOTES: "see lophn-shell://desktop",
  });
  assert.deepEqual(Object.keys(cleaned).sort(), ["EDITOR", "HOME", "PATH"]);
  assert.equal(JSON.stringify(cleaned).includes("secret"), false);
  assert.equal(JSON.stringify(cleaned).includes("once"), false);
});

test("shell/terminal#R4: Linux·macOS는 사용자 login shell을 argv 배열로 고른다", () => {
  const program = resolveLoginShell({
    platform: "linux",
    env: { SHELL: "/bin/bash" },
    exists: (file) => file === "/bin/bash",
  });
  assert.deepEqual(program, {
    file: "/bin/bash",
    args: ["-l"],
    label: "/bin/bash",
  });
});

test("shell/terminal#R4: Windows는 PowerShell 7, 없으면 표시한 5.1을 직접 고른다", () => {
  const seven = resolveLoginShell({
    platform: "win32",
    env: {},
    exists: (file) => file.endsWith("pwsh.exe"),
  });
  assert.equal(seven?.label, "PowerShell 7");
  assert.deepEqual(seven?.args, ["-NoLogo"]);

  const five = resolveLoginShell({
    platform: "win32",
    env: {},
    exists: (file) => file.endsWith("powershell.exe"),
  });
  assert.equal(five?.label, "PowerShell 5.1");
  assert.equal(five?.file.includes("WindowsPowerShell"), true);
});

test("shell/terminal#R4: shell이 없으면 다른 프로그램으로 대신 고르지 않는다", () => {
  const missing = resolveLoginShell({
    platform: "linux",
    env: { SHELL: "/missing/fish" },
    exists: () => false,
  });
  assert.equal(missing, null);
});
