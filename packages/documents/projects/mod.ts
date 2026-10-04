export {
  type CanonicalRoot,
  deepestRegisteredRoot,
  overlappingEnabledRoots,
  type PathStyle,
  pathStyle,
  type RegisteredRoot,
  rootRelation,
  rootsOverlap,
} from "./model.ts";
export { projectsSchemaSteps } from "./schema.ts";
export { createProjectCommands } from "./commands.ts";
export { directoryScanner, openedFileEscapes } from "./scan.ts";
export {
  decideTracking,
  type GitignoreRule,
  type TrackingDecision,
} from "./rules.ts";
export {
  type DirectoryEntry,
  previewTracking,
  type RootScanner,
} from "./work.ts";
export {
  createProjectReads,
  initialTrackingProposal,
  type ProjectReadDeps,
} from "./reads.ts";
export { createProjectEventVisibility } from "./visibility.ts";
export type {
  ProjectAccessTarget,
  ProjectCandidate,
  ProjectEvent,
} from "./authorization.ts";
