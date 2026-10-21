// coding agent가 맡긴 App Engineer에게 보내는 메시지. Router가 열린 session, 없으면 새 session으로 보낸다.
import { z } from "zod";
import { defineMemory } from "../base/route.ts";

const MESSAGE_MAX_CODE_POINTS = 8_000;

// ledger에 쓰지 않는다. 보내는 session은 token이 정한다.
export const codingMessageSend = defineMemory({
  resource: "coding_agent_sessions",
  method: "send_message",
  name: "coding.send_message",
  input: z.strictObject({
    body: z.string().refine(
      (value) =>
        /\S/.test(value) && [...value].length <= MESSAGE_MAX_CODE_POINTS,
      { message: "message length" },
    ),
  }),
  output: z.object({ accepted: z.literal(true) }),
  actors: ["coding_agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const MESSAGE_ROUTES = [codingMessageSend] as const;
