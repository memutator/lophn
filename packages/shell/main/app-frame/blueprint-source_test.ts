import assert from "node:assert/strict";
import { test } from "node:test";

import type { CallResult } from "./app-connection.ts";
import {
  createBlueprintSource,
  createEntryScreen,
} from "./blueprint-source.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const OTHER = "rel_01j9zzzzzzzzzzzzzzzzzzzzz2";

const BLUEPRINT = {
  app: APP,
  release: RELEASE,
  commands: [{
    key: "add",
    label: "Add",
    description: "Adds a row.",
    effect: "write",
    confirm: true,
    input: { type: "object" },
  }, {
    key: "list",
    label: "List",
    description: "Lists rows.",
    effect: "read",
    confirm: false,
    input: null,
  }],
  screens: [
    { key: "card", label: "Card", path: "card", sizes: ["card"] },
    { key: "main", label: "Main", path: "main", sizes: ["panel", "full"] },
  ],
};

function reader(result: CallResult) {
  const calls: string[] = [];
  return {
    calls,
    read: (app: string) => {
      calls.push(app);
      return Promise.resolve(result);
    },
  };
}

test("shell/app-frame#R15: 앱 view의 blueprint는 /v1/apps/blueprint의 같은 release command 선언이다", async () => {
  const { read, calls } = reader({ ok: true, value: BLUEPRINT });
  const source = createBlueprintSource(read);
  const got = await source({
    app: APP,
    release: RELEASE,
    mode: "live",
    bundleHash: "h",
  });
  assert.deepEqual(got, {
    ok: true,
    value: {
      commands: [
        {
          key: "add",
          label: "Add",
          effect: "write",
          confirm: true,
          input: { type: "object" },
        },
        {
          key: "list",
          label: "List",
          effect: "read",
          confirm: false,
          input: null,
        },
      ],
    },
  });
  assert.deepEqual(calls, [APP]);
});

test("shell/app-frame#R15: view의 release가 active release와 다르거나 release 없는 preview면 다른 선언으로 판정하지 않는다", async () => {
  const { read } = reader({ ok: true, value: BLUEPRINT });
  const source = createBlueprintSource(read);
  const moved = await source({
    app: APP,
    release: OTHER,
    mode: "live",
    bundleHash: "h",
  });
  assert.equal(moved.ok, false);
  const preview = await source({
    app: APP,
    release: null,
    mode: "preview",
    bundleHash: "h",
  });
  assert.equal(preview.ok, false);
  const failed = await createBlueprintSource(
    reader({ ok: false, error: { code: "not_found", message: "x" } }).read,
  )({ app: APP, release: RELEASE, mode: "live", bundleHash: "h" });
  assert.deepEqual(failed, {
    ok: false,
    error: { code: "unavailable", message: "blueprint is not available" },
  });
});

test("shell/app-frame#R18: 전용 창은 blueprint가 full 크기를 선언한 첫 screen을 연다", async () => {
  const entry = createEntryScreen(reader({ ok: true, value: BLUEPRINT }).read);
  assert.deepEqual(await entry(APP, RELEASE), { ok: true, value: "main" });
  assert.equal((await entry(APP, OTHER)).ok, false);
  const none = createEntryScreen(
    reader({
      ok: true,
      value: { ...BLUEPRINT, screens: BLUEPRINT.screens.slice(0, 1) },
    }).read,
  );
  assert.equal((await none(APP, RELEASE)).ok, false);
});
