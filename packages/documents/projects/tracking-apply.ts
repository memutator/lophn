import type { Result } from "../../base/mod.ts";
import { err, ok } from "../../base/mod.ts";
import type {
  Folder,
  Project,
  TrackingPreview,
  TrackingRuleSet,
} from "../../contracts/documents/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";
import { overlappingEnabledRoots } from "./model.ts";
import type { ProjectCandidate } from "./authorization.ts";
import { enabledRoots, loadProjects } from "./store.ts";

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 적용은 미리 본 folders·tracking·base_revision과 같아야 한다.
export function previewMatches(
  preview: TrackingPreview,
  project: string,
  baseRevision: string,
  folders: readonly Folder[],
  tracking: TrackingRuleSet,
): boolean {
  return preview.project === project &&
    preview.base_revision === baseRevision &&
    preview.complete === true &&
    sameJson(preview.folders, folders) &&
    sameJson(preview.tracking, tracking);
}

export function trackingChanged(
  before: Project,
  after: { folders: readonly Folder[]; tracking: TrackingRuleSet },
) {
  return {
    before: { folders: before.folders, tracking: before.tracking },
    after: { folders: [...after.folders], tracking: after.tracking },
  };
}

export function enabledOverlap(
  tx: Tx,
  next: ProjectCandidate,
  self: string,
): Result<void> {
  const projects = loadProjects(tx.sql);
  if (!projects.ok) return projects;
  const others = enabledRoots(projects.value).filter((root) =>
    root.project !== self
  );
  const overlap = overlappingEnabledRoots([
    ...others,
    ...next.folders.map((folder) => ({
      project: self,
      path: folder.path,
      enabled: true,
    })),
  ]);
  if (!overlap.ok) return overlap;
  return overlap.value === null
    ? ok(undefined)
    : err({ code: "conflict", message: "enabled tracking roots overlap" });
}
