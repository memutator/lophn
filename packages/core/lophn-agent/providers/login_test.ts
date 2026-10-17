import { assertEquals } from "@std/assert";
import { err, ok, seededRandom } from "../../../base/mod.ts";
import type { ProviderDefinition } from "../../../protocol/lophn-agent/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { withProviderLogin } from "./login.ts";

const NOW = Date.parse("2026-10-17T00:00:00.000Z");
const PROVIDER = "pvd_01h455vb4pex5v6nkc6gd5fd12";
const ISSUER = "http://127.0.0.1:1";
const CLIENT = "oaiapp_issued";
const USER = {
  principal: "user:local",
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};

// 내장 ChatGPT 정의의 발급자 주소만 loopback fake로 바꾼다.
function chatgpt(): ProviderDefinition {
  const builtin = builtinProviderDefinition("openai");
  if (!builtin.ok || builtin.value.oauth?.product !== "chatgpt") {
    throw new Error("내장 openai 정의에 ChatGPT 로그인이 없다");
  }
  return {
    ...builtin.value,
    oauth: {
      ...builtin.value.oauth,
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    },
  };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
}

const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);

async function idToken(claims: Record<string, unknown>): Promise<string> {
  const part = (value: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${part({ alg: "RS256", kid: "k1" })}.${part(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

type Case = {
  name: string;
  state?: (state: string) => string;
  nonce?: (nonce: string) => string;
  audience?: string;
  scope?: string;
  connect?: "unavailable";
  expected: string;
};

// 한 시도: begin → 사람이 browser에서 돌아온 callback → complete. 발급자, listener, writer, secret 저장소는 가짜다.
async function attempt(c: Case) {
  const secrets = new Map<string, string>();
  const commands: { command: string; input: unknown }[] = [];
  const writer: Writer = {
    command(_ctx, envelope) {
      commands.push({ command: envelope.command, input: envelope.input });
      if (c.connect !== undefined) {
        return Promise.resolve(err({ code: c.connect, message: "가짜 실패" }));
      }
      const input = envelope.input as Record<string, unknown>;
      return Promise.resolve(ok({
        result: {
          provider: {
            id: input.id,
            name: input.name,
            definition: input.definition,
            endpoint: input.endpoint,
            protocol: input.protocol,
            credential: {
              kind: "oauth",
              secret_ref: {
                name: (input.credential as { secret: string }).secret,
              },
              revision: 1,
              state: "available",
              unavailable_reason: null,
              until: null,
              expires_at: input.expires_at,
              logged_in_at: new Date(NOW).toISOString(),
              refreshed_at: null,
              model_blocks: [],
            },
            revision: 1,
          },
        },
        replayed: false,
        first_seq: null,
        last_seq: null,
        wake: false,
      }));
    },
    readResult: () => Promise.resolve(ok(null)),
    close: () => Promise.resolve(),
  };
  let deliver: (callback: { code: string; state: string }) => void = () => {};
  const received = new Promise<{ code: string; state: string }>((resolve) => {
    deliver = resolve;
  });
  // begin이 만든 authorize 주소다. 가짜 발급자가 그 nonce로 id_token을 만든다.
  const seen: { authorize?: URL } = {};
  const login = withProviderLogin(writer, {
    async http(url) {
      if (url === `${ISSUER}/jwks`) {
        return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
      }
      return Response.json({
        access_token: "ACCESS-VALUE",
        refresh_token: "REFRESH-VALUE",
        expires_in: 3600,
        scope: c.scope ??
          "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        id_token: await idToken({
          iss: ISSUER,
          aud: c.audience ?? CLIENT,
          exp: NOW / 1000 + 3600,
          nonce: (c.nonce ?? ((value) => value))(
            seen.authorize!.searchParams.get("nonce")!,
          ),
          sub: "user-1",
        }),
      });
    },
    openListener: () =>
      Promise.resolve(ok({
        port: () => 1,
        receive: () =>
          received.then((callback) =>
            ok({ ...callback, iss: null, client_id: CLIENT })
          ),
        close: () => Promise.resolve(),
      })),
    secrets: {
      get: (name) =>
        secrets.has(name)
          ? ok(secrets.get(name)!)
          : err({ code: "not_found", message: "없다" }),
      put: (name, value) => {
        secrets.set(name, String(value));
        return Promise.resolve(ok({ names: [] }) as never);
      },
      delete: (name) => {
        secrets.delete(name);
        return Promise.resolve(ok({ names: [] }) as never);
      },
    },
    newKey: () => "key",
    nowMs: () => NOW,
    random: seededRandom(7),
  });
  const run = (command: string, input: unknown) =>
    login.command(USER, {
      command,
      input,
      idempotency_key: "key",
      compare: {},
      prepared: [],
    });
  const begun = await run("BeginProviderLogin", {
    provider: PROVIDER,
    name: "OpenAI",
    definition: chatgpt(),
    endpoint: "https://api.openai.com/v1",
    protocol: "openai-responses",
  });
  if (!begun.ok) throw new Error(begun.error.message);
  const started = begun.value.result as {
    login: string;
    sign_in: { url: string };
  };
  const authorize = new URL(started.sign_in.url);
  seen.authorize = authorize;
  deliver({
    code: "CODE",
    state: (c.state ?? ((value) => value))(
      authorize.searchParams.get("state")!,
    ),
  });
  // listener의 callback이 세션에 닿을 때까지 한 차례 넘긴다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const done = await run("CompleteProviderLogin", {
    provider: PROVIDER,
    login: started.login,
  });
  return {
    code: done.ok
      ? (done.value.result as { state: string }).state
      : done.error.code,
    tokens: [...secrets.keys()].filter((name) => name.startsWith("provider.")),
    connects: commands.filter((entry) => entry.command === "ConnectProvider"),
  };
}

Deno.test("ChatGPT 로그인은 검증이 틀리거나 연결이 실패하면 secret과 provider를 남기지 않는다", async () => {
  const good = await attempt({ name: "맞는 callback", expected: "connected" });
  assertEquals(good.code, "connected");
  assertEquals(good.tokens.sort(), [
    "provider.01h455vb4pex5v6nkc6gd5fd12",
    "provider.01h455vb4pex5v6nkc6gd5fd12.meta",
    "provider.01h455vb4pex5v6nkc6gd5fd12.refresh",
  ]);
  const input = good.connects[0]?.input as Record<string, unknown>;
  assertEquals(
    [input.auth_kind, input.credential, input.expires_at],
    [
      "oauth",
      { secret: "provider.01h455vb4pex5v6nkc6gd5fd12" },
      new Date(NOW + 3_600_000).toISOString(),
    ],
  );

  const refused: Case[] = [
    {
      name: "다른 시도의 state",
      state: (value) => `${value}x`,
      expected: "forbidden",
    },
    {
      name: "id_token의 nonce가 다르다",
      nonce: (value) => `${value}x`,
      expected: "forbidden",
    },
    {
      name: "id_token의 audience가 다른 client다",
      audience: "oaiapp_other",
      expected: "forbidden",
    },
    {
      name: "plan usage scope가 없다",
      scope: "openid profile email offline_access",
      expected: "forbidden",
    },
    {
      name: "Connect가 실패한다",
      connect: "unavailable",
      expected: "unavailable",
    },
  ];
  for (const c of refused) {
    const got = await attempt(c);
    assertEquals(
      [c.name, got.code, got.tokens, got.connects.length],
      [c.name, c.expected, [], c.connect === undefined ? 0 : 1],
    );
  }
});
