// 세 질문
// - contract: boundary `models`(BeginProviderLogin·CompleteProviderLogin·CancelProviderLogin, 연결된 provider의 credential),
//   `secrets`(token·code·verifier·device_code는 secrets.json 밖 어디에도 없다).
// - 현실적 회귀: issuer pump나 대기열을 건드려 발급자 왕복이 끊기는 것, complete가 간격 전에 발급자를 두드리는 것,
//   취소해도 listener가 열려 있는 것, 로그인 도중 값이 log·blob에 남는 것.
// - 왜 지금 test로 못 잡나: login_test.ts는 발급자·listener·writer를 가짜로 꽂은 함수 호출이다. 요청이 core 대기열 -> runtime
//   child의 pump -> HTTP로 가는 길과 callback이 실제 loopback socket으로 오는 길은 process를 건너야만 돈다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  loginBegin,
  loginCancel,
  loginComplete,
  providerRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { SECRET_FILE_NAME } from "../../packages/protocol/secrets/mod.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import { runtimePids } from "../support/core/process.ts";
import { settle, until } from "../support/core/human.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import { type FakeIssuer, startFakeIssuer } from "../support/fake-oauth/mod.ts";

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
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...await filesWith(path, key));
    } else if (entry.isFile && entry.name !== SECRET_FILE_NAME) {
      const text = new TextDecoder("latin1").decode(await Deno.readFile(path));
      if (text.includes(key)) found.push(path);
    }
  }
  return found;
}

// core가 멈춘 뒤 읽는다. 없으면 빈 object.
async function secretsOf(run: Run): Promise<Record<string, string>> {
  try {
    return JSON.parse(
      await Deno.readTextFile(`${run.home}/${SECRET_FILE_NAME}`),
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
}

function suffixOf(id: string): string {
  return id.slice("pvd_".length);
}

Deno.test("device code 로그인이 발급자 간격을 지키고 secret 셋을 저장한다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const provider = core.ids.newId("pvd");
    const access = core.ids.newId("key");
    const refresh = core.ids.newId("key");
    const device_code = core.ids.newId("key");
    issuer.script({
      device: { device_code, user_code: "E2E-CODE", interval: 1 },
      device_code: [{ kind: "pending" }, { kind: "tokens", access, refresh }],
    });
    const before = await runtimePids(run.home);

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
    const tokenRequestsAtEarly = issuer.journal().filter((entry) =>
      entry.path === "/token"
    ).length;
    await until("로그인이 끝남", async () => {
      const step = await core.call(loginComplete, {
        provider,
        login: started.login,
      });
      return step.state === "connected" ? step : undefined;
    }, LOGIN_MS);
    await settle(core, before);

    // 1. 발급자: device 시작 하나, 간격 전 complete는 발급자에 묻지 않음, poll 둘은 간격 이상 떨어짐.
    assertEquals(early.state, "pending");
    assertEquals(tokenRequestsAtEarly, 0);
    const journal = issuer.journal();
    assertEquals(
      journal.filter((entry) => entry.path === "/device/code").length,
      1,
    );
    const polls = journal.filter((entry) => entry.path === "/token");
    assertEquals(polls.length, 2);
    assert(polls[1]!.at - polls[0]!.at >= started.interval_ms);

    // 2. ledger: 연결된 oauth credential
    const { provider: record } = await core.call(providerRead, { provider });
    assertEquals(record.credential.kind, "oauth");
    assertEquals(record.credential.state, "available");
    assertEquals(
      record.credential.secret_ref?.name,
      `provider.${suffixOf(provider)}`,
    );
    assert(record.credential.expires_at !== null);

    // 3. disk: secret 셋
    await core.stop();
    const secrets = await secretsOf(run);
    const name = `provider.${suffixOf(provider)}`;
    assertEquals(secrets[name], access);
    assertEquals(secrets[`${name}.refresh`], refresh);
    assert(secrets[`${name}.meta`] !== undefined);
  });
});

Deno.test("PKCE 로그인이 loopback callback으로 끝나고 code와 token이 secrets.json 밖에 남지 않는다", async () => {
  await withFakes(async ({ run, fake, issuer, core }) => {
    const provider = core.ids.newId("pvd");
    const access = core.ids.newId("key");
    const refresh = core.ids.newId("key");
    const code = core.ids.newId("key");
    const clientId = `oaiapp_${core.ids.newId("key")}`;
    const before = await runtimePids(run.home);

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
      authorization_code: [{
        kind: "tokens",
        access,
        refresh,
        id_token: idToken,
      }],
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
    await until("로그인이 끝남", async () => {
      const step = await core.call(loginComplete, {
        provider,
        login: started.login,
      });
      return step.state === "connected" ? step : undefined;
    }, LOGIN_MS);
    await settle(core, before);

    // 1. 발급자: code 교환에 verifier와 redirect_uri가 있고 jwks를 읽음
    assertEquals(pending.state, "pending");
    const journal = issuer.journal();
    const exchange = journal.filter((entry) => entry.path === "/token");
    assertEquals(exchange.length, 1);
    const form = exchange[0]!.form;
    const verifier = form["code_verifier"];
    assertEquals(form["grant_type"], "authorization_code");
    assertEquals(form["code"], code);
    assertEquals(form["redirect_uri"], redirect);
    assert(verifier !== undefined && verifier.length > 0);
    assertEquals(
      journal.filter((entry) =>
        entry.path === "/jwks" && entry.method === "GET"
      )
        .length,
      1,
    );

    // 2. ledger
    const { provider: record } = await core.call(providerRead, { provider });
    assertEquals(record.credential.kind, "oauth");
    assertEquals(record.credential.state, "available");

    // 3. disk: secrets.json에는 있고 나머지(core.log 포함)에는 없다.
    await core.stop();
    const secrets = await secretsOf(run);
    const name = `provider.${suffixOf(provider)}`;
    assertEquals(secrets[name], access);
    assertEquals(secrets[`${name}.refresh`], refresh);
    assert(secrets[`${name}.meta`] !== undefined);
    assert(secrets["provider-oauth.host-id"] !== undefined);
    for (const value of [code, verifier, access, refresh, idToken]) {
      assertEquals(await filesWith(run.dir, value), []);
    }
  });
});

Deno.test("취소한 로그인의 callback listener가 닫힌다", async () => {
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
    await assertRejects(
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
    assert(!done.ok);
    assertEquals(done.error.code, "not_found");
    // 3. disk: 그 provider의 이름이 없다.
    await core.stop();
    const secrets = await secretsOf(run);
    assertEquals(
      Object.keys(secrets).filter((name) => name.startsWith("provider.")),
      [],
    );
  });
});
