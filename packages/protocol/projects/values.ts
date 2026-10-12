import { z } from "zod";
import { idSchema, seqSchema } from "../platform/mod.ts";

export const SLUG_MAX_LENGTH = 63;
export const slugSchema = z.string().max(SLUG_MAX_LENGTH).regex(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
);
export type Slug = z.infer<typeof slugSchema>;

export const projectIdSchema = idSchema("prj");
export const documentIdSchema = idSchema("doc");
export const versionIdSchema = idSchema("ver");
export const appIdSchema = idSchema("app");

export const revisionSchema = seqSchema.refine((value) => value !== "0", {
  message: "revision must be positive",
});
export const versionNumberSchema = z.number().int().min(1).max(
  Number.MAX_SAFE_INTEGER,
);

// OS의 realpath 판정은 worker에 남겨 contract를 이식 가능하게 유지한다.
export const absolutePathSchema = z.string().min(1).refine(
  (value) =>
    !/\p{Cc}/u.test(value) &&
    (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\[^\\]+\\[^\\]+/.test(value)) &&
    !value.split(/[\\/]/).some((part) => part === "." || part === ".."),
  { message: "expected normalized absolute path" },
);

export const relativePathSchema = z.string().min(1).refine(
  (value) =>
    !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
    !/[\\\p{Cc}]/u.test(value) &&
    value.split("/").every((part) =>
      part !== "" && part !== "." && part !== ".."
    ),
  { message: "expected root-relative path" },
);

export const sectionKeySchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "invalid section key" },
);
