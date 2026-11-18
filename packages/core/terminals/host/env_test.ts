import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLoginShell, terminalEnv } from "./env.ts";

// 두 번 renderer만 고쳤는데 다시 생긴 bug다. 띄운 곳의 env와 상관없이 truecolor를 알린다.
test("터미널 shell은 띄운 process에 COLORTERM이 없거나 달라도 truecolor를 받는다", () => {
  assert.equal(terminalEnv({ TERM: "xterm-256color" }).COLORTERM, "truecolor");
  assert.equal(terminalEnv({ COLORTERM: "" }).COLORTERM, "truecolor");
  assert.equal(terminalEnv({ COLORTERM: "8bit" }).COLORTERM, "truecolor");
});

// ssh-agent·git 작성자·local proxy가 터미널 탭에서 사라졌던 bug다. 이름이 token 꼴이거나 값이 127.0.0.1 port여도 사용자 것은 남긴다.
test("터미널 env는 사용자 env 허용 목록을 남기고 플랫폼 token·endpoint는 지운다", () => {
  const env = terminalEnv({
    SSH_AUTH_SOCK: "/run/user/1000/agent.sock",
    XAUTHORITY: "/home/ana/.Xauthority",
    GIT_AUTHOR_NAME: "Ana",
    GIT_COMMITTER_EMAIL: "ana@example.com",
    HTTP_PROXY: "http://127.0.0.1:7890",
    https_proxy: "http://127.0.0.1:7890",
    LOPHN_CORE_URL: "http://localhost:1",
    GITHUB_TOKEN: "x",
    OPENAI_API_KEY: "x",
    GIT_AUTHOR_TOKEN: "x",
    DEV_SERVER: "http://127.0.0.1:3000",
    CORE: "lophn-core://abc",
  });
  assert.deepEqual(Object.keys(env).sort(), [
    "COLORTERM",
    "GIT_AUTHOR_NAME",
    "GIT_COMMITTER_EMAIL",
    "HTTP_PROXY",
    "SSH_AUTH_SOCK",
    "XAUTHORITY",
    "https_proxy",
  ]);
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
