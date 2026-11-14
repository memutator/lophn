import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { agentCardSchema } from "./agent-definitions.ts";
import {
  callAddressInputSchema,
  callFailReasonSchema,
  callFromOutputSchema,
  callReplySchema,
  callStateSchema,
  callTargetSchema,
} from "./calls.ts";

// 앱이 A2A의 한쪽이 된다: agent에게 call을 보내고 답을 받는다. 앱 화면만 부른다(view-first): 앱 process에는 이 길이 없다. shell main이
// sender view에서 앱을 정해 사람 자격으로 부르고 앱 id를 입력에 싣는다(page가 고르지 못한다). 보낼 수 있는 곳은 그 앱 workspace에서 call로
// 닿을 수 있는 workspace의 agent와 session이다(call 정책). 앱에 받을 queue가 없어 답은 call 행에 글로 남고, 앱은 `call.settled`
// event를 받아 `app_calls.read`로 읽는다. 앱이 보내는 reply는 `none`과 `result`뿐이다(대화는 열지 않는다).

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

// shell main이 앱 화면을 대신해 부르므로 app을 준다.
const onBehalf = { app: idSchema("app") };

// 앱이 보는 call 한 건이다. 받는 session 기록의 본문은 싣지 않는다(session이 보이면 ACP 기록으로 읽는다). result는 이 앱이 보낸
// result call의 답 글이고, 남이 보낸 call의 답은 늘 null이다.
export const appCallRowSchema = z.object({
  call: idSchema("cal"),
  from: callFromOutputSchema,
  to: callTargetSchema,
  receiver_session: idSchema("ses").nullable(),
  reply: callReplySchema,
  state: callStateSchema,
  fail_reason: callFailReasonSchema.nullable(),
  result: z.string().nullable(),
  created_at: atSchema,
  state_changed_at: atSchema,
});
export type AppCallRow = z.infer<typeof appCallRowSchema>;

// `call.settled` event(발행자 `lophn`)의 payload다. 끝난 call 하나: 답(done, result call이면 `app_calls.read`의 result), 실패,
// 취소, 답 없는 call의 소비(done). 이 앱이 보낸 call에 대해서만 이 앱에 간다.
export const APP_CALL_SETTLED_EVENT = "call.settled";
export const callSettledPayloadSchema = z.object({
  call: idSchema("cal"),
  state: z.enum(["done", "failed", "cancelled"]),
  fail_reason: callFailReasonSchema.nullable(),
});
export type CallSettledPayload = z.infer<typeof callSettledPayloadSchema>;

export const appCallsSend = defineMemory({
  resource: "app_calls",
  method: "send",
  name: "app_calls.send",
  changes: [],
  input: z.strictObject({
    ...onBehalf,
    // agent의 handle(앱 workspace에서 보이는 것)과 선택 workspace, 또는 보이는 session. workspace를 빼면 그 앱 workspace다.
    to: callAddressInputSchema,
    reply: z.enum(["none", "result"]),
    text: z.string().min(1),
    // 같은 key로 다시 보내면 첫 call을 돌려준다(이 앱 안에서). 재시도가 두 번 가지 않게 SDK가 send마다 만든다.
    key: z.string().min(1).max(200).optional(),
  }),
  output: z.object({
    call: idSchema("cal"),
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
  }),
  actors: ["user"],
  errors,
});

// 이 앱이 보낸 call만 읽는다. 남의 call은 없는 call과 같은 not_found다.
export const appCallsRead = defineMemory({
  resource: "app_calls",
  method: "read",
  name: "app_calls.read",
  input: z.strictObject({ ...onBehalf, call: idSchema("cal") }),
  output: z.object({ call: appCallRowSchema }),
  actors: ["user"],
  errors,
});

export const appCallsCancel = defineMemory({
  resource: "app_calls",
  method: "cancel",
  name: "app_calls.cancel",
  changes: [],
  input: z.strictObject({
    ...onBehalf,
    call: idSchema("cal"),
    reason: z.string().min(1).optional(),
  }),
  output: z.object({ call: idSchema("cal"), state: callStateSchema }),
  actors: ["user"],
  errors,
});

// 보이는 session이 받은 call과 보낸 call들(새것부터, 최대 50). 안 보이는 session은 없는 session과 같다.
export const appCallsList = defineMemory({
  resource: "app_calls",
  method: "list",
  name: "app_calls.list",
  input: z.strictObject({ ...onBehalf, session: idSchema("ses") }),
  output: z.object({ calls: z.array(appCallRowSchema) }),
  actors: ["user"],
  errors,
});

// 이 앱 workspace에서 부를 수 있는 agent들의 명함(전역 agent, 이 앱의 범위 agent, 이 앱 workspace의 lophn).
export const appAgentsList = defineMemory({
  resource: "app_agents",
  method: "list",
  name: "app_agents.list",
  input: z.strictObject({ ...onBehalf }),
  output: z.object({ agents: z.array(agentCardSchema) }),
  actors: ["user"],
  errors,
});

export const APP_CALL_ROUTES = [
  appCallsSend,
  appCallsRead,
  appCallsCancel,
  appCallsList,
  appAgentsList,
] as const;
