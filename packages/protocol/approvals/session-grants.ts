import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { permissionCategorySchema, permissionDenialSchema } from "./denial.ts";

// 이 대화 동안("session") 허락한 항목. core 메모리에만 살고 session 끝·재시작에 사라지며 fork로 가지 않는다.
export const sessionGrantSchema = z.strictObject({
  id: z.string().min(1),
  session: idSchema("ses"),
  category: permissionCategorySchema,
  pattern: z.string().min(1),
  label: z.string().min(1),
  created_at: atSchema,
});
export type SessionGrant = z.infer<typeof sessionGrantSchema>;

// `/permissions` 화면에 보이는 최근 거부 기록 한 줄이다.
export const recentDenialSchema = z.strictObject({
  id: z.string().min(1),
  turn: idSchema("trn"),
  tool_call: idSchema("tcl"),
  at: atSchema,
  denial: permissionDenialSchema,
});
export type RecentDenial = z.infer<typeof recentDenialSchema>;
