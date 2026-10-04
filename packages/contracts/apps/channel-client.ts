import { err, type ErrorCode, ok, type Result } from "../../base/mod.ts";
import type { z } from "zod";
import { errorBodySchema, errorCodeForStatus } from "../platform/errors.ts";
import {
  type AppConnectInput,
  type AppConnectOutput,
  appConnectOutputSchema,
} from "./channel.ts";
import {
  type CommandInvokeInput,
  type CommandInvokeOutput,
  commandInvokeOutputSchema,
  type CommandStatusOutput,
  commandStatusOutputSchema,
} from "./direct-socket.ts";
import { DIRECT_SOCKET_PATHS, SOCKET_HOST } from "./channel-values.ts";

const decoder = new TextDecoder();

export type AppChannelFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;

export type AppChannelTransport = {
  connect(input: AppConnectInput): Promise<
    { status: number; headers: Headers; bytes: Uint8Array }
  >;
  direct(
    endpoint: string,
    path: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;
};

function fail(code: ErrorCode, message: string) {
  return err({ code, message });
}

function read<S extends z.ZodType>(
  schema: S,
  status: number,
  bytes: Uint8Array,
) {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    return fail("unavailable", "response was not JSON");
  }
  if (status !== 200) {
    const body = errorBodySchema.safeParse(value);
    if (body.success) return err(body.data.error);
    const code = errorCodeForStatus(status);
    return fail(code ?? "unavailable", "request failed");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail("unavailable", "response did not match");
  return ok(parsed.data as z.output<S>);
}

// MCP·CLI·agent runtime·shell main이 함께 쓰는 작은 client.
// socket 위치와 credential은 호출자가 transport로 주입한다.
export function createAppChannelClient(transport: AppChannelTransport) {
  return {
    async connect(
      input: AppConnectInput,
    ): Promise<Result<AppConnectOutput>> {
      try {
        const response = await transport.connect(input);
        return read(appConnectOutputSchema, response.status, response.bytes);
      } catch (_caught) {
        return fail("unavailable", "transport failed");
      }
    },
    invoke(
      endpoint: string,
      authorization: string,
      input: CommandInvokeInput,
    ): Promise<Result<CommandInvokeOutput>> {
      return call(
        transport,
        endpoint,
        authorization,
        "POST",
        DIRECT_SOCKET_PATHS.invoke,
        input,
        commandInvokeOutputSchema,
      );
    },
    status(
      endpoint: string,
      authorization: string,
      requestKey: string,
      invocation: string,
    ): Promise<Result<CommandStatusOutput>> {
      const query = new URLSearchParams({
        request_key: requestKey,
        invocation,
      });
      return call(
        transport,
        endpoint,
        authorization,
        "GET",
        `${DIRECT_SOCKET_PATHS.status}?${query}`,
        undefined,
        commandStatusOutputSchema,
      );
    },
  };
}

export type AppChannelClient = ReturnType<typeof createAppChannelClient>;

async function call<S extends z.ZodType>(
  transport: AppChannelTransport,
  endpoint: string,
  authorization: string,
  method: string,
  path: string,
  body: unknown,
  schema: S,
): Promise<Result<z.output<S>>> {
  try {
    const response = await transport.direct(endpoint, path, {
      method,
      headers: {
        authorization,
        host: SOCKET_HOST,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return read(schema, response.status, response.bytes);
  } catch (_caught) {
    return fail("unavailable", "transport failed");
  }
}
