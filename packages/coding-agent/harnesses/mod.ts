// harnesses leaf의 공통 entry다. 조립이 쓰는 것만 내보낸다(architecture).
export {
  ADAPTER_REVISION,
  authOf,
  type CapabilityState,
  CATALOG_REVISION,
  type ConfigTargetSpec,
  type DetectionCommand,
  type DetectionSpec,
  type EnvironmentSupport,
  type ExecutionSpec,
  type HarnessDefinition,
  type HookSpec,
  PROBE_OUTCOMES,
  type ProbeOutcome,
  probeResultOf,
  type ProbeSeat,
  type ProbeSpec,
  type SkillTargetSpec,
  versionOf,
} from "./model.ts";
export {
  ALIAS_HOP_LIMIT,
  type Candidate,
  type DetectionKey,
  discover,
  type ExecPort,
  FALLBACK_DIRS as DETECTION_FALLBACK_DIRS,
  type FilesPort,
  PROBE_OUTPUT_LIMIT_BYTES,
  PROBE_TIMEOUT_MS,
  type ProbeRun,
  runProbe,
} from "./detection.ts";
export { environmentSupported } from "./detection.ts";
export { catalogOf, HARNESS_CATALOG } from "./catalog/definitions.ts";
export {
  type ApplyResult,
  type FilePort,
  install,
  observe,
  type ObservedHashes,
  type Store,
} from "./integration/apply.ts";
export { recover, remove } from "./integration/remove.ts";
export {
  chosenHarness,
  type InstallPlan,
  type PlanError,
  type PlannedResource,
  planOf,
  type PlanResult,
} from "./integration/plan.ts";
export {
  type Digest,
  type Journal,
  type JournalEntry,
  type OwnedResource,
  type Receipt,
  RECEIPT_SCHEMA_VERSION,
} from "./integration/receipt.ts";
export {
  filePort,
  integrationsStore,
  storeOf,
  WRITE_TEMP_SUFFIX,
} from "./integration/journal.ts";
export {
  type BuildInput,
  buildResources,
  HOOK_OWNER_TOKEN,
} from "./builder.ts";
export type { BuildOutput, RootGroup } from "./builder.ts";
export {
  type LaunchInputs,
  launchOf,
  mcpEntryOf,
  type McpLaunch,
} from "./launch.ts";
export {
  skillGuidanceOf,
  type SkillRootView,
  type SkillShadow,
  skillShadowsOf,
} from "./skills.ts";
export { type RootInputs, rootOf, versionAtLeast } from "./resolvers.ts";
export { setOwned as setTomlOwned } from "./adapters/toml.ts";
export {
  type LoadingConnection,
  type LoadingInput,
  type LoadingPorts,
  type LoadingReport,
  type LoadingTrust,
  LOPHN_SKILL_NAMES,
  type McpEntry,
  type McpProbePort,
  type McpProbeRequest,
  type McpProbeResult,
  observeLoading,
  probeRequestOf,
  type ReadPort,
  unobservedLoading,
} from "./loading.ts";
export { MCP_PROBE_TIMEOUT_MS, stdioMcpProbe } from "./mcp-probe.ts";
export {
  type InspectInput,
  inspectIntegration,
  type Inspection,
  type InspectPorts,
} from "./inspect.ts";
export {
  INSTALL_COMPONENTS,
  type InstallInput,
  type InstallOutcome,
  type InstallPorts,
  installSelected,
  planSelected,
  removeSelected,
  selectedWriteFiles,
  updateSelected,
} from "./install.ts";
export {
  detectHarnesses,
  type DetectionCache,
  detectionCacheOf,
  type DetectOutcome,
  type DetectPorts,
  NATIVE_ENVIRONMENT,
  parseDetections,
} from "./detect.ts";
export {
  decideDefaultHarness,
  type DefaultHarnessDecision,
  type DefaultHarnessState,
  runnableOf,
  type SelectionEntry,
} from "./selection.ts";
