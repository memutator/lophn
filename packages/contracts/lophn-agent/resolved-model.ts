import { z } from "zod";
import { atSchema, idSchema, jsonObjectSchema } from "../platform/mod.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
export const nonnegativeDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);

// effort 축의 값 이름이다. 약한 값에서 강한 값 순서이고 model마다 이 가운데 지원하는 것만 선언한다(R15).
export const EFFORT_VALUES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "very_high",
  "maximum",
] as const;
export const effortValueSchema = z.enum(EFFORT_VALUES);
export type EffortValue = z.infer<typeof effortValueSchema>;
// 화면에 보이는 이름이다. 문구 자체는 shell/wording의 영어 message key가 감싼다.
export const EFFORT_LABELS = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "XHigh",
  maximum: "Max",
} as const satisfies Record<EffortValue, string>;

// 모델에 맡김은 순서 밖이다. model 호출 기록이 요청·적용 수준을 이 이름으로 남긴다.
export const REASONING_LEVELS = [...EFFORT_VALUES, "provider_default"] as const;
export const reasoningLevelSchema = z.enum(REASONING_LEVELS);
export const MODEL_MEDIA = ["text", "image", "audio", "video"] as const;
const mediaSchema = z.array(z.enum(MODEL_MEDIA)).refine(
  (values) => values.includes("text") && new Set(values).size === values.length,
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
  return value.context_from === null || value.context_through === null ||
    value.context_from <= value.context_through;
}
export const priceRateSchema = z.strictObject(priceRateFields).refine(
  rateShape,
  {
    message: "invalid context interval",
  },
);
export const priceRateOutputSchema = z.object(priceRateFields).refine(
  rateShape,
  {
    message: "invalid context interval",
  },
);

function disjointRates(value: {
  rates: readonly {
    context_from: number | null;
    context_through: number | null;
  }[];
}): boolean {
  const sorted = [...value.rates].sort((a, b) =>
    (a.context_from ?? 0) - (b.context_from ?? 0)
  );
  return sorted.every((rate, index) =>
    index === 0 ||
    (sorted[index - 1].context_through !== null &&
      sorted[index - 1].context_through! < (rate.context_from ?? 0))
  );
}
const priceBasisFields = {
  currency: z.literal("USD"),
  rates: z.array(priceRateSchema).min(1),
  source: nonblankSchema,
  revision: nonblankSchema,
  checked_at: atSchema,
};
export const priceBasisSchema = z.strictObject(priceBasisFields).refine(
  disjointRates,
  { message: "overlapping context price intervals" },
);
export const priceBasisOutputSchema = z.object({
  ...priceBasisFields,
  rates: z.array(priceRateOutputSchema).min(1),
}).refine(disjointRates, { message: "overlapping context price intervals" });

const credentialsSchema = z.array(nonblankSchema).refine(
  (values) => new Set(values).size === values.length,
  { message: "duplicate credential key" },
);
const resolvedModelFields = {
  purpose: z.enum(["judgment", "organizing"]),
  credentials: credentialsSchema,
  provider: idSchema("pvd"),
  model_name: nonblankSchema,
  sent_model_name: nonblankSchema,
  verification: z.enum(["verified", "unverified"]),
  option_values: z.record(nonblankSchema, nonblankSchema),
  request_patch: jsonObjectSchema,
  context_limit: positiveIntegerSchema,
  input_limit: positiveIntegerSchema,
  output_limit: positiveIntegerSchema,
  supports_tools: z.boolean(),
  input_media: mediaSchema,
  output_media: mediaSchema,
  price_basis: priceBasisSchema.nullable(),
  basis: jsonObjectSchema,
};
export const resolvedModelSchema = z.strictObject(resolvedModelFields);
export const resolvedModelOutputSchema = z.object({
  ...resolvedModelFields,
  price_basis: priceBasisOutputSchema.nullable(),
});
export type PriceRate = z.infer<typeof priceRateSchema>;
export type PriceBasis = z.infer<typeof priceBasisSchema>;
export type ResolvedModel = z.infer<typeof resolvedModelSchema>;
