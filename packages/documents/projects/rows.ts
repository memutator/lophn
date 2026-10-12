import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Folder,
  folderSchema,
  type Project,
  projectSchema,
  type TrackingPattern,
  trackingPatternSchema,
  trackingRuleSetSchema,
} from "../../protocol/projects/mod.ts";
import type { SqlRow } from "../../protocol/platform/mod.ts";
import { validateFolderRoots } from "./model.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored project" });
}

function flag(value: unknown): Result<boolean> {
  if (value === 1 || value === 1n) return ok(true);
  if (value === 0 || value === 0n) return ok(false);
  return invalidStored();
}

export function projectFromRows(
  row: SqlRow,
  folderRows: readonly SqlRow[],
  patternRows: readonly SqlRow[],
): Result<Project> {
  const enabled = flag(row.tracking_enabled);
  if (!enabled.ok) return enabled;
  const gitignore = flag(row.use_gitignore);
  if (!gitignore.ok) return gitignore;
  const folders: Folder[] = [];
  for (let index = 0; index < folderRows.length; index++) {
    const folder = folderRows[index]!;
    if (folder.position !== index && folder.position !== BigInt(index)) {
      return invalidStored();
    }
    const parsed = folderSchema.safeParse({
      path: folder.path,
      description: folder.description,
    });
    if (!parsed.success) return invalidStored();
    folders.push(parsed.data);
  }
  if (!validateFolderRoots(folders).ok) return invalidStored();
  const patterns: TrackingPattern[] = [];
  for (let index = 0; index < patternRows.length; index++) {
    const pattern = patternRows[index]!;
    if (pattern.position !== index && pattern.position !== BigInt(index)) {
      return invalidStored();
    }
    const parsed = trackingPatternSchema.safeParse({
      effect: pattern.effect,
      glob: pattern.glob,
    });
    if (!parsed.success) return invalidStored();
    patterns.push(parsed.data);
  }
  const tracking = trackingRuleSetSchema.safeParse({
    enabled: enabled.value,
    patterns,
    use_gitignore: gitignore.value,
  });
  if (!tracking.success) return invalidStored();
  const project = projectSchema.safeParse({
    id: row.id,
    name: row.name,
    title: row.title,
    purpose: row.purpose,
    revision: row.revision,
    status: row.status,
    folders,
    tracking: tracking.data,
  });
  return project.success ? ok(project.data) : invalidStored();
}
