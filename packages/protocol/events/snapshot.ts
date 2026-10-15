import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../base/route.ts";
import { turnPermissionRequestSchema } from "../approvals/mod.ts";
import { SENDABLE_SESSION_STATES } from "../lophn-agent/calls.ts";

// waiting은 대기 권한 요청이나 질문이 있는 때, unknown은 coding agent가 harness 신호를 못 받았을 때다.
export const sessionStateSchema = z.enum(SENDABLE_SESSION_STATES);
export type SessionState = z.infer<typeof sessionStateSchema>;

// 질문 내용은 싣지 않는다. 질문 read로 읽는다.
export const sessionSnapshotSchema = z.object({
  session: idSchema("ses"),
  state: sessionStateSchema,
  permission_requests: z.array(turnPermissionRequestSchema),
  questions: z.array(z.object({
    group: idSchema("qgr"),
    turn: idSchema("trn"),
    tool_call: idSchema("tcl"),
  })),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

// Gateway의 ready 뒤 renderer가 읽는다. sessions를 생략하면 열린 session 전부다.
export const sessionSnapshotsList = defineRead({
  resource: "session_snapshots",
  method: "list",
  name: "ListSessionSnapshots",
  input: z.strictObject({ sessions: z.array(idSchema("ses")).optional() }),
  output: withReadCommon(z.object({
    snapshots: z.array(sessionSnapshotSchema),
  })),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
