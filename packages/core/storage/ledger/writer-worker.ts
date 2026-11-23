import { parentPort, workerData } from "node:worker_threads";
import { internalError } from "../../../base/mod.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { executeCommand, readOwnResult } from "./executor.ts";
import { type LedgerConnection, openConnection } from "./sqlite.ts";
import type { WriterRequest } from "./writer-message.ts";
import { assembleWriter } from "./writer-assembly.ts";

// core가 Worker를 만들 때 넘긴 ledger 경로와 팀 등록 module이다.
const boot = workerData as {
  path: string;
  modules: string[];
  clock: "system" | number;
  seed: number;
};
const port = parentPort!;

// 자격 기록과 command가 같은 연결을 본다. writer loop의 두 번째 연결은 쓰지 않는다.
const opened = openConnection(boot.path);
if (!opened.ok) {
  port.postMessage({ id: 0, op: "failed", body: opened.error });
} else {
  const connection = opened.value;
  const registration = await assembleWriter(boot, connection);
  const commands = new Map<string, CommandDefinition>();
  for (const definition of registration.commands) {
    commands.set(
      definition.route.name,
      registration.afterCommit.declared(definition),
    );
  }
  const deps = {
    clock: registration.clock,
    ids: registration.ids,
    ports: registration.ports,
    registerBlobRef: registration.registerBlobRef,
    call: registration.call,
    checkCredential: registration.checkCredential,
    confirmation: registration.confirmation,
    onTx: registration.onTx,
  };
  let chain = Promise.resolve();
  let reported = false;
  port.on("message", (message) => {
    const data = message as WorkerMessage;
    chain = chain
      .then(() => handle(connection, deps, commands, registration, data))
      .catch(() => {
        port.postMessage({
          id: data.id,
          op: "failed",
          body: internalError(),
        });
      })
      .then(() => {
        // rollback 실패나 corrupt가 연결을 fault시켜도 Worker는 살아 있다. main이 모르면 이후 모든 command가
        // unavailable로만 끝나므로 한 번 알린다. close는 failed()를 참으로 만들고 Worker를 끝내므로 뺀다.
        if (reported || data.op === "close" || !connection.failed()) return;
        reported = true;
        port.postMessage({
          id: 0,
          op: "failed",
          body: { code: "unavailable", message: "ledger 연결이 fault됐다" },
        });
      });
  });
}

type WorkerMessage =
  | WriterRequest
  | {
      id: number;
      op: "record-credential";
      context: unknown;
    }
  | {
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
      port.postMessage({
        id: data.id,
        op: "confirmation",
        body: { ok: true, value: null },
      } as never);
      return;
    }
    if (data.action === "close-window") {
      registry.closeWindow(data.windowId ?? "");
      port.postMessage({
        id: data.id,
        op: "confirmation",
        body: { ok: true, value: null },
      } as never);
      return;
    }
    if (data.action === "consume") {
      // file·worker route의 확인 사용. 예약과 소비를 이 thread에서 한 번에 한다.
      const use = data.request as Parameters<typeof registry.reserve>[0];
      const reserved = registry.reserve(use);
      if (reserved.ok) registry.consume(use.ref);
      port.postMessage({
        id: data.id,
        op: "confirmation",
        body: reserved.ok ? { ok: true, value: null } : reserved,
      } as never);
      return;
    }
    const parsed = confirmationHandleRegisterSchema.safeParse(data.request);
    const issued = parsed.success
      ? registry.issue(parsed.data)
      : {
          ok: false as const,
          error: {
            code: "invalid_input" as const,
            message: "확인 등록이 올바르지 않다",
          },
        };
    port.postMessage({
      id: data.id,
      op: "confirmation",
      body: issued,
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
    port.postMessage({
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
    port.postMessage({ id: data.id, op: "closed" });
    // 답을 보낸 뒤 thread를 끝낸다. postMessage는 이미 queue에 들어갔다.
    process.exit(0);
    return;
  }
  if (data.op === "blob-prepared") {
    const nowMs = registration.clock.nowMs();
    registration.preparations.register(data.prepared, nowMs);
    registration.preparations.prune(nowMs);
    port.postMessage({ id: data.id, op: "blob-noted" } as never);
    return;
  }
  if (data.op === "blob-prune") {
    registration.preparations.prune(registration.clock.nowMs());
    port.postMessage({ id: data.id, op: "blob-noted" } as never);
    return;
  }
  if (data.op === "read-result") {
    port.postMessage({
      id: data.id,
      op: "read-result",
      body: readOwnResult(connection, deps.checkCredential, data.ctx, data.key),
    });
    return;
  }
  try {
    registration.noteRequest(data.ctx);
    // 확정된 새 command의 commit 뒤 할 일만 main으로 돌려준다. 되돌아간 tx의 것은 버린다.
    const body = await registration.afterCommit.run(() =>
      executeCommand(connection, deps, commands, data.ctx, data.envelope),
    );
    port.postMessage({ id: data.id, op: "command", body });
  } catch {
    port.postMessage({
      id: data.id,
      op: "failed",
      body: internalError(),
    });
  } finally {
    registration.noteRequest(undefined);
  }
}
