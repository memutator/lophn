import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type Blueprint,
  type ConfirmRequest,
  createAppCall,
  type InputRules,
} from "./app-call.ts";
import type { InvokeRequest, InvokeResponse } from "./app-invoke.ts";
import type { AppBinding, ConnectTarget, Outcome } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

// 앱 runtime과 같은 contracts 정본으로 검사한다. shell tsc는 contracts 원본을 보지 않으므로
// 문자열 URL로 읽는다.
const contractRules = await import(
  new URL("../../../../packages/contracts/apps/blueprint.ts", import.meta.url)
    .href
) as {
  validateInput: InputRules["validate"];
  canonicalInputHash: InputRules["hash"];
};
const RULES: InputRules = {
  validate: contractRules.validateInput,
  hash: contractRules.canonicalInputHash,
};

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const HASH = "1".repeat(64);
const PROOF = { payload: { invocation: "inv_x" }, signature: "s".repeat(86) };

const BLUEPRINT: Blueprint = {
  commands: [
    {
      key: "usage.list",
      label: "List usage",
      effect: "read",
      confirm: false,
      input: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 10, minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      key: "note.save",
      label: "Save note",
      effect: "write",
      confirm: false,
      input: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      key: "account.close",
      label: "Close account",
      effect: "external",
      confirm: true,
      input: {
        type: "object",
        properties: {
          reason: { type: "string", default: "none" },
        },
        additionalProperties: false,
      },
    },
    {
      key: "status.ping",
      label: "Ping",
      effect: "read",
      confirm: false,
      input: null,
    },
    {
      key: "secret.export",
      label: "Export",
      effect: "read",
      confirm: false,
      input: null,
    },
  ],
};

function binding(nonce: string, overrides: Partial<AppBinding> = {}) {
  return {
    endpoint: `/run/app-${nonce}.sock`,
    authorization: `signed-${nonce}`,
    release: REL as string | null,
    bundleHash: HASH,
    processNonce: nonce,
    expiresAtMs: 1_000_000 as number | null,
    ...overrides,
  };
}

function viewOf(overrides: Partial<BoundView> = {}): BoundView {
  return {
    view_session: "view-1",
    generation: 1,
    target: {
      app: APP,
      mode: "live",
      release: REL,
      screen: "main",
      size: "full",
    },
    binding: binding("nonce-1", { authorization: "screen-only" }),
    ...overrides,
  };
}

function world() {
  const state = {
    nonce: "nonce-1",
    // core는 요청한 것 중 프로세스가 등록한 command만 넣는다.
    registered: [
      "usage.list",
      "note.save",
      "account.close",
      "status.ping",
    ],
    connects: [] as { target: ConnectTarget; commands: string[] }[],
    invokes: [] as InvokeRequest[],
    confirms: [] as ConfirmRequest[],
    blueprintReads: 0,
    replies: [] as (InvokeResponse | "drop")[],
    confirmResult: {
      ok: true,
      value: PROOF,
    } as Awaited<ReturnType<Parameters<typeof createAppCall>[0]["confirm"]>>,
    now: 0,
  };
  let serial = 0;
  const calls = createAppCall({
    connector: {
      connectCommands(target, commands) {
        state.connects.push({ target, commands: [...commands] });
        const value = {
          binding: binding(state.nonce, {
            authorization: `signed-${state.nonce}-${state.connects.length}`,
            release: target.release,
          }),
          commands: commands.filter((key) => state.registered.includes(key)),
        };
        return Promise.resolve({ ok: true, value } as Outcome<typeof value>);
      },
    },
    blueprint() {
      state.blueprintReads += 1;
      return Promise.resolve({ ok: true, value: BLUEPRINT });
    },
    rules: RULES,
    confirm(request) {
      state.confirms.push(request);
      return Promise.resolve(state.confirmResult);
    },
    invoke(request) {
      state.invokes.push(structuredClone(request));
      const reply = state.replies.shift() ?? {
        status: 200,
        body: {
          result: { result: { ok: true } },
          mode: "live",
        },
      };
      return reply === "drop"
        ? Promise.reject(new Error("socket closed"))
        : Promise.resolve(reply);
    },
    ids: { requestKey: () => `req-${++serial}` },
    clock: { nowMs: () => state.now },
  });
  return { calls, state };
}

test("shell/app-frame#R15, shell/app-frame#R12: app:call은 sender view의 앱·release·연결과 고정 blueprint로 검사해 앱 socket invoke로 보낸다", async () => {
  const w = world();
  const result = await w.calls.call(viewOf(), {
    command: "usage.list",
    input: {},
  });
  assert.deepEqual(result, {
    ok: true,
    value: { result: { result: { ok: true } }, mode: "live" },
  });
  // 연결은 view의 앱·mode·release·screen과 blueprint의 모든 command를 범위로 얻는다.
  assert.deepEqual(w.state.connects, [{
    target: {
      app: APP,
      mode: "live",
      release: REL,
      screen: "main",
      size: "full",
    },
    commands: [
      "usage.list",
      "note.save",
      "account.close",
      "status.ping",
      "secret.export",
    ],
  }]);
  // 화면 연결이 아니라 command 범위가 있는 연결로 보내고 default를 적용한 입력을 싣는다.
  assert.deepEqual(w.state.invokes, [{
    endpoint: "/run/app-nonce-1.sock",
    authorization: "signed-nonce-1-1",
    body: {
      request_key: "req-1",
      command: "usage.list",
      release: REL,
      input: { limit: 10 },
    },
  }]);
  // preview의 release 없는 연결에는 release를 싣지 않는다. 입력 없는 command는 null로 부른다.
  const preview = viewOf({
    view_session: "view-2",
    target: {
      app: APP,
      mode: "preview",
      release: null,
      screen: "main",
      size: "panel",
    },
    binding: binding("nonce-1", { release: null }),
  });
  w.state.invokes.length = 0;
  const ping = await w.calls.call(preview, {
    command: "status.ping",
    input: null,
  });
  assert.equal(ping.ok, true);
  assert.equal(w.state.connects.at(-1)!.target.mode, "preview");
  assert.equal(w.state.connects.at(-1)!.target.release, null);
  assert.deepEqual(w.state.invokes[0]!.body, {
    request_key: "req-2",
    command: "status.ping",
  });
});

test("shell/app-frame#R15: 일반 read는 ledger 기록을 기다리지 않고 100번 불러도 연결·blueprint read는 한 번이다", async () => {
  const w = world();
  for (let index = 0; index < 100; index++) {
    const result = await w.calls.call(viewOf(), {
      command: "usage.list",
      input: { limit: 3 },
    });
    assert.equal(result.ok, true);
  }
  assert.equal(w.state.invokes.length, 100);
  assert.equal(w.state.connects.length, 1);
  assert.equal(w.state.blueprintReads, 1);
  assert.equal(w.state.confirms.length, 0);
  // 같은 view의 동시 첫 호출도 연결을 한 번만 얻는다.
  const fresh = world();
  await Promise.all(
    Array.from(
      { length: 5 },
      () => fresh.calls.call(viewOf(), { command: "usage.list", input: {} }),
    ),
  );
  assert.equal(fresh.state.connects.length, 1);
});

test("shell/app-frame#R13: 선언 밖·연결 밖 command는 같은 답이고 token·임의 field·wildcard·schema 밖 입력은 앱에 닿지 않는다", async () => {
  const w = world();
  const undeclared = await w.calls.call(viewOf(), {
    command: "files.read",
    input: {},
  });
  // blueprint에는 있지만 프로세스가 등록하지 않아 core가 연결에 넣지 않은 command.
  const outside = await w.calls.call(viewOf(), {
    command: "secret.export",
    input: null,
  });
  assert.deepEqual(undeclared, outside);
  assert.deepEqual(undeclared, {
    ok: false,
    error: { code: "invalid_input", message: "command is not available" },
  });
  for (
    const bad of [
      { command: "usage.list", input: {}, token: "secret" },
      {
        command: "usage.list",
        input: {},
        app: "app_01j9yyyyyyyyyyyyyyyyyyyyyy",
      },
      { command: "usage.list", input: {}, method: "DELETE", path: "/etc" },
      { command: "*", input: {} },
      { command: " ", input: {} },
      { command: "usage.list\u0000", input: {} },
      { command: "usage.list" },
      { command: "usage.list", input: { limit: 0 } },
      { command: "usage.list", input: { extra: true } },
      { command: "note.save", input: {} },
      { command: "usage.list", input: { big: "x".repeat(70_000) } },
      "usage.list",
      null,
    ]
  ) {
    const result = await w.calls.call(viewOf(), bad);
    assert.equal(result.ok, false, JSON.stringify(bad).slice(0, 80));
    assert.equal(
      (result as { error: { code: string } }).error.code,
      "invalid_input",
    );
  }
  assert.equal(w.state.invokes.length, 0);
});

test("shell/app-frame#R15: confirm command는 approval gate의 proof를 붙여야만 보내고 거절이면 앱을 부르지 않는다", async () => {
  const w = world();
  w.state.confirmResult = {
    ok: false,
    error: { code: "forbidden", message: "the person declined" },
  };
  const declined = await w.calls.call(viewOf(), {
    command: "account.close",
    input: {},
  });
  assert.deepEqual(declined, {
    ok: false,
    error: { code: "forbidden", message: "the person declined" },
  });
  assert.equal(w.state.invokes.length, 0);
  // 사람 결정에 묶는 값은 view의 앱·release·nonce와 default를 적용한 정규 입력·hash다.
  const asked = w.state.confirms[0]!;
  assert.equal(asked.app, APP);
  assert.equal(asked.release, REL);
  assert.equal(asked.processNonce, "nonce-1");
  assert.equal(asked.command.key, "account.close");
  assert.deepEqual(asked.input, { reason: "none" });
  const expected = await RULES.hash(
    BLUEPRINT.commands[2]!.input as never,
    { reason: "none" },
  );
  assert.deepEqual(expected, { ok: true, value: asked.inputHash });

  w.state.confirmResult = { ok: true, value: PROOF };
  const accepted = await w.calls.call(viewOf(), {
    command: "account.close",
    input: {},
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(w.state.invokes[0]!.body, {
    request_key: "req-1",
    command: "account.close",
    release: REL,
    input: { reason: "none" },
    proof: PROOF,
  });
  // 일반 command는 gate를 지나지 않는다.
  await w.calls.call(viewOf(), { command: "note.save", input: { text: "a" } });
  assert.equal(w.state.confirms.length, 2);
});

test("shell/app-frame#R12: 연결이 view와 다른 프로세스면 보내지 않고 401은 한 번만 다시 얻으며 끊긴 쓰기는 다시 부르지 않는다", async () => {
  const w = world();
  w.state.nonce = "nonce-other";
  const moved = await w.calls.call(viewOf(), {
    command: "usage.list",
    input: {},
  });
  assert.deepEqual(moved, {
    ok: false,
    error: { code: "conflict", message: "the app view changed" },
  });
  assert.equal(w.state.invokes.length, 0);

  w.state.nonce = "nonce-1";
  w.state.replies.push({
    status: 401,
    body: { error: { code: "unauthorized", message: "connection expired" } },
  });
  const retried = await w.calls.call(viewOf(), {
    command: "usage.list",
    input: {},
  });
  assert.equal(retried.ok, true);
  assert.equal(w.state.invokes.length, 2);
  assert.equal(
    w.state.invokes[0]!.body.request_key,
    w.state.invokes[1]!.body.request_key,
  );
  assert.notEqual(
    w.state.invokes[0]!.authorization,
    w.state.invokes[1]!.authorization,
  );

  w.state.replies.push("drop");
  const lost = await w.calls.call(viewOf(), {
    command: "note.save",
    input: { text: "hello" },
  });
  assert.deepEqual(lost, {
    ok: false,
    error: { code: "unavailable", message: "command result is unknown" },
  });
  assert.equal(w.state.invokes.length, 3);

  // 앱의 거절 code는 그대로, 모르는 응답은 unavailable이다.
  w.state.replies.push({
    status: 409,
    body: { error: { code: "conflict", message: "revision changed" } },
  });
  assert.deepEqual(
    await w.calls.call(viewOf(), {
      command: "note.save",
      input: { text: "a" },
    }),
    { ok: false, error: { code: "conflict", message: "revision changed" } },
  );
  w.state.replies.push({ status: 500, body: { error: { code: "internal" } } });
  assert.deepEqual(
    await w.calls.call(viewOf(), {
      command: "note.save",
      input: { text: "a" },
    }),
    { ok: false, error: { code: "unavailable", message: "command failed" } },
  );
  // 만료가 가까우면 다음 호출 전에 연결을 다시 얻는다.
  const before = w.state.connects.length;
  w.state.now = 1_000_000 - 1_000;
  await w.calls.call(viewOf(), { command: "usage.list", input: {} });
  assert.equal(w.state.connects.length, before + 1);
});
