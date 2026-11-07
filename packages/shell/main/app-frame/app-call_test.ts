import assert from "node:assert/strict";
import { test } from "node:test";

import { createAppCall } from "./app-call.ts";
import type { CoreCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

const APP = "app_00000000000000000000000001";
const RELEASE = "rel_00000000000000000000000001";

function view(mode: "live" | "preview"): BoundView {
  return {
    view_session: "view-1",
    generation: 1,
    target: {
      app: APP,
      mode,
      release: RELEASE,
      screen: "main",
      place: "tab",
    },
    binding: {
      release: RELEASE,
      bundleHash: "a".repeat(64),
      processNonce: "n1",
    },
  };
}

function setup() {
  const sent: unknown[] = [];
  const call: CoreCaller = (_kind, _resource, _method, body) => {
    sent.push(body);
    return Promise.resolve({
      ok: true,
      value: { invocation: null, outcome: { status: "succeeded", result: 1 } },
    });
  };
  const appCall = createAppCall({
    declaration: () =>
      Promise.resolve({
        ok: true,
        value: {
          operations: [{ name: "add", title: "Add", effect: "write" }],
        },
      }),
    call,
  });
  return { appCall, sent };
}

test("페이지가 보낸 앱·release·caller 주장은 쓰이지 않는다", async () => {
  const { appCall, sent } = setup();
  const claimed = await appCall.call(view("live"), {
    operation: "add",
    input: {},
    target: { mode: "live", app: "app_other", release: "rel_other" },
    caller: { kind: "agent" },
  });
  assert.equal(claimed.ok, false);
  assert.equal(sent.length, 0);

  const done = await appCall.call(view("live"), {
    operation: "add",
    input: { a: 1 },
  });
  assert.deepEqual(done, { ok: true, value: 1 });
  assert.deepEqual(sent, [
    {
      target: { mode: "live", app: APP, release: RELEASE },
      kind: "operation",
      name: "add",
      input: { a: 1 },
      caller: { kind: "person", view_session: "view-1" },
    },
  ]);
});

test("선언에 없는 operation(command 이름 포함)은 core까지 가지 않는다", async () => {
  const { appCall, sent } = setup();
  const reply = await appCall.call(view("live"), {
    operation: "drop",
    input: null,
  });
  assert.equal(reply.ok, false);
  assert.equal(!reply.ok && reply.error.code, "forbidden");
  assert.equal(sent.length, 0);
});
