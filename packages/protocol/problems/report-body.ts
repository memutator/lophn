import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";

// 일반 `blobs/read` 대신, 문제에 붙은 보고의 사람 글·log·화면 상태 blob만 읽는 좁은 통로다.
// owner_kind는 `report`로 고정이고 field는 이 셋뿐이라 입력으로
// 다른 blob을 가리킬 수 없다. 자격은 이 route의 operation이고 앱 범위 연결은 보고의 앱·문제 target도
// 함께 통과해야 한다. 응답 글은 core 알려진 값 pipe를 지난 것이다.
const REPORT_BODY_FIELDS = [
  "report_text",
  "snapshot_logs",
  "feedback_state",
] as const;

export const reportBody = defineRead({
  resource: "problems",
  method: "report_body",
  name: "problems.report_body",
  input: z.strictObject({
    report: idSchema("rpt"),
    field: z.enum(REPORT_BODY_FIELDS),
    offset_bytes: z.number().int().min(0).default(0),
    length_bytes: z.number().int().min(1).max(262_144),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("available"),
      text: z.string(),
      truncated: z.boolean(),
    }),
    z.object({ status: z.literal("unavailable"), reason: z.string() }),
  ]),
  actors: ["user", "coding_agent", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
