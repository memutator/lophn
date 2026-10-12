import { z } from "zod";

// 설치·update는 HTTP route가 없다. shell이 보여 줄 상태 값만 둔다.
export const SUPPORTED_OS = ["linux", "macos", "windows"] as const;

export const supportedOsSchema = z.enum(SUPPORTED_OS);

export type SupportedOs = z.infer<typeof supportedOsSchema>;

export const INSTALL_METHODS = ["deb", "appimage", "app", "exe"] as const;

export const installMethodSchema = z.enum(INSTALL_METHODS);

export type InstallMethod = z.infer<typeof installMethodSchema>;

export const INSTALL_COMMANDS = [
  "lophn-desktop",
  "lophn",
  "lophn-mcp",
] as const;

// Linux 기본값. 다른 OS 경로는 문서에 없다.
export const LINUX_DATA_ROOT = "~/.lophn";
export const LINUX_DATA_ROOT_ENV = "LOPHN_HOME";
export const LINUX_DENO_CACHE = "~/.cache/lophn/deno";
export const LINUX_DATA_ENTRIES = [
  "settings",
  "ledger",
  "blobs",
  "apps",
  "sdk",
  "logs",
  "backups",
  "credentials",
] as const;

export const installCommandSchema = z.enum(INSTALL_COMMANDS);

export type InstallCommand = z.infer<typeof installCommandSchema>;

// 검증 전에는 사용 가능으로 표시하지 않는다.
export const INSTALL_READINESS = ["verified", "unverified"] as const;

export const installReadinessSchema = z.enum(INSTALL_READINESS);

export type InstallReadiness = z.infer<typeof installReadinessSchema>;

export const installReleaseSchema = z.object({
  os: supportedOsSchema,
  method: installMethodSchema,
  version: z.string().min(1),
  readiness: installReadinessSchema,
  commands: z.array(installCommandSchema),
}).refine(
  (value) =>
    (value.os === "linux" &&
      (value.method === "deb" || value.method === "appimage")) ||
    (value.os === "macos" && value.method === "app") ||
    (value.os === "windows" && value.method === "exe"),
  { message: "install method does not match os" },
).refine(
  (value) => value.readiness === "unverified" || value.method !== "appimage",
  { message: "appimage stays an alternate until its sandbox is verified" },
);

export type InstallRelease = z.infer<typeof installReleaseSchema>;

// 지원 판보다 높거나 hash가 다르면 정상 서비스를 열지 않는다.
export const SCHEMA_COMPATIBILITY = [
  "current",
  "migration_pending",
  "unsupported",
  "hash_mismatch",
  "damaged",
] as const;

export const schemaCompatibilitySchema = z.enum(SCHEMA_COMPATIBILITY);

export type SchemaCompatibility = z.infer<typeof schemaCompatibilitySchema>;

export const schemaCompatibilityStateSchema = z.object({
  installed_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  applied_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  compatibility: schemaCompatibilitySchema,
}).refine(
  (value) =>
    value.applied_version <= value.installed_version ||
    value.compatibility === "unsupported",
  { message: "a newer applied schema is unsupported" },
).refine(
  (value) =>
    value.compatibility !== "current" ||
    value.applied_version === value.installed_version,
  { message: "current requires the installed schema" },
).refine(
  (value) =>
    value.compatibility !== "migration_pending" ||
    value.applied_version < value.installed_version,
  { message: "migration pending requires an older applied schema" },
);

export type SchemaCompatibilityState = z.infer<
  typeof schemaCompatibilityStateSchema
>;

// 정상 정지 순서(architecture/platform 8). 창을 닫는 것은 이 순서가 아니다.
export const CLEAN_SHUTDOWN_STEPS = [
  "close_admission",
  "finish_commands",
  "stop_children",
  "observe_exit",
  "close_connections",
  "release_lock",
] as const;

export const cleanShutdownStepSchema = z.enum(CLEAN_SHUTDOWN_STEPS);

export type CleanShutdownStep = z.infer<typeof cleanShutdownStepSchema>;

export const cleanShutdownSchema = z.object({
  completed_through: cleanShutdownStepSchema.nullable(),
  unknown_results: z.boolean(),
});

export type CleanShutdown = z.infer<typeof cleanShutdownSchema>;

// update는 사람 설치와 정상 정지 뒤의 재시작만 필요하다.
export const RESTART_REQUIREMENTS = ["none", "after_clean_stop"] as const;

export const restartRequirementSchema = z.enum(RESTART_REQUIREMENTS);

export type RestartRequirement = z.infer<typeof restartRequirementSchema>;

export const updateNoticeSchema = z.object({
  current_version: z.string().min(1),
  offered_version: z.string().min(1),
  os: supportedOsSchema,
  schema: schemaCompatibilityStateSchema,
  restart: restartRequirementSchema,
});

export type UpdateNotice = z.infer<typeof updateNoticeSchema>;

// 같은 데이터 폴더의 writer는 하나다.
export const INSTANCE_STATES = ["absent", "running", "conflict"] as const;

export const instanceStateSchema = z.enum(INSTANCE_STATES);

export type InstanceState = z.infer<typeof instanceStateSchema>;
