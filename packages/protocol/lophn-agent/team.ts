import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { contentBlocksSchema } from "./content-block.ts";
import { agentRuntimeSchema } from "./agent-values.ts";
import { atSchema } from "../base/values.ts";
import { callReplySchema, SENDABLE_SESSION_STATES } from "./calls.ts";
import { workspaceNameSchema } from "./workspaces.ts";

// 팀은 spawn tree다. `team spawn`으로 연 session은 연 session의 자식이고 core가 session에 `spawned_by`를 남긴다.
// 규칙 셋: (1) spawn은 내 밑으로만(부모는 입력이 아니라 자격의 session), (2) spawn된 session의 call은 부모·형제·내 밑 전체로만,
// (3) 끝내기는 내 엄격한 자손만. 사람의 메시지와 팀 밖에서 오는 call은 그대로다.

export const TEAM_SETTING_KEY = "lophn-agent.team";

// core는 desk를 모른다. 그래서 desk당 팀원 수는 root(조상 중 spawned_by가 없는 session) 아래 열린 자손 수로 센다.
export const teamLimitsSchema = z.strictObject({
  max_members: z.number().int().min(1),
  max_depth: z.number().int().min(1),
});
export type TeamLimits = z.infer<typeof teamLimitsSchema>;

export const DEFAULT_TEAM_LIMITS: TeamLimits = {
  max_members: 8,
  max_depth: 2,
};

// `team spawn`의 첫 call 본문 앞에 core가 붙이는 고정 글이다. system prompt에 넣지 않아 prompt cache를 깨지 않는다.
export const TEAM_MEMBER_PREAMBLE =
  "You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.";

// 팀이 바뀌었다고 다음 turn 끝에 붙는 고정 글이다. 연락처는 system prompt에 싣지 않는다.
export const TEAM_CHANGED_TEXT =
  "Your team changed. Run `lophn team read` to see it.";

const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 받는 곳은 agent handle과 workspace 이름이다. workspace를 빼면 부른 session의 workspace다(call.send는 home).
export const teamSpawn = defineCommand({
  resource: "team",
  method: "spawn",
  name: "SpawnTeamMember",
  changes: ["sessions"],
  input: z.strictObject({
    agent: z.string().min(1),
    workspace: workspaceNameSchema.optional(),
    reply: callReplySchema,
    body: contentBlocksSchema,
    // 이 팀원이 부모에게 무엇인지(`TabRelation`의 peer·stage). 같은 workspace면 그 뜻대로 부모 탭 곁에 열린다. 없으면 peer다.
    relation: z.enum(["peer", "stage"]).optional(),
    // 보낸 쪽 tool call ID. 같은 호출을 다시 보내도 session이 하나만 생긴다.
    dedup: z.string().min(1),
  }),
  output: z.object({ session: idSchema("ses"), call: idSchema("cal") }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: [...commandErrors],
});

export const teamEnd = defineCommand({
  resource: "team",
  method: "end",
  name: "EndTeamMember",
  changes: ["sessions"],
  input: z.strictObject({ session: idSchema("ses") }),
  output: z.object({ ended: z.array(idSchema("ses")) }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: [...commandErrors],
});

const teamMemberSchema = z.object({
  session: idSchema("ses"),
  // agent handle과 보이는 이름, 한 줄 목적이다.
  agent: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  runtime: agentRuntimeSchema,
  state: z.enum(SENDABLE_SESSION_STATES),
  // 내가 이 팀원에게 보낸, 아직 답을 받지 못한 result·conversation call. 팀원이 `call reply`를 잊은 것을 알아채는 길이다.
  open_calls: z.array(
    z.object({
      call: idSchema("cal"),
      reply: callReplySchema,
      created_at: atSchema,
    }),
  ),
});

export const teamRead = defineRead({
  resource: "team",
  method: "read",
  name: "ReadTeam",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      parent: teamMemberSchema.nullable(),
      siblings: z.array(teamMemberSchema),
      children: z.array(teamMemberSchema),
    }),
  ),
  reads: ["sessions"],
  actors: ["agent"],
  errors: [...readErrors],
});

export const TEAM_ROUTES = [teamSpawn, teamEnd, teamRead] as const;
