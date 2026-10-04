import { assertEquals } from "@std/assert";
import { checkRepo, type Violation } from "./check-deps.ts";
import { steps } from "./check.ts";

type Tree = Record<string, string | object>;
const portable = { compilerOptions: { erasableSyntaxOnly: true } };
const workspace = {
  workspace: ["./packages/*", "./packages/*/**", "./apps/*"],
};

async function fixture(tree: Tree): Promise<Violation[]> {
  const root = await Deno.makeTempDir({ prefix: "lophn-deps-" });
  try {
    for (
      const [path, value] of Object.entries({ "deno.json": workspace, ...tree })
    ) {
      const file = `${root}/${path}`;
      await Deno.mkdir(file.slice(0, file.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(
        file,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
    return await checkRepo(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function test(name: string, tree: Tree, expected: string[]) {
  Deno.test(`tools/check-deps: ${name}`, async () => {
    assertEquals(
      (await fixture(tree)).map((violation) => violation.rule).sort(),
      expected.sort(),
    );
  });
}

// 규칙 1
test("base 통과: 내부 상대 경로·테스트 assert", {
  "packages/base/mod.ts": 'export * from "./id.ts";',
  "packages/base/id.ts": "export const id = 1;",
  "packages/base/id_test.ts": 'import { assert } from "@std/assert";',
}, []);
for (
  const specifier of [
    "zod",
    "../contracts/mod.ts",
    "@std/assert",
    "@lophn/base",
  ]
) {
  test(`base 거절: ${specifier}`, {
    "packages/base/deno.json": {
      ...portable,
      name: "@lophn/base",
      exports: "./mod.ts",
    },
    "packages/base/mod.ts": `import "${specifier}";`,
  }, ["base"]);
}

// 규칙 2
const contractMembers: Tree = {
  "packages/base/deno.json": {
    ...portable,
    name: "@lophn/base",
    exports: "./mod.ts",
  },
  "packages/base/mod.ts": "",
  "packages/contracts/deno.json": {
    ...portable,
    name: "@lophn/contracts",
    exports: { "./platform": "./platform/mod.ts" },
  },
  "packages/contracts/platform/mod.ts": "",
};
test("contracts 통과: 내부·base·zod·테스트 assert", {
  ...contractMembers,
  "packages/contracts/documents/mod.ts":
    'import "../platform/mod.ts"; import "../../base/mod.ts"; import "@lophn/base"; import "zod";',
  "packages/contracts/documents/model_test.ts": 'import "@std/assert";',
}, []);
for (
  const specifier of ["react", "../../platform/ledger/mod.ts", "@std/assert"]
) {
  test(`contracts 거절: ${specifier}`, {
    "packages/contracts/platform/mod.ts": `import "${specifier}";`,
  }, ["contracts"]);
}
test("contracts 순환 통과: 단방향·같은 최상위", {
  "packages/contracts/platform/mod.ts": 'export * from "./value.ts";',
  "packages/contracts/platform/value.ts": 'export * from "./mod.ts";',
  "packages/contracts/documents/mod.ts": 'import "../platform/mod.ts";',
}, []);
test("contracts 순환 거절: 세 최상위", {
  "packages/contracts/platform/mod.ts": 'export * from "../documents/mod.ts";',
  "packages/contracts/documents/mod.ts": 'import "../apps/mod.ts";',
  "packages/contracts/apps/mod.ts":
    'const load = () => import("../platform/mod.ts");',
}, ["contracts-cycle", "contracts-cycle", "contracts-cycle"]);

// 규칙 3
for (
  const scheme of [
    "npm:zod",
    "jsr:@std/assert",
    "node:fs",
    "http://example.test/mod.ts",
    "https://example.test/mod.ts",
  ]
) {
  test(`이식성 거절: ${scheme}`, {
    "packages/base/mod.ts": `import "${scheme}";`,
    "packages/contracts/mod.ts": `import "${scheme}";`,
  }, ["base", "contracts", "portable-import", "portable-import"]);
}
test("이식성 config 통과: base·contracts·중첩 member", {
  "packages/base/deno.json": portable,
  "packages/contracts/deno.json": portable,
  "packages/contracts/platform/deno.json": portable,
}, []);
test("이식성 config 거절: 누락·false·다른 위치", {
  "packages/base/deno.json": {},
  "packages/contracts/deno.json": {
    compilerOptions: { erasableSyntaxOnly: false },
  },
  "packages/contracts/platform/deno.json": { erasableSyntaxOnly: true },
}, ["portable-config", "portable-config", "portable-config"]);

// 규칙 4
const leaves: Tree = {
  ...contractMembers,
  "packages/lophn-agent/harness/provider/deno.json": {
    name: "@lophn/lophn-agent/harness/provider",
    exports: { ".": "./mod.ts", "./private": "./model.ts" },
  },
  "packages/lophn-agent/harness/provider/mod.ts": "",
  "packages/lophn-agent/harness/provider/model.ts": "",
  "packages/lophn-agent/harness/tools/deno.json": {
    name: "@lophn/lophn-agent/harness/tools",
    exports: "./mod.ts",
  },
  "packages/lophn-agent/harness/tools/mod.ts": "",
};
test(
  "leaf 통과: 중첩 leaf mod·workspace exports·자기 파일·contracts·base·외부",
  {
    ...leaves,
    "packages/lophn-agent/harness/tools/work.ts":
      'import "./model.ts"; import "../provider/mod.ts"; import "@lophn/lophn-agent/harness/provider"; import "@lophn/contracts/platform"; import "../../../contracts/platform/mod.ts"; import "@lophn/base"; import "npm:zod"; import "react";',
  },
  [],
);
test("leaf 거절: 상대 경로·workspace private export", {
  ...leaves,
  "packages/lophn-agent/harness/tools/mod.ts":
    'import "../provider/model.ts"; import "@lophn/lophn-agent/harness/provider/private";',
}, ["leaf", "leaf"]);
test("leaf 경계 통과: workspace 없는 mod.ts와 내부 하위 폴더", {
  "packages/platform/ledger/mod.ts": "",
  "packages/platform/api/mod.ts":
    'import "../ledger/mod.ts"; import "./adapters/db.ts";',
  "packages/platform/api/adapters/db.ts": 'import "../model.ts";',
}, []);
test("leaf 경계 거절: workspace 없는 중첩 leaf", {
  "packages/lophn-agent/harness/tools/mod.ts": 'import "../provider/model.ts";',
  "packages/lophn-agent/harness/provider/mod.ts": "",
  "packages/lophn-agent/harness/provider/model.ts": "",
}, ["leaf"]);
test("최상위 거절: 상대 경로·workspace 이름", {
  "packages/platform/ledger/mod.ts":
    'import "../../documents/projects/mod.ts"; import "@lophn/documents/projects";',
  "packages/documents/projects/deno.json": {
    name: "@lophn/documents/projects",
    exports: "./mod.ts",
  },
  "packages/documents/projects/mod.ts": "",
}, ["top-level", "top-level"]);
test("contract 경계 거절: private·전체 모음", {
  "packages/platform/ledger/mod.ts":
    'import "../../contracts/documents/model.ts"; import "../../contracts/mod.ts";',
}, ["leaf-contract", "leaf-contract"]);
test("workspace 통과: glob·하위 exports·긴 member 이름·wildcard export", {
  "deno.json": {
    workspace: [
      "./packages/*",
      "./packages/{platform,contracts}/**",
      "./packages/sdk",
    ],
  },
  "packages/platform/deno.json": {
    name: "@lophn/platform",
    exports: { "./ledger": "./ledger/mod.ts", "./api": "./api/mod.ts" },
  },
  "packages/platform/ledger/deno.json": {
    name: "@lophn/platform/ledger",
    exports: "./mod.ts",
  },
  "packages/platform/ledger/mod.ts": 'import "@lophn/platform/api";',
  "packages/platform/deno-unused.ts": "",
  "packages/platform/api/mod.ts": "",
  "packages/contracts/deno.json": {
    ...portable,
    name: "@lophn/contracts",
    exports: { "./*": "./*/mod.ts" },
  },
  "apps/core/main.ts":
    'import "@lophn/platform/ledger"; import "@lophn/contracts/documents";',
  "packages/platform/api/work.ts": 'import "@lophn/contracts/documents";',
}, []);
test("workspace 거절: 존재하지 않는 export를 조용히 통과시키지 않는다", {
  "packages/platform/ledger/mod.ts": 'import "@lophn/documents/private";',
  "packages/documents/deno.json": {
    name: "@lophn/documents",
    exports: "./mod.ts",
  },
}, ["workspace"]);

// 규칙 5
const shellMembers: Tree = {
  ...contractMembers,
  "packages/design/deno.json": { name: "@lophn/design", exports: "./mod.ts" },
  "packages/sdk/deno.json": { name: "@lophn/sdk", exports: "./mod.ts" },
};
test("shell 통과: contracts·design·sdk·npm", {
  ...shellMembers,
  "apps/shell/main/main.ts":
    'import "@lophn/contracts/platform"; import "@lophn/design"; import "@lophn/sdk"; import "../../../packages/sdk/mod.ts"; import "npm:electron";',
}, []);
test("shell 거절: base·core package 상대 경로와 workspace", {
  ...shellMembers,
  "packages/platform/deno.json": {
    name: "@lophn/platform",
    exports: "./mod.ts",
  },
  "apps/shell/main/main.ts":
    'import "@lophn/base"; import "@lophn/platform"; import "../../../packages/documents/projects/mod.ts";',
}, ["shell", "shell", "shell"]);

// 규칙 6
const testingMember = {
  name: "@lophn/core",
  exports: { "./testing": "./testing/mod.ts" },
};
test("testing 통과: *_test.ts·비슷한 이름", {
  "apps/core/deno.json": testingMember,
  "packages/platform/ledger/model_test.ts":
    'import "../../../apps/core/testing/mod.ts"; import "@lophn/core/testing";',
  "apps/cli/main.ts": 'import "../core/testing-helper.ts";',
}, []);
test("testing 거절: 제품 코드·tsx 테스트 이름", {
  "apps/core/deno.json": testingMember,
  "apps/cli/main.ts":
    'import "../core/testing/mod.ts"; import "@lophn/core/testing";',
  "apps/shell/main_test.tsx": 'import "../core/testing/mod.ts";',
}, ["testing", "testing", "testing"]);

test("testing 내부 조립 통과: public entry·Worker·types", {
  "apps/core/testing/ledger.ts": 'import "./ledger-channel.ts";',
  "apps/core/testing/ledger-channel.ts": 'import "./ledger-types.ts";',
  "apps/core/testing/ledger-worker.ts": 'import "./ledger-types.ts";',
}, []);
test("testing public entry 통과: 다른 팀 테스트", {
  "packages/documents/projects/commands_test.ts":
    'import "../../../apps/core/testing/ledger.ts";',
}, []);
test("testing 내부 helper도 외부 제품에서는 거절", {
  "apps/core/main.ts": 'import "./testing/ledger-types.ts";',
  "packages/platform/ledger/mod.ts":
    'import "../../../apps/core/testing/ledger.ts";',
}, ["testing", "testing"]);

// 규칙 7
for (
  const name of [
    "v2",
    "v8",
    "m1",
    "w07",
    "milestone",
    "milestone1",
    "phase-2",
    "phase2",
    "new-api",
    "old-api",
    "legacy-api",
    "api-next",
  ]
) {
  test(`이름 거절: ${name} 폴더·파일·_test 앞`, {
    [`packages/platform/${name}/mod.ts`]: "",
    [`apps/${name}.tsx`]: "",
    [`tools/${name}_test.ts`]: "",
    [`e2e/${name}.ts`]: "",
  }, ["name", "name", "name", "name"]);
}
test("이름 통과: 숫자가 domain 이름의 일부·검사 범위 밖", {
  "packages/platform/sha256/mod.ts": "",
  "apps/cli/preview.ts": "",
  "tools/phase-space_test.ts": "",
  "e2e/flows/version_test.ts": "",
  "fixtures/v2/file.ts": "",
}, []);

// import reader와 제외 범위
Deno.test("tools/check-deps: 정적·export·동적 import의 파일과 줄", async () => {
  const violations = await fixture({
    "packages/base/mod.ts":
      '// import "react";\nimport type {\n Foo\n} from "zod";\nexport { x } from "react";\nconst load = () => import("react", { with: { type: "json" } });',
  });
  assertEquals(
    violations.map(({ file, line, rule }) => ({ file, line, rule })),
    [
      { file: "packages/base/mod.ts", line: 2, rule: "base" },
      { file: "packages/base/mod.ts", line: 5, rule: "base" },
      { file: "packages/base/mod.ts", line: 6, rule: "base" },
    ],
  );
});
test("reader 통과: 주석·문자열·template text·regex·계산 import·property", {
  "packages/base/mod.ts":
    '// import "react";\n/* export * from "react" */\nconst text = \'import "react"\';\nconst template = `import "react"`;\nconst regex = /import "react"/;\nconst load = import(name);\nobj.import("react");\nconst meta = import.meta;',
}, []);
test(
  "reader 거절: template expression·escaped specifier·semicolon 없는 export",
  {
    "packages/base/mod.ts":
      'const text = `${import("react")}`;\nimport "\\u007aod"\nexport type { A } from "react"\nexport * as x from "react"',
  },
  ["base", "base", "base", "base"],
);
test("제외 범위: 어느 깊이든 node_modules·.claude·.dev-data·dist", {
  "node_modules/v2/mod.ts": 'import "react";',
  ".claude/v2/mod.ts": 'import "react";',
  ".dev-data/v2/mod.ts": 'import "react";',
  "dist/v2/mod.ts": 'import "react";',
  "packages/base/node_modules/v2/mod.ts": 'import "react";',
  "packages/base/dist/v2/mod.ts": 'import "react";',
}, []);
Deno.test("tools/check-deps: lint 다음에 deps 단계를 실행한다", () => {
  const lint = steps.findIndex((step) => step.name === "lint");
  assertEquals(steps[lint + 1], {
    name: "deps",
    command: ["deno", "run", "--allow-read", "tools/check-deps.ts"],
  });
});
