import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { createPhoneApp } from "../../../../../tests/support/app/phone/fixture.ts";
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../../base/mod.ts";
import { phoneManifestSchema } from "../../../../protocol/apps/phone-screen.ts";
import { LINKS_PATH } from "../bundle/links.ts";
import { prepareFromSource } from "./from-source.ts";

// fixture는 npm 의존이 없다. npm이 registry에 닿지 않게 한다(준비의 npm 자식은 npm_config_*를 받는다).
process.env["npm_config_offline"] = "true";
process.env["npm_config_audit"] = "false";
process.env["npm_config_fund"] = "false";
process.env["npm_config_update_notifier"] = "false";

const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
const roots: string[] = [];
// bundle과 sdk 사본은 읽기 전용이다. 폴더마다 쓰기 권한을 돌려준 뒤 지운다.
async function removeTree(dir: string): Promise<void> {
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeTree(join(dir, entry.name));
  }
}
after(async () => {
  for (const root of roots) {
    await removeTree(root).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function prepare(patch?: (dir: string) => Promise<void>) {
  const dataRoot = await mkdtemp(join(tmpdir(), "phone-prepare-"));
  roots.push(dataRoot);
  const { sourceRoot, commit } = await createPhoneApp(dataRoot, patch);
  return await prepareFromSource({
    dataRoot,
    app: ids.newId("app"),
    sourceRoot,
    commit,
  });
}

test("폰 화면 하나만 가진 앱은 준비가 phone.js·manifest·preview를 bundle에 담는다", async () => {
  const prepared = await prepare();
  assert.ok(prepared.ok, JSON.stringify(!prepared.ok && prepared.error));
  const paths = prepared.value.manifest.files.map((file) => file.path);
  for (const name of [
    "phone.js",
    "phone.js.map",
    "phone.json",
    "index.html",
    "preview.js",
    "preview.js.map",
  ]) {
    assert.ok(paths.includes(`screens/home/${name}`), name);
  }
  const manifest = phoneManifestSchema.parse(
    JSON.parse(
      await readFile(
        join(prepared.value.copyPath, "screens/home/phone.json"),
        "utf8",
      ),
    ),
  );
  assert.deepEqual(manifest.kit, {
    "@lophn/ui-native": "0.1.0",
    "@lophn/app-ui-native": "0.1.0",
  });
  // build에만 쓴 kit(devDependencies)은 prune되어 bundle의 node_modules에 없다. 남은 것은 workspace stand-in이다.
  const links = JSON.parse(
    await readFile(join(prepared.value.copyPath, LINKS_PATH), "utf8"),
  ) as { path: string }[];
  assert.deepEqual(links.map((link) => link.path).sort(), [
    "node_modules/react",
    "node_modules/react-dom",
    "node_modules/react-native-web",
  ]);
});

test("선언의 폰 화면과 phone.tsx가 양쪽으로 맞지 않으면 준비가 실패한다", async (t) => {
  const screen = "src/screens/home/phone.tsx";
  const cases: [string, (dir: string) => Promise<void>, RegExp][] = [
    [
      "선언했는데 phone.tsx가 없다",
      async (dir) => {
        await mkdir(join(dir, "src/screens/other"));
        await rename(
          join(dir, screen),
          join(dir, "src/screens/other/phone.tsx"),
        );
      },
      /^The phone screen home has no src\/screens\/home\/phone\.tsx/,
    ],
    [
      "phone.tsx가 선언에 없다",
      async (dir) => {
        await mkdir(join(dir, "src/screens/extra"));
        await writeFile(
          join(dir, "src/screens/extra/phone.tsx"),
          await readFile(join(dir, screen)),
        );
      },
      /^src\/screens\/extra\/phone\.tsx is not a declared phone screen/,
    ],
    [
      "한 key에 main.tsx와 phone.tsx가 같이 있다",
      async (dir) => {
        await writeFile(join(dir, "src/screens/home/main.tsx"), "export {};\n");
      },
      /^ui_build_failed: src\/screens\/home has both main\.tsx and phone\.tsx/,
    ],
  ];
  for (const [name, patch, reason] of cases) {
    await t.test(name, async () => {
      const prepared = await prepare(patch);
      assert.ok(!prepared.ok);
      assert.match(prepared.error.reason, reason);
    });
  }
});
