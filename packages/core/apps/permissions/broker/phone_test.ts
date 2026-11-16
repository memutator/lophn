import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import type {
  AppGrant,
  GrantPermissionRequirement,
} from "../../../../protocol/apps/mod.ts";
import { effectiveScope } from "../effective.ts";
import { createPhoneService } from "./phone.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const LIVE = {
  app: APP,
  release: "r1",
  mode: "live" as const,
  processNonce: "n1",
};
const DECLARED: GrantPermissionRequirement = {
  kind: "phone.use",
  scope: { capability: "location.get" },
  reason: "weather where you are",
};

function grant(
  capability: string,
  status: "active" | "revoked" = "active",
): AppGrant {
  return {
    id: "grt_01hzzzzzzzzzzzzzzzzzzzz001",
    app: APP,
    scope: { kind: "phone.use", capability },
    status,
    created_at: "2026-11-01T00:00:00.000Z",
    revoked_at: status === "active" ? null : "2026-11-02T00:00:00.000Z",
  } as AppGrant;
}

// broker가 core에서 읽는 것과 같이 선언과 grant로 실행 범위를 계산한다. `known: false`는 core가 앱의 active release를
// 모르는 것(보관된 앱)이다.
function setup(
  permissions: GrantPermissionRequirement[],
  grants: AppGrant[],
  known = true,
) {
  const asked: unknown[] = [];
  const service = createPhoneService({
    access: {
      candidate: () => false,
      current: (app) =>
        Promise.resolve(
          ok(
            known
              ? {
                  release: "r1",
                  scope: effectiveScope({
                    app,
                    facts: {
                      release: "r1",
                      permissions,
                      app_connections: [],
                      tools: [],
                    },
                    grants,
                    targetCommands: () => undefined,
                  }),
                  tools: [],
                }
              : null,
          ),
        ),
    },
    core: {
      request: (_child, input) => {
        asked.push(input);
        return Promise.resolve(ok({ value: { lat: 1 } }));
      },
    },
  });
  const request = (mode: "live" | "preview" = "live") =>
    service.request(
      { ...LIVE, mode },
      {
        process_nonce: "n1",
        mode,
        capability: "location.get",
        input: {},
      },
    );
  return { asked, request };
}

// 폰의 위치가 사람의 허락 없이 앱으로 나가지 않는 경계다. 어느 쪽이 빠졌든 같은 거절이고 core(곧 폰)에 닿지 않는다.
test("phone requests are refused without a live grant for that capability and never reach core", async () => {
  const cases = {
    "not declared": setup([], [grant("location.get")]),
    "declared, no grant": setup([DECLARED], []),
    revoked: setup([DECLARED], [grant("location.get", "revoked")]),
    "another capability only": setup([DECLARED], [grant("camera.take")]),
    archived: setup([DECLARED], [grant("location.get")], false),
  };
  for (const [name, one] of Object.entries(cases)) {
    const refused = await one.request();
    assert.ok(!refused.ok, name);
    assert.equal(refused.error.code, "forbidden", name);
    assert.deepStrictEqual(
      refused.error.details,
      { permission: "phone.use", scope: { capability: "location.get" } },
      name,
    );
    assert.deepStrictEqual(one.asked, [], name);
  }

  const preview = setup([DECLARED], [grant("location.get")]);
  const fromPreview = await preview.request("preview");
  assert.ok(!fromPreview.ok);
  assert.equal(fromPreview.error.code, "forbidden");
  assert.deepStrictEqual(preview.asked, []);

  const allowed = setup([DECLARED], [grant("location.get")]);
  assert.deepStrictEqual(await allowed.request(), ok({ value: { lat: 1 } }));
  assert.deepStrictEqual(allowed.asked, [
    { capability: "location.get", input: {} },
  ]);
});
