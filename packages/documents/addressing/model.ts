import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  appIdSchema,
  documentIdSchema,
  projectIdSchema,
  revisionSchema,
  type Slug,
  SLUG_MAX_LENGTH,
  slugSchema,
} from "../../protocol/projects/mod.ts";

export {
  type Address,
  addressSchema,
  type DocumentRef,
  documentRefSchema,
  formatAddress,
  parseAddress,
  type PlaceRef,
  placeRefSchema,
  type Slug,
  SLUG_MAX_LENGTH,
  slugSchema,
} from "../../protocol/projects/mod.ts";

export function checkName(value: unknown): Result<Slug> {
  const parsed = slugSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_input", message: "invalid address name" });
}

function candidate(value: string): Slug | null {
  const normalized = value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) return null;
  const prefixed = /^[a-z]/.test(normalized)
    ? normalized
    : `document-${normalized}`;
  const bounded = prefixed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
  return slugSchema.parse(bounded);
}

// 제목은 건드리지 않고 ASCII 재료만 쓴다. transliteration은 사람이 고른 이름을 대신하지 않는다.
export function suggestName(title: string, firstFileName?: string): Slug {
  const fromTitle = candidate(title);
  if (fromTitle !== null) return fromTitle;
  const basename = firstFileName?.split(/[\\/]/).at(-1) ?? "";
  const stem = basename.replace(/\.[^.]+$/, "");
  return candidate(stem) ?? "document";
}

export const documentNameSchema = z.discriminatedUnion("place_kind", [
  z.strictObject({
    place_kind: z.literal("project"),
    place_id: projectIdSchema,
    name: slugSchema,
    document: documentIdSchema,
    reserved_seq: revisionSchema,
  }),
  z.strictObject({
    place_kind: z.literal("app"),
    place_id: appIdSchema,
    name: slugSchema,
    document: documentIdSchema,
    reserved_seq: revisionSchema,
  }),
]);
export type DocumentName = z.infer<typeof documentNameSchema>;
