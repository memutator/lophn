// MCP·CLI가 같은 core client를 쓰는 자리(connection#R15, cli#R1).
// POST /v1/<resource>/<method>에 Authorization bearer로 붙고 쓰기는
// idempotency key를 전달한다. 쓰기 응답을 잃으면 성공·domain 실패로 추측하지
// 않고 effect_unknown 진단과 원래 key·commands/result 대상 read 안내를 돌려준다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import {
  type ConnectionId,
  connectionIdSchema,
} from "../../../contracts/coding-agent/mod.ts";
import { effectUnknownSchema } from "../../../contracts/coding-agent/mod.ts";
import type { EffectUnknown } from "../../../contracts/coding-agent/mod.ts";
import {
  commandsResult,
  createRpcClient,
  type RpcFetch,
} from "../../../contracts/platform/mod.ts";
import type { CommandRoute, Route } from "../../../contracts/platform/mod.ts";
import type { CredentialProvider } from "../credential/provider.ts";

export type CoreClientOptions = {
  baseUrl: string;
  provider: CredentialProvider;
  connection: ConnectionId;
  fetch?: RpcFetch;
};

export type CoreClient = {
  connection: ConnectionId;
  baseUrl: string;
  // command route를 envelope로 보낸다. 응답을 잃어 effect_unknown이면
  // 원래 key로 /v1/commands/result를 다시 본다.
  // compare·prepared는 소유 route가 요구하는 CAS 비교와 준비 참조다(문서 저장).
  command<R extends CommandRoute>(
    route: R,
    body: {
      input: unknown;
      idempotency_key: string;
      compare?: unknown;
      prepared?: readonly string[];
    },
  ): Promise<Result<unknown>>;
  // read·worker route는 envelope 없이 입력을 그대로 보낸다. 쓰기가 아니므로
  // 응답을 잃어도 effect_unknown이 아니라 전송 실패(unavailable)다.
  read(route: Route, input: unknown): Promise<Result<unknown>>;
};

// 쓰기 응답 유실 진단(architecture 8의 effect_unknown·exit6). 원래 key와
// 대상 read 안내를 details에 남긴다.
export function effectUnknown(
  idempotencyKey: string,
  subject: string,
): EffectUnknown {
  return effectUnknownSchema.parse({
    code: "unavailable",
    message: "쓰기 응답을 잃어 효과를 모른다",
    details: {
      diagnosis: "effect_unknown",
      idempotency_key: idempotencyKey,
      subject,
      read: "commands/result",
    },
  });
}

export function isEffectUnknown(
  error: LophnError,
): error is EffectUnknown & LophnError {
  return effectUnknownSchema.safeParse(error).success;
}

export function createCoreClient(options: CoreClientOptions): CoreClient {
  const connection = options.connection;
  const base = options.baseUrl.replace(/\/$/, "");
  const fetchImpl: RpcFetch = options.fetch ??
    ((input, init) =>
      fetch(input, init).then(async (response) => ({
        status: response.status,
        headers: response.headers,
        bytes: new Uint8Array(await response.arrayBuffer()),
      })));
  async function rpc(): Promise<Result<ReturnType<typeof createRpcClient>>> {
    const credential = await options.provider(connection);
    if (!credential.ok) {
      return err({
        code: "unavailable",
        message: "connection credential을 받지 못했다",
        details: { reason: credential.error },
      });
    }
    return ok(createRpcClient({
      baseUrl: base,
      token: credential.value.token,
      fetch: fetchImpl,
    }));
  }

  return {
    connection,
    baseUrl: options.baseUrl,
    async command(route, body) {
      const opened = await rpc();
      if (!opened.ok) return opened;
      const client = opened.value;
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
      // 실패로 추측하지 않는다(architecture 8).
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
      const opened = await rpc();
      if (!opened.ok) return opened;
      return await opened.value.call(route, input as never);
    },
  };
}

// connection 참조 입력에서 client를 만든다. 참조는 --connection·env에서만 온다.
export function connectionFromRef(
  value: string | undefined,
): Result<ConnectionId> {
  if (value === undefined) {
    return err({ code: "invalid_input", message: "connection 참조가 없다" });
  }
  const parsed = connectionIdSchema.safeParse(value.trim());
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "connection 참조가 올바르지 않다",
    });
  }
  return ok(parsed.data);
}
