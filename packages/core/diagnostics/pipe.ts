import { err, ok, type Result } from "../../base/mod.ts";
import type { Diagnostic } from "../../protocol/supervision/mod.ts";
import {
  DIAGNOSTICS_WRITE_OP,
  type DiagnosticsWriteOutput,
  diagnosticsWriteRequestSchema,
} from "../../protocol/diagnostics/mod.ts";
import type { SafeLog } from "./log.ts";

// The owner supplies current authority, never a principal/process/scope submitted in payload.
export type DiagnosticAuthority = {
  principal: string;
  process: string;
  task: string;
  scope: readonly string[];
  permits(diagnostic: Diagnostic): boolean;
};
type DiagnosticIngress = {
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

// send resolves when a private worker reply arrives. Never await it in a command.
