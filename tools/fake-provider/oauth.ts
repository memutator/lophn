// OAuth 흉내. token 원문은 합성 상수이고 요청 log에는 남기지 않는다.
// 시계는 주입받아 device code 만료를 실제 대기 없이 지난다.
import type { StepResponse } from "./types.ts";

export type OAuthOptions = {
  nowMs: () => number;
  randomBytes?: () => Uint8Array;
  // 성공 전 poll 순서. 없으면 바로 성공한다.
  devicePolls?: Array<"authorization_pending" | "slow_down">;
  // 이 시각(ms) 이후의 poll은 expired.
  deviceExpiresAtMs?: number;
  // refresh 요청이 새 refresh token을 돌려준다.
  rotateRefresh?: boolean;
};

type Client = { redirectUris: string[] };

const CODE = "synthetic-auth-code";
const DEVICE = "synthetic-device-code";

function token(prefix: string, bytes: Uint8Array): string {
  return `${prefix}-${
    [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  }`;
}

function json(status: number, body: unknown): StepResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function pkce(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  );
}

export class OAuth {
  #options: OAuthOptions;
  #clients = new Map<string, Client>();
  #challenges = new Map<string, string>();
  #polls = 0;
  #refreshCount = 0;

  constructor(options: OAuthOptions) {
    this.#options = options;
  }

  refreshCount(): number {
    return this.#refreshCount;
  }

  async handle(
    method: string,
    path: string,
    body: unknown,
    query: URLSearchParams,
  ): Promise<StepResponse | undefined> {
    if (method === "GET" && path === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: "http://fake.local",
        authorization_endpoint: "/oauth/authorize",
        token_endpoint: "/oauth/token",
        device_authorization_endpoint: "/oauth/device",
        registration_endpoint: "/oauth/register",
        grant_types_supported: [
          "authorization_code",
          "refresh_token",
          "urn:ietf:params:oauth:grant-type:device_code",
        ],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (method === "POST" && path === "/oauth/register") {
      return this.#register(body);
    }
    if (method === "GET" && path === "/oauth/authorize") {
      return this.#authorize(query);
    }
    if (method === "POST" && path === "/oauth/device") return this.#device();
    if (method === "POST" && path === "/oauth/token") {
      return await this.#token(body);
    }
    return undefined;
  }

  #register(body: unknown): StepResponse {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid_client_metadata" });
    }
    const record = body as { redirect_uris?: unknown; client_name?: unknown };
    if (
      !Array.isArray(record.redirect_uris) ||
      typeof record.client_name !== "string"
    ) {
      return json(400, { error: "invalid_client_metadata" });
    }
    const id = `client-${this.#clients.size + 1}`;
    this.#clients.set(id, { redirectUris: record.redirect_uris.map(String) });
    return json(201, { client_id: id, client_name: record.client_name });
  }

  #authorize(query: URLSearchParams): StepResponse {
    const client = this.#clients.get(query.get("client_id") ?? "");
    const redirect = query.get("redirect_uri") ?? "";
    const state = query.get("state");
    const challenge = query.get("code_challenge");
    if (
      !client || !client.redirectUris.includes(redirect) || !state ||
      challenge === null
    ) {
      return json(400, { error: "invalid_request" });
    }
    if (query.get("code_challenge_method") !== "S256") {
      return json(400, { error: "invalid_request" });
    }
    this.#challenges.set(state, challenge);
    const location = `${redirect}?code=${CODE}&state=${
      encodeURIComponent(state)
    }`;
    return { status: 302, headers: { location }, body: "" };
  }

  #device(): StepResponse {
    return json(200, {
      device_code: DEVICE,
      user_code: "SYNTHETIC",
      verification_uri: "http://127.0.0.1/device",
      expires_in: 300,
      interval: 0,
    });
  }

  async #token(body: unknown): Promise<StepResponse> {
    const fields = body && typeof body === "object"
      ? body as Record<string, string>
      : {};
    if (Object.values(fields).some((value) => typeof value !== "string")) {
      return json(400, { error: "invalid_request" });
    }
    if (fields.grant_type === "refresh_token") return this.#refresh(fields);
    if (fields.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
      return this.#poll(fields);
    }
    return await this.#exchange(fields);
  }

  async #exchange(fields: Record<string, string>): Promise<StepResponse> {
    const challenge = this.#challenges.get(fields.state ?? "");
    if (!challenge || !fields.code_verifier) {
      return json(400, { error: "invalid_grant" });
    }
    if (await pkce(fields.code_verifier) !== challenge) {
      return json(400, { error: "invalid_grant" });
    }
    this.#challenges.delete(fields.state ?? "");
    return json(200, {
      token_type: "bearer",
      access_token: this.#tokenValue("access"),
      refresh_token: this.#tokenValue("refresh"),
      expires_in: 3600,
    });
  }

  #refresh(fields: Record<string, string>): StepResponse {
    if (!fields.refresh_token?.startsWith("refresh-")) {
      return json(400, { error: "invalid_grant" });
    }
    this.#refreshCount += 1;
    const next = this.#options.rotateRefresh
      ? this.#tokenValue("refresh")
      : fields.refresh_token;
    return json(200, {
      token_type: "bearer",
      access_token: this.#tokenValue("access"),
      refresh_token: next,
      expires_in: 3600,
      rotated: this.#options.rotateRefresh === true,
    });
  }

  #tokenValue(prefix: string): string {
    return token(
      prefix,
      this.#options.randomBytes?.() ??
        crypto.getRandomValues(new Uint8Array(16)),
    );
  }

  #poll(fields: Record<string, string>): StepResponse {
    if (fields.device_code !== DEVICE) {
      return json(400, { error: "invalid_grant" });
    }
    const expires = this.#options.deviceExpiresAtMs;
    if (expires !== undefined && this.#options.nowMs() >= expires) {
      return json(400, { error: "expired_token" });
    }
    const planned = this.#options.devicePolls?.[this.#polls++];
    if (planned) return json(400, { error: planned });
    return json(200, {
      token_type: "bearer",
      access_token: this.#tokenValue("access"),
      refresh_token: this.#tokenValue("refresh"),
      expires_in: 3600,
    });
  }
}
