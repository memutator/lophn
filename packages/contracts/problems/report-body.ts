import { z } from "zod";
import { defineRead, idSchema } from "../platform/mod.ts";

// 일반 blob 접근 대신 문제에 붙은 보고 text·log만 읽는 통로다.
export const reportBody = defineRead({
  resource: "problems",
  method: "report_body",
  name: "problems.report_body",
  input: z.strictObject({
    problem: idSchema("prb"),
    report: idSchema("rpt"),
    field: z.enum(["report_text", "snapshot_logs", "feedback_state"]),
    offset_bytes: z.number().int().min(0).default(0),
    length_bytes: z.number().int().min(1).max(262_144),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), text: z.string(), truncated: z.boolean() }),
    z.object({ status: z.literal("unavailable"), reason: z.string() }),
  ]),
  actors: ["user", "coding_agent", "agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found", "unavailable"],
});
