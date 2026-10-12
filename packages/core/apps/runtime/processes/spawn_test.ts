import { assert, assertEquals } from "@std/assert";
import type { FlagSet } from "../../permissions/mod.ts";
import { appArgv, appEnv, flagsAccepted } from "./spawn.ts";

const FLAGS: FlagSet = {
  args: ["--cached-only", "--no-remote", "--quiet"],
  limits: [],
};

Deno.test("apps/runtime#R24: 자식 환경은 HOME·DENO_DIR·XDG_CACHE_HOME·PATH만 담는다", () => {
  const env = appEnv({
    home: "/home/me",
    denoDir: "/home/me/.cache/deno",
    xdgCacheHome: "/home/me/.cache",
    path: "/usr/bin",
  });
  assertEquals(Object.keys(env).sort(), [
    "DENO_DIR",
    "HOME",
    "PATH",
    "XDG_CACHE_HOME",
  ]);
  // parent의 API token은 자식 환경에 없다.
  const parent = { OPENAI_API_KEY: "sk-secret", ANTHROPIC_API_KEY: "sk-ant" };
  for (const value of Object.values(env)) {
    assert(!Object.values(parent).includes(value));
  }
});

Deno.test("apps/runtime#R7: argv에는 token·secret이 없고 flag는 계산된 그대로다", () => {
  const argv = appArgv({
    deno: "/usr/bin/deno",
    entry: "/bundle/main.ts",
    flags: FLAGS,
    importMap: "/bundle/import-map.json",
    environment: { home: "", denoDir: "", xdgCacheHome: "", path: "" },
    startLine: JSON.stringify({ broker_credential: "cred-secret" }),
  });
  assertEquals(argv[0], "run");
  assert(argv.includes("--cached-only"));
  assert(argv.includes("--no-remote"));
  assert(argv.includes("--import-map=/bundle/import-map.json"));
  assertEquals(argv.at(-1), "/bundle/main.ts");
  assert(!argv.join(" ").includes("cred-secret"));
  assert(!argv.join(" ").includes("sk-"));
});

Deno.test("apps/runtime#R23: 원격 import를 여는 flag는 받지 않는다", () => {
  assert(flagsAccepted(FLAGS));
  assert(!flagsAccepted({ args: ["--allow-all"], limits: [] }));
  assert(!flagsAccepted({ args: ["--allow-env=HOME"], limits: [] }));
  assert(!flagsAccepted({ args: ["--allow-run=/bin/sh"], limits: [] }));
});
