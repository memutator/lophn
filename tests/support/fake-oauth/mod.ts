// 구독 provider 로그인 E2E가 발급자 자리에 쓰는 fake OAuth 발급자. device authorization,
// token(authorization_code·device_code·refresh_token grant), jwks 셋만 말한다. 발급자 주소는 provider
// 정의 data라 정의만 이 주소로 채우면 core는 진짜 발급자와 똑같이 부른다.
// 줄을 못 맞춘 요청(빈 queue, 모르는 path·grant, 빠진 form 값)은 HTTP 400으로 답하고 journal에 차이를 남긴다.
// 500 계열은 core가 unavailable로 읽어 test가 헷갈려서 쓰지 않는다.

import type {
  OAuthDefinition,
  ProviderDefinition,
} from "../../../packages/protocol/lophn-agent/mod.ts";

export type IssuerReply =
  | {
    kind: "tokens";
    access: string;
    refresh: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  }
  | { kind: "pending" }
  | { kind: "error"; status: number; error: string };

export type IssuerScript = {
  device?: {
    device_code: string;
    user_code: string;
    interval?: number;
    expires_in?: number;
  };
  authorization_code?: IssuerReply[];
  device_code?: IssuerReply[];
  refresh_token?: IssuerReply[];
};

export type IssuerJournalEntry = {
  n: number;
  at: number;
  method: string;
  path: string;
  form: Record<string, string>;
  step: number | null;
  mismatch: string | null;
};

export type IssuerHandler = {
  /** startFakeIssuer가 port를 알면 채운다. handler만 쓰는 unit은 이 기본값을 본다. */
  url: string;
  definition(product: "chatgpt" | "supergrok"): ProviderDefinition;
  script(steps: IssuerScript): void;
  idToken(
    claims: { aud: string; nonce: string; sub?: string; exp?: number },
  ): Promise<string>;
  journal(): readonly IssuerJournalEntry[];
  handle(request: Request): Promise<Response>;
};

export type FakeIssuer = IssuerHandler & { close(): Promise<void> };

const KID = "e2e";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
// core가 chatgpt에서 요구하는 scope 하나가 들어 있다. supergrok은 받은 scope를 읽지 않아 같은 값이어도 된다.
const GRANTED_SCOPE = "openid offline_access chatgpt.tokens.use.direct";
const REQUIRED: Record<string, readonly string[]> = {
  authorization_code: [
    "client_id",
    "code",
    "code_verifier",
    "redirect_uri",
    "resource",
  ],
  [DEVICE_GRANT]: ["client_id", "device_code"],
  refresh_token: ["client_id", "refresh_token"],
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// socket 없이 request를 직접 넣을 수 있는 몸체. startFakeIssuer가 Deno.serve를 얹는다.
export function createFakeIssuerHandler(): IssuerHandler {
  const keys = crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  let steps: IssuerScript = {};
  let taken: Record<string, number> = {};
  const entries: IssuerJournalEntry[] = [];

  function nextReply(
    grant: "authorization_code" | "device_code" | "refresh_token",
    entry: IssuerJournalEntry,
  ): IssuerReply | string {
    const queue = steps[grant] ?? [];
    const index = taken[grant] ?? 0;
    const reply = queue[index];
    if (reply === undefined) {
      return `no scripted ${grant} reply left for request ${entry.n}`;
    }
    taken[grant] = index + 1;
    entry.step = index;
    return reply;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = await request.text();
    const entry: IssuerJournalEntry = {
      n: entries.length + 1,
      at: Date.now(),
      method: request.method,
      path: url.pathname,
      form: Object.fromEntries(new URLSearchParams(text)),
      step: null,
      mismatch: null,
    };
    entries.push(entry);
    const miss = (message: string) => {
      entry.mismatch = message;
      return json(400, {
        error: "invalid_request",
        error_description: message,
      });
    };
    const expect = (method: string, path: string) =>
      entry.method === method && entry.path === path;

    if (expect("GET", "/jwks")) {
      const jwk = await crypto.subtle.exportKey(
        "jwk",
        (await keys).publicKey,
      );
      return json(200, {
        keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }],
      });
    }
    if (expect("POST", "/device/code")) {
      const device = steps.device;
      if (device === undefined) return miss("no scripted device start");
      entry.step = 0;
      return json(200, {
        device_code: device.device_code,
        user_code: device.user_code,
        verification_uri: `${handler.url}/verify`,
        interval: device.interval ?? 0.1,
        expires_in: device.expires_in ?? 300,
      });
    }
    if (!expect("POST", "/token")) {
      return miss(`unknown request ${entry.method} ${entry.path}`);
    }
    const grant = entry.form["grant_type"] ?? "";
    const required = REQUIRED[grant];
    if (required === undefined) return miss(`unknown grant_type "${grant}"`);
    const absent = required.filter((name) => !entry.form[name]);
    if (absent.length > 0) {
      return miss(`${grant} request lacks ${absent.join(", ")}`);
    }
    if (
      grant === DEVICE_GRANT && steps.device !== undefined &&
      entry.form["device_code"] !== steps.device.device_code
    ) {
      return miss("device_code is not the one this issuer handed out");
    }
    const reply = nextReply(
      grant === DEVICE_GRANT
        ? "device_code"
        : grant as "authorization_code" | "refresh_token",
      entry,
    );
    if (typeof reply === "string") return miss(reply);
    if (reply.kind === "pending") {
      return json(400, { error: "authorization_pending" });
    }
    if (reply.kind === "error") {
      return json(reply.status, { error: reply.error });
    }
    return json(200, {
      access_token: reply.access,
      refresh_token: reply.refresh,
      token_type: "Bearer",
      expires_in: reply.expires_in ?? 3600,
      scope: reply.scope ?? GRANTED_SCOPE,
      ...(reply.id_token === undefined ? {} : { id_token: reply.id_token }),
    });
  }

  const handler: IssuerHandler = {
    url: "http://issuer.test",
    definition(product) {
      const oauth: OAuthDefinition = product === "chatgpt"
        ? {
          product,
          issuer: handler.url,
          authorization_endpoint: `${handler.url}/authorize`,
          token_endpoint: `${handler.url}/token`,
          jwks_uri: `${handler.url}/jwks`,
          resource: `${handler.url}/resource`,
          scopes: ["openid", "offline_access", "chatgpt.tokens.use.direct"],
        }
        : {
          product,
          client_id: "e2e-client",
          device_authorization_endpoint: `${handler.url}/device/code`,
          token_endpoint: `${handler.url}/token`,
          scopes: ["openid", "offline_access"],
        };
      return {
        key: "anthropic",
        display_name: "Fake Anthropic",
        protocols: ["anthropic-messages"],
        auth_kinds: ["oauth"],
        models_endpoint: null,
        oauth,
        revision: "e2e",
      };
    },
    script(next) {
      steps = {
        ...next,
        authorization_code: [...(next.authorization_code ?? [])],
        device_code: [...(next.device_code ?? [])],
        refresh_token: [...(next.refresh_token ?? [])],
      };
      taken = {};
    },
    async idToken(claims) {
      const part = (value: unknown) =>
        base64url(new TextEncoder().encode(JSON.stringify(value)));
      const input = `${part({ alg: "RS256", kid: KID, typ: "JWT" })}.${
        part({
          iss: handler.url,
          aud: claims.aud,
          nonce: claims.nonce,
          sub: claims.sub ?? "e2e-subject",
          exp: claims.exp ?? Math.floor(Date.now() / 1000) + 3600,
        })
      }`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        (await keys).privateKey,
        new TextEncoder().encode(input),
      );
      return `${input}.${base64url(new Uint8Array(signature))}`;
    },
    journal: () => entries,
    handle,
  };
  return handler;
}

export function startFakeIssuer(): Promise<FakeIssuer> {
  const issuer = createFakeIssuerHandler();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    issuer.handle,
  );
  // definition·idToken이 handler.url을 읽으므로 같은 object에 port를 채워 돌려준다.
  issuer.url = `http://127.0.0.1:${server.addr.port}`;
  return Promise.resolve(Object.assign(issuer, {
    close: () => server.shutdown(),
  }));
}
