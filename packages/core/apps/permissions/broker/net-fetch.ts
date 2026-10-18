// broker `/_lophn/broker/net/fetch`. 앱에는 외부 net flag가 없고 이 전송부가
// 요청마다 선언∩grant의 정확한 host·port를 검사한 뒤 비동기로 외부 I/O를 한다. redirect는 한 단계마다
// 같은 검사를 다시 받고, 플랫폼 port는 grant가 있어도 loopback 어느 표기에서나 막는다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  brokerNetFetchInputSchema,
  type brokerNetFetchOutputSchema,
} from "../../../../protocol/apps/mod.ts";
import type { z } from "zod";
import {
  type AccessState,
  type BrokerAccess,
  currentAccess,
  invalid,
  liveOnly,
  netGranted,
  normalHost,
  refuse,
  unavailable,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

export type NetFetchOutput = z.infer<typeof brokerNetFetchOutputSchema>;

type NetFetchDeps = {
  access: BrokerAccess;
  // 실제 전송. 기본은 전역 fetch다. redirect는 이 서비스가 직접 따라가므로 manual로 부른다.
  transport?: typeof globalThis.fetch;
  // 정하지 않으면 loopback host는 http, 그 밖은 https다. 시험이 넣는 값이 이긴다.
  scheme?: "https" | "http";
  // 앱이 닿는 loopback에서 막을 플랫폼의 실제 port와 설정 port.
  platformPorts: readonly number[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const NET_FETCH_TIMEOUT_MS = 30_000;
const NET_FETCH_MAX_BYTES = 1_048_576;
const NET_FETCH_MAX_REDIRECTS = 5;

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "::" ||
    host === "0.0.0.0" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

// WHATWG URL의 host는 IPv6를 대괄호로 감싼다. 선언·grant의 host 표기로 되돌린다.
export function urlHost(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function urlPort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

// 목적지 하나(host·port)가 지금 실행 범위와 플랫폼 보호 안에서 허락되는지 본다.
export function destinationAllowed(
  state: AccessState,
  platformPorts: readonly number[],
  host: string,
  port: number,
): boolean {
  if (isLoopbackHost(host) && platformPorts.includes(port)) return false;
  return netGranted(state, host, port);
}

export type NetFetchService = {
  request(child: BrokerChild, body: unknown): Promise<Result<NetFetchOutput>>;
};

function decode(
  bytes: Uint8Array,
  contentType: string,
): NetFetchOutput["body"] {
  const text = new TextDecoder().decode(bytes);
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

async function readCapped(
  response: Response,
  limit: number,
): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(next.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function createNetFetchService(deps: NetFetchDeps): NetFetchService {
  const send = deps.transport ?? globalThis.fetch;
  // 사람이 켠 같은 컴퓨터의 서비스를 부르려는 것이다. 기계 밖으로 나가지 않는 loopback에만 http를 허락한다.
  const schemeFor = (host: string): "https" | "http" =>
    deps.scheme ?? (isLoopbackHost(host) ? "http" : "https");
  const timeout = deps.timeoutMs ?? NET_FETCH_TIMEOUT_MS;
  const limit = deps.maxBytes ?? NET_FETCH_MAX_BYTES;
  const maxRedirects = deps.maxRedirects ?? NET_FETCH_MAX_REDIRECTS;

  return {
    async request(child, body) {
      const parsed = brokerNetFetchInputSchema.safeParse(body);
      if (!parsed.success) return invalid("net fetch input is invalid");
      const input = parsed.data;
      const wanted = { host: input.host, port: input.port };
      const refused = liveOnly(child, "net.fetch", wanted);
      if (refused) return refused;
      const host = normalHost(input.host);
      if (host === undefined) return invalid("host must be an exact host");
      const exact = { host, port: input.port };
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      const state = access.value;
      if (
        state === null ||
        !state.app_api.includes(input.command) ||
        !destinationAllowed(state, deps.platformPorts, host, input.port)
      ) {
        return refuse("net.fetch", exact);
      }
      const method = input.method.toUpperCase();
      if (!METHODS.has(method)) return invalid("method is not supported");
      if (!input.path.startsWith("/")) return invalid("path must be absolute");
      const origin = `${schemeFor(host)}://${
        host.includes(":") ? `[${host}]` : host
      }:${input.port}`;
      let target: URL;
      try {
        target = new URL(input.path, origin);
      } catch {
        return invalid("path is invalid");
      }
      // 경로 문자열이 목적지를 바꾸는 우회(//other, /\other)를 막는다.
      if (target.origin !== new URL(origin).origin) {
        return invalid("path must stay on the granted destination");
      }
      let hops = 0;
      let current = target;
      let currentMethod = method;
      while (true) {
        let response: Response;
        try {
          response = await send(current, {
            method: currentMethod,
            redirect: "manual",
            signal: AbortSignal.timeout(timeout),
            headers: {},
          });
        } catch {
          return unavailable("request failed");
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (location === null) return unavailable("redirect has no target");
          hops += 1;
          if (hops > maxRedirects) return unavailable("too many redirects");
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            return unavailable("redirect target is invalid");
          }
          // redirect는 새 전송이다. 목적지가 grant 밖이거나 scheme이 그 목적지 규칙과 다르거나
          // https에서 http로 내려가면 거절한다. http는 loopback에서 loopback으로만 이어진다.
          if (
            next.protocol !== `${schemeFor(urlHost(next))}:` ||
            (current.protocol === "https:" && next.protocol === "http:") ||
            !destinationAllowed(
              state,
              deps.platformPorts,
              urlHost(next),
              urlPort(next),
            )
          ) {
            return refuse("net.fetch", {
              host: urlHost(next),
              port: urlPort(next),
            });
          }
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) &&
              currentMethod !== "GET" && currentMethod !== "HEAD")
          ) {
            currentMethod = "GET";
          }
          current = next;
          continue;
        }
        const bytes = await readCapped(response, limit);
        if (bytes === undefined) return unavailable("response is too large");
        return ok({
          status: response.status,
          body: decode(bytes, response.headers.get("content-type") ?? ""),
        });
      }
    },
  };
}
