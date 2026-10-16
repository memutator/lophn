import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";

export const visualKeySchema = z.string().regex(/^[a-z0-9_-]{1,64}$/);

// column/series/node/edge key는 문자열·unique·참조 관계만 검사한다.
// block key의 regex나 문서에 없는 문자 제한을 이 key에 씌우지 않는다.
export const visualRefKeySchema = z.string();

function codePoints(min: number, max: number) {
  return z.string().refine((value) => {
    const length = Array.from(value).length;
    return length >= min && length <= max;
  }, { message: "invalid code point length" });
}

export const visualTitleSchema = codePoints(1, 200);
export const visualDescriptionSchema = codePoints(1, 2000);
export const visualTextSchema = z.string().min(1);

export function distinct(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export function visualObject<S extends z.ZodRawShape>(
  strict: boolean,
  shape: S,
) {
  return strict ? z.strictObject(shape) : z.object(shape);
}

// 공개 출력의 additive shape는 redaction이나 현재 scope 검증을 대신하지 않는다.
export function visualSourceSchemas(strict: boolean) {
  const object = <S extends z.ZodRawShape>(shape: S) =>
    visualObject(strict, shape);
  return z.discriminatedUnion("kind", [
    object({
      kind: z.literal("app_command"),
      reference: object({
        app: idSchema("app"),
        release: idSchema("rel"),
        command: visualTextSchema,
        tool_call: idSchema("tcl"),
      }),
      observed_at: atSchema,
    }),
    object({
      kind: z.literal("estimate"),
      reference: object({ label: visualTextSchema }),
      observed_at: atSchema.nullable(),
    }),
  ]);
}
