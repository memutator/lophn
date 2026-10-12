import { assertEquals } from "@std/assert";
import { checkRepo, type Violation } from "./check-deps.ts";
import { steps } from "./check.ts";

type Tree = Record<string, string | object>;
const portable = { compilerOptions: { erasableSyntaxOnly: true } };
const workspace = { workspace: ["./packages/*", "./packages/*/**"] };

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

// package 의존 표
const ALLOWED: Record<string, string[]> = {
  base: [],
  protocol: ["base"],
  core: ["protocol", "base"],
  "coding-agent": ["protocol", "base"],
  design: [],
  sdk: ["protocol", "design"],
  shell: ["protocol", "base", "design"],
};
const PACKAGES = Object.keys(ALLOWED);
const named = (name: string) => ({
  name: `@lophn/${name}`,
  exports: "./mod.ts",
});

Deno.test("tools/check-deps: package 의존 표대로 상대 경로 import를 판정한다", async () => {
  const tree: Tree = {};
  const expected: string[] = [];
  for (const from of PACKAGES) {
    tree[`packages/${from}/mod.ts`] = "";
    for (const to of PACKAGES) {
      if (from === to) continue;
      const file = `packages/${from}/to-${to}.ts`;
      tree[file] = `import "../${to}/mod.ts";`;
      if (!ALLOWED[from].includes(to)) expected.push(file);
    }
  }
  const violations = await fixture(tree);
  assertEquals(
    violations.map((violation) => violation.rule),
    expected.map(() => "package"),
  );
  assertEquals(
    violations.map((violation) => violation.file).sort(),
    expected.sort(),
  );
});

Deno.test("tools/check-deps: workspace 이름으로 import해도 같은 표를 쓴다", async () => {
  const tree: Tree = {};
  for (const name of PACKAGES) {
    if (name === "core") continue;
    tree[`packages/${name}/deno.json`] = { ...portable, ...named(name) };
    tree[`packages/${name}/mod.ts`] = "";
  }
  tree["packages/shell/ok.ts"] =
    'import "@lophn/protocol"; import "@lophn/base"; import "@lophn/design";';
  tree["packages/shell/bad.ts"] =
    'import "@lophn/sdk"; import "@lophn/coding-agent";';
  tree["packages/design/bad.ts"] = 'import "@lophn/protocol";';
  assertEquals(
    (await fixture(tree)).map(({ file, line, rule }) => ({ file, line, rule })),
    [
      { file: "packages/design/bad.ts", line: 1, rule: "package" },
      { file: "packages/shell/bad.ts", line: 1, rule: "package" },
      { file: "packages/shell/bad.ts", line: 1, rule: "package" },
    ],
  );
});

test("자기 package 안은 깊이와 상관없이 통과", {
  "packages/core/apps/mod.ts": 'import "../projects/work.ts";',
  "packages/core/projects/work.ts": 'import "../main/daemon/mod.ts";',
  "packages/core/main/daemon/mod.ts": "",
  "packages/sdk/ui-table/mod.ts": 'import "../ui-chart/mod.ts";',
  "packages/sdk/ui-chart/mod.ts": "",
}, []);
test("repo 밖 경로와 packages 밖 파일은 package 표를 보지 않는다", {
  "packages/core/mod.ts":
    'import "../../tools/work.ts"; import "../../e2e/work.ts";',
  "tools/work.ts": 'import "../packages/core/mod.ts";',
  "e2e/work.ts":
    'import "../packages/core/mod.ts"; import "../packages/shell/mod.ts";',
  "packages/shell/mod.ts": "",
}, []);

// core는 core만 import한다
test("core 거절: 다른 package의 test도 core를 import할 수 없다", {
  "packages/core/apps/mod.ts": "",
  "packages/core/testing/mod.ts": "",
  "packages/sdk/cap-store/store_test.ts":
    'import "../../core/apps/mod.ts"; import "../../core/testing/mod.ts";',
}, ["package", "package"]);
test("core 거절 메시지: core를 import하는 것은 core뿐", {
  "packages/core/mod.ts": "",
  "packages/coding-agent/mod.ts": 'import "../core/mod.ts";',
}, ["package"]);
Deno.test("tools/check-deps: core 위반 메시지는 core뿐이라고 말한다", async () => {
  const [violation] = await fixture({
    "packages/core/mod.ts": "",
    "packages/shell/mod.ts": 'import "../core/mod.ts";',
  });
  assertEquals(
    violation.message.startsWith("core를 import하는 것은 core뿐"),
    true,
  );
});

// shell main의 terminal host만 coding-agent를 더 쓸 수 있다
test("shell terminal host는 coding-agent를 import할 수 있다", {
  "packages/coding-agent/mod.ts": "",
  "packages/shell/terminal-host/launch-plan.ts":
    'import "../../coding-agent/mod.ts";',
  "packages/shell/main/terminal/coding/start.ts":
    'import "../../../../coding-agent/mod.ts";',
  "packages/shell/main/terminal/coding/start_test.ts":
    'import "../../../../coding-agent/mod.ts";',
}, []);
test("shell terminal host 밖은 coding-agent를 import할 수 없다", {
  "packages/coding-agent/mod.ts": "",
  "packages/shell/main/desktop/connection.ts":
    'import "../../../coding-agent/mod.ts";',
  "packages/shell/renderer/work.tsx": 'import "../../coding-agent/mod.ts";',
}, ["package", "package"]);
test("terminal host도 core·sdk는 import할 수 없다", {
  "packages/core/mod.ts": "",
  "packages/sdk/mod.ts": "",
  "packages/shell/terminal-host/work.ts":
    'import "../../core/mod.ts"; import "../../sdk/mod.ts";',
}, ["package", "package"]);

// testing 규칙
test("testing 통과: core test는 core/testing을 쓰고 testing끼리 서로 쓴다", {
  "packages/core/testing/mod.ts": 'import "./ledger.ts";',
  "packages/core/testing/ledger.ts": 'import "./ledger-types.ts";',
  "packages/core/testing/ledger-types.ts": "",
  "packages/core/testing/ledger_test.ts": 'import "./ledger.ts";',
  "packages/core/projects/model_test.ts": 'import "../testing/mod.ts";',
  "packages/core/apps/work_test.ts": 'import "../testing/ledger.ts";',
  "packages/core/testing-helper.ts": "",
  "packages/core/main/daemon/mod.ts": 'import "../../testing-helper.ts";',
}, []);
test("testing 거절: 제품 코드가 core/testing을 import", {
  "packages/core/testing/mod.ts": "",
  "packages/core/main/daemon/mod.ts": 'import "../../testing/mod.ts";',
  "packages/core/projects/store.ts": 'import "../testing/mod.ts";',
}, ["testing", "testing"]);
test("testing 거절: tsx 파일은 test 파일이 아니다", {
  "packages/core/testing/mod.ts": "",
  "packages/core/apps/work_test.tsx": 'import "../testing/mod.ts";',
}, ["testing"]);
test("module testing 통과: 다른 module의 *_test.ts가 testing/ 파일", {
  "packages/core/projects/testing/mod.ts": "",
  "packages/core/projects/testing/extra.ts": "",
  "packages/core/apps/reads_test.ts":
    'import "../projects/testing/mod.ts"; import "../projects/testing/extra.ts";',
}, []);
test("module testing 거절: 제품 코드와 mod.ts 재노출", {
  "packages/core/projects/mod.ts": 'export * from "./testing/mod.ts";',
  "packages/core/projects/store.ts": 'import "./testing/mod.ts";',
  "packages/core/projects/testing/mod.ts": "",
  "packages/core/apps/reads.ts": 'import "../projects/testing/mod.ts";',
}, ["testing", "testing", "testing"]);

// 이식성
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
    "packages/protocol/mod.ts": `import "${scheme}";`,
    "packages/core/mod.ts": `import "${scheme}";`,
  }, ["external", "external", "portable-import", "portable-import"]);
}
test("외부 specifier 통과: protocol은 zod, test는 @std/assert", {
  "packages/base/mod.ts": "",
  "packages/base/id_test.ts": 'import "@std/assert";',
  "packages/protocol/mod.ts": 'import "zod"; import "../base/mod.ts";',
  "packages/protocol/model_test.ts": 'import "@std/assert"; import "zod";',
}, []);
test("외부 specifier 거절: base의 zod, 제품 코드의 @std/assert, 그 밖의 이름", {
  "packages/base/mod.ts": 'import "zod";',
  "packages/protocol/mod.ts": 'import "@std/assert"; import "react";',
}, ["external", "external", "external"]);
test("외부 specifier는 다른 package에서 자유", {
  "packages/core/mod.ts":
    'import "zod"; import "npm:ignore"; import "node:fs";',
  "packages/design/mod.ts": 'import "react"; import "npm:lucide-react";',
}, []);
test("이식성 config 통과: base·protocol·중첩 member", {
  "packages/base/deno.json": portable,
  "packages/protocol/deno.json": portable,
  "packages/protocol/server/deno.json": portable,
  "packages/core/deno.json": {},
}, []);
test("이식성 config 거절: 누락·false·다른 위치", {
  "packages/base/deno.json": {},
  "packages/protocol/deno.json": {
    compilerOptions: { erasableSyntaxOnly: false },
  },
  "packages/protocol/server/deno.json": { erasableSyntaxOnly: true },
}, ["portable-config", "portable-config", "portable-config"]);

// protocol 최상위 순환
test("protocol 순환 통과: 단방향·같은 최상위", {
  "packages/protocol/server/mod.ts": 'export * from "./value.ts";',
  "packages/protocol/server/value.ts": 'export * from "./mod.ts";',
  "packages/protocol/apps/mod.ts": 'import "../server/mod.ts";',
  "packages/protocol/base/mod.ts": "",
  "packages/protocol/mod.ts": 'import "./apps/mod.ts";',
}, []);
test("protocol 순환 거절: 세 최상위", {
  "packages/protocol/server/mod.ts": 'export * from "../apps/mod.ts";',
  "packages/protocol/apps/mod.ts": 'import "../events/mod.ts";',
  "packages/protocol/events/mod.ts":
    'const load = () => import("../server/mod.ts");',
}, ["protocol-cycle", "protocol-cycle", "protocol-cycle"]);

// workspace 해석
test("workspace 통과: glob·하위 exports·긴 member 이름·wildcard export", {
  "deno.json": {
    workspace: ["./packages/*", "./packages/{protocol,sdk}/**"],
  },
  "packages/sdk/deno.json": {
    name: "@lophn/sdk",
    exports: {
      "./ui-table": "./ui-table/mod.ts",
      "./ui-chart": "./ui-chart/mod.ts",
    },
  },
  "packages/sdk/ui-table/deno.json": {
    name: "@lophn/sdk/ui-table",
    exports: "./mod.ts",
  },
  "packages/sdk/ui-table/mod.ts": 'import "@lophn/sdk/ui-chart";',
  "packages/sdk/ui-chart/mod.ts": "",
  "packages/protocol/deno.json": {
    ...portable,
    name: "@lophn/protocol",
    exports: { "./*": "./*/mod.ts" },
  },
  "packages/shell/main.ts": 'import "@lophn/protocol/apps";',
  "packages/sdk/work.ts": 'import "@lophn/protocol/apps";',
}, []);
test("workspace 거절: 존재하지 않는 export를 조용히 통과시키지 않는다", {
  "packages/core/mod.ts": 'import "@lophn/protocol/private";',
  "packages/protocol/deno.json": {
    ...portable,
    name: "@lophn/protocol",
    exports: "./mod.ts",
  },
}, ["workspace"]);

// 이름
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
    [`packages/core/${name}/mod.ts`]: "",
    [`apps/${name}.tsx`]: "",
    [`tools/${name}_test.ts`]: "",
    [`e2e/${name}.ts`]: "",
  }, ["name", "name", "name", "name"]);
}
test("이름 통과: 숫자가 domain 이름의 일부·검사 범위 밖", {
  "packages/core/sha256/mod.ts": "",
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
      { file: "packages/base/mod.ts", line: 2, rule: "external" },
      { file: "packages/base/mod.ts", line: 5, rule: "external" },
      { file: "packages/base/mod.ts", line: 6, rule: "external" },
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
  ["external", "external", "external", "external"],
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
