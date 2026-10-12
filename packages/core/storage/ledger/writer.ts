import { err, internalError, type Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
} from "../../../protocol/server/mod.ts";
import {
  type CommandExecutorDeps,
  type CredentialCheck,
  executeCommand,
  readOwnResult,
} from "./executor.ts";
import type { LedgerConnection } from "./sqlite.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  StoredCommandResult,
  WriterRequest,
  WriterResponse,
} from "./writer-message.ts";

export type { CommandEnvelope, CommandSuccess, StoredCommandResult };

export type Writer = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  readResult(
    ctx: AuthenticatedContext,
    key: string,
  ): Promise<Result<StoredCommandResult | null>>;
  close(): Promise<void>;
};

type Pending = { resolve: (message: WriterResponse) => void };

const DEAD = {
  code: "unavailable" as const,
  message: "writer가 끝났다",
};

// Deno Worker 하나의 쓰기 연결만 연다. 이쪽은 SQL을 하지 않고 작은 메시지만 보낸다.
// 자격은 Worker 등록이 본다. 이쪽은 시각·회수 주장을 보내지 않는다.
export function openWriter(
  path: string,
  entry: URL = new URL("./writer-main.ts", import.meta.url),
): Writer {
  const worker = new Worker(entry, {
    type: "module",
    name: JSON.stringify({ path }),
  });
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let dead: Result<never> | undefined;
  const fail = (
    error: { code: "unavailable" | "internal"; message: string } = DEAD,
  ) => {
    if (dead !== undefined) return;
    dead = err(error);
    const notice: WriterResponse = { id: 0, op: "failed", body: error };
    for (const waiting of pending.values()) waiting.resolve(notice);
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<WriterResponse>) => {
    const message = event.data;
    if (message.op === "failed" && message.id === 0) {
      fail();
      return;
    }
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    waiting.resolve(message);
    if (message.op === "closed") fail();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail();
    return true;
  };
  worker.onmessageerror = () => fail();
  const send = (request: WriterRequest): Promise<WriterResponse> => {
    if (dead !== undefined && !dead.ok) {
      return Promise.resolve({
        id: request.id,
        op: "failed",
        body: dead.error,
      });
    }
    return new Promise((resolve) => {
      pending.set(request.id, { resolve });
      try {
        worker.postMessage(request);
      } catch {
        pending.delete(request.id);
        fail();
        resolve({ id: request.id, op: "failed", body: DEAD });
      }
    });
  };
  return {
    command(ctx, envelope) {
      return send({
        id: nextId++,
        op: "command",
        ctx,
        envelope,
      }).then(commandBody);
    },
    readResult(ctx, key) {
      return send({ id: nextId++, op: "read-result", ctx, key }).then(readBody);
    },
    async close() {
      if (dead !== undefined) return;
      await send({ id: nextId++, op: "close" });
    },
  };
}

function commandBody(message: WriterResponse): Result<CommandSuccess> {
  if (message.op === "command") return message.body;
  if (message.op === "failed") return err(message.body);
  return err(internalError());
}

function readBody(
  message: WriterResponse,
): Result<StoredCommandResult | null> {
  if (message.op === "read-result") return message.body;
  if (message.op === "failed") return err(message.body);
  return err(internalError());
}

export function runCommand(
  connection: LedgerConnection,
  deps: CommandExecutorDeps,
  commands: readonly CommandDefinition[],
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
): Promise<Result<CommandSuccess>> {
  const table = new Map<string, CommandDefinition>();
  for (const definition of commands) {
    table.set(definition.route.name, definition);
  }
  return executeCommand(connection, deps, table, ctx, envelope);
}

export function runReadResult(
  connection: LedgerConnection,
  checkCredential: CredentialCheck,
  ctx: AuthenticatedContext,
  key: string,
): Result<StoredCommandResult | null> {
  return readOwnResult(connection, checkCredential, ctx, key);
}
