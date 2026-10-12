import { err, ok, type Result } from "../../base/mod.ts";
import type {
  Diagnostic,
  WorkerRequest,
} from "../../protocol/supervision/mod.ts";
import {
  DIAGNOSTICS_WRITE_MAX_PENDING_BYTES,
  DIAGNOSTICS_WRITE_OP,
  diagnosticsWriteInputSchema,
  type DiagnosticsWriteOutput,
  diagnosticsWriteRequestSchema,
} from "../../protocol/diagnostics/mod.ts";
import type { SafeLog } from "./log.ts";
import { CONTROL_MAX_BYTES } from "../../protocol/base/mod.ts";

// The owner supplies current authority, never a principal/process/scope submitted in payload.
export type DiagnosticAuthority = {
  principal: string;
  process: string;
  task: string;
  scope: readonly string[];
  permits(diagnostic: Diagnostic): boolean;
};
export type DiagnosticIngress = {
  accept(request: unknown): Result<DiagnosticsWriteOutput>;
};
export function createDiagnosticIngress(options: {
  currentAuthority(): DiagnosticAuthority | undefined;
  log: SafeLog;
}): DiagnosticIngress {
  return {
    accept(request) {
      const parsed = diagnosticsWriteRequestSchema.safeParse(request);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "invalid diagnostics request",
        });
      }
      let authority: DiagnosticAuthority | undefined;
      try {
        authority = options.currentAuthority();
        if (
          !authority?.principal || !authority.process || !authority.task ||
          !authority.scope.includes(DIAGNOSTICS_WRITE_OP) ||
          parsed.data.payload.records.some((record) =>
            !authority!.permits(record)
          )
        ) {
          return err({
            code: "forbidden",
            message: "diagnostics authority required",
          });
        }
      } catch {
        return err({
          code: "forbidden",
          message: "diagnostics authority required",
        });
      }
      options.log.noteDropped(parsed.data.payload.dropped);
      let accepted = 0;
      for (const record of parsed.data.payload.records) {
        if (options.log.admit(record)) accepted++;
      }
      return ok({
        accepted,
        dropped: parsed.data.payload.records.length - accepted,
      });
    },
  };
}

export type DiagnosticHost = {
  publish(records: readonly Diagnostic[], dropped?: number): void;
  close(): void;
  readonly pendingBytes: number;
  readonly dropped: number;
};
// send resolves when a private worker reply arrives. Never await it in a command.
export function createDiagnosticHost(options: {
  currentAuthority(): DiagnosticAuthority | undefined;
  send(request: WorkerRequest): Promise<void>;
  nextRequestId(): string;
}): DiagnosticHost {
  const queue: { json: string; bytes: number; count: number }[] = [];
  let pendingBytes = 0;
  let dropped = 0;
  let draining = false;
  let closed = false;
  const encoder = new TextEncoder();
  const lose = (count: number) =>
    dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + count);
  async function drain() {
    while (queue.length && !closed) {
      const entry = queue.shift()!;
      try {
        // Authority can be revoked while queued. Re-check immediately before sending.
        const request = JSON.parse(entry.json);
        const authority = options.currentAuthority();
        if (
          !authority?.principal || !authority.process || !authority.task ||
          !authority.scope.includes(DIAGNOSTICS_WRITE_OP) ||
          request.payload.records.some((record: Diagnostic) =>
            !authority.permits(record)
          )
        ) {
          lose(entry.count);
        } else await options.send(request);
      } catch {
        lose(entry.count);
      } finally {
        pendingBytes -= entry.bytes;
      }
    }
    draining = false;
  }
  return {
    publish(records, lost = 0) {
      const parsed = diagnosticsWriteInputSchema.safeParse({
        records,
        dropped: lost,
      });
      if (!parsed.success || closed) {
        lose(records.length);
        return;
      }
      try {
        const authority = options.currentAuthority();
        if (
          !authority?.principal || !authority.process || !authority.task ||
          !authority.scope.includes(DIAGNOSTICS_WRITE_OP) ||
          parsed.data.records.some((record) => !authority.permits(record))
        ) {
          lose(records.length);
          return;
        }
        const request = diagnosticsWriteRequestSchema.parse({
          type: "worker_request",
          request_id: options.nextRequestId(),
          op: DIAGNOSTICS_WRITE_OP,
          payload: parsed.data,
        });
        const json = JSON.stringify(request);
        const bytes = encoder.encode(json).length;
        if (
          bytes > CONTROL_MAX_BYTES ||
          pendingBytes + bytes > DIAGNOSTICS_WRITE_MAX_PENDING_BYTES
        ) {
          lose(records.length);
          return;
        }
        pendingBytes += bytes;
        queue.push({ json, bytes, count: records.length });
        if (!draining) {
          draining = true;
          queueMicrotask(() => void drain());
        }
      } catch {
        lose(records.length);
      }
    },
    close() {
      closed = true;
      for (const entry of queue.splice(0)) {
        pendingBytes -= entry.bytes;
        lose(entry.count);
      }
    },
    get pendingBytes() {
      return pendingBytes;
    },
    get dropped() {
      return dropped;
    },
  };
}
