import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";

// prerelease·build 꼬리는 받지 않는다. ledger의 package_versions.version CHECK와 같은 모양이다.
export const packageVersionNameSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, {
    message: "expected one exact x.y.z version",
  });

export const packageNameSchema = z
  .string()
  .regex(/^@(?:me|lophn)\/[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const packageVersionSchema = z.object({
  version: packageVersionNameSchema,
  bundle_hash: sha256Schema,
  guide_hash: sha256Schema,
  // 요구 permission 이름. activation 비교의 added_resources와 같은 이름 규칙이다.
  permissions: z.array(z.string().min(1)).optional(),
});
export type PackageVersion = z.infer<typeof packageVersionSchema>;

// 공개 catalog 값이다. 실제 설치 membership·공개 판 불변·byte hash는 host가 검사한다.
export const packageSchema = z.object({
  id: idSchema("pkg"),
  name: packageNameSchema,
  description: z
    .string()
    .regex(/\S/)
    .refine((value) => !/[\r\n]/.test(value), {
      message: "description must be a single line",
    }),
  // 처음 publish한 앱이 주인이다. 주인이 없는 package는 null이고 다음에 publish한 앱이 주인이 된다.
  owner_app: idSchema("app").nullable(),
  versions: z
    .array(packageVersionSchema)
    .min(1)
    .refine(
      (values) =>
        new Set(values.map((value) => value.version)).size === values.length,
      { message: "duplicate package version" },
    ),
});
export type Package = z.infer<typeof packageSchema>;
