import { z } from "zod";

// kind 글: agent가 자기 project의 kind를 이해하는 글이다. program이 쓰고 있는 kinds 파일에서 결정적으로 조립한다.
// 글을 만드는 함수는 core의 몫이다.

export const KIND_TEXT_TAG = "lophn-kinds";
// 예산을 넘으면 full에서 names, count로 줄인다.
const KIND_TEXT_LEVELS = ["full", "names", "count"] as const;
export type KindTextLevel = (typeof KIND_TEXT_LEVELS)[number];

export const kindTextSchema = z.object({
  kinds: z.array(z.object({
    name: z.string(),
    summary: z.string(),
    files: z.array(z.string()),
    key: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      list: z.boolean(),
      // enum의 값들 또는 ref의 대상 kind. 없으면 null.
      detail: z.string().nullable(),
    })),
  })),
  // kinds 파일에 오류가 있어 앞의 맞던 판을 쓰고 있다.
  warning: z.boolean(),
});
export type KindText = z.infer<typeof kindTextSchema>;
