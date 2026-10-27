import type { Diagnostic } from "../../protocol/supervision/mod.ts";
import {
  type DiagnosticRecord,
  DIAGNOSTICS_WRITE_MAX_PENDING_BYTES,
  diagnosticsWriteInputSchema,
} from "../../protocol/diagnostics/mod.ts";

export type DiagnosticCatalog = {
  components: readonly string[];
  locations: Readonly<Record<string, string>>;
};
export type SafeLog = {
  admit(diagnostic: Diagnostic): boolean;
  noteDropped(count: number): void;
  close(): void;
  flush(): Promise<void>;
  readonly pendingBytes: number;
  readonly dropped: number;
};
const descriptions: Record<Diagnostic["kind"], string> = {
  lophn_internal: "Platform internal failure observed.",
  unattributed_observation: "Unattributed observation recorded.",
  shell_view_lifetime: "Shell view lifetime observed.",
  app_invocation_delivery_loss: "App invocation delivery loss observed.",
};

export function createSafeLog(options: {
  catalog: DiagnosticCatalog;
  sink(bytes: Uint8Array): Promise<void>;
}): SafeLog {
  // Catalog is trusted composition, not report payload. Snapshot it at admission setup.
  const components = new Set(options.catalog.components);
  const locations = new Map(Object.entries(options.catalog.locations));
  const queue: Uint8Array[] = [];
  let pendingBytes = 0;
  let dropped = 0;
  let draining: Promise<void> | undefined;
  let closed = false;
  const encoder = new TextEncoder();
  const addLoss = (count: number) => {
    dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + count);
  };
  async function drain() {
    while (queue.length && !closed) {
      const bytes = queue.shift()!;
      try {
        await options.sink(bytes);
      } catch {
        addLoss(1);
      } finally {
        pendingBytes -= bytes.length;
      }
    }
  }
  function start() {
    if (draining) return;
    draining = Promise.resolve()
      .then(drain)
      .finally(() => {
        draining = undefined;
        if (queue.length && !closed) start();
      });
  }
  return {
    admit(value) {
      const parsed = diagnosticsWriteInputSchema.safeParse({
        records: [value],
        dropped: 0,
      });
      if (closed || !parsed.success) {
        addLoss(1);
        return false;
      }
      const diagnostic = parsed.data.records[0];
      if (!components.has(diagnostic.payload.component)) {
        addLoss(1);
        return false;
      }
      const location =
        diagnostic.kind === "lophn_internal"
          ? locations.get(diagnostic.payload.location)
          : null;
      if (diagnostic.kind === "lophn_internal" && !location) {
        addLoss(1);
        return false;
      }
      const record: DiagnosticRecord = {
        at: diagnostic.payload.observed_at,
        component: diagnostic.payload.component,
        kind: "log",
        code: diagnostic.kind,
        error_type:
          diagnostic.kind === "lophn_internal"
            ? diagnostic.payload.error_class
            : null,
        location: location ?? null,
        message: descriptions[diagnostic.kind],
        redaction: {
          rule_revision: "diagnostic-fixed-catalog",
          status: "partial",
          content: null,
          redacted_items: [],
          omissions: [
            {
              location: "payload",
              reason: "private",
              message: "Only registered classification is retained.",
            },
          ],
        },
      };
      const bytes = encoder.encode(JSON.stringify(record) + "\n");
      if (pendingBytes + bytes.length > DIAGNOSTICS_WRITE_MAX_PENDING_BYTES) {
        addLoss(1);
        return false;
      }
      queue.push(bytes);
      pendingBytes += bytes.length;
      start();
      return true;
    },
    noteDropped(count) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new TypeError("invalid loss count");
      }
      addLoss(count);
    },
    close() {
      if (closed) return;
      closed = true;
      addLoss(queue.length);
      for (const bytes of queue.splice(0)) pendingBytes -= bytes.length;
    },
    flush: async () => {
      while (draining) await draining;
    },
    get pendingBytes() {
      return pendingBytes;
    },
    get dropped() {
      return dropped;
    },
  };
}
