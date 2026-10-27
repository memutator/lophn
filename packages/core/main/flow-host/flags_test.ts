import assert from "node:assert/strict";
import { test } from "node:test";
import { flowArgv, flowFlags } from "./flags.ts";

const paths = {
  workflowFolder: "/data/projects/prj_1/workflows/w",
  sdkRoot: "/data/sdk",
  outsideLinks: [] as string[],
};

test("flow process flags allow only reading the workflow folder and the SDK", () => {
  const flags = flowFlags(paths);
  assert.ok(flags.ok);
  const names = flags.value.map((f) => f.split("=")[0]);
  assert.deepStrictEqual(names, [
    "--no-prompt",
    "--no-config",
    "--no-remote",
    "--no-npm",
    "--cached-only",
    "--no-lock",
    "--quiet",
    "--allow-read",
    "--v8-flags",
  ]);
  const read = flags.value.find((f) => f.startsWith("--allow-read="))!;
  assert.deepStrictEqual(read.slice("--allow-read=".length).split(","), [
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
    assert.ok(!flags.value.some((f) => f.startsWith(banned)), banned);
  }
});

test("flow flags deny reading outside symlinks and always cap memory", () => {
  const none = flowFlags(paths);
  assert.ok(none.ok);
  assert.ok(!none.value.some((f) => f.startsWith("--deny-read")));
  assert.ok(none.value.includes("--v8-flags=--max-old-space-size=512"));

  const links = [`${paths.workflowFolder}/b`, `${paths.workflowFolder}/a`];
  const some = flowFlags({ ...paths, outsideLinks: links });
  assert.ok(some.ok);
  assert.ok(some.value.includes("--v8-flags=--max-old-space-size=512"));
  assert.deepStrictEqual(
    some.value.find((f) => f.startsWith("--deny-read=")),
    `--deny-read=${paths.workflowFolder}/a,${paths.workflowFolder}/b`,
  );
});

test("flow flags refuse a path that would split into two allowed items", () => {
  for (const bad of ["/a,/etc", "/a\n/etc", "/a\0"]) {
    const a = flowFlags({ ...paths, workflowFolder: bad });
    const b = flowFlags({ ...paths, sdkRoot: bad });
    const c = flowFlags({ ...paths, outsideLinks: [bad] });
    assert.ok(!a.ok && a.error.code === "invalid_input");
    assert.ok(!b.ok && b.error.code === "invalid_input");
    assert.ok(!c.ok && c.error.code === "invalid_input");
  }
});

test("flow argv puts every flag before the entry", () => {
  const argv = flowArgv({
    ...paths,
    outsideLinks: ["/data/projects/prj_1/workflows/w/link"],
    importMap: "/data/flows/import-map.json",
    entry: "/data/sdk/flow/1.0.0/entry.ts",
    flow: "/data/projects/prj_1/workflows/w/flow.ts",
  });
  assert.ok(argv.ok);
  const list = argv.value;
  assert.deepStrictEqual(list[0], "run");
  assert.deepStrictEqual(list.slice(-2), [
    "/data/sdk/flow/1.0.0/entry.ts",
    "/data/projects/prj_1/workflows/w/flow.ts",
  ]);
  assert.ok(list.slice(1, -2).every((a) => a.startsWith("--")));
});
