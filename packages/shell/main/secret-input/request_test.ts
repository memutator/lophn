import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type OpenRequest,
  type RequestCore,
  submitRequest,
} from "./request.ts";

const VALUE = "482913-MARKER";
const request: OpenRequest = {
  session: "ses_1",
  tool_call: "tcl_1",
  kind: "login",
  tab: "tab_1",
  view: "browser",
  ref: "e7",
  mode: "once",
  label: "2FA code",
  origin: "https://example.com",
  title: "Sign in",
};

function fakeCore() {
  const calls: { route: string; body: unknown }[] = [];
  const uploads: string[] = [];
  const core: RequestCore = {
    internal(_kind, resource, method, body) {
      calls.push({ route: `${resource}/${method}`, body });
      return Promise.resolve({ ok: true, value: {} });
    },
    upload(resource, method) {
      uploads.push(`${resource}/${method}`);
      return Promise.resolve({ ok: true, value: {} });
    },
  };
  return { core, calls, uploads };
}

// 값이 저장소나 결과에 남으면 한 번만 넣기로 한 값(2FA code 등)이 agent에게 새거나 파일에 쌓인다.
test("한 번 넣기의 값은 알려진 값 등록과 치기에만 가고 저장·결과에는 없다", async () => {
  const { core, calls, uploads } = fakeCore();
  let typed: unknown;
  const reply = await submitRequest(
    core,
    (input) => {
      typed = input;
      return Promise.resolve({ content: [] });
    },
    request,
    { value: VALUE },
  );
  assert.deepEqual(reply, { ok: true });
  assert.equal((typed as { value: string }).value, VALUE);
  assert.equal((typed as { origin: string }).origin, request.origin);
  assert.deepEqual(uploads, []);
  assert.deepEqual(
    calls.map((call) => call.route),
    ["input_request/hold", "input_request/done"],
  );
  const done = calls.find((call) => call.route === "input_request/done")!;
  assert.deepEqual((done.body as { result: unknown }).result, { filled: true });
  assert.ok(!JSON.stringify(done.body).includes(VALUE));

  // 치기가 실패해도(origin이 달라졌다) 결과 오류에 값이 없다.
  calls.length = 0;
  const refused = await submitRequest(
    core,
    () =>
      Promise.resolve({
        error: { code: "conflict", message: "the page origin changed" },
      }),
    request,
    { value: VALUE },
  );
  assert.deepEqual(refused, { ok: true });
  const failed = calls.find((call) => call.route === "input_request/done")!;
  assert.equal(
    (failed.body as { result: { error: { code: string } } }).result.error.code,
    "conflict",
  );
  assert.ok(!JSON.stringify(failed.body).includes(VALUE));
});

// 연결하지 못한 provider의 key가 남으면 쓰이지 않는 secret이 쌓이고, 결과에 값이 실리면 agent가 key를 본다.
test("새 provider 자리는 값을 저장한 뒤 연결을 보내고, 연결이 실패하면 값을 지우며 결과에 값이 없다", async () => {
  const secret: OpenRequest = {
    session: "ses_1",
    tool_call: "tcl_2",
    kind: "secret",
    slot: { provider: "openrouter" },
    name: "provider.abc",
    subject: "OpenRouter",
    destinations: ["https://openrouter.ai/api/v1"],
    configured: false,
    connect: { id: "pvd_abc", name: "OpenRouter" },
  };
  const { core, calls, uploads } = fakeCore();
  assert.deepEqual(
    await submitRequest(core, undefined, secret, { value: VALUE }),
    {
      ok: true,
    },
  );
  assert.deepEqual(uploads, ["secrets/put"]);
  assert.deepEqual(
    calls.map((call) => call.route),
    ["providers/connect", "input_request/done"],
  );
  const connect = calls[0]!.body as {
    input: { id: string; credential: { secret: string } };
  };
  assert.equal(connect.input.id, "pvd_abc");
  assert.deepEqual(connect.input.credential, { secret: "provider.abc" });
  assert.deepEqual((calls[1]!.body as { result: unknown }).result, {
    stored: true,
  });

  const failing = fakeCore();
  failing.core.internal = (_kind, resource, method, body) => {
    failing.calls.push({ route: `${resource}/${method}`, body });
    return Promise.resolve(
      resource === "providers"
        ? { ok: false, error: { code: "unavailable" } }
        : { ok: true, value: {} },
    );
  };
  await submitRequest(failing.core, undefined, secret, { value: VALUE });
  assert.deepEqual(
    failing.calls.map((call) => call.route),
    ["providers/connect", "secrets/delete", "input_request/done"],
  );
  assert.ok(!JSON.stringify(failing.calls).includes(VALUE));
  assert.equal(
    (failing.calls[2]!.body as { result: { error: { code: string } } }).result
      .error.code,
    "unavailable",
  );
});
