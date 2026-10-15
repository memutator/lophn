export {
  type CanonicalRoot,
  deepestRegisteredRoot,
  nextRevision,
  type PathStyle,
  pathStyle,
  type Project,
  rootRelation,
  rootsOverlap,
  searchScopeOf,
} from "./model.ts";
export { projectsSchemaSteps } from "./schema.ts";
export { createProjectCommands } from "./commands.ts";
export {
  gitignoreExcludes,
  type GitignoreRule,
  symlinkEscapesRoot,
} from "./rules.ts";
export { loadProject, loadProjects } from "./store.ts";
export { recordOf } from "./record.ts";
export {
  createProjectReads,
  projectInfoList,
  type ProjectInfoOf,
  projectInfoOf,
  type ProjectReadDeps,
} from "./reads.ts";
export { folderResolverPort, projectManagerProvisioningPort } from "./ports.ts";
export type { ProjectAccessTarget } from "./authorization.ts";
