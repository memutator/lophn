// CLI가 core를 부르는 client다.
// POST /<resource>/<method>에 Authorization bearer(coding token 또는 user token)로 붙고 쓰기는
// idempotency key를 전달한다. 쓰기 응답을 잃으면 성공·domain 실패로 추측하지
// 않고 effect_unknown 진단과 원래 key·commands/result 대상 read 안내를 돌려준다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import { commandsResult } from "../../../protocol/server/mod.ts";
import type { CommandRoute, Route } from "../../../protocol/base/mod.ts";
import {
  createRpcClient,
  type RpcFetch,
} from "../../../protocol/client/mod.ts";

type CoreClientOptions = {
  baseUrl: string;
  // `LOPHN_CODING_TOKEN`의 값 또는 user token file의 내용이다.
  token: string;
  // coding token(앱 하나 범위)이면 참이다. 참일 때만 `not_found`를 "범위 밖" 글로 바꾼다.
  appScoped: boolean;
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

// 없는 대상과 이 token 범위 밖 대상은 같은 답이다. core가 준 not_found의 메시지·details를
// 버려 존재 여부가 새지 않게 한다.
const UNREADABLE_MESSAGE =
  "현재 token으로 읽을 수 없다. 없는 대상이거나 이 앱 범위 밖이다";

function sameAsAbsent<T>(result: Result<T>): Result<T> {
  if (result.ok || result.error.code !== "not_found") return result;
  return err({ code: "not_found", message: UNREADABLE_MESSAGE });
}

export function createCoreClient(options: CoreClientOptions): CoreClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const fetchImpl: RpcFetch =
    options.fetch ??
    ((input, init) =>
      fetch(input, init).then(async (response) => ({
        status: response.status,
        headers: response.headers,
        bytes: new Uint8Array(await response.arrayBuffer()),
      })));
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
      return options.appScoped ? sameAsAbsent(err(failed)) : err(failed);
    },
    async read(route, input) {
      if (route.kind === "command") {
        return err({
          code: "invalid_input",
          message: "command route는 read로 보낼 수 없다",
        });
      }
      const result = await rpcClient.call(route, input as never);
      return options.appScoped ? sameAsAbsent(result) : result;
    },
  };
}
