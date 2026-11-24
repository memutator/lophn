// CLI가 core를 부르는 client다.
// POST /<resource>/<method>에 Authorization bearer(control connect가 준 user 자격 또는 agent turn 자격)로 붙고
// 쓰기는 idempotency key를 전달한다. 쓰기 응답을 잃으면 성공·domain 실패로 추측하지
// 않고 effect_unknown 진단과 원래 key·commands/result 대상 read 안내를 돌려준다.
import { request as httpRequest } from "node:http";
import type { LophnError } from "../../../base/mod.ts";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { CommandRoute, Route } from "../../../protocol/base/mod.ts";
import {
  createRpcClient,
  type RpcFetch,
} from "../../../protocol/client/mod.ts";
import { commandsResult } from "../../../protocol/server/mod.ts";

// Node의 기본 fetch(undici)는 headersTimeout이 5분(300s)이라 사람 승인·secret 입력을 기다리는
// CLI core 호출이 5분 뒤 끊긴다. http:// loopback 호출은 `node:http`로 timeout 없이 기다린다.
const nodeHttpRpcFetch: RpcFetch = (input, init) => {
  const url = new URL(input);
  if (url.protocol !== "http:") {
    return fetch(input, init).then(async (response) => ({
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    }));
  }
  return new Promise((resolve, reject) => {
    const body =
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? Buffer.from(init.body, "utf8")
          : Buffer.from(init.body);
    const reqHeaders: Record<string, string> = { ...init.headers };
    if (body !== undefined && reqHeaders["content-length"] === undefined) {
      reqHeaders["content-length"] = String(body.byteLength);
    }
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port === "" ? 80 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: init.method,
        agent: false,
        timeout: 0,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        res.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const one of value) headers.append(key, one);
            } else {
              headers.set(key, value);
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            bytes: new Uint8Array(Buffer.concat(chunks)),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(0);
    req.on("error", reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
};

type CoreClientOptions = {
  baseUrl: string;
  // control connect가 준 user 자격 또는 agent turn 자격이다.
  token: string;
  fetch?: RpcFetch;
};

export type CoreClient = {
  baseUrl: string;
  // command route를 envelope로 보낸다. 응답을 잃어 effect_unknown이면
  // 원래 key로 /commands/result를 다시 본다.
  // compare·prepared는 소유 route가 요구하는 CAS 비교와 준비 참조다.
  command<R extends CommandRoute>(
    route: R,
    body: {
      input: unknown;
      idempotency_key: string;
      compare?: unknown;
      prepared?: readonly string[];
    },
  ): Promise<Result<unknown>>;
  // read·memory route는 envelope 없이 입력을 그대로 보낸다. 쓰기가 아니므로
  // 응답을 잃어도 effect_unknown이 아니라 전송 실패(unavailable)다.
  read(route: Route, input: unknown): Promise<Result<unknown>>;
};

// 쓰기 응답 유실 진단이다. 원래 key와 대상 read 안내를 details에 남긴다.
function effectUnknown(idempotencyKey: string, subject: string): LophnError {
  return {
    code: "unavailable",
    message: "쓰기 응답을 잃어 효과를 모른다",
    details: {
      diagnosis: "effect_unknown",
      idempotency_key: idempotencyKey,
      subject,
      read: "commands/result",
    },
  };
}

export function createCoreClient(options: CoreClientOptions): CoreClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const fetchImpl: RpcFetch = options.fetch ?? nodeHttpRpcFetch;
  const rpcClient = createRpcClient({
    baseUrl: base,
    token: options.token,
    fetch: fetchImpl,
  });

  return {
    baseUrl: options.baseUrl,
    async command(route, body) {
      const client = rpcClient;
      // command 계약의 envelope은 strict object다. 호출자가 주지 않은 compare·
      // prepared는 계약 기본값으로 채운다.
      const sent = await client.call(route, {
        input: body.input,
        idempotency_key: body.idempotency_key,
        compare: body.compare ?? {},
        prepared: body.prepared ?? [],
      } as never);
      if (sent.ok) return sent;
      const failed = sent.error;
      // transport 유실은 command 결과를 같은 key로 다시 본다. 성공·domain
      // 실패로 추측하지 않는다.
      if (
        failed.code === "unavailable" &&
        failed.details?.reason === "transport_failed" &&
        route.kind === "command"
      ) {
        const looked = await client.call(commandsResult, {
          idempotency_key: body.idempotency_key,
        } as never);
        if (looked.ok) {
          const stored = (
            looked.value as { result: { result: unknown } | null }
          ).result;
          if (stored !== null) return ok(stored.result);
        }
        return err(effectUnknown(body.idempotency_key, route.resource));
      }
      return err(failed);
    },
    async read(route, input) {
      if (route.kind === "command") {
        return err({
          code: "invalid_input",
          message: "command route는 read로 보낼 수 없다",
        });
      }
      return rpcClient.call(route, input as never);
    },
  };
}
