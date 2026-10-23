import { assert, assertEquals } from "@std/assert";
import { flowArgv, flowFlags } from "./flags.ts";

const paths = {
  workflowFolder: "/data/projects/prj_1/workflows/w",
  sdkRoot: "/data/sdk",
};

Deno.test("flow process flags allow only reading the workflow folder and the SDK", () => {
  const flags = flowFlags(paths);
  assert(flags.ok);
  const names = flags.value.map((f) => f.split("=")[0]);
  assertEquals(names, [
    "--no-prompt",
    "--no-config",
    "--no-remote",
    "--no-npm",
    "--cached-only",
    "--no-lock",
    "--quiet",
    "--allow-read",
  ]);
  const read = flags.value.find((f) => f.startsWith("--allow-read="))!;
  assertEquals(read.slice("--allow-read=".length).split(","), [
    paths.workflowFolder,
    paths.sdkRoot,
  ]);
  for (
    const banned of [
      "--allow-write",
      "--allow-net",
      "--allow-run",
      "--allow-env",
      "--allow-all",
      "-A",
      "--allow-sys",
      "--allow-ffi",
      "--allow-import",
    ]
  ) {
    assert(!flags.value.some((f) => f.startsWith(banned)), banned);
  }
});

Deno.test("flow flags refuse a path that would split into two allowed items", () => {
  for (const bad of ["/a,/etc", "/a\n/etc", "/a\0"]) {
    const a = flowFlags({ ...paths, workflowFolder: bad });
    const b = flowFlags({ ...paths, sdkRoot: bad });
    assert(!a.ok && a.error.code === "invalid_input");
    assert(!b.ok && b.error.code === "invalid_input");
  }
});

Deno.test("flow argv puts every flag before the entry", () => {
  const argv = flowArgv({
    ...paths,
    importMap: "/data/flows/import-map.json",
    entry: "/data/sdk/flow/1.0.0/entry.ts",
    flow: "/data/projects/prj_1/workflows/w/flow.ts",
  });
  assert(argv.ok);
  const list = argv.value;
  assertEquals(list[0], "run");
  assertEquals(list.slice(-2), [
    "/data/sdk/flow/1.0.0/entry.ts",
    "/data/projects/prj_1/workflows/w/flow.ts",
  ]);
  assert(list.slice(1, -2).every((a) => a.startsWith("--")));
});
