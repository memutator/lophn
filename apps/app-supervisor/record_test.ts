import { assert, assertEquals } from "@std/assert";
import { readRecordState, recordInput } from "./record.ts";
import type { RuntimeRecord } from "../../packages/core/apps/runtime/core-link.ts";

const STARTED: RuntimeRecord = {
  method: "record_started",
  app: "app_00000000000000000000000001",
  process_nonce: "nonce-1",
  started_at: "2026-10-04T00:00:00.000Z",
  attestation: {
    release: "rel_00000000000000000000000001",
    bundle_hash: "ab".repeat(32),
    commands: ["ping"],
    data_schema: 1,
    process_nonce: "nonce-1",
    connection_ok: true,
  },
};

Deno.test("apps/runtime#R2: record 입력에 관측 식별이 있고 base_revision compare가 없다", () => {
  const input = recordInput(STARTED);
  assertEquals(input.process_nonce, "nonce-1");
  assertEquals(input.started_at, "2026-10-04T00:00:00.000Z");
  assert(!("base_revision" in input));
});

Deno.test("apps/runtime#R2: record 응답은 command 출력의 state를 읽는다", () => {
  const ok = readRecordState({
    status: 200,
    body: {
      app: STARTED.app,
      state: { state: "running", termination_pending: false },
    },
  });
  assert(ok.ok);
  assertEquals(ok.value.state, "running");
  const rejected = readRecordState({
    status: 400,
    body: { error: { code: "invalid_input" } },
  });
  assert(!rejected.ok);
  const malformed = readRecordState({
    status: 200,
    body: { state: "running" },
  });
  // envelope로 감싼 모양은 실제 응답이 아니다.
  assert(
    !readRecordState({
      status: 200,
      body: { output: { app: STARTED.app, state: { state: "running" } } },
    }).ok,
  );
  assert(!malformed.ok);
});

Deno.test("apps/runtime#R21: core가 record를 거절해도 호출자는 오류를 받고 죽지 않는다", async () => {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, (request) => {
    const body = request.headers.get("content-type");
    assertEquals(body, "application/json");
    return Response.json({ error: { code: "invalid_input" } }, { status: 400 });
  });
  try {
    const port = server.addr.port;
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/apps/record_started`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer cred",
        },
        body: JSON.stringify({
          input: recordInput(STARTED),
          idempotency_key: "k",
          prepared: [],
        }),
      },
    );
    const result = readRecordState({
      status: response.status,
      body: await response.json(),
    });
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
  } finally {
    await server.shutdown();
  }
});
