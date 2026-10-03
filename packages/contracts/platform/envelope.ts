import { z } from "zod";
import {
  IDEMPOTENCY_KEY_MAX_BYTES,
  IDEMPOTENCY_KEY_MIN_BYTES,
} from "./limits.ts";
import { runIdSchema } from "./ids.ts";
import { seqSchema } from "./values.ts";
import type { CommandRoute, ReadRoute } from "./route.ts";
import { confirmationRefSchema } from "./confirmation-handle.ts";

const encoder = new TextEncoder();

// UTF-8 1~128 bytes(architecture/platform 5.2).
export const idempotencyKeySchema = z.string().refine((value) => {
  const bytes = encoder.encode(value).length;
  return bytes >= IDEMPOTENCY_KEY_MIN_BYTES &&
    bytes <= IDEMPOTENCY_KEY_MAX_BYTES;
}, { message: "invalid idempotency key" });

const opaqueRefSchema = z.string().min(1);

const preparedSchema = z.array(opaqueRefSchema);

type CommandRequestRoute = {
  input: z.ZodType;
  compare?: z.ZodType;
  confirmation?: "required";
};

// field 순서는 canonical JSON에 남으므로 요청 본문의 기존 순서를 유지한다.
const commandRequestFields = {
  idempotency_key: idempotencyKeySchema,
  compare: z.strictObject({}),
  run: runIdSchema.optional(),
  prepared: preparedSchema,
  confirmation: confirmationRefSchema.optional(),
};

type CompareSchema<R extends CommandRequestRoute> = [
  Extract<R["compare"], z.ZodType>,
] extends [never] ? z.ZodObject<Record<string, never>>
  : Extract<R["compare"], z.ZodType>;

type ConfirmationSchema<R extends CommandRequestRoute> =
  R["confirmation"] extends "required" ? typeof confirmationRefSchema
    : z.ZodOptional<typeof confirmationRefSchema>;

type CommandRequestObject<R extends CommandRequestRoute> = z.ZodObject<{
  input: R["input"];
  idempotency_key: typeof idempotencyKeySchema;
  compare: CompareSchema<R>;
  run: z.ZodOptional<typeof runIdSchema>;
  prepared: typeof preparedSchema;
  confirmation: ConfirmationSchema<R>;
}>;

export function commandRequestSchema<R extends CommandRequestRoute>(
  route: R,
): CommandRequestObject<R> {
  const compare = (route.compare ?? z.strictObject({})) as CompareSchema<R>;
  // 선언한 route만 confirmation을 필수로 둔다. 나머지에서는 field 자체가 선택이다.
  const confirmation = (
    route.confirmation === "required"
      ? confirmationRefSchema
      : confirmationRefSchema.optional()
  ) as ConfirmationSchema<R>;
  return z.strictObject({
    input: route.input,
    idempotency_key: commandRequestFields.idempotency_key,
    compare,
    run: commandRequestFields.run,
    prepared: commandRequestFields.prepared,
    confirmation,
  }) as unknown as CommandRequestObject<R>;
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
