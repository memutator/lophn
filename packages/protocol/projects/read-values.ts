import { z } from "zod";
import { RPC_JSON_MAX_BYTES } from "../base/limits.ts";
import { withReadCommon } from "../base/envelope.ts";

// opaque: runtime은 결합 조건을 cursor에 담는다. schema는 decode하지 않는다.
export const readCursorSchema = z.string().min(1);
const paginationFields = {
  complete: z.boolean(),
  next_cursor: readCursorSchema.nullable(),
};

function validPagination(
  value: { complete: boolean; next_cursor: string | null },
): boolean {
  return value.complete
    ? value.next_cursor === null
    : value.next_cursor !== null && value.next_cursor.length > 0;
}

// 읽기 예산만으로 큰 metadata/JSON escaping 비용을 막을 수 없어 최종 JSON에도 bound를 둔다.
function boundedJson<T extends z.ZodType>(schema: T) {
  return schema.refine((value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).length <=
        RPC_JSON_MAX_BYTES;
    } catch {
      return false;
    }
  }, { message: "public JSON exceeds 256KiB" });
}
export function publicPage<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return boundedJson(
    withReadCommon(z.object({ ...schema.shape, ...paginationFields })).refine(
      (value) =>
        validPagination(
          value as { complete: boolean; next_cursor: string | null },
        ),
    ),
  );
}
export function publicRead<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return boundedJson(
    withReadCommon(schema).refine((value) =>
      (value as { next_cursor: unknown }).next_cursor === null
    ),
  );
}
