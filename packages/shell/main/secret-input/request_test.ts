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
  profile: null,
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
