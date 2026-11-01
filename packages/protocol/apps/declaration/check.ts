import { z } from "zod";
import { defineMemory } from "../../base/route.ts";
import { appInputSchema } from "../apps.ts";
import { permissionRequirementSchema } from "../permissions.ts";

// 앱 source의 lophn.ts를 평가해 검사한다. 파일을 읽고 Node 자식을 띄우는 I/O라 memory route다.
// 오류는 선언이 평가되지 않거나 구조 검사를 통과하지 못한 이유, 경고는 설명이 빈 칸,
// permission_review는 사람이 승인하게 될 permission 선언이다. 구조 오류는 오류 코드가 아니라 output의
// errors에 담는다.
export const declarationCheck = defineMemory({
  resource: "declarations",
  method: "check",
  name: "declaration.check",
  input: appInputSchema,
  output: z.object({
    errors: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
    permission_review: z.array(permissionRequirementSchema),
  }),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
export type DeclarationCheckOutput = z.output<typeof declarationCheck.output>;
