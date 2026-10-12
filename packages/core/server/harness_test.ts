import { assert } from "@std/assert";
import { manualClock, type Result, seededRandom } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "./identity/mod.ts";
import {
  type ApiServer,
  type ApiServerOptions,
  startApiServer,
} from "./mod.ts";

export const POLICIES: OperationPolicy[] = [
  {
    name: "identity/current",
    actors: ["user", "machine"],
    kind: "read",
  },
  { name: "task/result", actors: ["machine"], kind: "command" },
];

export const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: { operations: ["identity/current"], targets: {} },
  conditions: { process: "main-generation" },
};

export function value<T>(result: Result<T>): T {
  assert(result.ok);
  return result.value;
}

export function registry(): {
  clock: ReturnType<typeof manualClock>;
  credentials: CredentialRegistry;
} {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  return {
    clock,
    credentials: new CredentialRegistry({
      epoch: "core-one",
      clock,
      random: seededRandom(5),
      operations: POLICIES,
    }),
  };
}

export async function listen(
  options: Partial<ApiServerOptions> & { token?: string } = {},
): Promise<{ server: ApiServer; base: string; token: string }> {
  const made = registry();
  const credentials = options.credentials ?? made.credentials;
  const issued = options.token !== undefined
    ? { token: options.token }
    : value(await credentials.issue(USER));
  const { token: _given, ...rest } = options;
  const server = await startApiServer({
    port: 0,
    clock: rest.clock ?? made.clock,
    ...rest,
    credentials,
  });
  return {
    server,
    base: `http://127.0.0.1:${server.port}`,
    token: issued.token,
  };
}

export type CallInit = RequestInit & { token?: string; host?: string };

export async function call(
  base: string,
  path: string,
  init: CallInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.host) headers.set("host", init.host);
  const rest: RequestInit = {
    method: init.method,
    body: init.body,
    headers,
  };
  return await fetch(`${base}${path}`, rest);
}

export type { AuthenticatedContext };
