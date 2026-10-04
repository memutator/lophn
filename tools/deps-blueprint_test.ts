import { assertEquals } from "@std/assert";
import { checkRepo, type Violation } from "./check-deps.ts";
import { BLUEPRINT_ENTRY, BLUEPRINT_WRAPPER } from "./deps-blueprint.ts";

const SDK = "packages/sdk/blueprint";
const HELPER = "packages/contracts/apps/blueprint-json.ts";
type Tree = Record<string, string>;
const graph: Tree = {
  [BLUEPRINT_ENTRY]: 'export * from "./blueprint-json.ts";',
  [HELPER]: "export const value = 1;",
  [BLUEPRINT_WRAPPER]: 'export * from "../../contracts/apps/blueprint.ts";',
  [`${SDK}/mod.ts`]:
    'export * from "../../contracts/apps/blueprint.ts"; export * from "./define.ts";',
  [`${SDK}/define.ts`]:
    'import { value } from "../../contracts/apps/blueprint.ts"; export { value };',
};

async function fixture(tree: Tree): Promise<Violation[]> {
  const root = await Deno.makeTempDir({ prefix: "lophn-blueprint-deps-" });
  try {
    for (const [path, source] of Object.entries(tree)) {
      const file = `${root}/${path}`;
      await Deno.mkdir(file.slice(0, file.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(file, source);
    }
    return await checkRepo(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function pure(violations: Violation[]) {
  return violations.filter((violation) => violation.rule === "blueprint-pure")
    .map(({ file, line }) => ({ file, line }));
}

Deno.test("apps/blueprint#R16 apps/sdk#R5: exact public wrappers share the pure entry", async () => {
  assertEquals(await fixture(graph), []);
  assertEquals(
    await fixture({
      [BLUEPRINT_ENTRY]: graph[BLUEPRINT_ENTRY],
      [HELPER]: graph[HELPER],
    }),
    [],
  );
  assertEquals(
    await fixture({
      ...graph,
      [HELPER]: 'export * from "./blueprint.ts";',
    }),
    [],
  );
});

Deno.test("apps/blueprint#R16: only the exact apps wrapper gains a public-entry exception", async () => {
  for (
    const file of [
      "packages/apps/blueprint/validate.ts",
      "packages/apps/runtime/mod.ts",
      "packages/documents/formats/mod.ts",
    ]
  ) {
    assertEquals(
      (await fixture({
        ...graph,
        [file]: 'export * from "../../contracts/apps/blueprint.ts";',
      })).map(({ file: source, rule }) => ({ file: source, rule })),
      [
        { file, rule: "leaf-contract" },
      ],
    );
  }
  const violations = await fixture({
    ...graph,
    [BLUEPRINT_WRAPPER]:
      'export * from "../../contracts/apps/blueprint-json.ts";',
  });
  assertEquals(violations.map(({ rule }) => rule), [
    "blueprint-pure",
    "leaf-contract",
  ]);
});

Deno.test("apps/blueprint#R16 apps/sdk#R5: wrappers cannot select private contract helpers", async () => {
  for (const file of [`${SDK}/mod.ts`, `${SDK}/define.ts`]) {
    assertEquals(
      pure(
        await fixture({
          ...graph,
          [file]: 'export * from "../../contracts/apps/blueprint-json.ts";',
        }),
      ),
      [{ file, line: 1 }],
    );
  }
});

Deno.test("apps/blueprint#R16: transitive pure contracts cannot gain external dependencies", async () => {
  for (
    const specifier of [
      "zod",
      "@std/assert",
      "@lophn/base",
      "npm:zod",
      "jsr:@std/assert",
      "node:fs",
      "https://example.test/mod.ts",
    ]
  ) {
    assertEquals(
      pure(
        await fixture({
          ...graph,
          [HELPER]: `import "${specifier}";`,
        }),
      ),
      [{ file: HELPER, line: 1 }],
    );
  }
});

Deno.test("apps/blueprint#R16: relative paths cannot drag in base Zod contracts or runtime", async () => {
  for (
    const [specifier, target] of [
      ["../../base/mod.ts", "packages/base/mod.ts"],
      ["./mod.ts", "packages/contracts/apps/mod.ts"],
      ["./permissions.ts", "packages/contracts/apps/permissions.ts"],
      ["../platform/mod.ts", "packages/contracts/platform/mod.ts"],
      ["../../apps/runtime/mod.ts", "packages/apps/runtime/mod.ts"],
      ["../../sdk/blueprint/mod.ts", `${SDK}/mod.ts`],
    ]
  ) {
    assertEquals(
      pure(
        await fixture({
          ...graph,
          [target]: "export const value = 1;",
          [HELPER]: `export * from "${specifier}";`,
        }),
      ),
      [{ file: HELPER, line: 1 }],
    );
  }
});

Deno.test("apps/sdk#R5 apps/blueprint#R16: SDK dependencies stay in its own pure directory", async () => {
  for (
    const [specifier, target] of [
      ["../cap-problem/mod.ts", "packages/sdk/cap-problem/mod.ts"],
      ["../../base/mod.ts", "packages/base/mod.ts"],
      ["../../contracts/apps/mod.ts", "packages/contracts/apps/mod.ts"],
      ["../../apps/runtime/mod.ts", "packages/apps/runtime/mod.ts"],
      ["zod", "packages/contracts/apps/permissions.ts"],
    ]
  ) {
    assertEquals(
      pure(
        await fixture({
          ...graph,
          [target]: "export const value = 1;",
          [`${SDK}/define.ts`]: `import "${specifier}";`,
        }),
      ),
      [{ file: `${SDK}/define.ts`, line: 1 }],
    );
  }
  assertEquals(
    await fixture({
      ...graph,
      [`${SDK}/define.ts`]: 'export * from "./helpers/value.ts";',
      [`${SDK}/helpers/value.ts`]:
        'export * from "../../../contracts/apps/blueprint.ts";',
    }),
    [],
  );
  assertEquals(
    pure(
      await fixture({
        ...graph,
        [`${SDK}/define.ts`]: 'export * from "./helpers/value.ts";',
        [`${SDK}/helpers/value.ts`]: 'import "zod";',
      }),
    ),
    [{ file: `${SDK}/helpers/value.ts`, line: 1 }],
  );
});

Deno.test("apps/blueprint#R16: missing extension missing file and test dependencies fail closed", async () => {
  for (
    const specifier of [
      "./blueprint-json",
      "./blueprint-json.ts?mode=pure",
      "./blueprint-value.ts",
      "./blueprint_test.ts",
      "./blueprint-unregistered.ts",
    ]
  ) {
    assertEquals(
      pure(
        await fixture({
          ...graph,
          [BLUEPRINT_ENTRY]: `export * from "${specifier}";`,
          "packages/contracts/apps/blueprint_test.ts":
            "export const value = 1;",
          "packages/contracts/apps/blueprint-unregistered.ts":
            "export const value = 1;",
        }),
      ),
      [{ file: BLUEPRINT_ENTRY, line: 1 }],
    );
  }
});

Deno.test("apps/blueprint#R16: escaped workspace names remain nonrelative dependencies", async () => {
  assertEquals(
    pure(
      await fixture({
        ...graph,
        "deno.json": '{"workspace":["./packages/*"]}',
        "packages/contracts/deno.json": JSON.stringify({
          name: "@lophn/contracts",
          exports: { "./blueprint": "./apps/blueprint.ts" },
          compilerOptions: { erasableSyntaxOnly: true },
        }),
        [BLUEPRINT_WRAPPER]: 'export * from "@lophn/contracts/blueprint";',
        [`${SDK}/mod.ts`]: 'export * from "@lophn/contracts/blueprint";',
        [HELPER]: 'import "\\u007aod";',
      }),
    ),
    [
      { file: BLUEPRINT_WRAPPER, line: 1 },
      { file: HELPER, line: 1 },
      { file: `${SDK}/mod.ts`, line: 1 },
    ],
  );
});

Deno.test("apps/blueprint#R16: pure graph checks computed and literal dynamic import lines", async () => {
  for (const expression of ["name", "`./blueprint-json.ts`", '"./" + name']) {
    assertEquals(
      pure(
        await fixture({
          ...graph,
          [BLUEPRINT_ENTRY]:
            `// dependency must be static\nconst load = () => import(${expression});`,
        }),
      ),
      [{ file: BLUEPRINT_ENTRY, line: 2 }],
    );
  }
  assertEquals(
    pure(
      await fixture({
        ...graph,
        [BLUEPRINT_ENTRY]: 'const load = () => import("zod");',
      }),
    ),
    [{ file: BLUEPRINT_ENTRY, line: 1 }],
  );
  assertEquals(
    pure(
      await fixture({
        ...graph,
        [BLUEPRINT_ENTRY]: "const text = `${import(name)}`;",
      }),
    ),
    [{ file: BLUEPRINT_ENTRY, line: 1 }],
  );
  assertEquals(
    await fixture({
      ...graph,
      [BLUEPRINT_ENTRY]:
        'const load = () => import("./blueprint-json.ts", { with: {} });',
    }),
    [],
  );
});

Deno.test("apps/blueprint#R16: comments strings templates regex and property calls are not imports", async () => {
  assertEquals(
    await fixture({
      ...graph,
      [BLUEPRINT_ENTRY]:
        '// import(name)\n/* import(name) */\nconst text = "import(name)";\nconst template = `import(name)`;\nconst regex = /import(name)/;\nobj.import(name);\nconst meta = import.meta;',
    }),
    [],
  );
  assertEquals(
    await fixture({
      ...graph,
      "packages/contracts/apps/mod.ts": 'import "zod";',
      "packages/sdk/cap-problem/mod.ts": 'import "node:fs";',
      "packages/base/mod.ts": "const load = () => import(name);",
    }),
    [],
  );
});
