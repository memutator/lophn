// fake 발급자 자기 점검. 세 질문의 답:
// - contract: boundary `models`(구독 provider 로그인은 발급자 주소가 정의 data라 fake 발급자도 정의만 바꿔 돈다), `secrets`.
// - 현실적 회귀: 발급자 쪽 모양(form 값, authorization_pending, 계정 claim)이 제품의 읽기와 어긋나는 것을 E2E가 잡으려면
//   fake가 제품이 보내는 값을 그대로 받고 틀린 요청을 숨기지 않아야 한다. 빈 queue를 조용히 넘기면 헛걸음이다.
// - 왜 지금 test로 못 잡나: login_test.ts·oauth-refresh_test.ts는 발급자를 함수 인자로 가짜로 만든다. 발급자 요청이
//   core 대기열 → runtime child의 pump → HTTP로 가는 길은 process를 건너야만 돈다.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeIssuerHandler } from "./mod.ts";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

// Response.json()은 unknown이다. 이 test가 읽는 값만 적어 두고 캐스팅해 쓴다.
type DeviceCodeReply = {
  device_code: string;
  verification_uri: string;
  interval: number;
};
type TokenReply = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

function form(path: string, fields: Record<string, string>): Request {
  return new Request(`http://issuer.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function base64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

test("fake 발급자가 device 로그인과 계정 claim을 담은 token을 낸다", async () => {
  const issuer = createFakeIssuerHandler();
  issuer.script({
    device: { device_code: "dev-1", user_code: "ABCD" },
    device_code: [
      { kind: "pending" },
      { kind: "tokens", access: "a-1", refresh: "r-1" },
    ],
  });

  const started = (await (
    await issuer.handle(
      form("/device/code", { client_id: "e2e-client", scope: "openid" }),
    )
  ).json()) as DeviceCodeReply;
  const poll = {
    grant_type: GRANT,
    client_id: "e2e-client",
    device_code: "dev-1",
  };
  const pending = await issuer.handle(form("/token", poll));
  const pendingBody = (await pending.json()) as TokenReply;
  const done = (await (
    await issuer.handle(form("/token", poll))
  ).json()) as TokenReply;

  const access = issuer.accessToken("acct-1");
  const claims = JSON.parse(
    new TextDecoder().decode(base64url(access.split(".")[1]!)),
  );

  const empty = await issuer.handle(form("/token", poll));
  const emptyBody = (await empty.json()) as TokenReply;

  assert.deepStrictEqual(
    [started.device_code, started.verification_uri, started.interval],
    ["dev-1", `${issuer.url}/verify`, 0.1],
  );
  assert.deepStrictEqual(
    [pending.status, pendingBody.error, done.access_token, done.refresh_token],
    [400, "authorization_pending", "a-1", "r-1"],
  );
  assert.deepStrictEqual(
    claims["https://api.openai.com/auth"].chatgpt_account_id,
    "acct-1",
  );
  assert.deepStrictEqual(
    [empty.status, emptyBody.error],
    [400, "invalid_request"],
  );
  const journal = issuer.journal();
  assert.deepStrictEqual(
    journal.map((entry) => [entry.n, entry.path, entry.step]),
    [
      [1, "/device/code", 0],
      [2, "/token", 0],
      [3, "/token", 1],
      [4, "/token", null],
    ],
  );
  assert.deepStrictEqual(journal[1]!.form["device_code"], "dev-1");
  assert.deepStrictEqual(journal[3]!.mismatch, emptyBody.error_description);
  assert.deepStrictEqual(
    journal.every((entry, i) => i === 0 || entry.at >= journal[i - 1]!.at),
    true,
  );
});
