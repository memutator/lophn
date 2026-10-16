import { err, internalError, type Result } from "../../../base/mod.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { executeCommand, readOwnResult } from "./executor.ts";
import { type LedgerConnection, openConnection } from "./sqlite.ts";
import type { WriterRequest, WriterResponse } from "./writer-message.ts";
import { recordSecretPreparation } from "../../secrets/mod.ts";
import { assembleWriter } from "./writer-assembly.ts";

type WorkerSelf = {
  name: string;
  postMessage(message: WriterResponse): void;
  onmessage: ((event: MessageEvent<WriterRequest>) => void) | null;
  close(): void;
};

// core가 Worker name으로 ledger 경로와 팀 등록 모듈을 넘긴다.
const worker = self as unknown as WorkerSelf;
const boot = JSON.parse(worker.name) as {
  path: string;
  modules: string[];
  clock: "system" | number;
  seed: number;
  domainOnly?: boolean;
};

// 자격 기록과 command가 같은 연결을 본다. writer loop의 두 번째 연결은 쓰지 않는다.
const opened = openConnection(boot.path);
if (!opened.ok) {
  worker.postMessage({ id: 0, op: "failed", body: opened.error });
} else {
  const connection = opened.value;
  const registration = await assembleWriter(boot, connection);
  const commands = new Map<string, CommandDefinition>();
  for (const definition of registration.commands) {
    commands.set(definition.route.name, definition);
  }
  const deps = {
    clock: registration.clock,
    ids: registration.ids,
    ports: registration.ports,
    registerBlobRef: registration.registerBlobRef,
    call: registration.call,
    checkCredential: registration.checkCredential,
    subscriberGate: registration.subscriberGate,
    confirmation: registration.confirmation,
    onTx: registration.onTx,
    domainOnly: boot.domainOnly,
  };
  let chain = Promise.resolve();
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const data = event.data;
    chain = chain.then(() =>
      handle(connection, deps, commands, registration, data)
    ).catch(
      () => {
        worker.postMessage({
          id: data.id,
          op: "failed",
          body: internalError(),
        });
      },
    );
  };
}

type WorkerMessage = WriterRequest | {
  id: number;
  op: "record-credential";
  context: unknown;
} | {
  // I/O worker가 keychain에 값을 둔 뒤 돌려준 값 없는 준비 증거(secret_preparations)다.
  id: number;
  op: "record-secret-preparation";
  preparation: unknown;
} | {
  // 테스트 manual clock을 민 시각. writer clock이 그 시각을 따라간다.
  id: number;
  op: "note-time";
  nowMs: number;
} | {
  id: number;
  op: "confirmation";
  action: "issue" | "close-window" | "clear" | "consume";
  request?: unknown;
  windowId?: string;
};

async function handle(
  connection: LedgerConnection,
  deps: Parameters<typeof executeCommand>[1],
  commands: Map<string, CommandDefinition>,
  registration: Awaited<ReturnType<typeof assembleWriter>>,
  data: WorkerMessage,
): Promise<void> {
  if (data.op === "confirmation") {
    const { confirmationHandleRegisterSchema } = await import(
      "../../../protocol/base/mod.ts"
    );
    const registry = registration.confirmationRegistry;
    if (data.action === "clear") {
      registry.clear();
      worker.postMessage(
        {
          id: data.id,
          op: "confirmation",
          body: { ok: true, value: null },
        } as never,
      );
      return;
    }
    if (data.action === "close-window") {
      registry.closeWindow(data.windowId ?? "");
      worker.postMessage(
        {
          id: data.id,
          op: "confirmation",
          body: { ok: true, value: null },
        } as never,
      );
      return;
    }
    if (data.action === "consume") {
      // file·worker route의 확인 사용. 예약과 소비를 이 thread에서 한 번에 한다.
      const use = data.request as Parameters<typeof registry.reserve>[0];
      const reserved = registry.reserve(use);
      if (reserved.ok) registry.consume(use.ref);
      worker.postMessage(
        {
          id: data.id,
          op: "confirmation",
          body: reserved.ok ? { ok: true, value: null } : reserved,
        } as never,
      );
      return;
    }
    const parsed = confirmationHandleRegisterSchema.safeParse(data.request);
    const issued = parsed.success ? registry.issue(parsed.data) : {
      ok: false as const,
      error: {
        code: "invalid_input" as const,
        message: "확인 등록이 올바르지 않다",
      },
    };
    worker.postMessage(
      { id: data.id, op: "confirmation", body: issued } as never,
    );
    return;
  }
  if (data.op === "record-secret-preparation") {
    // 자체 transaction으로 한 행을 확정한다. 열린 transaction 안에서는 부르지 않는다.
    let recorded: Result<unknown>;
    if (connection.inTransaction()) {
      recorded = err({
        code: "internal",
        message: "준비 증거를 열린 transaction 안에서 남길 수 없다",
      });
    } else {
      try {
        connection.exec("begin immediate");
        recorded = recordSecretPreparation(connection.sql, data.preparation);
        connection.exec(recorded.ok ? "commit" : "rollback");
      } catch {
        try {
          connection.exec("rollback");
        } catch { /* 이미 끝난 transaction */ }
        recorded = err({
          code: "unavailable",
          message: "준비 증거를 남기지 못했다",
        });
      }
    }
    worker.postMessage({
      id: data.id,
      op: recorded.ok ? "recorded" : "failed",
      body: recorded.ok
        ? { code: "ok", message: "secret preparation recorded" }
        : recorded.error,
    } as never);
    return;
  }
  if (data.op === "record-credential") {
    const { recordCredential } = await import("../../server/credentials.ts");
    const { authenticatedContextSchema } = await import(
      "../../../protocol/server/mod.ts"
    );
    const parsed = authenticatedContextSchema.safeParse(data.context);
    const recorded = parsed.success
      ? recordCredential(connection, parsed.data)
      : {
        ok: false as const,
        error: {
          code: "invalid_input" as const,
          message: "credential 기록이 올바르지 않다",
        },
      };
    worker.postMessage({
      id: data.id,
      op: recorded.ok ? "recorded" : "failed",
      body: recorded.ok
        ? { code: "ok", message: "credential recorded" }
        : recorded.error,
    } as never);
    return;
  }
  if (data.op === "close") {
    connection.close();
    worker.postMessage({ id: data.id, op: "closed" });
    worker.close();
    return;
  }
  if (data.op === "blob-prepared") {
    registration.preparations.register(data.prepared, data.nowMs);
    registration.preparations.prune(data.nowMs);
    worker.postMessage({ id: data.id, op: "blob-noted" } as never);
    return;
  }
  if (data.op === "note-time") {
    registration.noteTime(data.nowMs);
    worker.postMessage({ id: data.id, op: "time-noted" } as never);
    return;
  }
  if (data.op === "blob-prune") {
    registration.preparations.prune(data.nowMs);
    worker.postMessage({ id: data.id, op: "blob-noted" } as never);
    return;
  }
  if (data.op === "read-result") {
    worker.postMessage({
      id: data.id,
      op: "read-result",
      body: readOwnResult(
        connection,
        deps.checkCredential,
        data.ctx,
        data.key,
      ),
    });
    return;
  }
  try {
    registration.noteRequest(data.ctx);
    registration.afterCommit.reset();
    const body = await executeCommand(
      connection,
      deps,
      commands,
      data.ctx,
      data.envelope,
    );
    // 확정된 새 command의 commit 뒤 할 일만 main으로 돌려준다. 되돌아간 tx의 것은 버린다.
    if (body.ok && !body.value.replayed) {
      const actions = registration.afterCommit.take();
      if (actions.length > 0) body.value.after_commit = actions;
    } else registration.afterCommit.reset();
    worker.postMessage({ id: data.id, op: "command", body });
  } catch {
    worker.postMessage({
      id: data.id,
      op: "failed",
      body: internalError(),
    });
  } finally {
    registration.noteRequest(undefined);
  }
}
