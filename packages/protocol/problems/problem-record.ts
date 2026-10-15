import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";

// 앱이 보고하는 이름이다. 문제를 묶는 key의 일부다.
export const problemNameSchema = z.string().min(1).max(120).regex(/\S/)
  .refine((value) => !/\p{Cc}/u.test(value), {
    message: "problem name has control characters",
  });
export type ProblemName = z.infer<typeof problemNameSchema>;

// 제보로 새로 연 문제의 이름이다.
export const FEEDBACK_PROBLEM_NAME = "User report";

export const PROBLEM_STATES = ["open", "resolved", "ignored"] as const;
export const problemStateSchema = z.enum(PROBLEM_STATES);
export type ProblemState = z.infer<typeof problemStateSchema>;

// 묶는 key.
// - named: 앱이 이름으로 보고했다. 같은 앱의 같은 이름이 한 문제다.
// - exception: 처리되지 않은 오류. discriminator는 오류 이름과 앱 source 위치(source map으로 푼
//   파일·줄)의 해시다. 위치를 못 풀면 그 발생의 Report id라 묶이지 않는다.
// - feedback: 제보로 새로 연 문제. discriminator는 그 제보의 Report id다.
function groupKey(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return z.discriminatedUnion("kind", [
    object({ kind: z.literal("named"), name: problemNameSchema }),
    object({
      kind: z.literal("exception"),
      discriminator: z.union([sha256Schema, idSchema("rpt")]),
    }),
    object({ kind: z.literal("feedback"), discriminator: idSchema("rpt") }),
  ]);
}
export const problemGroupKeySchema = groupKey(false);
export const problemGroupKeyInputSchema = groupKey(true);
export type ProblemGroupKey = z.infer<typeof problemGroupKeySchema>;

// `name`은 처음 발생의 이름이다. `state_changed_at`은 `state`가 마지막으로 바뀐 시각이다.
export const problemRecordSchema = z.object({
  id: idSchema("prb"),
  app: idSchema("app"),
  group_key: problemGroupKeySchema,
  name: problemNameSchema,
  state: problemStateSchema,
  state_changed_at: atSchema,
  seq: seqSchema,
});
export type ProblemRecord = z.infer<typeof problemRecordSchema>;

// 재발 규칙. 판정 함수는 core가 만든다. live 발생만 문제에 붙는다.
// - 새 문제를 만들 때 `ProblemOpened`를 낸다.
// - `open` 문제에 온 발생은 쌓기만 한다.
// - `resolved` 문제에 온 발생의 release가 `state_changed_at` 뒤에 활성화됐으면
//   (`ReleaseRecord.activated_at > state_changed_at`) 문제를 `open`으로 다시 열고
//   `ProblemReopened`를 낸다. 그 전 release에서 늦게 온 발생은 쌓기만 한다.
// - `ignored` 문제는 재발해도 다시 열지 않는다. 쌓기만 한다.
