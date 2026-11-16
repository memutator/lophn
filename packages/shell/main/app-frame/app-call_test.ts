import assert from "node:assert/strict";
import { test } from "node:test";

import { appViewsCallInputSchema } from "../../../protocol/apps/views.ts";
import { createAppCall } from "./app-call.ts";
import type { CoreCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

const view = { view_session: "view-0001-0002" } as BoundView;

test("화면이 준 입력의 undefined 칸은 빠지고 core 통로의 입력 검사를 통과한다", async () => {
  const sent: unknown[] = [];
  const call: CoreCaller = async (_kind, _resource, _method, body) => {
    sent.push(body);
    // core RPC client는 보내기 전에 이 schema로 검사한다.
    return appViewsCallInputSchema.safeParse(body).success
      ? { ok: true, value: { outcome: { ok: true, value: 1 } } }
      : { ok: false, error: { code: "invalid_input", message: "invalid" } };
  };
  const calls = createAppCall({ call, resume: () => {} });
  // IPC(structured clone)는 값이 undefined인 칸을 그대로 넘긴다.
  const fromPage = structuredClone({
    operation: "usage.sessions",
    input: { harnesses: undefined, search: undefined, offset: 0, limit: 50 },
  });
  assert.deepEqual(await calls.call(view, fromPage), { ok: true, value: 1 });
  assert.deepEqual(sent, [
    {
      view: "view-0001-0002",
      operation: "usage.sessions",
      input: { offset: 0, limit: 50 },
    },
  ]);
  // 입력을 주지 않은 호출은 null로 간다.
  assert.deepEqual(await calls.call(view, { operation: "usage.sources" }), {
    ok: true,
    value: 1,
  });
  assert.equal((sent[1] as { input: unknown }).input, null);
});
