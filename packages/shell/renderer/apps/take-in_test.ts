import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreCall } from "../../ipc/core.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { readAvailable, takeInApp } from "./take-in.ts";
import { takeInText } from "./take-in-note.ts";

const APP_ID = "app_01jd00000000000000000000rc";
const OTHER_APP = "app_01jd00000000000000000000zz";
const MACHINE_ID = "mch_01jd0000000000000000000001";
const RELEASE_ID = "rel_01jd00000000000000000000rc";

function envReply(
  available: readonly { app: string; name: string; machine: string }[],
) {
  return {
    ok: true as const,
    value: {
      available: available.map((one) => ({
        ...one,
        slug: one.name.toLowerCase(),
        release: null,
      })),
    },
  };
}

test("takeInApp은 available에 있는 앱만 apps/take_in으로 들이고, 없으면 sync_off를 돌려준다", async () => {
  const calls: CoreCall[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call: (req) => {
      calls.push(req);
      if (req.resource === "machine" && req.method === "environment") {
        return Promise.resolve(
          envReply([{ app: APP_ID, name: "Recipes", machine: MACHINE_ID }]),
        );
      }
      if (req.resource === "apps" && req.method === "take_in") {
        return Promise.resolve({
          ok: true,
          value: {
            app: APP_ID,
            release: RELEASE_ID,
            source_path: null,
            installed: "app_and_release",
          },
        });
      }
      throw new Error(`unexpected call ${req.resource}/${req.method}`);
    },
  };

  assert.deepStrictEqual(await readAvailable(core), {
    ok: true,
    value: [{ app: APP_ID, name: "Recipes", machine: MACHINE_ID }],
  });

  // Not in available -> sync_off without calling apps/take_in.
  assert.deepStrictEqual(await takeInApp(core, OTHER_APP), {
    ok: false,
    reason: "sync_off",
  });
  assert.equal(
    calls.some((one) => one.method === "take_in"),
    false,
  );

  // In available -> calls apps/take_in with app and from.
  const taken = await takeInApp(core, APP_ID);
  assert.deepStrictEqual(taken, {
    ok: true,
    app: APP_ID,
    release: RELEASE_ID,
  });
  const command = calls.find((one) => one.method === "take_in");
  assert.deepStrictEqual((command?.body as { input: unknown }).input, {
    app: APP_ID,
    from: MACHINE_ID,
  });
  assert.match(takeInText(taken, "Recipes", "Home server"), /Recipes/);
  assert.match(
    takeInText({ ok: false, reason: "sync_off" }, "Recipes", "Home server"),
    /Home server/,
  );
});

test("takeInApp은 core의 conflict·source_incomplete 이유를 그대로 옮긴다", async () => {
  for (const reason of [
    "sdk_missing",
    "slug_in_use",
    "dependency_missing",
    "source_incomplete",
  ] as const) {
    const core: CoreSource = {
      subscribe: () => () => {},
      call: (req) => {
        if (req.resource === "machine" && req.method === "environment") {
          return Promise.resolve(
            envReply([{ app: APP_ID, name: "Recipes", machine: MACHINE_ID }]),
          );
        }
        return Promise.resolve({
          ok: false,
          error: {
            code: reason === "source_incomplete" ? "invalid_input" : "conflict",
            message: reason,
            details: { reason },
          },
        });
      },
    };
    assert.deepStrictEqual(await takeInApp(core, APP_ID), {
      ok: false,
      reason,
    });
  }
});
