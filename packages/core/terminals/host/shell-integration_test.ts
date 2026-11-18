import assert from "node:assert/strict";
import { test } from "node:test";
import { integrateShell } from "./shell-integration.ts";

// 판을 올릴 때 옛 supervisor가 run 폴더를 지워 bash 탭이 rc를 하나도 읽지 않았다. 시작 층이 사라져도 사용자 rc는 읽어야 한다.
test("shell 시작 층 file이 없으면 원래 login shell 인자로 띄운다", () => {
  const dir = "/run/lophn/key/shell-1/shell-init";
  const env = { LPN_SHELL_INIT: dir };
  const cases = [
    {
      file: "/bin/bash",
      present: [`${dir}/bash.sh`],
      args: ["--init-file", `${dir}/bash.sh`],
      env: {},
    },
    { file: "/bin/bash", present: [], args: ["-l"], env: {} },
    {
      file: "/usr/bin/zsh",
      present: [`${dir}/zsh/.zshenv`],
      args: ["-l"],
      env: { ZDOTDIR: `${dir}/zsh`, LPN_USER_ZDOTDIR: "" },
    },
    { file: "/usr/bin/zsh", present: [], args: ["-l"], env: {} },
  ];
  for (const c of cases) {
    const got = integrateShell(c.file, ["-l"], env, (path) =>
      c.present.includes(path),
    );
    assert.deepEqual(got, { args: c.args, env: c.env }, c.file);
  }
});
