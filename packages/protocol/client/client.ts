import {
  asInternalError,
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { z } from "zod";
import { errorBodySchema, errorCodeForStatus } from "../base/errors.ts";
import { type CommandRequest, commandRequestSchema } from "../base/envelope.ts";
import { type CommandRoute, type Route, routePath } from "../base/route.ts";

type FileBody = { bytes: Uint8Array; contentType: string | null };

type SchemaOf<R extends Route> = Extract<R["output"], z.ZodType>;

// command는 envelope로 보내고 결과 객체로 받는다.
// memory는 command가 아니므로 ledger envelope 없이 raw 입력·출력을 주고받는다.
type CallBody<R extends Route> = R extends CommandRoute ? CommandRequest<R>
  : z.input<R["input"]>;

// 성공한 command도 read처럼 등록된 결과 객체를 그대로 200으로 받는다.
type CallResult<R extends Route> = R extends { kind: "file" } ? FileBody
  : z.output<SchemaOf<R>>;

export type RpcFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;

export type RpcClient = {
  call<R extends Route>(
    route: R,
    body: CallBody<R>,
  ): Promise<Result<CallResult<R>>>;
};

type Response = { status: number; headers: Headers; bytes: Uint8Array };

const decoder = new TextDecoder();

function readOutput<S extends z.ZodType>(schema: S, value: unknown) {
  return schema.safeParse(value);
}

function fail(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return err({ code, message, ...(details ? { details } : {}) });
}

export function createRpcClient(options: {
  baseUrl: string;
  token: string;
  fetch: RpcFetch;
}): RpcClient {
  const base = options.baseUrl.replace(/\/$/, "");
  return {
    async call<R extends Route>(route: R, body: CallBody<R>) {
      // 바이트 body route는 JSON 호출이 아니다. 그 route의 client가 따로 보낸다.
      if (route.kind === "upload") {
        return fail("invalid_input", "upload route needs a byte body");
      }
      const requestSchema: z.ZodType = route.kind === "command"
        ? commandRequestSchema(route)
        : route.input;
      const input = requestSchema.safeParse(body);
      if (!input.success) {
        return fail("invalid_input", "invalid input");
      }
      const headers: Record<string, string> = {
        "authorization": `Bearer ${options.token}`,
      };
      const init: {
        method: string;
        headers: Record<string, string>;
        body?: string;
      } = {
        method: "POST",
        headers,
      };
      if (route.kind !== "file") {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(input.data);
      }
      let response: Response;
      try {
        response = await options.fetch(`${base}${routePath(route)}`, init);
      } catch {
        // 결과를 모른다. command는 같은 key로 /commands/result를 다시 본다.
        return fail("unavailable", "transport failed", {
          reason: "transport_failed",
        });
      }
      if (response.status !== 200) {
        const parsed = errorBodySchema.safeParse(decodeJson(response.bytes));
        if (!parsed.success) {
          const code = errorCodeForStatus(response.status) ?? "internal";
          return fail(code, "request failed");
        }
        return err(parsed.data.error);
      }
      if (route.kind === "file") {
        return ok({
          bytes: response.bytes,
          contentType: response.headers.get("content-type"),
        } as CallResult<R>);
      }
      const output = readOutput(
        route.output as SchemaOf<R>,
        decodeJson(response.bytes),
      );
      if (!output.success) return err(asInternalError(output.error));
      return ok(output.data as CallResult<R>);
    },
  };
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}
