import assert from "node:assert/strict";
import { test } from "node:test";

import { SHELL_ENV_NAMES, shellEnvironment } from "./env.ts";

test("shell 환경에 lophn token과 secret이 나가지 않는다", () => {
  const env = shellEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/x",
    LOPHN_CODING_TOKEN: "t",
    LOPHN_HOME: "/data",
    ANTHROPIC_API_KEY: "k",
    GITHUB_TOKEN: "g",
  }, "/opt/deno/bin/deno");
  assert.deepStrictEqual(env, {
    PATH: "/opt/deno/bin:/usr/bin",
    HOME: "/home/x",
  });
  for (const name of Object.keys(env)) {
    assert.deepStrictEqual(
      (SHELL_ENV_NAMES as readonly string[]).includes(name),
      true,
    );
  }
});
