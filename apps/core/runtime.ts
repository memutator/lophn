import type { Clock, Result } from "../../packages/base/mod.ts";
import { err, internalError, ok } from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import type { ReadHandler } from "../../packages/platform/api/mod.ts";
import {
  platformStatusReads,
  type StatusSource,
} from "../../packages/platform/diagnostics/mod.ts";
import {
  createEventDispatcher,
  createReaderEventBackend,
  createReaderPool,
  createSubscriptionStore,
  openConnection,
  type ReaderPool,
  type SubscriptionStore,
  type Writer,
} from "../../packages/platform/ledger/mod.ts";
import type {
  WriterRequest,
  WriterResponse,
} from "../../packages/platform/ledger/writer-message.ts";
import type { Assembled } from "./registration.ts";

export type CoreRuntime = {
  writer: Writer;
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  readers: ReaderPool;
  reads: Map<string, ReadHandler>;
  events: ReturnType<typeof createReaderEventBackend>;
  subscriptions: SubscriptionStore;
  wake(): void;
  close(): Promise<void>;
};

const WRITER_DEAD = {
  code: "unavailable" as const,
  message: "writer가 끝났다",
};

// lock과 schema step 다음이다. writer·reader Worker, event 배포, API read를 연다.
export async function openRuntime(input: {
  ledgerPath: string;
  clock: Clock;
  nowMs: number;
  seed: number;
  modules: readonly string[];
  assembled: Assembled;
  source: StatusSource;
}): Promise<Result<CoreRuntime>> {
  const openedWriter = openProductWriter(input.ledgerPath, {
    modules: [...input.modules],
    nowMs: input.nowMs,
    seed: input.seed,
  });
  const readers = await createReaderPool(input.ledgerPath, [
    new URL("./reader-registration.ts", import.meta.url),
  ]);
  if (!readers.ok) {
    await openedWriter.writer.close();
    return readers;
  }
  const root = input.ledgerPath.slice(0, input.ledgerPath.lastIndexOf("/"));
  const directory = `${root}/derived/api-subscriptions`;
  await Deno.mkdir(directory, { recursive: true });
  const subscriptions = await createSubscriptionStore(directory);
  if (!subscriptions.ok) {
    readers.value.close();
    await openedWriter.writer.close();
    return subscriptions;
  }
  const status = platformStatusReads(input.source, input.clock);
  const reads = new Map<string, ReadHandler>([
    ["platform/status", status.status],
    ["platform/health", status.health],
    // reader Worker가 등록한 ledger read. 팀 read는 그 뒤에 같은 풀로 붙는다.
    ...["commands/result", "events/list"].map((
      key,
    ): [string, ReadHandler] => [
      key,
      (ctx, body) =>
        readers.value.read(
          {
            resource: key.slice(0, key.indexOf("/")),
            method: key.slice(key.indexOf("/") + 1),
          },
          ctx,
          body,
        ),
    ]),
    ...input.assembled.reads.map((read): [string, ReadHandler] => [
      `${read.route.resource}/${read.route.method}`,
      (ctx, body) => readers.value.read(read.route, ctx, body),
    ]),
  ]);
  const events = createReaderEventBackend(
    readers.value,
    (ref) => Promise.resolve(currentCredential(input.ledgerPath, ref)),
  );
  const dispatcher = createEventDispatcher((catchUp) => {
    const timer = setInterval(catchUp, 200);
    return () => clearInterval(timer);
  });
  return ok({
    writer: openedWriter.writer,
    confirmation: openedWriter.confirmation,
    record: openedWriter.record,
    readers: readers.value,
    reads,
    events,
    subscriptions: subscriptions.value,
    wake: () => dispatcher.wake(),
    async close() {
      dispatcher.close();
      readers.value.close();
      subscriptions.value.close();
      await openedWriter.writer.close();
    },
  });
}

// openWriter는 path만 worker name에 넣는다. 팀 모듈은 core가 name에 더한다.
function openProductWriter(
  path: string,
  extra: { modules: string[]; nowMs: number; seed: number },
): {
  writer: Writer;
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
} {
  const worker = new Worker(new URL("./writer-worker.ts", import.meta.url), {
    type: "module",
    name: JSON.stringify({ path, ...extra }),
  });
  let nextId = 1;
  const pending = new Map<number, {
    resolve: (message: WriterResponse) => void;
  }>();
  let dead: Result<never> | undefined;
  const fail = () => {
    if (dead !== undefined) return;
    dead = err(WRITER_DEAD);
    for (const waiting of pending.values()) {
      waiting.resolve({ id: 0, op: "failed", body: WRITER_DEAD });
    }
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<WriterResponse>) => {
    const message = event.data;
    if (message.op === "failed" && message.id === 0) return fail();
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    waiting.resolve(message);
    if (message.op === "closed") fail();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail();
  };
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
        resolve({ id: request.id, op: "failed", body: WRITER_DEAD });
      }
    });
  };
  return {
    writer: {
      command(ctx, envelope) {
        return send({ id: nextId++, op: "command", ctx, envelope }).then(
          (message) => {
            if (message.op === "command") return message.body;
            if (message.op === "failed") return err(message.body);
            return err(internalError());
          },
        );
      },
      readResult(ctx, key) {
        return send({ id: nextId++, op: "read-result", ctx, key }).then(
          (message) => {
            if (message.op === "read-result") return message.body;
            if (message.op === "failed") return err(message.body);
            return err(internalError());
          },
        );
      },
      async close() {
        if (dead !== undefined) return;
        await send({ id: nextId++, op: "close" });
      },
    },
    // main↔core 비공개 통로의 확인 등록을 writer 프로세스의 registry로 넘긴다.
    confirmation(body: {
      action: "issue" | "close-window" | "clear";
      request?: unknown;
      windowId?: string;
    }) {
      return send({
        id: nextId++,
        op: "confirmation",
        ...body,
      } as unknown as WriterRequest).then((message) => {
        const reply = message as unknown as {
          op: string;
          body: Result<unknown>;
        };
        if (reply.op === "confirmation") return reply.body;
        if (message.op === "failed") return err(message.body);
        return err({
          code: "unavailable",
          message: "확인 등록을 전달하지 못했다",
        });
      });
    },
    record(context) {
      return send({
        id: nextId++,
        op: "record-credential",
        context,
      } as unknown as WriterRequest).then((message) => {
        if ((message.op as string) === "recorded") return ok(undefined);
        if (message.op === "failed") return err(message.body);
        return err({
          code: "unavailable",
          message: "credential 기록을 남기지 못했다",
        });
      });
    },
  };
}

function currentCredential(
  ledgerPath: string,
  credentialRef: string,
): Result<RequestContext> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      `select context, state from credentials where credential_ref = ?`,
      [credentialRef],
    );
    if (
      !row || row["state"] !== "active" || typeof row["context"] !== "string"
    ) {
      return err({ code: "unauthorized", message: "현재 credential이 없다" });
    }
    const context = authenticatedContextSchema.safeParse(
      JSON.parse(row["context"]),
    );
    if (!context.success || context.data.credential_ref !== credentialRef) {
      return err({ code: "unauthorized", message: "현재 credential이 없다" });
    }
    return ok(context.data);
  } catch {
    return err({
      code: "unavailable",
      message: "credential 기록을 읽지 못했다",
    });
  } finally {
    opened.value.close();
  }
}
