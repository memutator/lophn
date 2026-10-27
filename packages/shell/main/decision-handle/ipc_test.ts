import assert from "node:assert/strict";
import { test } from "node:test";

import { DECISION_HANDLE_CHANNEL } from "../../ipc/confirmation.ts";
import { type DecisionHandleIpc, registerDecisionHandle } from "./ipc.ts";

const PROVIDER = "pvd_01h455vb4pex5v6nkc6gd5fd00";
const REQUEST = {
  concern: "lophn-agent/providers",
  decision: "provider_disconnect",
  targets: [PROVIDER],
};

function setup(windowOf: (sender: unknown) => string | undefined) {
  let handler:
    | ((event: { sender: unknown }, input: unknown) => Promise<unknown>)
    | undefined;
  const ipc: DecisionHandleIpc = {
    handle(channel, listener) {
      assert.equal(channel, DECISION_HANDLE_CHANNEL);
      handler = listener;
    },
    removeHandler() {},
  };
  const registered: unknown[] = [];
  registerDecisionHandle(ipc, {
    windowOf,
    core: () => ({
      internal: () =>
        Promise.resolve({
          ok: true,
          value: { provider: { id: PROVIDER } },
        }),
    }),
    register: (request) => {
      registered.push(request);
      return Promise.resolve({
        ok: true,
        confirmation: "ref",
        expiresAt: "2026-10-16T09:02:00.000Z",
      });
    },
    now: () => Date.parse("2026-10-16T09:00:00.000Z"),
  });
  return {
    call: (sender: unknown, input: unknown) => handler!({ sender }, input),
    registered,
  };
}

test("화면을 누르지 않은 결정 요청은 handle을 받지 못한다", async () => {
  // 일반 shell 창이 아닌 sender(보호 창, overlay, 앱 view)는 창으로 풀리지 않는다.
  const none = setup(() => undefined);
  assert.deepEqual(
    ((await none.call("overlay", REQUEST)) as { error: { code: string } }).error
      .code,
    "forbidden",
  );
  assert.equal(none.registered.length, 0);

  // 고정되지 않은 결정은 shell 창이어도 받지 못한다.
  const shell = setup(() => "window-1");
  const unknown = (await shell.call("shell", {
    ...REQUEST,
    decision: "delete_everything",
  })) as { error: { code: string } };
  assert.equal(unknown.error.code, "forbidden");
  assert.equal(shell.registered.length, 0);

  const ok = await shell.call("shell", REQUEST);
  assert.deepEqual(ok, {
    confirmation: "ref",
    expires_at: "2026-10-16T09:02:00.000Z",
  });
  assert.equal(shell.registered.length, 1);
});
