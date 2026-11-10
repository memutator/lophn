import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { test } from "node:test";

import { SHELL_ENV_NAMES, shellEnvironment } from "./env.ts";

test("shell 환경에 lophn token과 secret이 나가지 않고 agent shell 표시만 붙는다", () => {
  const env = shellEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/home/x",
      LOPHN_CODING_TOKEN: "t",
      LOPHN_HOME: "/data",
      ANTHROPIC_API_KEY: "k",
      GITHUB_TOKEN: "g",
    },
    "/data/run/bin",
  );
  assert.deepStrictEqual(env, {
    // shim 폴더는 OS의 PATH 구분자로 붙는다(Windows는 `;`).
    PATH: `/data/run/bin${delimiter}/usr/bin`,
    HOME: "/home/x",
    LOPHN_AGENT_SHELL: "1",
  });
  for (const name of Object.keys(env).filter(
    (one) => one !== "LOPHN_AGENT_SHELL",
  )) {
    assert.deepStrictEqual(
      (SHELL_ENV_NAMES as readonly string[]).includes(name),
      true,
    );
  }
});

test("LOPHN_SESSION_ID는 부르는 쪽이 준 session만 나가고 부모 env에서 물려받지 않는다", () => {
  const parent = {
    PATH: "/usr/bin",
    LOPHN_SESSION_ID: "ses_parent",
    LOPHN_X: "x",
  };
  assert.deepStrictEqual(shellEnvironment(parent, undefined, "linux"), {
    PATH: "/usr/bin",
    LOPHN_AGENT_SHELL: "1",
  });
  assert.deepStrictEqual(
    shellEnvironment(parent, undefined, "linux", "ses_mine"),
    { PATH: "/usr/bin", LOPHN_SESSION_ID: "ses_mine", LOPHN_AGENT_SHELL: "1" },
  );
});
