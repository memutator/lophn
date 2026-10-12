import { z } from "zod";
import {
  BLOB_READ_MAX_BYTES,
  blobReadResultSchema,
  preparedBlobSchema,
} from "../storage/blob.ts";
import { defineCommand, defineRead, defineWorker } from "../base/route.ts";
import { defineEvent } from "../events/events.ts";
import { idempotencyKeySchema, withReadCommon } from "../base/envelope.ts";
import { sha256Schema } from "../base/values.ts";
import { appIdSchema, releaseIdSchema } from "./channel-values.ts";
import {
  packageKindSchema,
  packageNameSchema,
  packageSchema,
  packageVersionNameSchema,
  packageVersionSchema,
} from "./packages.ts";

// package.register_version 입력. 검증된 설치 결과의 hash만 받는다
// (domain-model apps/sdk command 표).
export const packageRegisterVersionInputSchema = z.strictObject({
  name: packageNameSchema,
  description: z.string().regex(/\S/).refine(
    (value) => !/[\r\n]/.test(value),
    { message: "description must be a single line" },
  ),
  kind: packageKindSchema,
  version: packageVersionNameSchema,
  bundle_hash: z.string().regex(/^[0-9a-f]{64}$/),
  guide_hash: z.string().regex(/^[0-9a-f]{64}$/),
  // 안내 byte를 blob으로 준비한 결과다. 있으면 같은 transaction에서 `package_version/guide` field로
  // 등록해 안내 원문을 읽을 수 있다. hash가 guide_hash와 같아야 한다. 없으면 hash만 남고 원문은 못 읽는다.
  guide_blob: preparedBlobSchema.optional(),
});
export type PackageRegisterVersionInput = z.infer<
  typeof packageRegisterVersionInputSchema
>;

// Package id는 등록 결과다. 입력에 없다(domain-model apps/sdk Package 표).
export const packageRegisterVersionOutputSchema = z.object({
  package: packageSchema,
  version: packageVersionSchema,
});

// Package kind 불변·공개 판 불변은 handler가 검사한다(domain-model apps/sdk).
export const packageRegisterVersion = defineCommand({
  resource: "packages",
  method: "register_version",
  name: "package.register_version",
  input: packageRegisterVersionInputSchema,
  output: packageRegisterVersionOutputSchema,
  actors: ["machine"],
  errors: ["forbidden", "invalid_input", "conflict"],
});

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const PACKAGE_LIST_MAX_COUNT = 200;

// 공개 catalog 목록. @me 이름이 있으면 @lophn보다 먼저 정렬한다.
// 정렬은 snapshot을 읽는 구체 목록 구현이 하고, contract는 page schema만 정한다.
export const packagesListInputSchema = z.strictObject({
  name: packageNameSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(PACKAGE_LIST_MAX_COUNT).optional(),
});
export const packagesListOutputSchema = withReadCommon(z.object({
  packages: z.array(packageSchema),
}));
export const packagesList = defineRead({
  resource: "packages",
  method: "list",
  name: "packages.list",
  input: packagesListInputSchema,
  output: packagesListOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const packagesVersionsInputSchema = z.strictObject({
  name: packageNameSchema,
});
export const packagesVersionsOutputSchema = withReadCommon(z.object({
  name: packageNameSchema,
  versions: z.array(packageVersionSchema),
}));
export const packagesVersions = defineRead({
  resource: "packages",
  method: "versions",
  name: "packages.versions",
  input: packagesVersionsInputSchema,
  output: packagesVersionsOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// 해당 version의 사용 안내. 정확한 version만 받는다.
export const packagesGuideInputSchema = z.strictObject({
  name: packageNameSchema,
  version: packageVersionNameSchema,
});
// 안내 원문은 blob store의 guide_hash 대상이다(→ platform/blob의 blobs/read).
export const packagesGuideOutputSchema = withReadCommon(z.object({
  name: packageNameSchema,
  version: packageVersionNameSchema,
  guide_hash: z.string().regex(/^[0-9a-f]{64}$/),
}));
export const packagesGuide = defineWorker({
  resource: "packages",
  method: "guide",
  name: "packages.guide",
  input: packagesGuideInputSchema,
  output: packagesGuideOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// 안내 원문(`package_version/guide` blob)의 읽기다. 일반 `blobs/read`를 열지 않고 이 한 field만 읽는다:
// owner_kind·field는 고정이고 입력은 package 이름·정확한 version과 읽을 구간뿐이라 다른 blob(문서 판 파일·
// format module·problem log 등)을 가리킬 수 없다. 등록되지 않은 version·안내 없는 version은 없는 것과 같은 답이다.
export const packagesGuideBodyInputSchema = z.strictObject({
  name: packageNameSchema,
  version: packageVersionNameSchema,
  offset_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  length_bytes: z.number().int().min(0).max(BLOB_READ_MAX_BYTES),
});
export const packagesGuideBody = defineRead({
  resource: "packages",
  method: "guide_body",
  name: "packages.guide_body",
  input: packagesGuideBodyInputSchema,
  output: blobReadResultSchema,
  actors: readActors,
  errors: readErrors,
});

// release의 고정 sdk_dependencies로 찾은 사용처.
export const packagesUsageInputSchema = z.strictObject({
  name: packageNameSchema,
  version: packageVersionNameSchema,
});
export const packageUsageSchema = z.object({
  app: appIdSchema,
  release: releaseIdSchema,
});
export type PackageUsage = z.infer<typeof packageUsageSchema>;
export const packagesUsageOutputSchema = withReadCommon(z.object({
  name: packageNameSchema,
  version: packageVersionNameSchema,
  usages: z.array(packageUsageSchema),
}));
export const packagesUsage = defineRead({
  resource: "packages",
  method: "usage",
  name: "packages.usage",
  input: packagesUsageInputSchema,
  output: packagesUsageOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const PACKAGE_ROUTES = [
  packageRegisterVersion,
  packagesList,
  packagesVersions,
  packagesGuide,
  packagesGuideBody,
  packagesUsage,
] as const;

export const PACKAGE_KIND_ROUTES = [
  "register_version",
  "list",
  "versions",
  "guide",
  "guide_body",
  "usage",
] as const;

// 입력에는 idempotency가 없고 key는 approval과 같은 요청 envelope가 싣는다.
export const packageRegisterRequestSchema = z.strictObject({
  input: packageRegisterVersionInputSchema,
  key: idempotencyKeySchema,
});

const packageSubject = z.custom<`pkg_${string}`>(
  (value) =>
    typeof value === "string" &&
    /^pkg_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(value),
);

export const packageVersionRegisteredPayloadSchema = z.object({
  name: packageNameSchema,
  kind: packageKindSchema,
  version: packageVersionNameSchema,
  bundle_hash: sha256Schema,
  guide_hash: sha256Schema,
});

export const packageVersionRegistered = defineEvent(
  "PackageVersionRegistered",
  {
    subject: packageSubject,
    payload: packageVersionRegisteredPayloadSchema,
  },
);

export const PACKAGE_EVENTS = [
  packageVersionRegistered,
] as const;
