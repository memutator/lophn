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
// scan.ts는 Deno.realPathSync 같은 동기 file API를 쓴다. barrel에 두면 file-tracking을
// 경유한 core module graph에 동기 file API가 들어간다. 호출자는 scan.ts를 직접 import한다.
export {
  decideTracking,
  type GitignoreRule,
  hardExclusion,
  type TrackingDecision,
  WRITE_TEMP_PREFIX,
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
