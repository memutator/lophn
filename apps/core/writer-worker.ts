import { internalError } from "../../packages/base/mod.ts";
import type { CommandDefinition } from "../../packages/contracts/platform/mod.ts";
import {
  executeCommand,
  readOwnResult,
} from "../../packages/platform/ledger/executor.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../packages/platform/ledger/sqlite.ts";
import type {
  WriterRequest,
  WriterResponse,
} from "../../packages/platform/ledger/writer-message.ts";
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
  nowMs: number;
  seed: number;
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
  id: number;
  op: "confirmation";
  action: "issue" | "close-window" | "clear";
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
      "../../packages/contracts/platform/mod.ts"
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
  if (data.op === "record-credential") {
    const { recordCredential } = await import("./credentials.ts");
    const { authenticatedContextSchema } = await import(
      "../../packages/contracts/platform/mod.ts"
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
    registration.noteBlobTime(data.nowMs);
    registration.preparations.register(data.prepared, data.nowMs);
    registration.preparations.prune(data.nowMs);
    worker.postMessage({ id: data.id, op: "blob-noted" } as never);
    return;
  }
  if (data.op === "blob-prune") {
    registration.noteBlobTime(data.nowMs);
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
    const body = await executeCommand(
      connection,
      deps,
      commands,
      data.ctx,
      data.envelope,
    );
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
