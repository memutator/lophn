export {
  canonicalOrder,
  containsProtected,
  type FsScope,
  isSameOrInside,
  type NetScope,
  type PathResolver,
  type ProtectedRoots,
  type ResolvedFsScope,
  type ResolvedRequirement,
  resolveRequirement,
} from "./model.ts";
export {
  appFlags,
  type AppPaths,
  type FlagSet,
  LIMIT_KEYS,
  type LimitKey,
  migrationFlags,
  type PlatformPorts,
  socketFlags,
} from "./flags.ts";
export {
  credentialRoots,
  keychainRoots,
  protectedRoots,
} from "./protected-paths.ts";
export { realPathResolver } from "./adapters/realpath.ts";
export { createGrantCommands, GRANT_APPROVAL_CONCERN } from "./commands.ts";
export { createGrantsReads } from "./reads.ts";
export { permissionsSchemaSteps } from "./schema.ts";
export {
  type AppDeclarations,
  type AutomationDeclarationFact,
  type CurrentDeclarations,
  currentDeclarations,
  declarationsOf,
} from "./declarations.ts";
export {
  type AccessEntry,
  type AutomationEntry,
  type EffectiveInput,
  type EffectiveScope,
  effectiveScope,
} from "./effective.ts";
export {
  buildGrantDisplay,
  type CombinationWarning,
  type GrantDisplay,
  type RequirementDisplay,
  WARNING_KEYS,
  type WarningKey,
} from "./display.ts";
