import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../../packages/base/mod.ts";
import type { Scenario } from "../../types.ts";
import {
  e2eBoundaries,
  type GateDeps,
  parseCatalog,
  runGate,
  selectE2e,
} from "./mod.ts";

const moduleYaml = `
modules:
  - path: packages/base
    boundary: base
  - path: packages/protocol
    boundary: protocol
  - path: packages/core/apps
    boundary: apps
  - path: packages/core/lophn-agent
    boundary: lophn-agent
  - path: packages/core/main
    boundary: core
  - path: packages/shell/main
    boundary: shell
  - path: tests
    boundary: null
`;
const boundaryYaml = `
elements:
  - id: core
    children:
      - id: apps
        children:
          - id: app-releases
      - id: lophn-agent
        children:
          - id: run-loop
      - id: server
  - id: base
interfaces:
  - id: core-api
    provided_by: [server]
`;
const cat = parseCatalog(moduleYaml, boundaryYaml);
const e2e = [
  { file: "tests/e2e/release_test.ts", boundaries: ["app-releases"] },
  { file: "tests/e2e/loop_test.ts", boundaries: ["run-loop"] },
  { file: "tests/e2e/x_test.ts", boundaries: ["server"] },
];
const pick = (...files: string[]) =>
  selectE2e({ files, modules: cat.modules, tree: cat.tree, e2e });

test("selectE2e never lets a changed product file pass without the e2e it touches", () => {
  const all = e2e.map((e) => e.file).sort();
  const table: [string, string[], boolean][] = [
    ["packages/core/agent-roles/roles/lophn/prompt.md", [], false],
    [
      "packages/core/lophn-agent/run-loop/loop.ts",
      ["tests/e2e/loop_test.ts"],
      false,
    ],
    ["packages/core/apps/x.ts", ["tests/e2e/release_test.ts"], false],
    ["packages/core/main/wiring.ts", all, false],
    ["packages/protocol/x.ts", all, true],
    ["tests/support/x.ts", all, true],
    ["package.json", all, true],
    ["package-lock.json", all, true],
    ["packages/unknown/x.ts", all, true],
    ["tests/e2e/x_test.ts", ["tests/e2e/x_test.ts"], false],
    ["packages/shell/main/x.ts", [], false],
  ];
  for (const [file, files, isAll] of table) {
    const got = pick(file);
    assert.deepStrictEqual(got.files, files, file);
    assert.deepStrictEqual(got.all, isAll, file);
  }
  assert.deepStrictEqual(
    e2eBoundaries("// - contract: no ids here", cat.known, cat.aliases),
    ["*"],
  );
  assert.deepStrictEqual(
    e2eBoundaries(
      "// - contract: interface `core-api`(a),\n//   `run-loop`(b).\n// - 회귀: `apps`",
      cat.known,
      cat.aliases,
    ),
    ["run-loop", "server"],
  );
});

const scenario = (id: string) => ({ id }) as Scenario;

function fakeDeps(opts: { checkCode?: number; failDry?: string } = {}) {
  const calls: string[] = [];
  const texts: Record<string, string> = {
    "/c/project-docs/module-catalog.yaml": moduleYaml,
    "/c/project-docs/boundary-catalog.yaml": boundaryYaml,
    "/w/tests/e2e/x_test.ts": "// - contract: boundary `server`",
  };
  const deps: GateDeps = {
    run: (cmd) => {
      calls.push(cmd.slice(0, 3).join(" "));
      return Promise.resolve({
        code: cmd[2] === "check" ? (opts.checkCode ?? 0) : 0,
        output: "",
      });
    },
    git: (args) =>
      Promise.resolve(
        args[0] === "diff" ? "packages/core/main/a.ts\n" : "abc\n",
      ),
    readText: (p) => Promise.resolve(texts[p]),
    listFiles: () => Promise.resolve(["x_test.ts"]),
    validateFixtures: () => Promise.resolve({ ok: true, problems: [] }),
    dryRun: (s) => {
      calls.push(`dry ${s.id}`);
      return Promise.resolve(
        s.id === opts.failDry
          ? err({ code: "internal", message: "boom" })
          : ok(undefined),
      );
    },
    now: () => 0,
    catalogRoot: "/c",
  };
  return { deps, calls };
}

test("runGate stops at the first failed stage and names the scenario whose dry run failed", async () => {
  const a = fakeDeps({ checkCode: 1 });
  const stopped = await runGate(
    { checkout: "/w", scenarios: [scenario("s1")] },
    a.deps,
  );
  assert.deepStrictEqual(stopped.ok, false);
  assert.deepStrictEqual(
    stopped.stages.map((s) => s.name),
    ["check"],
  );
  assert.deepStrictEqual(a.calls, ["npm run check"]);

  const b = fakeDeps({ failDry: "s2" });
  const report = await runGate(
    { checkout: "/w", scenarios: [scenario("s1"), scenario("s2")] },
    b.deps,
  );
  assert.deepStrictEqual(report.ok, false);
  const dry = report.stages.find((s) => s.name === "dry-run")!;
  assert.ok(
    !dry.ok && dry.detail.includes("s2") && !dry.detail.includes("s1:"),
  );
  assert.deepStrictEqual(
    b.calls.includes(
      "node_modules/electron/dist/electron --test --test-concurrency=1",
    ),
    true,
  );
});
