export {
  type CanonicalRoot,
  deepestRegisteredRoot,
  nextRevision,
  type Project,
  rootRelation,
  searchScopeOf,
} from "./model.ts";
export { PROJECTS_IDENTITY_STEPS, projectsSchemaSteps } from "./schema.ts";
export { PROJECT_CLONE_CONTEXT, PROJECT_IDENTITY_CONTEXT } from "./contexts.ts";
export { createProjectCommands } from "./commands.ts";
export {
  gitignoreExcludes,
  type GitignoreRule,
  symlinkEscapesRoot,
} from "./rules.ts";
export {
  assignBornIdentities,
  loadProject,
  loadProjects,
} from "./store.ts";
export { recordOf } from "./record.ts";
export { createProjectReads, projectInfoList, projectInfoOf } from "./reads.ts";
export { folderResolverPort } from "./ports.ts";
