import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { agentIdSchema, workspaceSchema } from "./workspaces.ts";

// 한 agent·한 자리의 session들에서 사람이 쓴 말과 그 agent의 답 글을 찾는다. 본문은 blob이라 표에서
// 바로 검색할 수 없다. handler가 최근 메시지부터 blob을 읽어 글을 찾고, 결과는 최근 것부터 낸다.
// tool 입력·출력과 다른 agent가 보낸 메시지는 찾지 않는다.
const SEARCH_TEXT_MAX = 200;

const searchQuerySchema = z
  .string()
  .max(SEARCH_TEXT_MAX)
  .refine((value) => value.trim().length > 0, {
    message: "expected a nonblank query",
  });

export const messageSearchMatchSchema = z.object({
  session: idSchema("ses"),
  message: idSchema("msg"),
  /** 메시지가 접수된 시각. 화면은 session 묶음 안의 순서를 이 값으로 정한다. */
  at: atSchema,
  /** 처음 맞은 곳 앞뒤를 한 줄로 줄인 글. 앞뒤가 잘리면 `…`가 붙는다. */
  snippet: z.string(),
});
export type MessageSearchMatch = z.infer<typeof messageSearchMatchSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const messageSearch = defineRead({
  resource: "session_messages",
  method: "search",
  name: "SearchSessionMessages",
  input: z.strictObject({
    agent: agentIdSchema,
    workspace: workspaceSchema.nullable(),
    query: searchQuerySchema,
  }),
  output: withReadCommon(
    z.object({ matches: z.array(messageSearchMatchSchema) }),
  ),
  actors: ["user"],
  errors: [...readErrors],
});
