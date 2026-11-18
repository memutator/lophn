import assert from "node:assert/strict";
import { test } from "node:test";

import { err } from "../../../../base/mod.ts";
import type { ToolCallInput } from "../../../../protocol/apps/calls/mod.ts";
import { createAppsCallService } from "./apps-call.ts";

const CHILD = {
  app: "app_00000000000000000000000001",
  release: "rel_00000000000000000000000001",
  mode: "live" as const,
  processNonce: "n1",
};

// 앱이 `on:`으로 다른 컴퓨터의 앱을 부를 때 같은 id의 이 컴퓨터 앱이 돌면 엉뚱한 data에 쓴다.
test("machine을 준 앱 호출은 이 컴퓨터의 앱으로 가지 않고 remote target으로만 core에 간다", async () => {
  const seen: ToolCallInput[] = [];
  const service = createAppsCallService({
    core: {
      call(_child, input) {
        seen.push(input);
        return Promise.resolve(err({ code: "unavailable", message: "stub" }));
      },
    },
  });
  const body = {
    process_nonce: "n1",
    mode: "live",
    target_app: "app_00000000000000000000000002",
    command: "items.add",
    parent_invocation: null,
  };
  await service.call(CHILD, { ...body, machine: "work" });
  await service.call(CHILD, body);
  assert.deepEqual(
    seen.map((input) => input.target),
    [
      { mode: "remote", machine: "work", app: body.target_app },
      { mode: "live", app: body.target_app, release: null },
    ],
  );
});
