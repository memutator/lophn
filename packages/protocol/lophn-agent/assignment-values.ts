import { z } from "zod";
import { idSchema } from "../base/ids.ts";

// 옛 assignment 상태. 새 모델에는 상태가 없다(assignment 계약과 함께 지운다).


// Operator는 project 또는 앱 자리에만 놓인다. 만드는 입력은 `all`을 받지 않는다.

// 멈춤은 담당 자리가 보관된 동안만이다.
const pauseFields = {
  kind: z.literal("scope_archived"),
  detail: z.string().refine((value) => value.trim().length > 0, {
    message: "pause detail is blank",
  }),
  target: z.union([idSchema("prj"), idSchema("app")]),
};

export const pauseReasonOutputSchema = z.object(pauseFields);

