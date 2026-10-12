// settings 통로 test가 같이 쓰는 가짜 core. 부른 route·입력·비교 기준을 모두 기록하고 답은 route별로
// 정한다. 답이 없는 route는 not_found다.
import { assert } from "@std/assert";

import { ALL_ROUTES } from "../../../../../../../packages/contracts/mod.ts";
import type { CoreCall } from "../../../../../ipc/core.ts";
import type { CoreReply } from "../../../../../ipc/core-api.ts";
import type { CoreSource } from "../../../connection/connection.ts";

export interface FakeCore {
  readonly core: CoreSource;
  readonly calls: CoreCall[];
}

export function fakeCore(
  answers: Record<string, (body: unknown) => CoreReply>,
): FakeCore {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const key = `${input.kind}:${input.resource}/${input.method}`;
        const answer = answers[key];
        return Promise.resolve(
          answer === undefined
            ? { ok: false, error: { code: "not_found", message: key } }
            : answer(input.body),
        );
      },
    },
  };
}

/** 보낸 모든 call이 contract route의 input·compare schema를 그대로 통과한다. */
export function assertCallsFitRoutes(calls: readonly CoreCall[]): void {
  assert(calls.length > 0, "at least one call was made");
  for (const call of calls) {
    const found = ALL_ROUTES.find((candidate) =>
      candidate.kind === call.kind && candidate.resource === call.resource &&
      candidate.method === call.method
    ) as unknown as {
      input: { safeParse(value: unknown): { success: boolean } };
      compare?: { safeParse(value: unknown): { success: boolean } };
    } | undefined;
    assert(found !== undefined, `${call.resource}/${call.method} is a route`);
    const body = call.body as Record<string, unknown>;
    const input = call.kind === "command" ? body.input : body;
    assert(
      found.input.safeParse(input).success,
      `${call.resource}/${call.method} input fits its schema`,
    );
    if (call.kind === "command" && found.compare !== undefined) {
      assert(
        found.compare.safeParse(body.compare).success,
        `${call.resource}/${call.method} compare fits its schema`,
      );
    }
  }
}

export const ok = (value: unknown): CoreReply => ({ ok: true, value });

export const fail = (code: string): CoreReply => ({
  ok: false,
  error: { code, message: code },
});

export function settingsAnswers(
  servers: unknown[],
  folders: string[] = [],
): Record<string, (body: unknown) => CoreReply> {
  return {
    "read:settings/definitions": () =>
      ok({
        definitions: [
          {
            key: "shell.os_notifications",
            description: "Show a desktop notification.",
            default_present: true,
            default: false,
          },
          {
            key: "lophn-agent.extensions.skill_folders",
            description: "Folders.",
            default_present: true,
            default: [],
          },
          {
            key: "lophn-agent.extensions.mcp_servers",
            description: "Servers.",
            default_present: true,
            default: [],
          },
          { key: "unset.one", description: "Unset.", default_present: false },
        ],
        defaults_revision: "d1",
      }),
    "read:settings/get": () =>
      ok({
        settings: [
          {
            key: "shell.os_notifications",
            resolved: true,
            value: true,
            source_layer: "common",
            apply_at: "current_check",
          },
          {
            key: "lophn-agent.extensions.skill_folders",
            resolved: true,
            value: folders,
            source_layer: folders.length === 0 ? "builtin" : "common",
            apply_at: "next_run",
          },
          {
            key: "lophn-agent.extensions.mcp_servers",
            resolved: true,
            value: servers,
            source_layer: servers.length === 0 ? "builtin" : "common",
            apply_at: "next_run",
          },
          {
            key: "unset.one",
            resolved: false,
            value: null,
            source_layer: null,
            apply_at: "next_run",
          },
        ],
        revision: 7,
        defaults_revision: "d1",
      }),
    "read:secrets/list": (body) =>
      ok({
        secrets: (body as { names: string[] }).names.map((name) => ({
          name,
          configured: name === "mcp-notes",
          revision: name === "mcp-notes" ? 1 : null,
        })),
      }),
    "command:settings/apply": () =>
      ok({ revision: 8, changed: true, applied: [] }),
  };
}

export function settingsCore(servers: unknown[], folders: string[] = []) {
  return fakeCore(settingsAnswers(servers, folders));
}

export const HTTP_SERVER = (name: string, kind: string, ref?: string) => ({
  name,
  revision: 1,
  enabled: true,
  call_timeout_ms: 60_000,
  classifications: {},
  transport: "http",
  http: {
    url: "https://tools.example.com",
    headers: {},
    auth: { kind, ...(ref === undefined ? {} : { secret_ref: ref }) },
  },
});

/** OAuth 로그인을 쓰는 전역 server. tokenRef가 null이면 아직 로그인하지 않았다. */
export const OAUTH_SERVER = (
  name: string,
  tokenRef: string | null,
  enabled = true,
) => ({
  name,
  revision: 1,
  enabled,
  call_timeout_ms: 60_000,
  classifications: {},
  transport: "http",
  http: {
    url: "https://tools.example.com",
    headers: {},
    auth: {
      kind: "oauth2",
      issuer: "https://auth.example.com",
      client_id: "lophn-client",
      client_secret_ref: null,
      scopes: ["read", "write"],
      token_ref: tokenRef,
    },
  },
});
