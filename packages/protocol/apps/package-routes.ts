import { z } from "zod";
import {
  BLOB_READ_MAX_BYTES,
  blobReadResultSchema,
  preparedBlobSchema,
} from "../storage/blob.ts";
import {
  defineCommand,
  defineMemory,
  defineRead,
  defineWorker,
} from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { relativePathSchema } from "../projects/values.ts";
import { defineEvent } from "../base/event.ts";
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

// package.register_version 입력. 검증된 설치 결과의 hash만 받는다.
const packageRegisterVersionInputSchema = z.strictObject({
  name: packageNameSchema,
  description: z.string().regex(/\S/).refine(
    (value) => !/[\r\n]/.test(value),
    { message: "description must be a single line" },
  ),
  // 새 package는 종류가 없다(null). core의 kind 열이 undefined를 못 받아 optional 대신 null로 둔다.
  kind: packageKindSchema.nullable().default(null),
  version: packageVersionNameSchema,
  // publish하는 앱. 이미 있는 package면 주인과 같아야 한다.
  owner_app: idSchema("app"),
  permissions: z.array(z.string().min(1)).optional(),
  bundle_hash: z.string().regex(/^[0-9a-f]{64}$/),
  guide_hash: z.string().regex(/^[0-9a-f]{64}$/),
  // 안내 byte를 blob으로 준비한 결과다. 있으면 같은 transaction에서 `package_version/guide` field로
  // 등록해 안내 원문을 읽을 수 있다. hash가 guide_hash와 같아야 한다. 없으면 hash만 남고 원문은 못 읽는다.
  guide_blob: preparedBlobSchema.optional(),
});
export type PackageRegisterVersionInput = z.infer<
  typeof packageRegisterVersionInputSchema
>;

// Package id는 등록 결과다. 입력에 없다.
export const packageRegisterVersionOutputSchema = z.object({
  package: packageSchema,
  version: packageVersionSchema,
});

// Package kind 불변·공개 판 불변은 handler가 검사한다.
export const packageRegisterVersion = defineCommand({
  resource: "packages",
  method: "register_version",
  name: "package.register_version",
  input: packageRegisterVersionInputSchema,
  output: packageRegisterVersionOutputSchema,
  actors: ["machine"],
  errors: ["forbidden", "invalid_input", "conflict"],
});

// 앱 source 안 상대 위치. 절대 경로·루트 밖 `..`·빈 조각은 거절한다.
export const sourceRelativePathSchema = z.string().min(1).refine(
  (value) =>
    value === "." ||
    (!/^[\\/]|^[A-Za-z]:|\\/.test(value) && !value.includes("\u0000") &&
      !/[\r\n]/.test(value) &&
      value.split("/").every((part) => part !== ".." && part !== "")),
  { message: "path must stay inside source" },
);

// App Engineer가 자기 앱 code의 일부를 사용자 package로 낸다. 앱 source의 HEAD commit에서 파일을 읽는 I/O라 memory route이고,
// core가 읽고 검사한 뒤 안에서 machine route package.register_version을 부른다. 낼 때 사람 승인은 없다.
export const packagePublishInputSchema = z.strictObject({
  app: appIdSchema,
  name: packageNameSchema.refine((name) => name.startsWith("@me/"), {
    message: "published package name must be @me/...",
  }),
  version: packageVersionNameSchema,
  description: z.string().regex(/\S/).refine(
    (value) => !/[\r\n]/.test(value),
    { message: "description must be a single line" },
  ),
  // 앱 source HEAD commit 안의 package 폴더.
  path: relativePathSchema,
  guide: z.strictObject({
    purpose: z.string().regex(/\S/),
    api: z.string().regex(/\S/),
    examples: z.string().regex(/\S/),
  }),
  permissions: z.array(z.string().min(1)),
  key: idempotencyKeySchema,
});
export type PackagePublishInput = z.infer<typeof packagePublishInputSchema>;

export const packagePublish = defineMemory({
  resource: "packages",
  method: "publish",
  name: "package.publish",
  input: packagePublishInputSchema,
  output: packageRegisterVersionOutputSchema,
  actors: ["agent"],
  errors: ["forbidden", "invalid_input", "conflict", "unavailable"],
});

// 설치 사본의 내장 SDK(@lophn/*) 목록과 안내. catalog가 아니라 `<data root>/sdk`가 정본이라 disk를 읽는 memory route다.
// lophn과 App Engineer는 그 폴더를 직접 읽을 수 없다. name이 없으면 설치된 것 전부(이름순)이고 guide는 null,
// name이 있으면 packages는 그 하나이고 guide는 본문이다. 설치되지 않은 이름은 not_found다.
export const packagesBuiltinInputSchema = z.strictObject({
  name: packageNameSchema.refine((name) => name.startsWith("@lophn/"), {
    message: "built-in package name must be @lophn/...",
  }).optional(),
});
export const builtinPackageSchema = z.object({
  name: packageNameSchema,
  version: packageVersionNameSchema,
  has_guide: z.boolean(),
});
export const packagesBuiltinOutputSchema = z.object({
  packages: z.array(builtinPackageSchema),
  guide: z.object({ text: z.string(), truncated: z.boolean() }).nullable(),
});
export type BuiltinPackage = z.infer<typeof builtinPackageSchema>;
export const packagesBuiltin = defineMemory({
  resource: "packages",
  method: "builtin",
  name: "packages.builtin",
  input: packagesBuiltinInputSchema,
  output: packagesBuiltinOutputSchema,
  actors: ["agent"],
  errors: [
    "invalid_input",
    "not_found",
    "unavailable",
    "forbidden",
    "unauthorized",
  ],
});

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const PACKAGE_LIST_MAX_COUNT = 200;

// 공개 catalog 목록. @me 이름이 있으면 @lophn보다 먼저 정렬한다.
// 정렬은 snapshot을 읽는 구체 목록 구현이 하고, contract는 page schema만 정한다.
const packagesListInputSchema = z.strictObject({
  name: packageNameSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(PACKAGE_LIST_MAX_COUNT).optional(),
});
const packagesListOutputSchema = withReadCommon(z.object({
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

const packagesVersionsInputSchema = z.strictObject({
  name: packageNameSchema,
});
const packagesVersionsOutputSchema = withReadCommon(z.object({
  name: packageNameSchema,
  owner_app: idSchema("app").nullable(),
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
const packagesGuideInputSchema = z.strictObject({
  name: packageNameSchema,
  version: packageVersionNameSchema,
});
// 안내 원문은 blob store의 guide_hash 대상이다(blobs/read로 읽는다).
const packagesGuideOutputSchema = withReadCommon(z.object({
  name: packageNameSchema,
  version: packageVersionNameSchema,
  guide_hash: z.string().regex(/^[0-9a-f]{64}$/),
}));
const packagesGuide = defineWorker({
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
const packagesGuideBodyInputSchema = z.strictObject({
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
const packagesUsageInputSchema = z.strictObject({
  name: packageNameSchema,
  version: packageVersionNameSchema,
});
const packageUsageSchema = z.object({
  app: appIdSchema,
  release: releaseIdSchema,
});
const packagesUsageOutputSchema = withReadCommon(z.object({
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
  packagePublish,
  packagesBuiltin,
  packagesList,
  packagesVersions,
  packagesGuide,
  packagesGuideBody,
  packagesUsage,
] as const;

// 입력에는 idempotency가 없고 key는 approval과 같은 요청 envelope가 싣는다.

const packageSubject = z.custom<`pkg_${string}`>(
  (value) =>
    typeof value === "string" &&
    /^pkg_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(value),
);

const packageVersionRegisteredPayloadSchema = z.object({
  name: packageNameSchema,
  kind: packageKindSchema.nullable().default(null),
  version: packageVersionNameSchema,
  permissions: z.array(z.string().min(1)).optional(),
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
