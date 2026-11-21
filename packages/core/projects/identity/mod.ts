export { createGitReader, type GitReader } from "./git.ts";
export {
  type FolderIdentity,
  type FolderProbe,
  inspectFolder,
  nodeFolderProbe,
} from "./inspect.ts";
export {
  createIdentityService,
  type IdentityService,
  type IdentityServiceDeps,
} from "./service.ts";
export {
  type MatchAction,
  matchActions,
  type MatchProject,
  sharedProjects,
} from "./match.ts";
export { createMatcher, type Matcher, type MatcherDeps } from "./matcher.ts";
