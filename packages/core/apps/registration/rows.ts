import { err, ok, type Result } from "../../../base/mod.ts";
import { type App, appSchema } from "../../../protocol/apps/mod.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored app" });
}

function flag(value: unknown): Result<boolean> {
  if (value === 1 || value === 1n) return ok(true);
  if (value === 0 || value === 0n) return ok(false);
  return invalidStored();
}

export function appFromRow(row: Record<string, unknown>): Result<App> {
  const enabled = flag(row.run_enabled);
  if (!enabled.ok) return enabled;
  const app = appSchema.safeParse({
    id: row.id,
    slug: row.slug,
    project: row.project,
    name: row.name,
    description: row.description,
    planning_version: row.planning_version,
    source_path: row.source_path,
    active_release: row.active_release,
    revision: row.revision,
    run_enabled: enabled.value,
    status: row.status,
  });
  return app.success ? ok(app.data) : invalidStored();
}
