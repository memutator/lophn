import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { defineRead } from "../base/route.ts";
import { turnRequestSchema } from "../approvals/mod.ts";
import { SENDABLE_SESSION_STATES } from "../lophn-agent/calls.ts";
import {
  agentIdSchema,
  workspaceOutputSchema,
} from "../lophn-agent/workspaces.ts";
import { workflowOriginSchema } from "../workflows/values.ts";

// waiting은 대기 turn request나 질문이 있는 때다. unknown은 지금 내는 곳이 없다.
const sessionStateSchema = z.enum(SENDABLE_SESSION_STATES);
export type SessionState = z.infer<typeof sessionStateSchema>;

// 다른 컴퓨터에서 도는 팀원 자리의 상태.
export const MEMBER_PLACE_STATES = [
  "pending",
  "held",
  "running",
  "ended",
] as const;

// 질문 내용은 싣지 않는다. 질문 read로 읽는다.
const sessionSnapshotSchema = z.object({
  session: idSchema("ses"),
  // 창을 연 뒤 만난 session도 누구의 session인지 알게 싣는다. 다른 컴퓨터에서 도는 팀원의 자리는 이 컴퓨터의 agent가 아니라 null이다
  // (그 컴퓨터의 handle은 runs_on에 있다).
  agent: agentIdSchema.nullable(),
  workspace: workspaceOutputSchema.nullable(),
  // 팀(spawn tree)의 부모. 화면이 sidebar에 팀 tree를 그린다.
  spawned_by: idSchema("ses").nullable(),
  // workflow가 열었거나 그 팀 자식이 상속한 출처. 탭이 없어도 sidebar·열기가 workflow desk에 맞춘다.
  workflow_origin: workflowOriginSchema.nullable().optional(),
  // worktree에 묶인 project session이면 그 worktree id.
  worktree_id: idSchema("wkt").nullable().optional(),
  // 다른 컴퓨터에서 도는 팀원의 자리(`team spawn --on`)면 그 컴퓨터(명단의 이름), 그 컴퓨터의 agent handle, 자리의 상태다: 아직 닿지
  // 않음(pending), 그 컴퓨터의 대기 목록(held), 그 컴퓨터가 받아 돎(running), 끝남(ended). 이 컴퓨터의 session은 null이다. 상태가 바뀌면
  // spawn call의 `StateChanged{agent_calls}`, 자리가 열리면 `StateChanged{sessions}`, 끝나면 `SessionEnded`가 온다. 그 자리의 state는 unknown이다.
  // 자리는 session read에 없어(이 컴퓨터의 session이 아니다) 사람이 보관할 때 쓰는 `state_seq`를 여기 싣는다.
  runs_on: z
    .object({
      machine: idSchema("mch"),
      computer: z.string(),
      handle: z.string(),
      state: z.enum(MEMBER_PLACE_STATES),
      state_seq: seqSchema,
    })
    .nullable(),
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
