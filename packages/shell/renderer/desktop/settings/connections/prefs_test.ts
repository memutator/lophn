import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreSource } from "../../connection/connection.ts";
import {
  CODING_AGENTS_SETTING_KEY,
  type CodingPrefs,
  coreCodingPrefsSource,
  createCodingPrefsStore,
} from "./prefs.ts";

function fakeCore(
  initial: CodingPrefs,
  options: { reject?: "locked" | "invalid_value"; unavailable?: boolean } = {},
) {
  let stored = initial;
  const writes: CodingPrefs[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call: ({ method, body }) => {
      if (method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [
              {
                key: CODING_AGENTS_SETTING_KEY,
                type: {},
                chosen: stored,
              },
            ],
            folders: [],
          },
        });
      }
      if (options.unavailable) {
        return Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "disk error" },
        });
      }
      if (options.reject !== undefined) {
        return Promise.resolve({
          ok: true,
          value: {
            changed: [],
            rejected: [
              { key: CODING_AGENTS_SETTING_KEY, reason: options.reject },
            ],
          },
        });
      }
      const next = (body as { changes: { value: CodingPrefs }[] }).changes[0]!
        .value;
      writes.push(next);
      stored = next;
      return Promise.resolve({
        ok: true,
        value: { changed: [CODING_AGENTS_SETTING_KEY], rejected: [] },
      });
    },
  };
  return { core, writes, current: () => stored };
}

test("기계마다 만든 coding prefs store는 자기 기계 core의 shell.coding_agents만 읽고 쓴다", async () => {
  const local = fakeCore({
    favorites: ["claude", "antigravity", "omp"],
    commands: { antigravity: "agy --dangerously-skip-permissions --gui" },
  });
  const remote = fakeCore({
    favorites: ["claude", "codex", "opencode"],
    commands: {},
  });

  const localStore = createCodingPrefsStore(coreCodingPrefsSource(local.core));
  const remoteStore = createCodingPrefsStore(
    coreCodingPrefsSource(remote.core),
  );

  localStore.reload();
  remoteStore.reload();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual(localStore.snapshot(), {
    favorites: ["claude", "antigravity", "omp"],
    commands: { antigravity: "agy --dangerously-skip-permissions --gui" },
  });
  assert.deepStrictEqual(remoteStore.snapshot(), {
    favorites: ["claude", "codex", "opencode"],
    commands: {},
  });

  remoteStore.set({
    favorites: ["claude", "codex", "opencode", "antigravity"],
    commands: { claude: "claude --gui" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual(remote.writes, [
    {
      favorites: ["claude", "codex", "opencode", "antigravity"],
      commands: { claude: "claude --gui" },
    },
  ]);
  assert.deepStrictEqual(local.writes, []);
  assert.deepStrictEqual(local.current(), {
    favorites: ["claude", "antigravity", "omp"],
    commands: { antigravity: "agy --dangerously-skip-permissions --gui" },
  });
});

test("settings/update가 거절하거나 실패하면 coding prefs store가 저장된 값으로 되돌린다", async () => {
  for (const options of [
    { reject: "invalid_value" as const },
    { unavailable: true },
  ]) {
    const server = fakeCore({ favorites: ["claude"], commands: {} }, options);
    const store = createCodingPrefsStore(coreCodingPrefsSource(server.core));
    store.reload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(store.snapshot().favorites, ["claude"]);

    store.set({ favorites: ["claude", "antigravity"], commands: {} });
    assert.deepStrictEqual(store.snapshot().favorites, [
      "claude",
      "antigravity",
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(store.snapshot().favorites, ["claude"]);
  }
});
