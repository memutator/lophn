import { z } from "zod";
import {
  archiveStateSchema,
  blobRefSchema,
  idSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { placeRefOutputSchema, placeRefSchema } from "./address.ts";
import { formatRefOutputSchema, formatRefSchema } from "./versions.ts";
import {
  documentIdSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
} from "./values.ts";

// key는 document slug와 별개다. 점·숫자 접두를 허용하고 제어 문자만 막는다.
export const seriesKeySchema = z.string().min(1).refine(
  (value) => value.trim().length > 0 && !/\p{Cc}/u.test(value),
  { message: "series key cannot be blank or contain control characters" },
);
export const seriesIdSchema = idSchema("ser");
export const seriesNameSchema = slugSchema;
export const seriesTitleSchema = z.string().refine((value) =>
  value.trim().length > 0
);

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const keyOrderSchema = z.strictObject({
  kind: z.literal("key"),
  direction: z.enum(["ascending", "descending"]),
});
const formatFieldOrderSchema = z.strictObject({
  kind: z.literal("format_field"),
  field: z.string().min(1),
  type: z.enum(["string", "number"]),
  direction: z.enum(["ascending", "descending"]),
});
export const seriesOrderSchema = z.discriminatedUnion("kind", [
  keyOrderSchema,
  formatFieldOrderSchema,
]);
export const seriesOrderOutputSchema = z.discriminatedUnion("kind", [
  z.object(keyOrderSchema.shape),
  z.object(formatFieldOrderSchema.shape),
]);
export type SeriesOrder = z.infer<typeof seriesOrderSchema>;

const NEXT_RULE =
  /^[^{}]*\{(n|major|minor|patch)(?:([+-])(\d+))?(?::(0?[1-4]))?\}$/;
export const nextRuleSchema = z.string().refine((value) => {
  const match = NEXT_RULE.exec(value.trim());
  if (!match) return false;
  if (match[3] === undefined) return true;
  try {
    return BigInt(match[3]) <= MAX_SAFE;
  } catch {
    return false;
  }
}, { message: "next rule must end with one supported placeholder" });
export type NextRule = z.infer<typeof nextRuleSchema>;

const contentInputSchema = z.strictObject({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const draftFields = {
  document: documentIdSchema,
  key: seriesKeySchema,
  base_version: versionIdSchema.nullable(),
  format: formatRefSchema,
  content: contentInputSchema.nullable(),
};
export const seriesDraftSchema = z.strictObject(draftFields);
export const seriesDraftOutputSchema = z.object({
  ...draftFields,
  format: formatRefOutputSchema,
  content: blobRefSchema.nullable(),
});
export type SeriesDraft = z.infer<typeof seriesDraftSchema>;

const instanceFields = {
  series: seriesIdSchema,
  document: documentIdSchema,
  key: seriesKeySchema,
  order_value: z.union([z.string(), z.number().finite()]).nullable(),
  order_version: versionIdSchema.nullable(),
  revision: revisionSchema,
};
export const seriesInstanceSchema = z.strictObject(instanceFields).refine((
  value,
) =>
  (value.order_value === null) === (value.order_version === null) &&
  (typeof value.order_value !== "string" || value.order_value.trim().length > 0)
);
export const seriesInstanceOutputSchema = z.object(instanceFields).refine((
  value,
) =>
  (value.order_value === null) === (value.order_version === null) &&
  (typeof value.order_value !== "string" || value.order_value.trim().length > 0)
);
export type SeriesInstance = z.infer<typeof seriesInstanceSchema>;

const seriesFields = {
  id: seriesIdSchema,
  place: placeRefSchema,
  name: seriesNameSchema,
  title: seriesTitleSchema,
  format: z.string().min(1),
  order: seriesOrderSchema,
  next_rule: nextRuleSchema,
  draft: seriesDraftSchema.nullable(),
  revision: revisionSchema,
  status: archiveStateSchema,
};
export const seriesSchema = z.strictObject(seriesFields).refine((value) =>
  value.draft === null || value.draft.format.name === value.format
);
export const seriesOutputSchema = z.object({
  ...seriesFields,
  place: placeRefOutputSchema,
  order: seriesOrderOutputSchema,
  draft: seriesDraftOutputSchema.nullable(),
}).refine((value) =>
  value.draft === null || value.draft.format.name === value.format
);
export type Series = z.infer<typeof seriesSchema>;

const suggestionFields = {
  series_revision: revisionSchema,
  key: z.string(),
  title: z.string(),
  from: seriesKeySchema.nullable(),
  taken: z.boolean(),
  document_name: slugSchema.nullable(),
};
export const nextSuggestionSchema = z.object(suggestionFields).refine((value) =>
  (value.key === "") === (value.title === "") &&
  (value.key === "" || value.title.trim().length > 0) &&
  (value.key !== "" || value.document_name === null)
);
export type NextSuggestion = z.infer<typeof nextSuggestionSchema>;

type KeyParts = { prefix: string; numbers: bigint[]; suffix: string };

function keyParts(key: string): KeyParts | null {
  const match = /^(\D*?)((?:\d+\.)*\d+)(\D*)$/.exec(key);
  if (!match) return null;
  return {
    prefix: match[1] ?? "",
    numbers: (match[2] ?? "").split(".").map((part) => BigInt(part)),
    suffix: match[3] ?? "",
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// locale과 표시 direction에 독립적인 key 자연 순. 숫자 가족 key가 먼저다.
export function compareSeriesKeys(left: string, right: string): number {
  const a = keyParts(left);
  const b = keyParts(right);
  if (a === null || b === null) {
    return a === b ? compareText(left, right) : a === null ? 1 : -1;
  }
  const prefix = compareText(a.prefix, b.prefix);
  if (prefix !== 0) return prefix;
  const count = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (a.numbers[index] ?? 0n) - (b.numbers[index] ?? 0n);
    if (difference !== 0n) return difference < 0n ? -1 : 1;
  }
  return compareText(a.suffix, b.suffix) || compareText(left, right);
}

function formatNumber(value: bigint, width: number): string | null {
  if (value < 0n || value > MAX_SAFE) return null;
  const text = value.toString();
  return width > 0 ? text.padStart(width, "0") : text;
}

// 읽기 전용 제안이다. key·document·파일을 예약하거나 저장하지 않는다.
export function suggestNextKey(rule: string, from: string | null): string {
  const parsed = NEXT_RULE.exec(rule.trim());
  const current = from === null ? null : keyParts(from);
  if (!parsed || current === null || current.numbers.length === 0) return "";
  const target = parsed[1] === "major"
    ? 0
    : parsed[1] === "minor"
    ? Math.min(1, current.numbers.length - 1)
    : current.numbers.length - 1;
  const step = parsed[3] === undefined
    ? 1n
    : BigInt(`${parsed[2]}${parsed[3]}`);
  const next = current.numbers[target]! + step;
  if (next < 0n) return "";
  const numbers = current.numbers.map((value, index) =>
    index === target ? next : index > target ? 0n : value
  );
  const width = parsed[4] === undefined ? 0 : Number(parsed[4]);
  if (width > 4) return "";
  const rendered = numbers.map((value, index) =>
    formatNumber(value, index === target ? width : 0)
  );
  return rendered.some((value) => value === null)
    ? ""
    : `${current.prefix}${rendered.join(".")}${current.suffix}`;
}

export function documentNameForKey(key: string): string | null {
  const name = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return slugSchema.safeParse(name).success ? name : null;
}
