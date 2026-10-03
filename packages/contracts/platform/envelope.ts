import { z } from "zod";
import {
  IDEMPOTENCY_KEY_MAX_BYTES,
  IDEMPOTENCY_KEY_MIN_BYTES,
} from "./limits.ts";
import { runIdSchema } from "./ids.ts";
import { seqSchema } from "./values.ts";
import type { CommandRoute, ReadRoute } from "./route.ts";

const encoder = new TextEncoder();

// UTF-8 1~128 bytes(architecture/platform 5.2).
export const idempotencyKeySchema = z.string().refine((value) => {
  const bytes = encoder.encode(value).length;
  return bytes >= IDEMPOTENCY_KEY_MIN_BYTES &&
    bytes <= IDEMPOTENCY_KEY_MAX_BYTES;
}, { message: "invalid idempotency key" });

// 모양은 contracts#T13이 좁힌다. 여기서는 불투명 참조만 받는다.
const opaqueRefSchema = z.string().min(1);

const preparedSchema = z.array(opaqueRefSchema);

type CommandRequestRoute = {
  input: z.ZodType;
  compare?: z.ZodType;
};

export function commandRequestSchema<R extends CommandRequestRoute>(route: R) {
  return z.strictObject({
    input: route.input,
    idempotency_key: idempotencyKeySchema,
    compare: (route.compare ?? z.strictObject({})) as R["compare"] extends
      z.ZodType ? R["compare"] : z.ZodObject<Record<string, never>>,
    run: runIdSchema.optional(),
    prepared: preparedSchema,
    confirmation: opaqueRefSchema.optional(),
  });
}

export type CommandRequest<R extends CommandRoute> = z.infer<
  ReturnType<typeof commandRequestSchema<R>>
>;

const seqPairSchema = z.union([
  z.object({ first_seq: z.null(), last_seq: z.null() }),
  z.object({ first_seq: seqSchema, last_seq: seqSchema }).refine(
    (value) => BigInt(value.last_seq) >= BigInt(value.first_seq),
    { message: "last_seq is before first_seq" },
  ),
]);

export function commandResponseSchema<O extends z.ZodType>(
  route: { output: O },
) {
  return z.object({
    result: route.output,
    replayed: z.boolean(),
  }).and(seqPairSchema);
}

export type CommandResponse<R extends CommandRoute> = z.infer<
  ReturnType<typeof commandResponseSchema<R["output"]>>
>;

export const readMetaSchema = z.object({
  as_of_seq: seqSchema,
  next_cursor: z.string().nullable(),
});

export type ReadMeta = z.infer<typeof readMetaSchema>;

// 응답에서 빠지거나 잘린 범위를 명시한다(architecture/platform 5.3). 범위 밖 대상은 개수도 세지 않으므로 이유에 없다.
export const omissionSchema = z.object({
  reason: z.enum(["page_limit", "byte_limit"]),
  count: z.number().refine((n) => Number.isSafeInteger(n) && n >= 0),
});

export type Omission = z.infer<typeof omissionSchema>;

export const readCommonSchema = readMetaSchema.extend({
  omitted: z.array(omissionSchema).optional(),
});

export type ReadCommon = z.infer<typeof readCommonSchema>;

export function withReadCommon<S extends z.ZodObject>(output: S) {
  return output.extend(readCommonSchema.shape);
}

export type ReadOutput<R extends ReadRoute> = z.infer<
  ReturnType<typeof withReadCommon<Extract<R["output"], z.ZodObject>>>
>;
