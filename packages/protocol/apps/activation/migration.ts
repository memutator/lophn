import { z } from "zod";
import { LOSS_KINDS } from "./migration-sql.ts";

// 순수 함수와 type은 migration-sql.ts에 있다(앱 bundle 사본이 zod 없이 쓴다). 여기는 schema만 둔다.
export * from "./migration-sql.ts";

export const lossKindSchema = z.enum(LOSS_KINDS);

const nameSchema = z.string().regex(/\S/);

export const lossStepSchema = z.object({
  kind: lossKindSchema,
  table: nameSchema,
  column: nameSchema.optional(),
}).refine(
  (value) => (value.kind === "drop_table") === (value.column === undefined),
  { message: "drop_table has no column, the other kinds need one" },
);

// SDK migration API의 한 단계.
export const migrationSchema = z.object({
  from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  to: z.number().int().max(Number.MAX_SAFE_INTEGER),
  sql: z.string(),
  loss: z.array(lossStepSchema),
}).refine((value) => value.to > value.from, {
  message: "migration to is not after from",
});
