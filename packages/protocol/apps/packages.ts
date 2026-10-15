import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import { semver } from "./blueprint-scope.ts";

export const PACKAGE_KINDS = [
  "component",
  "capability",
  "domain",
  "format",
] as const;

export const packageKindSchema = z.enum(PACKAGE_KINDS);
export type PackageKind = z.infer<typeof packageKindSchema>;

export const packageVersionNameSchema = z.string().refine(semver, {
  message: "expected one exact SemVer",
});

export const packageNameSchema = z.string().regex(
  /^@(?:me|lophn)\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
);

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
  description: z.string().regex(/\S/).refine((value) => !/[\r\n]/.test(value), {
    message: "description must be a single line",
  }),
  // 새 package는 종류가 없다(null이나 없음). 옛 값만 남는다.
  kind: packageKindSchema.nullish(),
  versions: z.array(packageVersionSchema).min(1).refine(
    (values) =>
      new Set(values.map((value) => value.version)).size === values.length,
    { message: "duplicate package version" },
  ),
});
export type Package = z.infer<typeof packageSchema>;
