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
  type FilesPort,
  PROBE_OUTPUT_LIMIT_BYTES,
  PROBE_TIMEOUT_MS,
  type ProbeRun,
  runProbe,
} from "./detection.ts";
export { catalogOf, HARNESS_CATALOG } from "./catalog/definitions.ts";
