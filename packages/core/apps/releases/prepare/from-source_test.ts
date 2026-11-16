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
import { createLocalApp } from "../../../../../tests/support/app/local/fixture.ts";
import { createPhoneApp } from "../../../../../tests/support/app/phone/fixture.ts";
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../../base/mod.ts";
import { phoneBackendManifestSchema } from "../../../../protocol/apps/phone-backend.ts";
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

async function prepare(
  patch?: (dir: string) => Promise<void>,
  create = createPhoneApp,
) {
  const dataRoot = await mkdtemp(join(tmpdir(), "phone-prepare-"));
  roots.push(dataRoot);
  const { sourceRoot, commit } = await create(dataRoot, patch);
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

test("runs_on에 phone이 있는 앱은 준비가 폰 backend와 manifest를 bundle의 phone/에 담는다", async () => {
  const prepared = await prepare(undefined, createLocalApp);
  assert.ok(prepared.ok, JSON.stringify(!prepared.ok && prepared.error));
  const paths = prepared.value.manifest.files.map((file) => file.path);
  for (const path of [
    "phone/backend.js",
    "phone/backend.json",
    "migrations/0-1.sql",
    "screens/home/phone.js",
  ]) {
    assert.ok(paths.includes(path), path);
  }
  const backend = phoneBackendManifestSchema.parse(
    JSON.parse(
      await readFile(
        join(prepared.value.copyPath, "phone/backend.json"),
        "utf8",
      ),
    ),
  );
  assert.deepEqual(Object.keys(backend.operations).sort(), [
    "add_item",
    "list_items",
    "send_report",
  ]);
  assert.equal(backend.data_schema, 1);
});

// runs_on에 phone이 있는 앱이 폰에서 못 도는 모양이면 준비가 agent가 고칠 한 줄로 실패한다. phone이 없는 앱은 같은 코드를 컴퓨터에서
// 돌리므로 영향이 없다(위의 폰 화면 fixture가 runs_on 없이 준비된다).
test("runs_on에 phone이 있는 앱은 node: import, 선언과 다른 handler, SDK 하한 아래가 준비를 실패시킨다", async (t) => {
  const cases: [string, (dir: string) => Promise<void>, RegExp][] = [
    [
      "node: import",
      async (dir) => {
        await writeFile(
          join(dir, "src/handlers.ts"),
          `import "node:fs";\n${await readFile(join(dir, "src/handlers.ts"), "utf8")}`,
        );
      },
      /^a backend that runs on the phone cannot import node:fs \(src\/handlers\.ts\)$/,
    ],
    [
      "선언과 다른 handler",
      async (dir) => {
        const path = join(dir, "lophn.ts");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace(
            `{ name: "send_report", title: "Send report", effect: "external" },`,
            `{ name: "send_report", title: "Send report", effect: "external" },
    { name: "delete_item", title: "Delete item", effect: "write" },`,
          ),
        );
      },
      /^backend\.js does not register delete_item$/,
    ],
    [
      "SDK 하한 아래",
      async (dir) => {
        const path = join(dir, "lophn.ts");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace(
            `{ name: "@lophn/cap-tool", version: "2.2.0" }`,
            `{ name: "@lophn/cap-tool", version: "2.1.0" }`,
          ),
        );
      },
      /^an app that runs on the phone needs @lophn\/cap-store 2\.0\.0 and @lophn\/cap-tool 2\.2\.0 or later$/,
    ],
  ];
  for (const [name, patch, reason] of cases) {
    await t.test(name, async () => {
      const prepared = await prepare(patch, createLocalApp);
      assert.ok(!prepared.ok);
      assert.match(prepared.error.reason, reason);
    });
  }
});
