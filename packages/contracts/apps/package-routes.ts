import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  defineWorker,
  idempotencyKeySchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
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

// 공개 catalog 목록. @me 이름이 있으면 @lophn보다 먼저 정렬한다(apps/sdk#R6).
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

// 해당 version의 사용 안내. 정확한 version만 받는다(apps/sdk#R7).
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

// release의 고정 sdk_dependencies로 찾은 사용처(apps/sdk#R6).
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
  packagesUsage,
] as const;

export const PACKAGE_KIND_ROUTES = [
  "register_version",
  "list",
  "versions",
  "guide",
  "usage",
] as const;

// 입력에는 idempotency가 없고 key는 T22 approval과 같은 요청 envelope가 싣는다.
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
