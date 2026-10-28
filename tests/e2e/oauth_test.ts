// 세 질문
// - contract: boundary `models`(BeginProviderLogin·CompleteProviderLogin·CancelProviderLogin, 연결된 provider의 credential),
//   `secrets`(token·code·verifier·device_code는 secrets.json 밖 어디에도 없다).
// - 현실적 회귀: issuer pump나 대기열을 건드려 발급자 왕복이 끊기는 것, complete가 간격 전에 발급자를 두드리는 것,
//   취소해도 listener가 열려 있는 것, 로그인 도중 값이 log·blob에 남는 것.
//   구독 token 사용: boundary `models`(OAuth 요청은 Bearer, revoked면 token을 건네지 않는다), `run-loop`(secret 부착이 막히면 turn은
//   configuration_unavailable), `secrets`(token은 secrets.json에만 있다).
//   회귀: 만료된 token으로 요청이 나가는 것, access만 쓰고 회전한 refresh를 안 저장하는 것, 거절된 갱신 뒤에도 옛 token을 건네는 것,
//   header가 x-api-key로 나가는 것, .refresh·.meta가 log·ledger에 새는 것.
//   못 잡는 이유: oauth-refresh_test는 refresher를 함수로만 부른다. child의 secret 요청, core hook, 발급자 pump, model HTTP header는 process를 건너야 이어진다.
// - 왜 지금 test로 못 잡나: login_test.ts는 발급자·listener·writer를 가짜로 꽂은 함수 호출이다. 요청이 core 대기열 -> runtime
//   child의 pump -> HTTP로 가는 길과 callback이 실제 loopback socket으로 오는 길은 process를 건너야만 돈다.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { errorCode } from "../../packages/base/mod.ts";
import {
  loginBegin,
  loginCancel,
  loginComplete,
  modelCallList,
  providerList,
  providerRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  SECRET_FILE_NAME,
  secretStatus,
} from "../../packages/protocol/secrets/mod.ts";
import { openSession, say, until, waitTurnEnd } from "../support/core/human.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import { connectOAuthProvider } from "../support/fake-oauth/login.ts";
import { type FakeIssuer, startFakeIssuer } from "../support/fake-oauth/mod.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

const LOGIN_MS = 30_000;

type Fakes = { run: Run; fake: FakeServer; issuer: FakeIssuer; core: Core };

// run, fake model server, fake 발급자, core를 띄우고 body를 돈 뒤 모두 닫는다.
async function withFakes(body: (ctx: Fakes) => Promise<void>): Promise<void> {
  const run = await createRun();
  const fake = await startFakeServer();
  const issuer = await startFakeIssuer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await body({ run, fake, issuer, core });
  } finally {
    await core?.kill().catch(() => {});
    await issuer.close();
    await fake.close();
    await run.remove();
  }
}

// 파일 안에 key가 byte로 들어 있는 file의 path 목록. secrets.json은 건너뛴다.
async function filesWith(dir: string, key: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesWith(path, key)));
    } else if (entry.isFile() && entry.name !== SECRET_FILE_NAME) {
      const text = new TextDecoder("latin1").decode(await readFile(path));
      if (text.includes(key)) found.push(path);
    }
  }
  return found;
}

// core가 멈춘 뒤 읽는다. 없으면 빈 object.
async function secretsOf(run: Run): Promise<Record<string, string>> {
  try {
    return JSON.parse(
      await readFile(`${run.home}/${SECRET_FILE_NAME}`, "utf8"),
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
}

function suffixOf(id: string): string {
  return id.slice("pvd_".length);
}

test("device code 로그인이 발급자 간격을 지키고 secret 셋을 저장한다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const provider = core.ids.newId("pvd");
    const access = core.ids.newId("key");
    const refresh = core.ids.newId("key");
    const device_code = core.ids.newId("key");
    issuer.script({
      device: { device_code, user_code: "E2E-CODE", interval: 1 },
      device_code: [{ kind: "pending" }, { kind: "tokens", access, refresh }],
    });

    const started = await core.call(loginBegin, {
      provider,
      name: "fake subscription",
      definition: issuer.definition("supergrok"),
      endpoint: fake.url,
      protocol: "anthropic-messages",
    });
    const early = await core.call(loginComplete, {
      provider,
      login: started.login,
    });
    const tokenRequestsAtEarly = issuer
      .journal()
      .filter((entry) => entry.path === "/token").length;
    await until(
      "로그인이 끝남",
      async () => {
        const step = await core.call(loginComplete, {
          provider,
          login: started.login,
        });
        return step.state === "connected" ? step : undefined;
      },
      LOGIN_MS,
    );

    // 1. 발급자: device 시작 하나, 간격 전 complete는 발급자에 묻지 않음, poll 둘은 간격 이상 떨어짐.
    assert.deepStrictEqual(early.state, "pending");
    assert.deepStrictEqual(tokenRequestsAtEarly, 0);
    const journal = issuer.journal();
    assert.deepStrictEqual(
      journal.filter((entry) => entry.path === "/device/code").length,
      1,
    );
    const polls = journal.filter((entry) => entry.path === "/token");
    assert.deepStrictEqual(polls.length, 2);
    assert.ok(polls[1]!.at - polls[0]!.at >= started.interval_ms);

    // 2. ledger: 연결된 oauth credential
    const { provider: record } = await core.call(providerRead, { provider });
    assert.deepStrictEqual(record.credential.kind, "oauth");
    assert.deepStrictEqual(record.credential.state, "available");
    assert.deepStrictEqual(
      record.credential.secret_ref?.name,
      `provider.${suffixOf(provider)}`,
    );
    assert.ok(record.credential.expires_at !== null);

    // 3. disk: secret 셋
    await core.stop();
    const secrets = await secretsOf(run);
    const name = `provider.${suffixOf(provider)}`;
    assert.deepStrictEqual(secrets[name], access);
    assert.deepStrictEqual(secrets[`${name}.refresh`], refresh);
    assert.ok(secrets[`${name}.meta`] !== undefined);
  });
});

test("PKCE 로그인이 loopback callback으로 끝나고 code와 token이 secrets.json 밖에 남지 않는다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const provider = core.ids.newId("pvd");
    const access = core.ids.newId("key");
    const refresh = core.ids.newId("key");
    const code = core.ids.newId("key");
    const clientId = `oaiapp_${core.ids.newId("key")}`;

    const started = await core.call(loginBegin, {
      provider,
      name: "fake subscription",
      definition: issuer.definition("chatgpt"),
      endpoint: fake.url,
      protocol: "anthropic-messages",
    });
    const params = new URL(started.sign_in.url).searchParams;
    const redirect = params.get("redirect_uri")!;
    const idToken = await issuer.idToken({
      aud: clientId,
      nonce: params.get("nonce")!,
    });
    issuer.script({
      authorization_code: [
        {
          kind: "tokens",
          access,
          refresh,
          id_token: idToken,
        },
      ],
    });
    const pending = await core.call(loginComplete, {
      provider,
      login: started.login,
    });
    // 사람이 browser에서 로그인을 마치면 발급자가 callback 주소로 돌려보낸다.
    const callback = await fetch(
      `${redirect}?${new URLSearchParams({
        code,
        state: params.get("state")!,
        client_id: clientId,
      })}`,
    );
    await callback.body?.cancel();
    await until(
      "로그인이 끝남",
      async () => {
        const step = await core.call(loginComplete, {
          provider,
          login: started.login,
        });
        return step.state === "connected" ? step : undefined;
      },
      LOGIN_MS,
    );

    // 1. 발급자: code 교환에 verifier와 redirect_uri가 있고 jwks를 읽음
    assert.deepStrictEqual(pending.state, "pending");
    const journal = issuer.journal();
    const exchange = journal.filter((entry) => entry.path === "/token");
    assert.deepStrictEqual(exchange.length, 1);
    const form = exchange[0]!.form;
    const verifier = form["code_verifier"];
    assert.deepStrictEqual(form["grant_type"], "authorization_code");
    assert.deepStrictEqual(form["code"], code);
    assert.deepStrictEqual(form["redirect_uri"], redirect);
    assert.ok(verifier !== undefined && verifier.length > 0);
    assert.deepStrictEqual(
      journal.filter(
        (entry) => entry.path === "/jwks" && entry.method === "GET",
      ).length,
      1,
    );

    // 2. ledger
    const { provider: record } = await core.call(providerRead, { provider });
    assert.deepStrictEqual(record.credential.kind, "oauth");
    assert.deepStrictEqual(record.credential.state, "available");

    // 3. disk: secrets.json에는 있고 나머지(core.log 포함)에는 없다.
    await core.stop();
    const secrets = await secretsOf(run);
    const name = `provider.${suffixOf(provider)}`;
    assert.deepStrictEqual(secrets[name], access);
    assert.deepStrictEqual(secrets[`${name}.refresh`], refresh);
    assert.ok(secrets[`${name}.meta`] !== undefined);
    assert.ok(secrets["provider-oauth.host-id"] !== undefined);
    for (const value of [code, verifier, access, refresh, idToken]) {
      assert.deepStrictEqual(await filesWith(run.dir, value), []);
    }
  });
});

test("취소한 로그인의 callback listener가 닫힌다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const provider = core.ids.newId("pvd");
    const started = await core.call(loginBegin, {
      provider,
      name: "fake subscription",
      definition: issuer.definition("chatgpt"),
      endpoint: fake.url,
      protocol: "anthropic-messages",
    });
    const params = new URL(started.sign_in.url).searchParams;
    const redirect = params.get("redirect_uri")!;
    await core.call(loginCancel, { provider, login: started.login });

    // 1. 연결: listener가 닫혀 있다.
    await assert.rejects(
      () =>
        fetch(
          `${redirect}?${new URLSearchParams({
            code: "x",
            state: params.get("state")!,
            client_id: "y",
          })}`,
        ),
      TypeError,
    );
    // 2. route: 취소한 login은 없다.
    const done = await core.tryCall(loginComplete, {
      provider,
      login: started.login,
    });
    assert.ok(!done.ok);
    assert.deepStrictEqual(done.error.code, "not_found");
    // 3. disk: 그 provider의 이름이 없다.
    await core.stop();
    const secrets = await secretsOf(run);
    assert.deepStrictEqual(
      Object.keys(secrets).filter((name) => name.startsWith("provider.")),
      [],
    );
  });
});

test("구독 token이 model 요청의 Bearer header로만 나간다", async () => {
  await withFakes(async ({ fake, issuer, core }) => {
    const { access, refresh } = await connectOAuthProvider(core, issuer, fake);
    const session = await openSession(core, { role: "lophn" });
    fake.script([{ reply: { kind: "text", text: "ok" } }]);
    await say(core, session, "hello");
    const turn = await waitTurnEnd(core, session);

    // 1. fake model: Bearer 하나, x-api-key 없음, 본문에 token 없음
    const [request, ...rest] = fake.journal();
    assert.deepStrictEqual(rest, []);
    assert.deepStrictEqual(
      request!.headers["authorization"],
      `Bearer ${access}`,
    );
    assert.deepStrictEqual(request!.headers["x-api-key"], undefined);
    const body = JSON.stringify(request!.body);
    assert.ok(!body.includes(access) && !body.includes(refresh));
    // 2. ledger
    assert.deepStrictEqual(turn.outcome?.kind, "completed");
    // 3. 발급자: 만료가 멀어 갱신하지 않고 로그인 요청뿐
    const grants = issuer
      .journal()
      .filter((entry) => entry.path === "/token")
      .map((entry) => entry.form["grant_type"]);
    assert.deepStrictEqual(grants.length, 1);
    assert.ok(!grants.includes("refresh_token"));
  });
});

test("만료가 가까우면 runtime이 청할 때 core가 먼저 갱신하고 회전한 값을 저장한다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const first = await connectOAuthProvider(core, issuer, fake, {
      expires_in: 60,
    });
    const provider = first.provider;
    const newAccess = core.ids.newId("key");
    const newRefresh = core.ids.newId("key");
    issuer.script({
      refresh_token: [
        {
          kind: "tokens",
          access: newAccess,
          refresh: newRefresh,
        },
      ],
    });
    const session = await openSession(core, { role: "lophn" });
    fake.script([{ reply: { kind: "text", text: "ok" } }]);
    await say(core, session, "hello");
    await waitTurnEnd(core, session);

    // 1. 발급자: refresh_token grant 하나, 로그인 때 refresh와 정의의 client_id
    const refreshes = issuer
      .journal()
      .filter((entry) => entry.form["grant_type"] === "refresh_token");
    assert.deepStrictEqual(refreshes.length, 1);
    assert.deepStrictEqual(refreshes[0]!.form["refresh_token"], first.refresh);
    assert.deepStrictEqual(refreshes[0]!.form["client_id"], "e2e-client");
    // 2. fake model: 요청이 새 access를 싣는다(갱신이 요청보다 먼저).
    const requests = fake.journal();
    assert.deepStrictEqual(requests.length, 1);
    assert.deepStrictEqual(
      requests[0]!.headers["authorization"],
      `Bearer ${newAccess}`,
    );
    // 3. disk: 회전한 refresh와 새 access
    await core.stop();
    const secrets = await secretsOf(run);
    const name = `provider.${suffixOf(provider)}`;
    assert.deepStrictEqual(secrets[`${name}.refresh`], newRefresh);
    assert.deepStrictEqual(secrets[name], newAccess);
  });
});

test("갱신이 거절되면 credential이 revoked이고 model 요청이 나가지 않는다", async () => {
  await withFakes(async ({ fake, issuer, core }) => {
    const { provider } = await connectOAuthProvider(core, issuer, fake, {
      expires_in: 60,
    });
    issuer.script({
      refresh_token: [{ kind: "error", status: 400, error: "invalid_grant" }],
    });
    const session = await openSession(core, { role: "lophn" });
    fake.script([{ reply: { kind: "text", text: "unused" } }]);
    await say(core, session, "hello");
    const turn = await waitTurnEnd(core, session);

    // 1. ledger: credential revoked
    const { provider: record } = await core.call(providerRead, { provider });
    assert.deepStrictEqual(record.credential.state, "revoked");
    assert.deepStrictEqual(
      record.credential.unavailable_reason,
      "refresh_revoked",
    );
    // 2. ledger: turn은 configuration_unavailable로 닫힌다.
    assert.deepStrictEqual(turn.outcome, {
      kind: "failed",
      reason: "configuration_unavailable",
    });
    // 3. fake model: 요청 없음
    assert.deepStrictEqual(fake.journal().length, 0);
  });
});

test("구독 token은 route 출력과 secrets.json 밖 어디에도 남지 않는다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const { provider, access, refresh, device_code } =
      await connectOAuthProvider(core, issuer, fake);
    const session = await openSession(core, { role: "lophn" });
    fake.script([{ reply: { kind: "text", text: "ok" } }]);
    await say(core, session, "hello");
    await waitTurnEnd(core, session);

    // 1. route 출력
    const outputs = JSON.stringify([
      await core.call(providerRead, { provider }),
      await core.call(providerList, {}),
      await core.call(modelCallList, { session }),
      await core.call(secretStatus, {}),
    ]);
    for (const value of [access, refresh, device_code]) {
      assert.ok(!outputs.includes(value));
    }
    assert.ok(outputs.includes(provider));
    // 2. disk: core.log 포함 secrets.json 밖에 없다.
    await core.stop();
    for (const value of [access, refresh, device_code]) {
      assert.deepStrictEqual(await filesWith(run.dir, value), []);
    }
  });
});
