// 세 질문
// - contract: boundary `models`. HTTP 오류와 stream 오류 frame을 retry할 것과 안 할 것으로 가르는 PROVIDER_FAILURES 분류.
// - 현실적 회귀: 분류 표를 손봐 retry할 오류가 안 되고 안 할 오류가 되는 수정(429 reset 근거, 5xx, redirect).
// - 지금 못 잡는 이유: failures.ts와 전송 계층에 test가 없다.

import assert from "node:assert/strict";
import { test } from "node:test";

import { err, formatAt, ok } from "../../../packages/base/mod.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
  type Transport,
  type TransportResponse,
} from "../../../packages/core/lophn-agent/providers/adapters/auth-transport.ts";
import {
  callWire,
  type Fixture,
  replayFetch,
  wireBinding,
  wireClock,
} from "../../support/wire/mod.ts";

const json = (error: Record<string, string>) =>
  JSON.stringify({ type: "error", error });
const http = (
  status: number,
  body = "",
  headers: Record<string, string> = {},
): Fixture => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body,
});
// 200 응답 안의 error frame이다. HTTP header가 없어 reset을 모른다.
const frame = (type: string, message: string): Fixture => ({
  status: 200,
  headers: { "content-type": "text/event-stream" },
  body: `event: error\ndata: ${json({ type, message })}\n\n`,
});

type Row = {
  name: string;
  response: Fixture;
  code: string;
  // 지금 시각에서 더할 초. 없으면 retry_at이 null이다.
  retryInSeconds?: number;
  reason?: string;
};

const ROWS: Row[] = [
  {
    name: "401",
    response: http(401, json({ type: "authentication_error", message: "bad" })),
    code: "credential_unavailable",
  },
  { name: "403", response: http(403), code: "credential_unavailable" },
  {
    name: "403 plan_access",
    response: http(403, json({ type: "plan_access", message: "no plan" })),
    code: "credential_unavailable",
    reason: "plan_access",
  },
  { name: "402", response: http(402), code: "credential_unavailable" },
  {
    name: "429 retry-after 20",
    response: http(429, "", { "retry-after": "20" }),
    code: "temporary",
    retryInSeconds: 20,
  },
  {
    name: "429 retry-after 90",
    response: http(429, "", { "retry-after": "90" }),
    code: "credential_unavailable",
  },
  {
    name: "429 header 없음",
    response: http(429),
    code: "temporary",
  },
  {
    name: "429 x-ratelimit-reset-requests 20s",
    response: http(429, "", { "x-ratelimit-reset-requests": "20s" }),
    code: "temporary",
    retryInSeconds: 20,
  },
  {
    name: "429 try again in 1.5s",
    response: http(
      429,
      json({
        type: "rate_limit_error",
        message: "Rate limit reached. Please try again in 1.5s.",
      }),
    ),
    code: "temporary",
    retryInSeconds: 1.5,
  },
  {
    name: "400 max_tokens 인자 오류",
    response: http(
      400,
      json({
        type: "invalid_request_error",
        message: "max_tokens: 99999 > 8192, the maximum for this model",
      }),
    ),
    code: "invalid_request",
  },
  { name: "500", response: http(500), code: "temporary" },
  { name: "502", response: http(502), code: "temporary" },
  { name: "503", response: http(503), code: "temporary" },
  { name: "529", response: http(529), code: "temporary" },
  { name: "504", response: http(504), code: "unknown" },
  { name: "408", response: http(408), code: "unknown" },
  {
    name: "302",
    response: http(302, "", { location: "http://127.0.0.1:2/elsewhere" }),
    code: "unknown",
  },
  {
    name: "400 invalid_request_error",
    response: http(
      400,
      json({ type: "invalid_request_error", message: "messages: required" }),
    ),
    code: "invalid_request",
  },
  {
    name: "413 context 초과 문구",
    response: http(
      413,
      json({ type: "request_too_large", message: "prompt is too long" }),
    ),
    code: "context_exceeded",
  },
  {
    name: "400 context_length_exceeded",
    response: http(
      400,
      json({ type: "context_length_exceeded", message: "x" }),
    ),
    code: "context_exceeded",
  },
  {
    name: "404 model",
    response: http(
      404,
      json({ type: "not_found_error", message: "model: claude-x" }),
    ),
    code: "model_unavailable",
  },
  {
    name: "404 다른 자원",
    response: http(
      404,
      json({ type: "not_found_error", message: "no such file" }),
    ),
    code: "unknown",
  },
  // stream 안 rate limit: 문구에 reset이 있으면 그 시각을 따른다(30초 안은 temporary, 넘으면 긴 대기).
  {
    name: "stream rate limit, retry after 20 seconds",
    response: frame("rate_limit_error", "Rate limited. retry after 20 seconds"),
    code: "temporary",
    retryInSeconds: 20,
  },
  {
    name: "stream rate limit, retry after 90 seconds",
    response: frame("rate_limit_error", "Rate limited. retry after 90 seconds"),
    code: "credential_unavailable",
  },
];

test("HTTP 오류는 retry할 것과 안 할 것으로 갈리고 redirect는 따라가지 않는다", async (t) => {
  const clock = wireClock();
  const replay = replayFetch(...ROWS.map((row) => row.response));
  const binding = await wireBinding("anthropic-messages", replay.fetch, clock);
  for (const row of ROWS) {
    await t.test(row.name, async () => {
      const out = await callWire(binding);
      assert.deepStrictEqual(out.outcome.kind, "failed");
      assert.deepStrictEqual(out.outcome.code, row.code);
      assert.deepStrictEqual(
        out.outcome.retry_at,
        row.retryInSeconds === undefined
          ? null
          : formatAt(clock.nowMs() + row.retryInSeconds * 1000),
      );
      if (row.reason !== undefined) {
        assert.deepStrictEqual(out.verdict?.unavailable_reason, row.reason);
      }
      if (row.response.status !== 200) {
        assert.deepStrictEqual(out.outcome.http_status, row.response.status);
      }
    });
  }
  // redirect를 따라갔다면 요청이 늘어난다(요청 하나가 case 하나다).
  assert.deepStrictEqual(replay.requests.length, ROWS.length);
});

test("요청 중 401이면 token을 새로 받아 한 번만 다시 보내고, 갱신할 수 없으면 처음 401을 그대로 돌려준다", async () => {
  const reply = (status: number): TransportResponse => ({
    status,
    headers: new Headers(),
    stream: null,
    json: String(status),
  });
  const run = async (statuses: number[], refreshable: boolean) => {
    const seen: { auth: string | undefined }[] = [];
    const refreshed: (boolean | undefined)[] = [];
    const attach: SecretAttachLike = {
      async send(_input, transmit, options) {
        refreshed.push(options?.refresh);
        if (options?.refresh === true && !refreshable) {
          return err({ code: "conflict", message: "no" });
        }
        return await transmit(options?.refresh === true ? "NEW" : "OLD");
      },
    };
    const transport: Transport = (request) => {
      seen.push({ auth: request.headers["authorization"] });
      return Promise.resolve(ok(reply(statuses.shift()!)));
    };
    const auth = createAuthTransport({
      attach,
      transport,
      context: {} as never,
      use: {} as never,
      operation: "op",
      headerName: "authorization",
      kind: "bearer",
    });
    const out = await auth.send({
      url: "https://x.test/v1",
      method: "POST",
      headers: {},
      body: "",
    });
    return {
      status: out.ok ? out.value.status : null,
      auths: seen.map((s) => s.auth),
      refreshed,
    };
  };
  // 갱신되면 새 token으로 한 번 더 보내고 두 번째 응답을 그대로 돌려준다(401이어도 세 번째는 없다).
  assert.deepStrictEqual(await run([401, 200], true), {
    status: 200,
    auths: ["Bearer OLD", "Bearer NEW"],
    refreshed: [undefined, true],
  });
  assert.deepStrictEqual(await run([401, 401], true), {
    status: 401,
    auths: ["Bearer OLD", "Bearer NEW"],
    refreshed: [undefined, true],
  });
  // 갱신할 수 없으면 다시 보내지 않고 처음 401이다. 401이 아니면 다시 부르지 않는다.
  assert.deepStrictEqual(await run([401], false), {
    status: 401,
    auths: ["Bearer OLD"],
    refreshed: [undefined, true],
  });
  assert.deepStrictEqual(await run([200], true), {
    status: 200,
    auths: ["Bearer OLD"],
    refreshed: [undefined],
  });
});
