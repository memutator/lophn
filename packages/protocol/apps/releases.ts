import { z } from "zod";
import { sha256Schema } from "../base/values.ts";
import { defineCommand } from "../base/route.ts";
import { relativePathSchema } from "../projects/values.ts";
import {
  appIdSchema,
  releaseIdSchema,
  toolKeySchema,
} from "./channel-values.ts";
import { packageVersionNameSchema } from "./packages.ts";
import { lossStepSchema } from "./activation/migration.ts";

const MIB = 1024 * 1024;

// 준비 상한. 상한 초과·취소·worker 종료의 부분 결과는
// release.record 입력으로 확정하지 않는다.
export const RELEASE_SOURCE_MAX_BYTES = 64 * MIB;
export const RELEASE_BUNDLE_MAX_BYTES = 256 * MIB;
export const RELEASE_FILE_MAX_COUNT = 10_000;
export const RELEASE_PREPARATION_LIMIT_MS = 300_000;
// 선언 TS 추출 자식 상한.
export const DECLARATION_EXTRACT_LIMIT_MS = 10_000;

const RELEASE_STATUSES = [
  "prepared",
  "activating",
  "active",
  "failed",
  "superseded",
] as const;
export const releaseStatusValueSchema = z.enum(RELEASE_STATUSES);

// schema 단계 값. from은 출발점, to는 도착점이며 to > from이다.
export const dataChangeSchema = z
  .object({
    from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    to: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    script_hash: sha256Schema,
    description: z.string().min(1),
    // 단계 파일 머리의 `-- loss:` 선언. release 준비가 읽어 싣는다.
    loss: z.array(lossStepSchema).optional(),
  })
  .refine((value) => value.to > value.from, {
    message: "data change to is not after from",
  });
export type DataChange = z.infer<typeof dataChangeSchema>;

// bundle 안의 manifest이며 release에 별도 mutable 표로 복제하지 않는다.
export const bundleManifestSchema = z.object({
  entrypoint: relativePathSchema,
  files: z
    .array(
      z.object({
        path: relativePathSchema,
        hash: sha256Schema,
      }),
    )
    .max(RELEASE_FILE_MAX_COUNT)
    .refine(
      (files) => new Set(files.map((file) => file.path)).size === files.length,
      { message: "bundle manifest file path is duplicated" },
    ),
  // 옛 이름. dependencies가 대신한다.
  sdk_dependencies: z
    .array(
      z.object({
        name: z.string().min(1),
        version: z.string().min(1),
      }),
    )
    .default([]),
  dependencies: z
    .array(
      z.object({
        name: z.string().min(1),
        version: packageVersionNameSchema,
        source: z.enum(["sdk", "package", "npm", "jsr"]),
      }),
    )
    .default([]),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

// 다른 앱·project가 쓰는 공개 tool을 지우는 release면 준비 결과가 그 tool을 싣는다. 막지 않고 알린다.
export const removedPublicToolSchema = z.object({
  tool: toolKeySchema,
});

// 공개 skill을 지우는 release면, 그 앱이 할당된 agent가 있을 때 그 skill을 싣는다. 막지 않고 알린다.
export const removedPublicSkillSchema = z.object({
  skill: z.string().min(1),
});

// 앱 place의 session이 앱 source의 HEAD commit으로 release를 준비한다. 검사에 떨어진 것은 오류가 아니라
// failed 출력이다: 오류 code는 model에 고정 글만 닿아 떨어진 이유가 가려진다.
// source 폴더가 없거나 commit이 없는 것도 build 단계의 failed다.
const releasePrepareOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("prepared"),
    release: z.object({
      id: releaseIdSchema,
      number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      status: releaseStatusValueSchema,
      code_commit: z.string().regex(/^[0-9a-f]{40}$/),
      bundle_hash: sha256Schema,
      data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
    removed_public_tools: z.array(removedPublicToolSchema),
    removed_public_skills: z.array(removedPublicSkillSchema),
  }),
  z.object({
    status: z.literal("failed"),
    stage: z.enum([
      "build",
      "dependencies",
      "migration",
      "handlers",
      "release",
    ]),
    reason: z.string().min(1),
  }),
]);
export type ReleasePrepareOutput = z.infer<typeof releasePrepareOutputSchema>;
export const releasePrepare = defineCommand({
  resource: "releases",
  method: "prepare",
  name: "release.prepare",
  input: z.strictObject({ app: appIdSchema }),
  output: releasePrepareOutputSchema,
  actors: ["agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

const RELEASE_LIST_MAX_COUNT = 200;

// release 목록. 불변 Release를 준비 순서로 보여준다.
export const releasesListInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  status: releaseStatusValueSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(RELEASE_LIST_MAX_COUNT).optional(),
});
export const releasesGetInputSchema = z.strictObject({
  release: releaseIdSchema,
});

// 앱 place의 session이 prepared release를 올린다. activation이 끝날 때까지 기다리되 상한을 넘으면 running이다.
// 동의가 필요하면 묻기만 하고 waiting_consent를 바로 돌려준다. failure는 release의 failure 그대로다
// (activation.ts가 이 file을 import하므로 그쪽 schema를 가져오지 않고 같은 꼴로 적는다).
const releaseActivateOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    release: releaseIdSchema,
    previous_release: releaseIdSchema.nullable(),
  }),
  z.object({
    status: z.literal("failed"),
    release: releaseIdSchema,
    failure: z.object({
      code: z.string().min(1),
      summary: z.string().min(1),
      restored: z.boolean().nullable(),
    }),
  }),
  z.object({
    status: z.literal("waiting_consent"),
    release: releaseIdSchema,
  }),
  z.object({ status: z.literal("running"), release: releaseIdSchema }),
]);
export type ReleaseActivateOutput = z.infer<typeof releaseActivateOutputSchema>;
export const releaseActivate = defineCommand({
  resource: "releases",
  method: "activate",
  name: "release.activate",
  input: z.strictObject({ release: releaseIdSchema }),
  output: releaseActivateOutputSchema,
  actors: ["agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const RELEASE_ROUTES = [releasePrepare, releaseActivate] as const;
