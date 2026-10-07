import { err, ok, type Result } from "../../packages/base/mod.ts";
import { REPAIR_CONTEXT_ROUTES } from "../../packages/contracts/coding-agent/mod.ts";
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import type { CoreRuntime } from "./runtime.ts";
import type { DocumentsChannel } from "./documents-serving.ts";
import { checkLaunchSpec } from "../../packages/platform/security/mod.ts";

export const REPAIR_WORKER_KIND = "coding-agent/worker";
export function repairWorkerSpec(): KindLaunchSpec | undefined {
  const spec: KindLaunchSpec = {
    kind: REPAIR_WORKER_KIND,
    entry: new URL("../worker/coding-agent/repair-context.ts", import.meta.url).pathname,
    allow_read: [], allow_write: [], allow_net: ["127.0.0.1"], allow_run: [], allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"], policy: "always", memory_limit_bytes: 268_435_456,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}

export function registerRepairReads(runtime: CoreRuntime, channel: DocumentsChannel): void {
  for (const route of REPAIR_CONTEXT_ROUTES) {
    runtime.reads.set(`${route.resource}/${route.method}`, async (ctx, input, credential): Promise<Result<unknown>> => {
      if (!ctx.scope.operations.includes(route.name)) return err({ code: "forbidden", message: "operation forbidden" });
      if (!credential || !runtime.current(ctx.credential_ref).ok) return err({ code: "unauthorized", message: "credential이 없다" });
      const result = await channel.request(`repair_context.${route.method}`, { credential, principal: ctx.principal, input }, 30_000);
      if (!result.ok) return result;
      if (!runtime.current(ctx.credential_ref).ok) return err({ code: "unauthorized", message: "credential이 없다" });
      const value = result.value as Record<string, unknown>;
      return ok(value);
    });
  }
}
