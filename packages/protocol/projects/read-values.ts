import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { RPC_JSON_MAX_BYTES, withReadCommon } from "../platform/mod.ts";
import {
  addressSchema,
  documentRefSchema,
  SECTION_STATUSES,
} from "./address.ts";
import { versionIdSchema, versionNumberSchema } from "./values.ts";
import { contentFileOutputSchema } from "./versions.ts";

export const ROOT_ESTIMATED_TOKEN_BUDGET = 1500;
export const PLACE_ESTIMATED_TOKEN_BUDGET = 3000;
export const DOCUMENT_ESTIMATED_TOKEN_BUDGET = 2000;
export const DOCUMENT_OUTLINE_DEPTH = 2;
export const READ_CODEPOINT_BUDGET = 12000;
export const EXCERPT_CODEPOINT_LIMIT = 200;
export const readActors = ["user", "coding_agent", "agent", "app"] as const;
export const readErrors = ERROR_CODES;
export const countSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);
export const nonblankSchema = z.string().refine((value) =>
  value.trim().length > 0
);
export const sectionStatusSchema = z.enum(SECTION_STATUSES);

// opaque: runtime은 ver/module/section/range/query/sort/current scope/basis/core epoch에
// 결합한다. 긴 한 줄은 line 안 codepoint 위치도 담는다. schema는 decode하지 않는다.
// 조건·판 mismatch는 invalid_input, basis 만료·worker 재시작은 conflict이며 매 page scope 재검사다.
export const readCursorSchema = z.string().min(1);
export const paginationFields = {
  complete: z.boolean(),
  next_cursor: readCursorSchema.nullable(),
};
export const cursorInputFields = { cursor: readCursorSchema.optional() };
export const estimatedBudgetSchema = versionNumberSchema;
export const selectedDocumentInputSchema = z.union([
  documentRefSchema,
  addressSchema,
]);
export const fixedDocumentInputSchema = z.union([
  z.strictObject({ ...documentRefSchema.shape, version: versionIdSchema }),
  z.strictObject({ ...addressSchema.shape, version: versionNumberSchema }),
]);

export function validPagination(
  value: { complete: boolean; next_cursor: string | null },
): boolean {
  return value.complete
    ? value.next_cursor === null
    : value.next_cursor !== null && value.next_cursor.length > 0;
}

// 읽기 예산만으로 큰 metadata/JSON escaping 비용을 막을 수 없어 최종 JSON에도 bound를 둔다.
export function boundedJson<T extends z.ZodType>(schema: T) {
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

// hash는 권한이 아니다. 호출자는 이 고정 version/path로 documents/file을 연다.
export const contentFileReferenceSchema = z.object({
  version: versionIdSchema,
  ...contentFileOutputSchema.shape,
});
export type ContentFileReference = z.infer<typeof contentFileReferenceSchema>;
