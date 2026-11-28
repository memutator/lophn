export {
  COPY_MAX_BYTES,
  COPY_MAX_ENTRIES,
  copyGitignoredFiles,
  detectWorktreeInclude,
  type IncludeDetectFs,
  isSafeRelativePattern,
  nodeIncludeDetectFs,
} from "./copy.ts";
export {
  countUnpushedCommits,
  ensureUniqueBranchName,
  GIT_DEFAULT_TIMEOUT_MS,
  GIT_FETCH_TIMEOUT_MS,
  type GitRunner,
  type GitRunResult,
  hasSubmodules,
  type InspectedGitRepo,
  inspectGitRepo,
  isGitAuthError,
  isWorktreeLockedInGit,
  listGitWorktrees,
  type ParsedGitWorktree,
  type ParsedPorcelainStatus,
  parsePorcelainV2Z,
  pruneWorktreesSafely,
  readGitdirAdminName,
  readGitDirectoryPath,
  readWorktreeGitStatus,
  redactGitUrlCredentials,
  RepoGitMutex,
  resolveBaseRef,
  runGit,
  verifyGitdirPointsToCommonDir,
} from "./git.ts";
export {
  type AskPersonGate,
  createWorktreeHandlers,
  type WorktreeHandlersDeps,
} from "./handlers.ts";
export {
  assertSafeRefName,
  computeWorktreePath,
  generateAutoBranchName,
  isFilesystemRoot,
  isSameOrInside,
  isStrictlyInside,
  safeRealpath,
  shortCommonDirHash,
  slugifyBranchPrefix,
  slugifyRepoName,
  slugifySeed,
  validateWorktreesRoot,
  WINDOWS_PATH_BUDGET,
} from "./paths.ts";
export { WORKTREES_SCHEMA_STEPS } from "./schema.ts";
export {
  createWorktreeService,
  TEARDOWN_TIMEOUT_MS,
  type WorktreeActivity,
  type WorktreeHookRunner,
  type WorktreeService,
  type WorktreeServiceDeps,
} from "./service.ts";
export { projectsWorktreesFolderSetting } from "./setting.ts";
export {
  loadManagedReadyWorktrees,
  loadProjectWorktrees,
  loadWorktreeById,
  loadWorktreeByIdempotencyKey,
  loadWorktreesByStatuses,
  loadWorktreeSettings,
  type StoredWorktreeRow,
  toPublicRecord,
  WORKTREES_CONTEXT,
  WORKTREES_PRINCIPAL,
  worktreesStoreCommand,
} from "./store.ts";
export {
  createWorktreeWatcher,
  type WorktreeWatcher,
  type WorktreeWatcherDeps,
} from "./watcher.ts";
