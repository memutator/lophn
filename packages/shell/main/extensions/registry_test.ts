import assert from "node:assert/strict";
import { test } from "node:test";

import { manualClock } from "../../../base/clock.ts";
import { createIdSource } from "../../../base/id.ts";
import { seededRandom } from "../../../base/random.ts";
import type { ExtensionModule } from "../../../protocol/extensions/mod.ts";
import { createExtensionRegistry, type ExtensionFiles } from "./registry.ts";

const BUNDLED = "/app/bundled";
const DATA = "/data";
const VERSION = "1.2.3";

// file Map 위의 대역이다. 폴더는 file path의 앞부분이고 비지 않은 폴더는 지워지지 않는다.
function memory(files: Map<string, string>): ExtensionFiles {
  const below = (dir: string) => [
    ...new Set(
      [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1).split("/")[0] as string),
    ),
  ];
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    list: (dir) => {
      const names = below(dir);
      return Promise.resolve(names.length === 0 ? null : names);
    },
    remove: (path) => {
      if (files.delete(path)) return Promise.resolve();
      if (below(path).length > 0) {
        return Promise.reject(new Error("directory not empty"));
      }
      return Promise.resolve();
    },
  };
}

function manifest(id: string, version = VERSION) {
  return JSON.stringify({
    id,
    name: id,
    description: "",
    version,
    entry: "index.cjs",
    provides: [],
  });
}

// fixture extension: 켜면 file을 쓰고 호출 기록을 남긴다.
function setup(manifests: Record<string, string>) {
  const files = new Map<string, string>();
  for (const [id, text] of Object.entries(manifests)) {
    files.set(`${BUNDLED}/${id}/manifest.json`, text);
  }
  const settings = new Map<string, unknown>([
    ["extensions.demo.enabled", false],
    ["shell.theme", "dark"],
  ]);
  const calls: string[] = [];
  const loaded: string[] = [];
  const module: ExtensionModule = {
    async activate(ctx) {
      calls.push("activate");
      await ctx.files.write("state/cache.json", "{}");
    },
    deactivate() {
      calls.push("deactivate");
    },
  };
  const clock = manualClock(0);
  const registry = createExtensionRegistry({
    roots: [BUNDLED],
    dataRoot: DATA,
    productVersion: VERSION,
    files: memory(files),
    load: (path) => {
      loaded.push(path);
      return Promise.resolve(module);
    },
    settings: {
      get: (key) => Promise.resolve({ ok: true, value: settings.get(key) }),
    },
    core: {
      call: () =>
        Promise.resolve({ ok: true as const, value: undefined as unknown }),
    },
    spawn: () => {
      throw new Error("not used");
    },
    acp: {
      open: () => {
        throw new Error("not used");
      },
      onTab: () => () => {},
      onOpenIntent: () => () => {},
    },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    log: () => {},
  });
  return { files, settings, calls, loaded, registry };
}

test("켰다가 끄고 지우면 data root가 처음과 같고 사람 file과 다른 설정은 그대로다", async () => {
  const t = setup({ demo: manifest("demo") });
  const first = new Map(t.files);

  t.settings.set("extensions.demo.enabled", true);
  await t.registry.sync();
  assert.deepEqual(t.calls, ["activate"]);
  assert.ok(t.files.has(`${DATA}/extensions/demo/.lophn-extension`));
  assert.ok(t.files.has(`${DATA}/extensions/demo/state/cache.json`));

  // 켜져 있으면 지우지 못한다.
  const refused = await t.registry.remove("demo");
  assert.ok(!refused.ok && refused.error.code === "conflict");

  t.settings.set("extensions.demo.enabled", false);
  await t.registry.sync();
  assert.deepEqual(t.calls, ["activate", "deactivate"]);

  // 사람이 같은 폴더에 넣은 file은 남고 다른 것은 모두 지워진다.
  t.files.set(`${DATA}/extensions/demo/mine.txt`, "human");
  assert.ok((await t.registry.remove("demo")).ok);
  assert.deepEqual(
    [...t.files.keys()].filter((path) => path.startsWith(DATA)),
    [`${DATA}/extensions/demo/mine.txt`],
  );
  t.files.delete(`${DATA}/extensions/demo/mine.txt`);
  assert.deepEqual(t.files, first);
  assert.equal(t.settings.get("shell.theme"), "dark");

  // 사람 file이 없었으면 폴더까지 처음과 같다.
  t.settings.set("extensions.demo.enabled", true);
  await t.registry.sync();
  t.settings.set("extensions.demo.enabled", false);
  await t.registry.sync();
  assert.ok((await t.registry.remove("demo")).ok);
  assert.deepEqual(t.files, first);
});

test("판이 다르거나 설정 선언이 없으면 켜지 않고, 꺼진 extension은 load하지 않는다", async () => {
  const t = setup({
    demo: manifest("demo"),
    old: manifest("old", "0.0.1"),
    stray: manifest("stray"),
  });
  t.settings.set("extensions.old.enabled", true);
  t.settings.set("extensions.stray.enabled", undefined);
  await t.registry.sync();

  assert.deepEqual(t.loaded, [], "nothing is enabled to load");
  const status = Object.fromEntries(
    (await t.registry.list()).map((info) => [info.id, info.status]),
  );
  assert.deepEqual(status, {
    demo: "off",
    old: "incompatible",
    stray: "no_setting",
  });
  assert.deepEqual(
    [...t.files.keys()].filter((path) => path.startsWith(DATA)),
    [],
  );

  // 판이 맞고 선언된 demo만 켜진다.
  t.settings.set("extensions.demo.enabled", true);
  await t.registry.sync();
  assert.deepEqual(t.loaded, [`${BUNDLED}/demo/index.cjs`]);
});
