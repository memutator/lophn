import {
  asInternalError,
  type Clock,
  err,
  type ErrorCode,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  commandRequestSchema,
  type CommandRoute,
  type FileRoute,
  type MemoryRoute,
  type ReadRoute,
  type Route,
  UPLOAD_INPUT_HEADER,
  type UploadRoute,
} from "../../protocol/base/mod.ts";
import type { CommandEnvelope, Writer } from "../storage/ledger/mod.ts";
import type { CredentialRegistry } from "./identity/mod.ts";
import {
  authorizeConditions,
  CONDITION_TARGET_KEYS,
  type ConfirmationBridge,
  consumeRouteConfirmation,
  type CredentialTarget,
  type RouteConfirmation,
} from "./identity/mod.ts";
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
  isUploadRoute,
  type RouteEntry,
} from "./routes.ts";

export type ReadHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
  credential?: string,
) => Result<unknown> | Promise<Result<unknown>>;

export type MemoryHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
  // 요청의 Bearer token 원문이다. read와 같다. 요청을 worker로 실어 보내는 route가 쓴다.
  credential?: string,
) => Result<unknown> | Promise<Result<unknown>>;

export type FileHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Result<Uint8Array> | Promise<Result<Uint8Array>>;

// file route의 stream 응답. 한 파일을 core 메모리에 모으지 않고 창 단위로 흘린다.
// - contentType: 저장된 media type 그대로다. dispatch가 형식만 검사하고 sniffing하지 않는다.
// - length: 응답 본문의 정확한 길이(Content-Length). 그보다 적게 흐르고 끝나면 응답이 끊긴다.
// - body: 소비자가 당길 때만 다음 창을 읽는다(backpressure). 크기·hash 검사가 끝에서
//   어긋나면 body를 오류로 끝내 응답을 완료하지 않는다.
type FileStream = {
  contentType: string;
  length: number;
  body: ReadableStream<Uint8Array>;
};

export type FileStreamHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Promise<Result<FileStream>>;

// upload route의 처리. 바이트 body는 core가 해석·보관하지 않고 stream으로 넘긴다.
// stream은 route 상한(max_bytes)을 넘으면 오류로 끝난다. length는 Content-Length를 보낸
// 요청의 선언 길이이고(그만큼만 흐른다) chunked 전송이면 없다. 입력이 크기를 선언하는
// route는 handler가 exactLength로 그 크기를 정확히 지킨다.
type UploadBody = {
  bytes: ReadableStream<Uint8Array>;
  length: number | undefined;
};

export type UploadHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
  body: UploadBody,
) => Promise<Result<unknown>>;

// core entry가 조립한다. 없는 handler는 그 route를 제공하지 않는 것이다.
export type DispatchDeps = {
  credentials: CredentialRegistry;
  clock: Clock;
  writer?: Writer;
  reads?: ReadonlyMap<string, ReadHandler>;
  memory?: ReadonlyMap<string, MemoryHandler>;
  files?: ReadonlyMap<string, FileHandler>;
  // file route를 stream으로 서빙하는 대상.
  fileStreams?: ReadonlyMap<string, FileStreamHandler>;
  uploads?: ReadonlyMap<string, UploadHandler>;
  // file route의 사람 결정 확인. 없으면 confirmation file route는 넘기지 않는다.
  confirmation?: ConfirmationBridge | RouteConfirmation;
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

type HttpResult =
  | { status: number; json: unknown }
  | { status: number; bytes: Uint8Array; contentType: string }
  | {
      status: number;
      stream: ReadableStream<Uint8Array>;
      length: number;
      contentType: string;
    };

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
    return err(
      failure({
        code: "forbidden",
        message: "operation forbidden",
      }),
    );
  }
  return ok(undefined);
}

function actorKind(actor: string): Route["actors"][number] | undefined {
  const kind = actor.split(":", 1)[0];
  if (
    kind === "user" ||
    kind === "coding_agent" ||
    kind === "agent" ||
    kind === "app" ||
    kind === "machine"
  )
    return kind;
  return undefined;
}

// credential scope의 고정 조건 target만 operation과 함께 검사한다. domain key는
// owner가 판정하는 것이라 api 경계에서는 건너뛴다(command·read의 ledger 검사와 같다).
function scopeTarget(ctx: AuthenticatedContext): CredentialTarget {
  const target: CredentialTarget = {};
  for (const key of CONDITION_TARGET_KEYS) {
    const value = ctx.conditions[key];
    if (value !== undefined && Object.hasOwn(ctx.scope.targets, key)) {
      target[key] = value;
    }
  }
  return target;
}

// route의 credential operation scope를 먼저 검사한다.
function scopeAllowed(
  ctx: AuthenticatedContext,
  operation: string,
): Result<void, RequestFailure> {
  const allowed = authorizeConditions(ctx, operation, scopeTarget(ctx));
  if (!allowed.ok) {
    return err(failure(allowed.error));
  }
  return ok(undefined);
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
  if (isUploadRoute(route)) {
    try {
      return await upload(request, route, ctx, deps);
    } catch (thrown) {
      return rejected(asInternalError(thrown));
    }
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
    if (isReadRoute(route)) {
      return await read(
        route,
        parsed.value,
        ctx,
        deps,
        request.headers.get("authorization")?.replace(/^Bearer /, ""),
      );
    }
    if (isMemoryRoute(route)) {
      return await memory(
        route,
        parsed.value,
        ctx,
        deps,
        request.headers.get("authorization")?.replace(/^Bearer /, ""),
      );
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

// 입력은 header의 base64url JSON이고 body는 바이트다. Content-Length가 있으면 상한을
// body를 읽기 전에 검사하고 선언과 다르게 흐르면 stream이 오류로 끝난다. 없으면(chunked)
// 흐르는 동안 route 상한을 지킨다.
async function upload(
  request: Request,
  route: UploadRoute,
  ctx: AuthenticatedContext,
  deps: DispatchDeps,
): Promise<HttpResult> {
  const scoped = scopeAllowed(ctx, route.name);
  if (!scoped.ok) return fromFailure(scoped.error);
  const type = request.headers.get("content-type");
  if (
    type === null ||
    type.split(";", 1)[0].trim().toLowerCase() !== UPLOAD_TYPE
  ) {
    return rejected({
      code: "invalid_input",
      message: "content type not allowed",
    });
  }
  const encoded = request.headers.get(UPLOAD_INPUT_HEADER);
  const decoded = encoded === null ? undefined : decodeInputHeader(encoded);
  if (decoded === undefined) {
    return rejected({ code: "invalid_input", message: "invalid upload input" });
  }
  const parsedJson = parseLimitedJson(decoded);
  if (!parsedJson.ok) return fromFailure(parsedJson.error);
  const input = route.input.safeParse(parsedJson.value);
  if (!input.success) {
    return rejected({ code: "invalid_input", message: "invalid upload input" });
  }
  const declared = request.headers.get("content-length");
  let length: number | undefined;
  if (declared !== null) {
    length = /^\d+$/.test(declared) ? Number(declared) : Number.NaN;
    if (!Number.isSafeInteger(length) || length > route.max_bytes) {
      return rejected({
        code: "invalid_input",
        message: `body exceeds the ${route.max_bytes} byte limit`,
      });
    }
  }
  const handler = deps.uploads?.get(routeKey(route));
  if (!handler) {
    return rejected({ code: "unavailable", message: "upload unavailable" });
  }
  const source =
    request.body ??
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  const result = await handler(ctx, input.data, {
    bytes: exactLength(source, length, route.max_bytes),
    length,
  });
  if (!result.ok) return rejected(commonWorkerError(result.error));
  const output = route.output.safeParse(result.value);
  if (!output.success) {
    return rejected(asInternalError(new Error("upload output")));
  }
  return { status: 200, json: output.data };
}

const UPLOAD_TYPE = "application/octet-stream";

function decodeInputHeader(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return undefined;
  try {
    const padded =
      value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const text = atob(padded);
    return Uint8Array.from(text, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

// route 상한을 넘는 바이트는 흘리지 않는다. 길이를 선언했으면 정확히 그 길이여야 한다.
// 어긋나면 stream이 오류로 끝나 handler가 아무것도 확정하지 못한다.
function exactLength(
  source: ReadableStream<Uint8Array>,
  length: number | undefined,
  max: number = Number.MAX_SAFE_INTEGER,
): ReadableStream<Uint8Array> {
  let total = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max || (length !== undefined && total > length)) {
          throw new Error("body longer than allowed");
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (length !== undefined && total !== length) {
          throw new Error("body shorter than declared");
        }
      },
    }),
  );
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
    ...(request.turn === undefined ? {} : { turn: request.turn }),
    ...(request.confirmation === undefined
      ? {}
      : { confirmation: request.confirmation }),
  };
  const result = await (deps.admitCommand
    ? deps.admitCommand(ctx, route.name, () =>
        sendCommand(deps.writer!, ctx, envelope, route),
      )
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
  // 성공은 등록된 결과 객체를 그대로 200으로 낸다. 추가 포장은 없다.
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
  credential?: string,
): Promise<HttpResult> {
  const parsed = route.input.safeParse(value);
  if (!parsed.success) {
    return rejected({ code: "invalid_input", message: "invalid read body" });
  }
  const handler = deps.reads?.get(routeKey(route));
  if (!handler) {
    return rejected({ code: "unavailable", message: "read unavailable" });
  }
  const result = await handler(ctx, parsed.data, credential);
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
  credential?: string,
): Promise<HttpResult> {
  const parsed = route.input.safeParse(value);
  if (!parsed.success) {
    return rejected({ code: "invalid_input", message: "invalid memory body" });
  }
  const handler = deps.memory?.get(routeKey(route));
  if (!handler) {
    return rejected({ code: "unavailable", message: "route unavailable" });
  }
  const result = await handler(ctx, parsed.data, credential);
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
  const confirmation =
    typeof record.confirmation === "string" ? record.confirmation : undefined;
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
  // credential operation scope를 먼저 본다. 범위 밖이면 handler에 닿지 않는다.
  const scoped = scopeAllowed(ctx, route.name);
  if (!scoped.ok) return fromFailure(scoped.error);
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
  const streaming = deps.fileStreams?.get(routeKey(route));
  if (streaming) return await fileStream(route, streaming, parsed.data, ctx);
  return rejected({ code: "unavailable", message: "file unavailable" });
}

async function fileStream(
  route: FileRoute,
  handler: FileStreamHandler,
  input: unknown,
  ctx: AuthenticatedContext,
): Promise<HttpResult> {
  const answer = await handler(ctx, input);
  if (!answer.ok) return rejected(commonWorkerError(answer.error));
  const { body, contentType, length } = answer.value;
  if (
    !validMediaType(contentType) ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    await body.cancel().catch(() => undefined);
    return rejected(asInternalError(new Error(`file stream ${route.name}`)));
  }
  return { status: 200, stream: body, length, contentType };
}

// 저장된 media type의 형식(`type/subtype`, 매개변수·공백·제어 문자 없음). header에 그대로
// 실리므로 CR·LF나 `;` 뒤 덧붙임을 통과시키지 않는다. 값을 고르거나 고쳐 쓰지 않는다.
const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function validMediaType(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 255 && MEDIA_TYPE.test(value)
  );
}

// worker 오류는 코드만 믿고 message·details는 버린다. worker 문장이 caller에게 새지 않는다
// (platform/redaction). 코드별 안전한 고정 message로 바꾼다.
const WORKER_ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_input: "입력이 계약과 다르다",
  unauthorized: "credential이 필요하다",
  forbidden: "operation이 금지되었다",
  not_found: "대상이 없다",
  conflict: "대상이 이미 바뀌었다",
  unavailable: "worker가 사용할 수 없다",
  internal: "internal error",
};

function commonWorkerError(error: {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): LophnError {
  return { code: error.code, message: WORKER_ERROR_MESSAGES[error.code] };
}
