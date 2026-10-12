import { err, internalError } from "../../../base/mod.ts";
import type { CommandDefinition } from "../../../protocol/platform/mod.ts";
import { executeCommand, readOwnResult } from "./executor.ts";
import { openConnection } from "./sqlite.ts";
import type { WriterRegistration } from "./writer-registration.ts";
import type { WriterRequest, WriterResponse } from "./writer-message.ts";

type Boot = { path: string };

export type WorkerSelf = {
  name: string;
  postMessage(message: WriterResponse): void;
  onmessage: ((event: MessageEvent<WriterRequest>) => void) | null;
  close(): void;
};

function boot(name: string): Boot | undefined {
  if (name.length === 0) return undefined;
  const parsed: unknown = JSON.parse(name);
  if (
    parsed === null || typeof parsed !== "object" || !("path" in parsed) ||
    typeof parsed.path !== "string"
  ) {
    return undefined;
  }
  return { path: parsed.path };
}

// 메시지 하나가 끝날 때까지 다음 메시지를 열지 않는다. fingerprint await가 끼어들지 못한다.
export function serveWriter(
  worker: WorkerSelf,
  registration: WriterRegistration,
): void {
  const started = boot(worker.name);
  if (started === undefined) return;
  const opened = openConnection(started.path);
  if (!opened.ok) {
    worker.postMessage({ id: 0, op: "failed", body: opened.error });
    return;
  }
  const connection = opened.value;
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
  };
  let chain = Promise.resolve();
  worker.onmessage = (event: MessageEvent<WriterRequest>) => {
    const data = event.data;
    chain = chain.then(() => handle(data)).catch(() => {
      worker.postMessage({ id: data.id, op: "failed", body: internalError() });
    });
  };

  async function handle(data: WriterRequest): Promise<void> {
    if (data.op === "close") {
      connection.close();
      worker.postMessage({ id: data.id, op: "closed" });
      worker.close();
      return;
    }
    if (data.op === "blob-prepared" || data.op === "blob-prune") {
      // 준비 참조 알림은 core writer가 맡는다. ledger loop는 받지 않는다.
      worker.postMessage({ id: data.id, op: "blob-noted" });
      return;
    }
    if (data.op === "read-result") {
      worker.postMessage({
        id: data.id,
        op: "read-result",
        // 제출 ctx의 principal·scope를 그대로 믿지 않는다. current 자격을 다시 본다(R13).
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
    }
  }
}

export function unavailableRegistration(): WriterRegistration {
  const denied = err({
    code: "unavailable" as const,
    message: "writer 권한 조립이 없다",
  });
  return {
    commands: [],
    clock: {
      now: () => {
        throw new Error("clock 없음");
      },
      nowMs: () => {
        throw new Error("clock 없음");
      },
    },
    ids: {
      newId() {
        throw new Error("id 없음");
      },
    },
    ports: [],
    registerBlobRef: () => denied,
    call: () => denied,
    checkCredential: () => denied,
  };
}
