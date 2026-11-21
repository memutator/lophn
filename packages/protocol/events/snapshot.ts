import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../base/route.ts";
import { turnRequestSchema } from "../approvals/mod.ts";
import { SENDABLE_SESSION_STATES } from "../lophn-agent/calls.ts";
import {
  agentIdSchema,
  workspaceOutputSchema,
} from "../lophn-agent/workspaces.ts";

// waiting은 대기 turn request나 질문이 있는 때다. unknown은 지금 내는 곳이 없다.
const sessionStateSchema = z.enum(SENDABLE_SESSION_STATES);
export type SessionState = z.infer<typeof sessionStateSchema>;

// 질문 내용은 싣지 않는다. 질문 read로 읽는다.
const sessionSnapshotSchema = z.object({
  session: idSchema("ses"),
  // 창을 연 뒤 만난 session도 누구의 session인지 알게 싣는다.
  agent: agentIdSchema,
  workspace: workspaceOutputSchema.nullable(),
  // 팀(spawn tree)의 부모. 화면이 sidebar에 팀 tree를 그린다.
  spawned_by: idSchema("ses").nullable(),
  state: sessionStateSchema,
  turn_requests: z.array(turnRequestSchema),
  questions: z.array(
    z.object({
      group: idSchema("qgr"),
      turn: idSchema("trn"),
      tool_call: idSchema("tcl"),
      to_parent: z.boolean(),
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
