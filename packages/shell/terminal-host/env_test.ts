import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLoginShell, terminalEnv } from "./env.ts";

// 두 번 renderer만 고쳤는데 다시 생긴 bug다. 띄운 곳의 env와 상관없이 truecolor를 알린다.
test("터미널 shell은 띄운 process에 COLORTERM이 없거나 달라도 truecolor를 받는다", () => {
  assert.equal(terminalEnv({ TERM: "xterm-256color" }).COLORTERM, "truecolor");
  assert.equal(terminalEnv({ COLORTERM: "" }).COLORTERM, "truecolor");
  assert.equal(terminalEnv({ COLORTERM: "8bit" }).COLORTERM, "truecolor");
});

// Windows 실기에서 winget으로 깐 PowerShell 7(MSIX)을 못 찾고 5.1로 떨어졌다. 그 판은 PATH의 앱 실행 alias로만 보인다.
test("Windows 터미널은 PATH에 있는 PowerShell 7을 먼저 쓰고, 없으면 5.1이다", () => {
  const alias =
    "C:\\Users\\ana\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
  const powershell51 =
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const lookup = (files: string[]) => ({
    platform: "win32" as const,
    env: {
      Path: "C:\\Windows\\System32;C:\\Users\\ana\\AppData\\Local\\Microsoft\\WindowsApps\\",
    },
    exists: (file: string) => files.includes(file),
  });
  assert.equal(resolveLoginShell(lookup([alias, powershell51]))?.file, alias);
  assert.deepEqual(resolveLoginShell(lookup([powershell51])), {
    file: powershell51,
    args: ["-NoLogo"],
    label: "PowerShell 5.1",
  });
});
