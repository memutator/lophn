import { assertEquals } from "@std/assert";
import { SHELL_ENV_NAMES, shellEnvironment } from "./env.ts";

Deno.test("shell 환경에 lophn token과 secret이 나가지 않는다", () => {
  const env = shellEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/x",
    LOPHN_CODING_TOKEN: "t",
    LOPHN_HOME: "/data",
    ANTHROPIC_API_KEY: "k",
    GITHUB_TOKEN: "g",
  });
  assertEquals(env, { PATH: "/usr/bin", HOME: "/home/x" });
  for (const name of Object.keys(env)) {
    assertEquals((SHELL_ENV_NAMES as readonly string[]).includes(name), true);
  }
});
