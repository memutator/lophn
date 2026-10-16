import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idempotencyKeySchema, withReadCommon } from "../base/envelope.ts";
import { preparedBlobSchema } from "../storage/blob.ts";
import { relativePathSchema } from "../projects/values.ts";
import {
  appIdSchema,
  approvalIdSchema,
  commandKeySchema,
  invocationIdSchema,
  releaseIdSchema,
} from "./channel-values.ts";
import { readyAttestationSchema } from "./runtime.ts";
import { packageVersionNameSchema } from "./packages.ts";
import { lossStepSchema } from "./activation/migration.ts";

const MIB = 1024 * 1024;

// 준비 상한. 상한 초과·취소·worker 종료의 부분 결과는
// release.prepare 입력으로 확정하지 않는다.
export const RELEASE_SOURCE_MAX_BYTES = 64 * MIB;
export const RELEASE_BUNDLE_MAX_BYTES = 256 * MIB;
export const RELEASE_FILE_MAX_COUNT = 10_000;
export const RELEASE_PREPARATION_LIMIT_MS = 300_000;
// blueprint TS 추출 자식 상한.
export const BLUEPRINT_EXTRACT_LIMIT_MS = 10_000;

export const RELEASE_STATUSES = [
  "prepared",
  "activating",
  "active",
  "failed",
  "superseded",
] as const;
export const releaseStatusValueSchema = z.enum(RELEASE_STATUSES);
export type ReleaseStatus = z.infer<typeof releaseStatusValueSchema>;

// 준비 출처. 새 coding 준비는 필수이고 null은 과거 이력만 담는다.
// claim 상태의 사본이 아니라 claim 출처 seq다.
function ticketSourceSchemas(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    ticket: z.string().regex(/^tkt_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
    claim_seq: z.string().refine((value) => value !== "0", {
      message: "claim_seq must be positive",
    }),
  });
}
export const ticketSourceSchema = ticketSourceSchemas(false);
export const ticketSourceInputSchema = ticketSourceSchemas(true);
export type TicketSource = z.infer<typeof ticketSourceSchema>;

// schema 단계 값. from은 출발점, to는 도착점이며 to > from이다.
export const dataChangeSchema = z.object({
  from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  to: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  script_hash: sha256Schema,
  description: z.string().min(1),
  // 단계 파일 머리의 `-- loss:` 선언. release 준비가 읽어 싣는다.
  loss: z.array(lossStepSchema).optional(),
}).refine((value) => value.to > value.from, {
  message: "data change to is not after from",
});
export type DataChange = z.infer<typeof dataChangeSchema>;

// activation 시도. 독립 ID는 없고 started_seq event seq로 구분한다.
function activationSchemas(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    started_seq: z.string().refine((value) => value !== "0", {
      message: "started_seq must be positive",
    }),
    previous_release: releaseIdSchema.nullable(),
    approval: approvalIdSchema,
    expected_grants_seq: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    expected_schema: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    backup_hash: sha256Schema.nullable(),
    data_change_invocation: invocationIdSchema.nullable(),
  });
}
export const activationSchema = activationSchemas(false);
export const activationInputSchema = activationSchemas(true);
export type Activation = z.infer<typeof activationSchema>;

// bundle 안의 manifest이며 release에 별도 mutable 표로 복제하지 않는다.
export const bundleManifestSchema = z.object({
  entrypoint: relativePathSchema,
  files: z.array(z.object({
    path: relativePathSchema,
    hash: sha256Schema,
  })).max(RELEASE_FILE_MAX_COUNT).refine(
    (files) => new Set(files.map((file) => file.path)).size === files.length,
    { message: "bundle manifest file path is duplicated" },
  ),
  // 옛 이름. dependencies가 대신한다.
  sdk_dependencies: z.array(z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  })).default([]),
  dependencies: z.array(z.object({
    name: z.string().min(1),
    version: packageVersionNameSchema,
    source: z.enum(["sdk", "package", "npm", "jsr"]),
  })).default([]),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

// command 하나의 바뀐 점. `kinds`는 입력·효과·확인·되돌림 지원이고 설명·이름만 바뀐 것은
// `description_only_commands`로 구별한다. 같은 입력 schema라도 효과가 바뀌면 동작 변경이다.
export const COMMAND_CHANGE_KINDS = [
  "input",
  "effect",
  "confirm",
  "revert",
] as const;
const commandEffectSchema = z.enum(["read", "write", "external"]);
export const commandChangeSchema = z.object({
  command: commandKeySchema,
  kinds: z.array(z.enum(COMMAND_CHANGE_KINDS)),
  effect_from: commandEffectSchema.nullable(),
  effect_to: commandEffectSchema.nullable(),
  // 이전에 없던 필수 입력 이름.
  new_required_inputs: z.array(z.string().min(1)),
});
export type CommandChange = z.infer<typeof commandChangeSchema>;

// 이전 release와 사람에게 보여줄 비교. 같은 입력 schema만으로 호환을 주장하지 않는다.
// 데이터 계약(`data_schema`·`data_changes`)은 apps/data, 접근 요청(`added_permissions`·
// `removed_permissions`)은 apps/permissions의 근거로 따로 둔다.
export const releaseComparisonSchema = z.object({
  previous_release: releaseIdSchema.nullable(),
  added_permissions: z.array(z.string().min(1)),
  removed_permissions: z.array(z.string().min(1)),
  added_commands: z.array(commandKeySchema),
  removed_commands: z.array(commandKeySchema),
  // 동작이 바뀐 command(입력·효과·확인·되돌림). 설명만 바뀐 것은 포함하지 않는다.
  changed_commands: z.array(commandKeySchema),
  command_changes: z.array(commandChangeSchema),
  // 효과가 external인 command 가운데 이전에는 external이 아니었거나 없던 것.
  external_commands: z.array(commandKeySchema),
  // 이름·설명만 바뀌어 동작 변경과 구별되는 command.
  description_only_commands: z.array(commandKeySchema),
  added_automations: z.array(z.string().min(1)),
  removed_automations: z.array(z.string().min(1)),
  changed_automations: z.array(z.string().min(1)),
  added_screens: z.array(z.string().min(1)),
  removed_screens: z.array(z.string().min(1)),
  changed_screens: z.array(z.string().min(1)),
  // 선언이 삭제되거나 바뀐 problem code. 열린 problem이 있어도 닫힘 근거가 아니다.
  added_problem_code_warnings: z.array(z.string().min(1)),
  data_schema: z.object({
    from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    to: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  data_changes: z.array(dataChangeSchema),
  // 정적 비교는 업무 의미의 동일성을 증명하지 못한다. 이전 release가 있고 바뀐 것이 있으면 true이며
  // 호환이라고 자동 표시하지 않는다.
  review_required: z.boolean(),
});
export type ReleaseComparison = z.infer<typeof releaseComparisonSchema>;

function releaseSchemas(strict: boolean) {
  const fields = {
    id: releaseIdSchema,
    app: appIdSchema,
    number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    code_commit: z.string().regex(/^[0-9a-f]{40}$/),
    bundle_hash: sha256Schema,
    blueprint_hash: sha256Schema,
    data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    data_changes: z.array(dataChangeSchema),
    tests: z.array(z.string().regex(/^vrf_[0-7][0-9a-hjkmnp-tv-z]{25}$/)).min(
      1,
    ).refine(
      (tests) => new Set(tests).size === tests.length,
      { message: "release test reference is duplicated" },
    ),
    ticket_source: strict
      ? ticketSourceInputSchema.nullable()
      : ticketSourceSchema.nullable(),
    created_by: actorSchema,
    created_at: atSchema,
    status: releaseStatusValueSchema,
    activation: strict
      ? activationInputSchema.nullable()
      : activationSchema.nullable(),
    failure: z.object({
      code: z.string().min(1),
      summary: z.string().min(1),
    }).nullable(),
  };
  // activating·failed에는 마지막 시도가 필수다.
  const needsActivation = (value: { status: ReleaseStatus }) =>
    value.status === "activating" || value.status === "failed";
  // failed에는 실패 근거 요약이 필수다.
  const needsFailure = (value: { status: ReleaseStatus }) =>
    value.status === "failed";
  return z.object(fields).refine(
    (value) => needsActivation(value) ? value.activation !== null : true,
    { message: "activating and failed need an activation" },
  ).refine(
    (value) => needsFailure(value) ? value.failure !== null : true,
    { message: "failed release needs a failure" },
  );
}

export const releaseSchema = releaseSchemas(false);
export const releaseInputSchema = releaseSchemas(true);
export type Release = z.infer<typeof releaseSchema>;

// 앱 전용 프로세스의 결과. 시도·실제 schema·무결성을 core가 검증한다.
export const dataResultSchema = z.object({
  release: releaseIdSchema,
  activation_seq: z.string().refine((value) => value !== "0", {
    message: "activation_seq must be positive",
  }),
  invocation: invocationIdSchema.nullable(),
  data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  integrity_ok: z.boolean(),
});
export type DataResult = z.infer<typeof dataResultSchema>;

const releaseRecordActors = ["machine"] as const;
// 준비 접수와 진행 조회는 coding agent 통로도 보낸다.
// 접수는 요청일 뿐 release 확정이 아니고 확정(prepare)은 machine만 한다.
const releaseRequestActors = ["coding_agent", "machine"] as const;

// 준비 접수. 접수는 release 확정이 아니고 request_key는 메모리 진행 식별이다.
const releasePrepareBundleInputSchema = z.strictObject({
  app: appIdSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  request_key: commandKeySchema,
  ticket_source: ticketSourceSchema.optional(),
});
const releasePrepareBundleOutputSchema = z.object({
  request_key: commandKeySchema,
  status: z.enum(["preparing", "completed", "cancelled", "failed", "unknown"]),
  bundle_hash: sha256Schema.nullable(),
  blueprint_hash: sha256Schema.nullable(),
  manifest: bundleManifestSchema.nullable(),
});
export const releasePrepareBundle = defineCommand({
  resource: "releases",
  method: "prepare_bundle",
  name: "release.prepare_bundle",
  input: releasePrepareBundleInputSchema,
  output: releasePrepareBundleOutputSchema,
  actors: releaseRequestActors,
  errors: ["forbidden", "invalid_input", "conflict", "unavailable"],
});

// 준비 진행 조회. 작업 메모리 유실이면 unknown이다.
const releasePreparationInputSchema = z.strictObject({
  app: appIdSchema,
  request_key: commandKeySchema,
});
const releasePreparationOutputSchema = z.object({
  app: appIdSchema,
  request_key: commandKeySchema,
  status: z.enum(["preparing", "completed", "cancelled", "failed", "unknown"]),
  bundle_hash: sha256Schema.nullable(),
  blueprint_hash: sha256Schema.nullable(),
  manifest: bundleManifestSchema.nullable(),
  // 준비가 끝나 확정된 release. ticket report가 쓴다.
  release: releaseIdSchema.nullable(),
});
export const releasePreparation = defineCommand({
  resource: "releases",
  method: "preparation",
  name: "release.preparation",
  input: releasePreparationInputSchema,
  output: releasePreparationOutputSchema,
  actors: releaseRequestActors,
  errors: ["forbidden", "invalid_input", "not_found", "unavailable"],
});

// 준비 취소 요청. worker 종료 확인 뒤 정리한다.
const releaseCancelPreparationInputSchema = z.strictObject({
  app: appIdSchema,
  request_key: commandKeySchema,
});
const releaseCancelPreparationOutputSchema = z.object({
  accepted: z.literal(true),
});
export const releaseCancelPreparation = defineCommand({
  resource: "releases",
  method: "cancel_preparation",
  name: "release.cancel_preparation",
  input: releaseCancelPreparationInputSchema,
  output: releaseCancelPreparationOutputSchema,
  actors: releaseRecordActors,
  errors: ["forbidden", "invalid_input", "conflict", "unavailable"],
});

// 불변 prepared Release 확정. 신뢰된 준비 결과·같은 hash app test만 확정한다.
const releasePrepareInputSchema = z.strictObject({
  app: appIdSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  bundle_hash: sha256Schema,
  blueprint_hash: sha256Schema,
  // 정규 blueprint JSON. core는 파일을 읽지 않으므로 준비한 bundle 안의 `blueprint.json` 그대로를
  // 싣고, core가 검증기와 hash로 `blueprint_hash`와 같은지 확인한다.
  blueprint: z.record(z.string(), z.unknown()),
  manifest: bundleManifestSchema,
  data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  data_changes: z.array(dataChangeSchema),
  tests: z.array(z.string().regex(/^vrf_[0-7][0-9a-hjkmnp-tv-z]{25}$/)).min(
    1,
  ).refine(
    (tests) => new Set(tests).size === tests.length,
    { message: "release test reference is duplicated" },
  ),
  ticket_source: ticketSourceInputSchema.optional(),
  // 비교는 core가 이전 active release의 고정 blueprint로 다시 계산한다. 보내도 쓰지 않는다.
  comparison: releaseComparisonSchema.optional(),
  created_by: actorSchema,
  key: idempotencyKeySchema,
});
const releasePrepareOutputSchema = z.object({
  release: releaseSchema,
});
export const releasePrepare = defineCommand({
  resource: "releases",
  method: "prepare",
  name: "release.prepare",
  input: releasePrepareInputSchema,
  output: releasePrepareOutputSchema,
  actors: releaseRecordActors,
  errors: ["forbidden", "invalid_input", "conflict", "unavailable"],
});

// activation 시작. release·approval·schema·grants를 다시 CAS한다.
const releaseStartActivationInputSchema = z.strictObject({
  release: releaseIdSchema,
  approval: approvalIdSchema,
  previous_release: releaseIdSchema.nullable(),
  expected_grants_seq: z.number().int().nonnegative().max(
    Number.MAX_SAFE_INTEGER,
  ),
  expected_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  key: idempotencyKeySchema,
});
const releaseStartActivationOutputSchema = z.object({
  status: z.literal("activating"),
  started_seq: z.string().refine((value) => value !== "0", {
    message: "started_seq must be positive",
  }),
});
export const releaseStartActivation = defineCommand({
  resource: "releases",
  method: "start_activation",
  name: "release.start_activation",
  input: releaseStartActivationInputSchema,
  output: releaseStartActivationOutputSchema,
  actors: ["machine", "user"],
  errors: ["forbidden", "conflict", "invalid_input"],
});

// 복구 참조 확정. migration 전 보호 backup을 먼저 ledger에 확정한다.
const releaseRecordBackupInputSchema = z.strictObject({
  release: releaseIdSchema,
  activation_seq: z.string().refine((value) => value !== "0", {
    message: "activation_seq must be positive",
  }),
  backup_hash: sha256Schema,
  // backup byte를 준비한 보호 blob이다. hash가 backup_hash와 같아야 하고 일반 blob 읽기가 없는 field로
  // 등록된다(domain-model apps/data DataBackup).
  blob: preparedBlobSchema,
  data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const releaseRecordBackupOutputSchema = z.object({
  accepted: z.literal(true),
});
export const releaseRecordBackup = defineCommand({
  resource: "releases",
  method: "record_backup",
  name: "release.record_backup",
  input: releaseRecordBackupInputSchema,
  output: releaseRecordBackupOutputSchema,
  actors: releaseRecordActors,
  errors: ["conflict", "invalid_input", "unavailable"],
});

// migration 결과 확정. 성공 제출은 integrity_ok true만 받는다.
const releaseRecordDataChangeInputSchema = z.strictObject({
  result: dataResultSchema,
});
const releaseRecordDataChangeOutputSchema = z.object({
  accepted: z.literal(true),
});
export const releaseRecordDataChange = defineCommand({
  resource: "releases",
  method: "record_data_change",
  name: "release.record_data_change",
  input: releaseRecordDataChangeInputSchema,
  output: releaseRecordDataChangeOutputSchema,
  actors: releaseRecordActors,
  errors: ["conflict", "invalid_input", "unavailable"],
});

// 실패 복원 결과 확정.
const releaseRecordDataRestoreInputSchema = z.strictObject({
  result: dataResultSchema,
  backup_hash: sha256Schema,
});
const releaseRecordDataRestoreOutputSchema = z.object({
  accepted: z.literal(true),
});
export const releaseRecordDataRestore = defineCommand({
  resource: "releases",
  method: "record_data_restore",
  name: "release.record_data_restore",
  input: releaseRecordDataRestoreInputSchema,
  output: releaseRecordDataRestoreOutputSchema,
  actors: releaseRecordActors,
  errors: ["conflict", "invalid_input", "unavailable"],
});

// 새 active 참조와 이전 superseded를 같은 transaction으로 확정한다.
const releaseCompleteActivationInputSchema = z.strictObject({
  release: releaseIdSchema,
  started_seq: z.string().refine((value) => value !== "0", {
    message: "started_seq must be positive",
  }),
  result: dataResultSchema,
  attestation: readyAttestationSchema,
});
const releaseCompleteActivationOutputSchema = z.object({
  status: z.literal("active"),
  previous_release: releaseIdSchema.nullable(),
});
export const releaseCompleteActivation = defineCommand({
  resource: "releases",
  method: "complete_activation",
  name: "release.complete_activation",
  input: releaseCompleteActivationInputSchema,
  output: releaseCompleteActivationOutputSchema,
  actors: releaseRecordActors,
  errors: ["conflict", "unavailable"],
});

// activation 실패. 실패 근거와 이전 활성 참조를 남긴다.
const releaseFailActivationInputSchema = z.strictObject({
  release: releaseIdSchema,
  started_seq: z.string().refine((value) => value !== "0", {
    message: "started_seq must be positive",
  }),
  failure: z.object({
    code: z.string().min(1),
    summary: z.string().min(1),
  }),
  invocation: invocationIdSchema.nullable().optional(),
});
const releaseFailActivationOutputSchema = z.object({
  status: z.literal("failed"),
});
export const releaseFailActivation = defineCommand({
  resource: "releases",
  method: "fail_activation",
  name: "release.fail_activation",
  input: releaseFailActivationInputSchema,
  output: releaseFailActivationOutputSchema,
  actors: releaseRecordActors,
  errors: ["conflict", "invalid_input"],
});

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const RELEASE_LIST_MAX_COUNT = 200;

// release 목록. 불변 Release를 준비 순서로 보여준다.
export const releasesListInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  status: releaseStatusValueSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(RELEASE_LIST_MAX_COUNT).optional(),
});
export const releasesListOutputSchema = withReadCommon(z.object({
  releases: z.array(releaseSchema),
}));
export const releasesList = defineRead({
  resource: "releases",
  method: "list",
  name: "releases.list",
  input: releasesListInputSchema,
  output: releasesListOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const releasesGetInputSchema = z.strictObject({
  release: releaseIdSchema,
});
export const releasesGetOutputSchema = withReadCommon(z.object({
  release: releaseSchema.nullable(),
}));
export const releasesGet = defineRead({
  resource: "releases",
  method: "get",
  name: "releases.get",
  input: releasesGetInputSchema,
  output: releasesGetOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// 이전 release와의 비교 열람. 사람이 activation 전에 확인한다.
export const releasesCompareInputSchema = z.strictObject({
  release: releaseIdSchema,
  previous_release: releaseIdSchema.optional(),
});
export const releasesCompareOutputSchema = withReadCommon(z.object({
  comparison: releaseComparisonSchema,
}));
export const releasesCompare = defineRead({
  resource: "releases",
  method: "compare",
  name: "releases.compare",
  input: releasesCompareInputSchema,
  output: releasesCompareOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const RELEASE_ROUTES = [
  releasePrepareBundle,
  releasePreparation,
  releaseCancelPreparation,
  releasePrepare,
  releaseStartActivation,
  releaseRecordBackup,
  releaseRecordDataChange,
  releaseRecordDataRestore,
  releaseCompleteActivation,
  releaseFailActivation,
  releasesList,
  releasesGet,
  releasesCompare,
] as const;

const releaseSubject = releaseIdSchema;

export const releaseActivated = defineEvent("ReleaseActivated", {
  subject: releaseSubject,
  payload: z.object({
    started_seq: z.string().refine((value) => value !== "0", {
      message: "started_seq must be positive",
    }),
    previous_release: releaseIdSchema.nullable(),
    data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
});
export const releaseActivationFailed = defineEvent("ReleaseActivationFailed", {
  subject: releaseSubject,
  payload: z.object({
    started_seq: z.string().refine((value) => value !== "0", {
      message: "started_seq must be positive",
    }),
    failure: z.object({
      code: z.string().min(1),
      summary: z.string().min(1),
    }),
    invocation: invocationIdSchema.nullable().optional(),
  }),
});
