import assert from "node:assert/strict";
import { test } from "node:test";

import { manualClock } from "../../base/clock.ts";
import { createIdSource } from "../../base/id.ts";
import { seededRandom } from "../../base/random.ts";
import type { ExtensionModule } from "../../protocol/extensions/mod.ts";
import { createExtensionRegistry, type ExtensionFiles } from "./registry.ts";

const BUNDLED = "/app/bundled";
const DATA = "/data";

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
    mkdir: () => Promise.resolve(),
    remove: (path) => {
      if (files.delete(path)) return Promise.resolve();
      if (below(path).length > 0) {
        return Promise.reject(new Error("directory not empty"));
      }
      return Promise.resolve();
    },
  };
}

const ECHO = {
  name: "echo",
  description: "echo",
  inputSchema: { type: "object" },
  effect: "read",
};

function manifest(id: string, tools: unknown[] = []) {
  return JSON.stringify({
    id,
    name: id,
    description: "",
    entry: "index.cjs",
    provides: [],
    contributes: { tools },
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
      ctx.tools.handle("echo", (input) =>
        Promise.resolve({
          ok: true as const,
          value: [{ type: "text" as const, text: JSON.stringify(input) }],
        }),
      );
    },
    deactivate() {
      calls.push("deactivate");
    },
  };
  const clock = manualClock(0);
  const registry = createExtensionRegistry({
    roots: [BUNDLED],
    dataRoot: DATA,
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

test("설정 선언이 없으면 켜지 않고, 꺼진 extension은 load하지 않는다", async () => {
  const t = setup({
    demo: manifest("demo"),
    stray: manifest("stray"),
  });
  t.settings.set("extensions.stray.enabled", undefined);
  await t.registry.sync();

  assert.deepEqual(t.loaded, [], "nothing is enabled to load");
  const status = Object.fromEntries(
    (await t.registry.list()).map((info) => [info.id, info.status]),
  );
  assert.deepEqual(status, {
    demo: "off",
    stray: "no_setting",
  });
  assert.deepEqual(
    [...t.files.keys()].filter((path) => path.startsWith(DATA)),
    [],
  );

  // 선언된 demo만 켜진다.
  t.settings.set("extensions.demo.enabled", true);
  await t.registry.sync();
  assert.deepEqual(t.loaded, [`${BUNDLED}/demo/index.cjs`]);
});

test("tool handler는 켜진 동안만 불리고, tool 목록은 켜진 것과 꺼진 것을 가리지 않는다", async () => {
  const t = setup({
    demo: manifest("demo", [ECHO]),
    plain: manifest("plain"),
  });
  const call = {
    session: "ses_1",
    workspace: { kind: "home" as const },
  } as never;

  // 꺼져 있다: handler가 없고, 목록에는 tool이 있는 demo만 있다.
  await t.registry.sync();
  const off = await t.registry.callTool("demo", "echo", {}, call);
  assert.ok(!off.ok && off.error.code === "not_found");
  assert.deepEqual(
    t.registry.catalog().map((one) => [one.id, one.tools.length]),
    [["demo", 1]],
  );

  t.settings.set("extensions.demo.enabled", true);
  await t.registry.sync();
  const on = await t.registry.callTool("demo", "echo", { a: 1 }, call);
  assert.ok(on.ok && on.value[0]?.type === "text");
  assert.equal(t.registry.catalog().length, 1);

  // 끄면 handler도 버린다.
  t.settings.set("extensions.demo.enabled", false);
  await t.registry.sync();
  const after = await t.registry.callTool("demo", "echo", {}, call);
  assert.ok(!after.ok && after.error.code === "not_found");
  assert.equal(t.registry.catalog().length, 1);
});

test("builtin extension은 설정 선언 없이 sync에서 자동 활성화되고 지울 수 없다", async () => {
  const builtinManifest = JSON.stringify({
    id: "core-gui",
    name: "Core GUI",
    description: "Built-in chat view",
    entry: "index.cjs",
    provides: ["chat"],
    builtin: true,
    contributes: {
      keybindings: [
        {
          command: "agent.cycle-mode",
          key: { other: "Shift+Tab" },
          context: "agentView:claude",
        },
      ],
    },
  });
  const t = setup({ "core-gui": builtinManifest });
  await t.registry.sync();

  assert.deepEqual(t.calls, ["activate"]);
  assert.deepEqual(t.loaded, [`${BUNDLED}/core-gui/index.cjs`]);

  const [view] = await t.registry.list();
  assert.equal(view?.id, "core-gui");
  assert.equal(view?.status, "on");
  assert.equal(view?.installed, true);
  assert.equal(view?.builtin, true);
  assert.equal(view?.contributes?.keybindings.length, 1);

  // 설정이 없어도 다시 sync할 때 꺼지지 않는다.
  await t.registry.sync();
  assert.deepEqual(t.calls, ["activate"]);

  // 내장 extension은 remove할 수 없다.
  const removed = await t.registry.remove("core-gui");
  assert.ok(!removed.ok && removed.error.code === "conflict");
});
