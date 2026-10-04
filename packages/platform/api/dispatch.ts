import {
  asInternalError,
  type Clock,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  commandRequestSchema,
  type CommandRoute,
  type FileRoute,
  type MemoryRoute,
  type ReadRoute,
  type Route,
  routePath,
} from "../../contracts/platform/mod.ts";
import type { CommandEnvelope, Writer } from "../ledger/mod.ts";
import type { CredentialRegistry } from "../identity/mod.ts";
import {
  type ConfirmationBridge,
  consumeRouteConfirmation,
} from "../identity/mod.ts";
import {
  contentTypeJson,
  errorBody,
  failure,
  headerBytes,
  MAX_HEADER_BYTES,
  parseLimitedJson,
  readLimitedBody,
  type RequestFailure,
} from "./request.ts";
import {
  isCommandRoute,
  isFileRoute,
  isMemoryRoute,
  isReadRoute,
  isWorkerRoute,
  type RouteEntry,
} from "./routes.ts";

export type ReadHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Result<unknown> | Promise<Result<unknown>>;

export type MemoryHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Result<unknown> | Promise<Result<unknown>>;

export type FileHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Result<Uint8Array> | Promise<Result<Uint8Array>>;

// T9가 조립한다. 없는 handler는 그 route를 제공하지 않는 것이다.
export type DispatchDeps = {
  credentials: CredentialRegistry;
  clock: Clock;
  writer?: Writer;
  reads?: ReadonlyMap<string, ReadHandler>;
  memory?: ReadonlyMap<string, MemoryHandler>;
  files?: ReadonlyMap<string, FileHandler>;
  // file route의 사람 결정 확인. 없으면 confirmation file route는 넘기지 않는다.
  confirmation?: ConfirmationBridge;
  // 동작별 body 상한. 없으면 RPC JSON 256KiB.
  bodyLimit?: (route: Route) => number;
  bodyTimeoutMs: number;
  jsonMaxBytes: number;
  // command 입장 대기(256·principal당 64·제어용 16 예약·5초). 없으면 줄 없이 바로 보낸다.
  admitCommand?: (
    ctx: AuthenticatedContext,
    name: string,
    work: () => Promise<HttpResult>,
  ) => Promise<HttpResult>;
};

export type HttpResult =
  | { status: number; json: unknown }
  | { status: number; bytes: Uint8Array; contentType: string };

function routeKey(route: { resource: string; method: string }): string {
  return `${route.resource}/${route.method}`;
}

function rejected(error: LophnError): HttpResult {
  return { status: failure(error).status, json: errorBody(error) };
}

function fromFailure(reason: RequestFailure): HttpResult {
  return { status: reason.status, json: errorBody(reason.error) };
}

// actor 상한은 route 등록값이다. 현재 동작 자격은 credential scope와 교집합이다.
function actorAllowed(
  route: Route,
  ctx: AuthenticatedContext,
): Result<void, RequestFailure> {
  const kind = actorKind(ctx.actor);
  if (!kind || !route.actors.includes(kind)) {
    return err(failure({
      code: "forbidden",
      message: "operation forbidden",
    }));
  }
  return ok(undefined);
}

function actorKind(actor: string): Route["actors"][number] | undefined {
  const kind = actor.split(":", 1)[0];
  if (
    kind === "user" || kind === "coding_agent" || kind === "agent" ||
    kind === "app" || kind === "machine"
  ) return kind;
  return undefined;
}

export async function dispatchHttp(
  request: Request,
  entry: RouteEntry,
  ctx: AuthenticatedContext,
  deps: DispatchDeps,
): Promise<HttpResult> {
  if (headerBytes(request) > MAX_HEADER_BYTES) {
    return rejected({ code: "invalid_input", message: "headers exceed limit" });
  }
  const route = entry.route;
  const allowed = actorAllowed(route, ctx);
  if (!allowed.ok) return fromFailure(allowed.error);
  if (request.method !== "POST") {
    return rejected({ code: "invalid_input", message: "method not allowed" });
  }
  if (isWorkerRoute(route)) {
    // pipe 작업은 HTTP JSON route가 아니다(architecture/platform 5.1).
    return rejected({ code: "not_found", message: "route not found" });
  }
  const maxBytes = deps.bodyLimit?.(route) ?? deps.jsonMaxBytes;
  const body = await readLimitedBody(request, {
    maxBytes,
    timeoutMs: deps.bodyTimeoutMs,
  });
  if (!body.ok) return fromFailure(body.error);
  if (!contentTypeJson(request)) {
    return rejected({
      code: "invalid_input",
      message: "content type not allowed",
    });
  }
  const parsed = parseLimitedJson(body.value);
  if (!parsed.ok) return fromFailure(parsed.error);
  try {
    if (isCommandRoute(route)) {
      return await command(route, parsed.value, ctx, deps);
    }
    if (isReadRoute(route)) return await read(route, parsed.value, ctx, deps);
    if (isMemoryRoute(route)) {
      return await memory(route, parsed.value, ctx, deps);
    }
    if (isFileRoute(route)) {
      const split = fileConfirmation(parsed.value);
      return await file(route, split.input, split.confirmation, ctx, deps);
    }
    return rejected({ code: "not_found", message: "route not found" });
  } catch (thrown) {
    return rejected(asInternalError(thrown));
  }
}

async function command(
  route: CommandRoute,
  value: unknown,
  ctx: AuthenticatedContext,
  deps: DispatchDeps,
): Promise<HttpResult> {
  const schema = commandRequestSchema(route);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return rejected({ code: "invalid_input", message: "invalid command body" });
  }
  if (!deps.writer) {
    return rejected({ code: "unavailable", message: "command unavailable" });
  }
  const request = parsed.data;
  const envelope: CommandEnvelope = {
    command: route.name,
    input: request.input,
    idempotency_key: request.idempotency_key,
    compare: request.compare,
    prepared: request.prepared,
    ...(request.run === undefined ? {} : { run: request.run }),
    ...(request.confirmation === undefined
      ? {}
      : { confirmation: request.confirmation }),
  };
  const result = await (deps.admitCommand
    ? deps.admitCommand(ctx, route.name, () =>
      sendCommand(deps.writer!, ctx, envelope, route))
    : sendCommand(deps.writer, ctx, envelope, route));
  return result;
}

async function sendCommand(
  writer: Writer,
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
  route: CommandRoute,
): Promise<HttpResult> {
  const result = await writer.command(ctx, envelope);
  if (!result.ok) return rejected(result.error);
  // 성공은 등록된 결과 객체를 그대로 200으로 낸다. 추가 포장은 없다(platform/api#R3).
  const output = route.output.safeParse(result.value.result);
  if (!output.success) {
    return rejected(asInternalError(new Error("command output")));
  }
  return { status: 200, json: output.data };
}

async function read(
  route: ReadRoute,
  value: unknown,
  ctx: AuthenticatedContext,
  deps: DispatchDeps,
): Promise<HttpResult> {
  const parsed = route.input.safeParse(value);
  if (!parsed.success) {
    return rejected({ code: "invalid_input", message: "invalid read body" });
  }
  const handler = deps.reads?.get(routeKey(route));
  if (!handler) {
    return rejected({ code: "unavailable", message: "read unavailable" });
  }
  const result = await handler(ctx, parsed.data);
  if (!result.ok) return rejected(result.error);
  const output = route.output.safeParse(result.value);
  if (!output.success) {
    return rejected(asInternalError(new Error("read output")));
  }
  return { status: 200, json: output.data };
}

async function memory(
  route: MemoryRoute,
  value: unknown,
  ctx: AuthenticatedContext,
  deps: DispatchDeps,
): Promise<HttpResult> {
  const parsed = route.input.safeParse(value);
  if (!parsed.success) {
    return rejected({ code: "invalid_input", message: "invalid memory body" });
  }
  const handler = deps.memory?.get(routeKey(route));
  if (!handler) {
    return rejected({ code: "unavailable", message: "route unavailable" });
  }
  const result = await handler(ctx, parsed.data);
  if (!result.ok) return rejected(result.error);
  return { status: 200, json: result.value };
}

// file route 입력은 confirmation을 선언하지 않는다. 요청 본문의 별도 field로만 받고
// route schema에 넘기기 전에 뗀다.
function fileConfirmation(value: unknown): {
  input: unknown;
  confirmation: string | undefined;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { input: value, confirmation: undefined };
  }
  const record = value as Record<string, unknown>;
  const confirmation = typeof record.confirmation === "string"
    ? record.confirmation
    : undefined;
  if (!("confirmation" in record)) return { input: value, confirmation };
  const { confirmation: _dropped, ...input } = record;
  return { input, confirmation };
}

async function file(
  route: FileRoute,
  value: unknown,
  confirmation: string | undefined,
  ctx: AuthenticatedContext,
  deps: DispatchDeps,
): Promise<HttpResult> {
  const parsed = route.input.safeParse(value);
  if (!parsed.success) {
    return rejected({ code: "invalid_input", message: "invalid file body" });
  }
  if (route.confirmation === "required") {
    if (!deps.confirmation) {
      return rejected({
        code: "unavailable",
        message: "사람 결정 확인을 사용할 수 없다",
      });
    }
    const consumed = await consumeRouteConfirmation(
      deps.confirmation,
      route,
      parsed.data,
      confirmation,
    );
    if (!consumed.ok) return rejected(consumed.error);
  }
  const handler = deps.files?.get(routeKey(route));
  if (!handler) {
    return rejected({ code: "unavailable", message: "file unavailable" });
  }
  const result = await handler(ctx, parsed.data);
  if (!result.ok) return rejected(result.error);
  return {
    status: 200,
    bytes: result.value,
    contentType: route.output.contentType,
  };
}

export function registeredPath(
  route: { resource: string; method: string },
): string {
  return routePath(route);
}
