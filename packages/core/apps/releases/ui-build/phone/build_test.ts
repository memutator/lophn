import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runInNewContext } from "node:vm";
import { PHONE_HOST_MODULES } from "../../../../../protocol/apps/phone-screen.ts";
import { bundlePhone, describeBuildFailure } from "./build.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "phone-build-")));
after(() => rm(root, { recursive: true, force: true }));
const base = join(root, "app");
const out = join(base, "dist/screens/home");
// staging 밖의 file. 상대 경로와 node_modules의 symlink로 닿아 본다.
await mkdir(join(root, "outside"), { recursive: true });
await writeFile(join(root, "outside/index.js"), "export default 1;\n");
await mkdir(join(base, "src/screens/home"), { recursive: true });
await mkdir(join(base, "node_modules/tiny"), { recursive: true });
await writeFile(
  join(base, "node_modules/tiny/package.json"),
  JSON.stringify({ name: "tiny", type: "module", exports: "./index.js" }),
);
// 앱 자기 npm 의존(순수 JS)은 묶이고, 그 안의 host module import는 external로 남는다.
await writeFile(
  join(base, "node_modules/tiny/index.js"),
  'import { useState } from "react";\nexport const useTiny = () => useState(1);\n',
);
await symlink(join(root, "outside"), join(base, "node_modules/linked"));

async function build(source: string): Promise<string[]> {
  await writeFile(join(base, "src/screens/home/phone.tsx"), source);
  return await bundlePhone(base, "home", out);
}

test("폰 화면 build는 host module 목록 밖의 module을 화면에 담지 않는다", async (t) => {
  const refused = [
    "react-dom/client",
    "@lophn/ui/overlay",
    "@lophn/app-ui",
    "react-native-reanimated",
    "@react-native/assets-registry/registry",
    "expo-camera",
    "react-native/Libraries/Image/Image",
    "node:fs",
    "fs",
    "../../../../outside/index.js",
    "linked",
  ];
  for (const specifier of refused) {
    await t.test(specifier, async () => {
      const failure = await build(
        `import x from "${specifier}";\nexport default function S() { return x; }\n`,
      ).then(
        () => undefined,
        (thrown: unknown) => describeBuildFailure(thrown),
      );
      assert.ok(failure !== undefined, `${specifier} was bundled`);
      // agent가 고칠 곳을 알도록 file과 줄이 앞에 온다.
      assert.match(failure, /^src\/screens\/home\/phone\.tsx:1:\d+: /);
    });
  }

  const modules = await build(
    [
      'import { View } from "react-native";',
      'import { Screen } from "@lophn/ui-native";',
      'import { useTiny } from "tiny";',
      "export default function Home() {",
      "  useTiny();",
      "  return <Screen><View /></Screen>;",
      "}",
    ].join("\n"),
  );
  // phone.js를 실제로 평가해 require하는 이름을 모은다. base bundle이 내주는 이름만이어야 한다.
  const required: string[] = [];
  let mounted: unknown;
  runInNewContext(await readFile(join(out, "phone.js"), "utf8"), {
    require: (name: string) => {
      required.push(name);
      return {};
    },
    __lophnMount: (screen: unknown) => {
      mounted = screen;
    },
  });
  assert.equal(typeof mounted, "function");
  assert.deepEqual([...new Set(required)].sort(), modules);
  assert.ok(
    modules.every((name) =>
      (PHONE_HOST_MODULES as readonly string[]).includes(name),
    ),
  );
  assert.deepEqual(modules, [
    "@lophn/ui-native",
    "react",
    "react-native",
    "react/jsx-runtime",
  ]);
});
