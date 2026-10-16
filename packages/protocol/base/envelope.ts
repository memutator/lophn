import { z } from "zod";
import {
  IDEMPOTENCY_KEY_MAX_BYTES,
  IDEMPOTENCY_KEY_MIN_BYTES,
} from "./limits.ts";
import { turnIdSchema } from "./ids.ts";
import { seqSchema } from "./values.ts";
import type { CommandRoute } from "./route.ts";
import { confirmationRefSchema } from "./confirmation-handle.ts";

const encoder = new TextEncoder();

// UTF-8 1~128 bytes.
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
  turn: turnIdSchema.optional(),
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
  turn: z.ZodOptional<typeof turnIdSchema>;
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
    turn: commandRequestFields.turn,
    prepared: commandRequestFields.prepared,
    confirmation,
  }) as unknown as CommandRequestObject<R>;
}

export type CommandRequest<R extends CommandRoute> = z.infer<
  ReturnType<typeof commandRequestSchema<R>>
>;

const readMetaSchema = z.object({
  as_of_seq: seqSchema,
  next_cursor: z.string().nullable(),
});

// 응답에서 빠지거나 잘린 범위를 명시한다. 범위 밖 대상은 개수도 세지 않으므로 이유에 없다.
const omissionSchema = z.object({
  reason: z.enum(["page_limit", "byte_limit"]),
  count: z.number().refine((n) => Number.isSafeInteger(n) && n >= 0),
});

export const readCommonSchema = readMetaSchema.extend({
  omitted: z.array(omissionSchema).optional(),
});

// shape를 generic으로 받아야 안쪽 field type이 넓어지지 않는다.
export function withReadCommon<T extends z.ZodRawShape>(
  output: z.ZodObject<T>,
) {
  return z.object({ ...output.shape, ...readCommonSchema.shape });
}
