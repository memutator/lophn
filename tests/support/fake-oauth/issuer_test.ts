// fake 발급자 자기 점검. 세 질문의 답:
// - contract: boundary `models`(구독 provider 로그인은 발급자 주소가 정의 data라 fake 발급자도 정의만 바꿔 돈다), `secrets`.
// - 현실적 회귀: 발급자 쪽 모양(form 값, authorization_pending, id_token 검증 값)이 제품의 읽기와 어긋나는 것을 E2E가 잡으려면
//   fake가 제품이 보내는 값을 그대로 받고 틀린 요청을 숨기지 않아야 한다. 빈 queue를 조용히 넘기면 헛걸음이다.
// - 왜 지금 test로 못 잡나: login_test.ts·oauth-refresh_test.ts는 발급자를 함수 인자로 가짜로 만든다. 발급자 요청이
//   core 대기열 → runtime child의 pump → HTTP로 가는 길은 process를 건너야만 돈다.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeIssuerHandler } from "./mod.ts";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

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

test("fake 발급자가 device 로그인과 서명한 id_token을 낸다", async () => {
  const issuer = createFakeIssuerHandler();
  issuer.script({
    device: { device_code: "dev-1", user_code: "ABCD" },
    device_code: [
      { kind: "pending" },
      { kind: "tokens", access: "a-1", refresh: "r-1" },
    ],
  });

  const started = await (
    await issuer.handle(
      form("/device/code", { client_id: "e2e-client", scope: "openid" }),
    )
  ).json();
  const poll = {
    grant_type: GRANT,
    client_id: "e2e-client",
    device_code: "dev-1",
  };
  const pending = await issuer.handle(form("/token", poll));
  const pendingBody = await pending.json();
  const done = await (await issuer.handle(form("/token", poll))).json();

  const jwt = await issuer.idToken({ aud: "e2e-client", nonce: "n-1" });
  const [header, payload, signature] = jwt.split(".");
  const jwks = await (
    await issuer.handle(new Request("http://issuer.test/jwks"))
  ).json();
  const key = await crypto.subtle.importKey(
    "jwk",
    jwks.keys[0],
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64url(signature!),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const claims = JSON.parse(new TextDecoder().decode(base64url(payload!)));

  const empty = await issuer.handle(form("/token", poll));
  const emptyBody = await empty.json();

  assert.deepStrictEqual(
    [started.device_code, started.verification_uri, started.interval],
    ["dev-1", `${issuer.url}/verify`, 0.1],
  );
  assert.deepStrictEqual(
    [pending.status, pendingBody.error, done.access_token, done.refresh_token],
    [400, "authorization_pending", "a-1", "r-1"],
  );
  assert.deepStrictEqual(
    [verified, claims.iss, claims.aud, claims.nonce, jwks.keys[0].kid],
    [true, issuer.url, "e2e-client", "n-1", "e2e"],
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
      [4, "/jwks", null],
      [5, "/token", null],
    ],
  );
  assert.deepStrictEqual(journal[1]!.form["device_code"], "dev-1");
  assert.deepStrictEqual(journal[4]!.mismatch, emptyBody.error_description);
  assert.deepStrictEqual(
    journal.every((entry, i) => i === 0 || entry.at >= journal[i - 1]!.at),
    true,
  );
});
