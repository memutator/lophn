// 앱 source의 두 release 사이 차이. 앱은 token(agent는 입력)이 정한다.
// `problem diff` CLI가 부른다.
import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";

const sourceDiffFileSchema = z.strictObject({
  path: z.string().min(1),
  status: z.enum(["added", "removed", "changed"]),
  // 너무 크거나 binary이면 null이다.
  patch: z.string().nullable(),
});

// 그 release의 source가 남아 있지 않으면 `preserved: false`다. 오류가 아니다.
const sourceDiffOutputSchema = z.discriminatedUnion("preserved", [
  z.strictObject({
    preserved: z.literal(true),
    files: z.array(sourceDiffFileSchema),
    truncated: z.boolean(),
  }),
  z.strictObject({ preserved: z.literal(false), reason: z.string() }),
]);
export type SourceDiffOutput = z.infer<typeof sourceDiffOutputSchema>;

export const codingSourceDiff = defineMemory({
  resource: "coding_agent_sources",
  method: "diff",
  name: "coding.source_diff",
  input: z.strictObject({
    // agent 호출일 때만 있다. coding_agent는 token이 정한 앱을 쓴다.
    app: idSchema("app").optional(),
    from_release: idSchema("rel"),
    to_release: idSchema("rel"),
  }),
  output: sourceDiffOutputSchema,
  actors: ["coding_agent", "agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

export const SOURCE_DIFF_ROUTES = [codingSourceDiff] as const;
