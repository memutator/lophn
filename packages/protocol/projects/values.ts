import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";

const SLUG_MAX_LENGTH = 63;
export const slugSchema = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

// artifact 이름은 폴더 이름이라 slug다.
export const artifactNameSchema = slugSchema;

export const projectIdSchema = idSchema("prj");
// 기계를 넘는 project id. 등록할 때 ledger에서 나고, 내 다른 컴퓨터의 같은 저장소와 자동으로 맞춰진다.
export const projectIdentitySchema = idSchema("pri");
// project가 남기는 옛 identity의 상한. 정체가 바뀌는 일은 드물고, 상한이 있어야 schema가 모양을 거절할 수 있다.
export const PROJECT_FORMER_IDENTITIES_MAX = 16;
export const versionIdSchema = idSchema("ver");
export const appIdSchema = idSchema("app");

export const revisionSchema = seqSchema.refine((value) => value !== "0", {
  message: "revision must be positive",
});

// OS의 realpath 판정은 worker에 남겨 contract를 이식 가능하게 유지한다.
export const absolutePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/\p{Cc}/u.test(value) &&
      (/^\//.test(value) ||
        /^[A-Za-z]:[\\/]/.test(value) ||
        /^\\\\[^\\]+\\[^\\]+/.test(value)) &&
      !value.split(/[\\/]/).some((part) => part === "." || part === ".."),
    { message: "expected normalized absolute path" },
  );

export const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:/.test(value) &&
      !/[\\\p{Cc}]/u.test(value) &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    { message: "expected root-relative path" },
  );

export const sectionKeySchema = z
  .string()
  .min(1)
  .refine((value) => !/\p{Cc}/u.test(value), {
    message: "invalid section key",
  });
