import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { EFFORT_VALUES } from "./option-axes.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
export const nonnegativeDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);

export const effortValueSchema = z.enum(EFFORT_VALUES);
export type EffortValue = z.infer<typeof effortValueSchema>;
// 화면에 보이는 이름이다. 문구 자체는 design/i18n의 영어 message key가 감싼다.
export const EFFORT_LABELS = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "XHigh",
  maximum: "Max",
} as const satisfies Record<EffortValue, string>;

export const MODEL_MEDIA = ["text", "image", "audio", "video", "pdf"] as const;
export const modelMediaSchema = z
  .array(z.enum(MODEL_MEDIA))
  .refine(
    (values) =>
      values.includes("text") && new Set(values).size === values.length,
    { message: "media must include text without duplicates" },
  );

const priceRateFields = {
  context_from: nonnegativeIntegerSchema.nullable(),
  context_through: positiveIntegerSchema.nullable(),
  cache_ttl_ms: positiveIntegerSchema.nullable(),
  input: nonnegativeDecimalSchema.nullable(),
  output: nonnegativeDecimalSchema.nullable(),
  cache_read: nonnegativeDecimalSchema.nullable(),
  cache_write: nonnegativeDecimalSchema.nullable(),
  reasoning: nonnegativeDecimalSchema.nullable(),
};
function rateShape(value: {
  context_from: number | null;
  context_through: number | null;
}): boolean {
  return (
    value.context_from === null ||
    value.context_through === null ||
    value.context_from <= value.context_through
  );
}
const priceRateSchema = z.strictObject(priceRateFields).refine(rateShape, {
  message: "invalid context interval",
});
const priceRateOutputSchema = z.object(priceRateFields).refine(rateShape, {
  message: "invalid context interval",
});

function disjointRates(value: {
  rates: readonly {
    context_from: number | null;
    context_through: number | null;
  }[];
}): boolean {
  const sorted = [...value.rates].sort(
    (a, b) => (a.context_from ?? 0) - (b.context_from ?? 0),
  );
  return sorted.every(
    (rate, index) =>
      index === 0 ||
      (sorted[index - 1].context_through !== null &&
        sorted[index - 1].context_through! < (rate.context_from ?? 0)),
  );
}
const priceBasisFields = {
  currency: z.literal("USD"),
  rates: z.array(priceRateSchema).min(1),
  source: nonblankSchema,
  revision: nonblankSchema,
  checked_at: atSchema,
};
export const priceBasisSchema = z
  .strictObject(priceBasisFields)
  .refine(disjointRates, { message: "overlapping context price intervals" });
export const priceBasisOutputSchema = z
  .object({
    ...priceBasisFields,
    rates: z.array(priceRateOutputSchema).min(1),
  })
  .refine(disjointRates, { message: "overlapping context price intervals" });

const resolvedModelFields = {
  purpose: z.enum(["judgment", "organizing"]),
  // run 시작에 고정한 provider의 credential 판. 인증 없음(custom provider의 loopback)만 null이다.
  credential_revision: positiveIntegerSchema.nullable(),
  provider: idSchema("pvd"),
  model_name: nonblankSchema,
  sent_model_name: nonblankSchema,
  verification: z.enum(["verified", "unverified"]),
  option_values: z.record(nonblankSchema, nonblankSchema),
  request_patch: jsonObjectSchema,
  request_headers: z.record(nonblankSchema, nonblankSchema),
  context_limit: positiveIntegerSchema,
  input_limit: positiveIntegerSchema,
  output_limit: positiveIntegerSchema,
  supports_tools: z.boolean(),
  input_media: modelMediaSchema,
  output_media: modelMediaSchema,
  price_basis: priceBasisSchema.nullable(),
  basis: jsonObjectSchema,
};
const resolvedModelSchema = z.strictObject(resolvedModelFields);
export type PriceRate = z.infer<typeof priceRateSchema>;
export type PriceBasis = z.infer<typeof priceBasisSchema>;
export type ResolvedModel = z.infer<typeof resolvedModelSchema>;
