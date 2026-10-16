import { z } from "zod";

// context 글: agent가 자기 context를 이해하는 글이다. program이 적용된 판에서 결정적으로 조립한다.
// 계약 원문은 넣지 않는다. 글을 만드는 함수는 core의 몫이다.

export const CONTEXT_TEXT_TAG = "lophn-context";
// 예산을 넘으면 full에서 names, count로 줄인다.
const CONTEXT_TEXT_LEVELS = ["full", "names", "count"] as const;
export type ContextTextLevel = (typeof CONTEXT_TEXT_LEVELS)[number];

const pathDescription = z.object({
  path: z.string(),
  description: z.string(),
});

// 같은 판이면 같은 글이어야 하므로 순서와 꼴이 결정적이다.
// target은 같은 context의 type이면 `Type`, 다른 context의 type이면 `context/Type`이다.
export const contextTextSchema = z.object({
  name: z.string(),
  // 적용된 판 번호. 예: "r3".
  version: z.string().regex(/^r[1-9][0-9]*$/),
  purpose: z.string(),
  project: z.object({
    name: z.string(),
    purpose: z.string(),
    folders: z.array(pathDescription),
    subfolders: z.array(pathDescription),
  }),
  types: z.array(z.object({
    name: z.string(),
    summary: z.string(),
    fields: z.array(z.string()),
    relations: z.array(z.object({
      label: z.string(),
      target: z.string(),
      count: z.enum(["one", "many"]),
    })),
  })),
  searches: z.array(z.object({
    name: z.string(),
    inputs: z.array(z.object({ name: z.string(), optional: z.boolean() })),
    description: z.string(),
  })),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
});
export type ContextText = z.infer<typeof contextTextSchema>;

// `context.get`은 prompt에 넣는 글과 같은 글을 돌려준다.
export const contextGetOutputSchema = z.object({
  version: z.string(),
  text: z.string(),
});
