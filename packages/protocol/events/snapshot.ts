import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, durationMsSchema } from "../base/values.ts";
import { defineRead } from "../base/route.ts";
import { turnRequestSchema } from "../approvals/mod.ts";
import { SENDABLE_SESSION_STATES } from "../lophn-agent/calls.ts";
import { agentIdSchema, placeOutputSchema } from "../lophn-agent/places.ts";

// waiting은 대기 turn request나 질문이 있는 때다. unknown은 지금 내는 곳이 없다.
const sessionStateSchema = z.enum(SENDABLE_SESSION_STATES);
export type SessionState = z.infer<typeof sessionStateSchema>;

// 질문 내용은 싣지 않는다. 질문 read로 읽는다.
const sessionSnapshotSchema = z.object({
  session: idSchema("ses"),
  // 창을 연 뒤 만난 session도 누구의 session인지 알게 싣는다.
  agent: agentIdSchema,
  place: placeOutputSchema.nullable(),
  state: sessionStateSchema,
  // lophn session만 싣는다. 아직 저장되지 않은 model 호출 하나의 글(redaction을 거친 것)이고
  // text·reasoning의 길이가 그 뒤 delta의 offset이다.
  writing: z
    .object({
      turn: idSchema("trn"),
      model_call: idSchema("mcl"),
      text: z.string(),
      reasoning: z.string(),
    })
    .nullable()
    .optional(),
  // lophn session만 싣는다. 도는 turn이 at까지 일한 시간이고 running이면 화면이 active_ms + (now − at)을 보인다.
  elapsed: z
    .object({
      turn: idSchema("trn"),
      active_ms: durationMsSchema,
      at: atSchema,
    })
    .nullable()
    .optional(),
  // lophn session만 싣는다. [Send now]로 올렸지만 아직 model 요청에 싣지 않은 steer의 message. 기록에는 아직 turn이
  // 비어 있어서 화면이 다음 turn 줄과 가르는 근거다.
  steering: z.array(idSchema("msg")).optional(),
  turn_requests: z.array(turnRequestSchema),
  questions: z.array(
    z.object({
      group: idSchema("qgr"),
      turn: idSchema("trn"),
      tool_call: idSchema("tcl"),
    }),
  ),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

// Gateway의 ready 뒤 renderer가 읽는다. sessions를 생략하면 열린 session 전부다.
export const sessionSnapshotsList = defineRead({
  resource: "session_snapshots",
  method: "list",
  name: "ListSessionSnapshots",
  input: z.strictObject({ sessions: z.array(idSchema("ses")).optional() }),
  output: withReadCommon(
    z.object({
      snapshots: z.array(sessionSnapshotSchema),
    }),
  ),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
