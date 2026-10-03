import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  appIdSchema,
  documentIdSchema,
  projectIdSchema,
  sectionKeySchema,
  slugSchema,
  versionIdSchema,
  versionNumberSchema,
} from "./values.ts";

export const placeRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: projectIdSchema }),
  z.strictObject({ kind: z.literal("app"), id: appIdSchema }),
]);
export const placeRefOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: projectIdSchema }),
  z.object({ kind: z.literal("app"), id: appIdSchema }),
]);
export type PlaceRef = z.infer<typeof placeRefSchema>;

const addressFields = {
  place: slugSchema,
  document: slugSchema,
  section: sectionKeySchema.nullable(),
  version: versionNumberSchema.nullable(),
};
export const addressSchema = z.strictObject(addressFields);
export const addressOutputSchema = z.object(addressFields);
export type Address = z.infer<typeof addressSchema>;

const documentRefFields = {
  document: documentIdSchema,
  version: versionIdSchema.nullable(),
  section: sectionKeySchema.nullable(),
};
export const documentRefSchema = z.strictObject(documentRefFields);
export const documentRefOutputSchema = z.object(documentRefFields);
export type DocumentRef = z.infer<typeof documentRefSchema>;

export const SECTION_STATUSES = [
  "whole",
  "found",
  "missing",
  "unverified",
  "unsupported",
] as const;
export const resolvedAddressSchema = z.object({
  document: documentIdSchema,
  version: versionIdSchema,
  section: sectionKeySchema.nullable(),
  redirected: z.boolean(),
  current_reference: z.union([addressOutputSchema, documentRefOutputSchema]),
  section_status: z.enum(SECTION_STATUSES),
});
export type ResolvedAddress = z.infer<typeof resolvedAddressSchema>;

const ADDRESS = /^([^/#@]+)\/([^/#@]+)(?:#([^#@]+))?(?:@([1-9][0-9]*))?$/;

export function parseAddress(value: string): Result<Address> {
  const match = ADDRESS.exec(value);
  if (!match) return err({ code: "invalid_input", message: "invalid address" });
  let section: string | null = null;
  try {
    section = match[3] === undefined ? null : decodeURIComponent(match[3]);
  } catch {
    return err({ code: "invalid_input", message: "invalid section encoding" });
  }
  const parsed = addressSchema.safeParse({
    place: match[1],
    document: match[2],
    section,
    version: match[4] === undefined ? null : Number(match[4]),
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_input", message: "invalid address" });
}

export function formatAddress(value: Address): Result<string> {
  const parsed = addressSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid address" });
  }
  const { place, document, section, version } = parsed.data;
  let encoded: string;
  try {
    encoded = section === null
      ? ""
      : `#${encodeURIComponent(section).replace(/%2F/g, "/")}`;
  } catch {
    return err({ code: "invalid_input", message: "invalid section encoding" });
  }
  return ok(
    `${place}/${document}${encoded}${version === null ? "" : `@${version}`}`,
  );
}
