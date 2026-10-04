import { err, ok, type Result } from "../../base/mod.ts";
import {
  errorBodySchema,
  parseActor,
  readCommonSchema,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import type { ReaderConnection } from "./reader-connection.ts";
import { validateOutput } from "./output.ts";

export const READ_MAX_ROWS = 500;
export const READ_MAX_BYTES = 1024 * 1024;
export const READ_TIMEOUT_MS = 2000;

export class ReadLimitExceeded extends Error {}
export class ReaderStorageError extends Error {}

function synchronousResult(value: unknown): Result<unknown> {
  // 이미 시작된 async handler의 rejection은 관측하되 Result로 채택하지 않는다.
  if (value instanceof Promise) void value.catch(() => undefined);
  if (!value || typeof value !== "object" || "then" in value) {
    throw new Error("read handler must return a synchronous Result");
  }
  const result = value as Record<string, unknown>;
  if (result.ok === true && "value" in result) return ok(result.value);
  if (result.ok === false) {
    const body = validateOutput(errorBodySchema, { error: result.error });
    if (body.ok) return err(body.value.error);
  }
  throw new Error("read handler returned an invalid Result");
}

// 배열의 각 항목이 한 row다. 중첩된 목록도 응답 한도에 포함한다.
function responseRows(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length +
      value.reduce((sum, item) => sum + responseRows(item), 0);
  }
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    return Object.values(value).reduce<number>(
      (sum, item) => sum + responseRows(item),
      0,
    );
  }
  return 0;
}

export type ReaderRegistration = {
  reads: readonly ReadDefinition[];
  ports: ReadonlyMap<unknown, unknown>;
};

// entry의 정적 module이 Worker마다 함수와 port object identity를 다시 조립한다.
export type ReaderRegistrationModule = {
  createReaderRegistration(): ReaderRegistration;
};

export function readKey(route: { resource: string; method: string }): string {
  return `${route.resource}.${route.method}`;
}

export function executeRead(
  connection: ReaderConnection,
  definition: ReadDefinition,
  ports: ReadonlyMap<unknown, unknown>,
  ctx: RequestContext,
  input: unknown,
): Result<unknown> {
  const result = executeSnapshot(connection, definition, ports, ctx, input);
  try {
    connection.end();
  } catch {
    return err({
      code: "unavailable",
      message: "reader snapshot을 닫을 수 없다",
    });
  }
  return result;
}

function executeSnapshot(
  connection: ReaderConnection,
  definition: ReadDefinition,
  ports: ReadonlyMap<unknown, unknown>,
  ctx: RequestContext,
  input: unknown,
): Result<unknown> {
  let active = false;
  const requireActive = () => {
    if (!active) throw new Error("read snapshot is closed");
  };
  try {
    const parsed = definition.route.input.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "read 입력이 올바르지 않다",
      });
    }
    const actor = parseActor(ctx.actor);
    if (!actor || !definition.route.actors.includes(actor.kind)) {
      return err({ code: "forbidden", message: "허용되지 않은 read actor다" });
    }
    const asOfSeq = connection.begin();
    active = true;
    const snapshot: ReadSnapshot = {
      sql: {
        get(query, params) {
          requireActive();
          return connection.sql.get(query, params);
        },
        all(query, params) {
          requireActive();
          return connection.sql.all(query, params);
        },
      },
      as_of_seq: asOfSeq,
      port<T>(key: unknown): T {
        requireActive();
        if (!ports.has(key)) throw new Error("unregistered read port");
        return ports.get(key) as T;
      },
    };
    let rawResult: unknown;
    let handlerError: unknown;
    let failed = false;
    try {
      rawResult = definition.handle(snapshot, ctx, parsed.data);
    } catch (error) {
      handlerError = error;
      failed = true;
    }
    // schema/JSON 조립이나 handler 밖의 작업 동안 SQLite snapshot을 잡지 않는다.
    active = false;
    try {
      connection.end();
    } catch {
      throw new ReaderStorageError("reader snapshot could not close");
    }
    if (failed) throw handlerError;
    const result = synchronousResult(rawResult);
    if (!result.ok) return result;
    if (!result.value || typeof result.value !== "object") {
      throw new Error("read output must be an object");
    }
    const output = validateOutput(definition.route.output, result.value, {
      as_of_seq: asOfSeq,
    });
    if (!output.ok || !readCommonSchema.safeParse(output.value).success) {
      throw new Error("read output schema differs");
    }
    const value = output.value;
    const serialized = JSON.stringify(value);
    const bytes = new TextEncoder().encode(serialized).length;
    if (responseRows(value) > READ_MAX_ROWS || bytes > READ_MAX_BYTES) {
      return err({
        code: "invalid_input",
        message: "read 응답 한도를 넘었다. 더 작은 page로 요청해야 한다",
        details: { max_rows: READ_MAX_ROWS, max_bytes: READ_MAX_BYTES },
      });
    }
    return ok(value);
  } catch (error) {
    return err(
      error instanceof ReadLimitExceeded
        ? {
          code: "invalid_input",
          message: "read 행 한도를 넘었다. 더 작은 page로 요청해야 한다",
          details: { max_rows: READ_MAX_ROWS },
        }
        : error instanceof ReaderStorageError
        ? { code: "unavailable", message: "reader 저장소를 사용할 수 없다" }
        : { code: "internal", message: "read 처리에 실패했다" },
    );
  }
}
