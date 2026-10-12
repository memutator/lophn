import { assertEquals, assertRejects } from "@std/assert";
import {
  applyPlan,
  type Mapping,
  type Note,
  type Plan,
  planMoves,
} from "./move-files.ts";

type Tree = Record<string, string | object>;
const decoder = new TextDecoder();

async function git(root: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error(decoder.decode(output.stderr));
  return decoder.decode(output.stdout);
}

async function write(root: string, tree: Tree) {
  for (const [path, value] of Object.entries(tree)) {
    const file = `${root}/${path}`;
    await Deno.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(
      file,
      typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
    );
  }
}

// 임시 git 저장소에 tree를 commit하고 fn에 넘긴다.
async function withRepo(
  tree: Tree,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "lophn-move-" });
  try {
    await write(root, tree);
    await git(root, ["init", "-q"]);
    await git(root, ["add", "-A"]);
    await git(root, [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "-m",
      "fixture",
    ]);
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function move(root: string, mapping: Mapping): Promise<Plan> {
  const plan = await planMoves(root, mapping);
  assertEquals(errors(plan.notes), []);
  await applyPlan(root, plan);
  return plan;
}

const errors = (notes: Note[]) =>
  notes.filter((note) => note.kind === "error").map((note) => note.message);
const read = (root: string, path: string) =>
  Deno.readTextFile(`${root}/${path}`);

Deno.test("tools/move-files: 상대 import와 new URL을 새 자리 기준으로 다시 쓴다", async () => {
  await withRepo({
    "deno.json": { workspace: ["./packages/*"] },
    "packages/a/deno.json": {
      name: "@x/a",
      exports: { ".": "./mod.ts", "./util": "./util/mod.ts" },
    },
    "packages/a/mod.ts": 'export * from "./util/mod.ts";\n',
    "packages/a/util/mod.ts": "export const util = 1;\n",
    "apps/core/main.ts": [
      'import { util } from "../../packages/a/util/mod.ts";',
      'import { x } from "./x.ts";',
      'const worker = new URL("../worker/main.ts", import.meta.url);',
      'const root = new URL("../../", import.meta.url);',
      'const config = import.meta.resolve("../worker/config.json");',
      "console.log(util, x, worker, root, config);",
      "",
    ].join("\n"),
    "apps/core/x.ts": "export const x = 1;\n",
    "apps/worker/main.ts": 'import "@x/a/util";\n',
    "apps/worker/config.json": "{}\n",
  }, async (root) => {
    const plan = await move(root, {
      moves: [
        { from: "apps/core/", to: "packages/core/main/daemon/" },
        { from: "apps/worker/", to: "packages/core/worker/" },
      ],
    });
    assertEquals(plan.moved.size, 4);
    assertEquals(
      await read(root, "packages/core/main/daemon/main.ts"),
      [
        'import { util } from "../../../a/util/mod.ts";',
        'import { x } from "./x.ts";',
        'const worker = new URL("../../worker/main.ts", import.meta.url);',
        'const root = new URL("../../../../", import.meta.url);',
        'const config = import.meta.resolve("../../worker/config.json");',
        "console.log(util, x, worker, root, config);",
        "",
      ].join("\n"),
    );
    assertEquals(
      await read(root, "packages/core/worker/main.ts"),
      'import "@x/a/util";\n',
    );
    await assertRejects(() => Deno.stat(`${root}/apps`));
    // 옮긴 것이 모두 index에 올라가 있다. 작업 트리에만 있는 변경이 없다.
    assertEquals(
      (await git(root, ["status", "--porcelain"])).split("\n").filter(Boolean)
        .filter((line) => line[1] !== " "),
      [],
    );
  });
});

Deno.test("tools/move-files: package 이름과 export key를 바꾸면 bare specifier도 따라간다", async () => {
  await withRepo({
    "deno.json": { workspace: ["./packages/*"] },
    "packages/contracts/deno.json": {
      name: "@x/contracts",
      exports: { ".": "./mod.ts", "./documents": "./documents/mod.ts" },
    },
    "packages/contracts/mod.ts": 'export * from "./documents/mod.ts";\n',
    "packages/contracts/documents/mod.ts": "export const documents = 1;\n",
    "packages/user/deno.json": { name: "@x/user", exports: "./mod.ts" },
    "packages/user/mod.ts":
      'import "@x/contracts/documents";\nimport "@x/contracts";\n',
  }, async (root) => {
    await move(root, {
      moves: [
        { from: "packages/contracts/", to: "packages/protocol/" },
        {
          from: "packages/contracts/documents/",
          to: "packages/protocol/projects/",
        },
      ],
      packages: [{ from: "@x/contracts", to: "@x/protocol" }],
    });
    assertEquals(
      await read(root, "packages/user/mod.ts"),
      'import "@x/protocol/projects";\nimport "@x/protocol";\n',
    );
    assertEquals(
      JSON.parse(await read(root, "packages/protocol/deno.json")),
      {
        name: "@x/protocol",
        exports: { ".": "./mod.ts", "./projects": "./projects/mod.ts" },
      },
    );
    assertEquals(
      await read(root, "packages/protocol/mod.ts"),
      'export * from "./projects/mod.ts";\n',
    );
  });
});

Deno.test("tools/move-files: 한 package로 합쳐지면 bare import가 상대 경로가 된다", async () => {
  await withRepo({
    "deno.json": { workspace: ["./packages/*"] },
    "packages/documents/deno.json": {
      name: "@x/documents",
      exports: "./mod.ts",
    },
    "packages/documents/mod.ts": "export const documents = 1;\n",
    "packages/core/deno.json": { name: "@x/core", exports: "./mod.ts" },
    "packages/core/mod.ts":
      'import { documents } from "@x/documents";\nexport { documents };\n',
  }, async (root) => {
    const plan = await move(root, {
      moves: [{ from: "packages/documents/", to: "packages/core/projects/" }],
      remove: ["packages/documents/deno.json"],
    });
    assertEquals(plan.removed, ["packages/documents/deno.json"]);
    assertEquals(
      await read(root, "packages/core/mod.ts"),
      'import { documents } from "./projects/mod.ts";\nexport { documents };\n',
    );
    await assertRejects(() =>
      Deno.stat(`${root}/packages/core/projects/deno.json`)
    );
  });
});

Deno.test("tools/move-files: 설정 파일의 workspace·exclude 경로를 고치고 같이 옮긴 상대 경로는 둔다", async () => {
  const tsconfig = [
    "{",
    "  // 주석도 읽는다",
    '  "include": ["**/*.ts", "../preload/**/*.ts"],',
    "}",
    "",
  ].join("\n");
  await withRepo({
    "deno.json": {
      workspace: ["./packages/*", "./apps/shell/renderer"],
      exclude: ["apps/shell/main", "dist"],
      test: { exclude: ["apps/shell/renderer/**/*_test.tsx"] },
    },
    "apps/shell/renderer/deno.json": {
      name: "@x/renderer",
      exports: "./main.tsx",
    },
    "apps/shell/renderer/main.tsx": "export const main = 1;\n",
    "apps/shell/main/tsconfig.json": tsconfig,
    "apps/shell/main/main.ts": "export const main = 1;\n",
    "apps/shell/preload/index.ts": "export const preload = 1;\n",
  }, async (root) => {
    await move(root, {
      moves: [{ from: "apps/shell/", to: "packages/shell/" }],
    });
    assertEquals(JSON.parse(await read(root, "deno.json")), {
      workspace: ["./packages/*", "./packages/shell/renderer"],
      exclude: ["packages/shell/main", "dist"],
      test: { exclude: ["packages/shell/renderer/**/*_test.tsx"] },
    });
    assertEquals(
      await read(root, "packages/shell/main/tsconfig.json"),
      tsconfig,
    );
  });
});

Deno.test("tools/move-files: CSS의 @import와 url()을 고친다", async () => {
  await withRepo({
    "packages/design/base.css": '@font-face { src: url("./fonts/a.woff2"); }\n',
    "packages/design/fonts/a.woff2": "font",
    "packages/sdk/tokens/base.css": '@import "../../design/base.css";\n',
  }, async (root) => {
    await move(root, {
      moves: [{ from: "packages/sdk/tokens/", to: "packages/sdk/ui/tokens/" }],
    });
    assertEquals(
      await read(root, "packages/sdk/ui/tokens/base.css"),
      '@import "../../../design/base.css";\n',
    );
    assertEquals(
      await read(root, "packages/design/base.css"),
      '@font-face { src: url("./fonts/a.woff2"); }\n',
    );
  });
});

Deno.test("tools/move-files: 고치지 못하는 경로 문자열과 옛 경로 언급을 보고한다", async () => {
  await withRepo({
    "apps/core/spawn.ts": [
      'import { join } from "node:path";',
      'export const main = join(import.meta.dirname!, "../worker/main.ts");',
      "// apps/worker에서 돈다",
      'export const fixed = "apps/worker/main.ts";',
      "",
    ].join("\n"),
    "apps/worker/main.ts": "export {};\n",
  }, async (root) => {
    const plan = await planMoves(root, {
      moves: [{ from: "apps/worker/", to: "packages/worker/" }],
    });
    assertEquals(
      plan.notes.filter((note) => note.kind !== "error").map((note) =>
        `${note.kind} ${note.file}:${note.line} ${note.message}`
      ),
      [
        "path apps/core/spawn.ts:2 경로 문자열 ../worker/main.ts → ../../packages/worker/main.ts",
        "mention apps/core/spawn.ts:3 // apps/worker에서 돈다",
        "path apps/core/spawn.ts:4 옛 경로 문자열: apps/worker/main.ts",
      ],
    );
  });
});

Deno.test("tools/move-files: 겹치는 자리, 없는 from, 지우는 파일 import는 오류다", async () => {
  await withRepo({
    "a/x.ts": "export {};\n",
    "b/x.ts": "export {};\n",
    "c/use.ts": 'import "../b/x.ts";\n',
  }, async (root) => {
    const plan = await planMoves(root, {
      moves: [
        { from: "a/", to: "d/" },
        { from: "b/", to: "d/" },
        { from: "nothing/", to: "e/" },
      ],
      remove: ["b/x.ts"],
    });
    assertEquals(errors(plan.notes).sort(), [
      "mapping의 from에 맞는 파일이 없음",
      "지우는 파일을 가리킴: ../b/x.ts",
    ]);
    const overlap = await planMoves(root, {
      moves: [{ from: "a/", to: "d/" }, { from: "b/", to: "d/" }],
    });
    assertEquals(errors(overlap.notes), ["a/x.ts와 같은 자리로 옮김: d/x.ts"]);
  });
});

Deno.test("tools/move-files: commit하지 않은 변경이 있으면 옮기지 않고, 남은 옛 폴더를 알려 준다", async () => {
  await withRepo({
    ".gitignore": "node_modules/\n",
    "apps/shell/main/main.ts": "export {};\n",
  }, async (root) => {
    const mapping = { moves: [{ from: "apps/shell/", to: "packages/shell/" }] };
    await write(root, { "apps/shell/main/node_modules/x.js": "" });
    await write(root, { "stray.ts": "" });
    await assertRejects(
      async () => await applyPlan(root, await planMoves(root, mapping)),
      Error,
      "commit하지 않은 변경",
    );
    await Deno.remove(`${root}/stray.ts`);
    assertEquals(await applyPlan(root, await planMoves(root, mapping)), [
      "apps",
    ]);
    assertEquals(
      await read(root, "packages/shell/main/main.ts"),
      "export {};\n",
    );
  });
});
