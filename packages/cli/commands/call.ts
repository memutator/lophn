// `lophn call send|reply|cancel`: lophn agent가 다른 session에 일을 맡기고, 받은 call에 답하고, 보낸 call을 취소한다.
// call.send·call.reply route는 actor가 agent뿐이라 binary(사람)에서는 forbidden이다. 보낸 turn의 unattended 표시는 core가
// agent credential의 turn mode에서 찍으므로 여기서 다루지 않는다.
// effect가 read인 것은 run-loop가 실패한 read를 같은 tool call로 다시 부를 때 key가 같아서 call이 하나만 생기기 때문이다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  agentCallSend,
  callCancel,
  callRefSchema,
  callReply,
} from "../../protocol/lophn-agent/calls.ts";
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { defineCommand } from "./types.ts";

const send = defineCommand({
  name: "call.send",
  summary: "Hand work to an agent asynchronously",
  description:
    "Hand work to an agent asynchronously; returns a call ID. to.session uses an open session (session list); to.agent/place opens a new one using exact names (no place means home). " +
    'Supply both with fallback:"new" to open a replacement when the session is closed. Closed sessions stay closed. ' +
    "reply: none requires no answer; result asks the receiver to reply; conversation lets both sides continue via call reply.",
  input: agentCallSend.input
    .omit({ dedup: true })
    .extend({ refs: z.array(callRefSchema).default([]) }),
  effect: "read",
  routes: [agentCallSend],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    // 같은 tool call을 다시 보내도 같은 dedup이라 call과 session이 하나만 생긴다.
    const sent = await ctx.core.command(
      agentCallSend,
      { ...input, dedup: ctx.key },
      { key: ctx.key },
    );
    if (!sent.ok) return sent;
    const { call, state, fail_reason } = sent.value;
    return ok({
      summary:
        fail_reason === null
          ? `call ${call} is ${state}`
          : `call ${call} failed: ${fail_reason}`,
      content: {
        call,
        state,
        fail_reason,
        ...(fail_reason === "closed"
          ? {
              hint: "that session is closed; call its agent and place to open a new session",
            }
          : {}),
      },
    });
  },
});

const reply = defineCommand({
  name: "call.reply",
  summary: "Answer a call you received",
  description:
    "Answer a call you received, with call (its ID), body and refs. If you will not take the work, reply with the reason. closed: true means the call already ended and the reply was not delivered.",
  input: callReply.input,
  positional: ["call"],
  effect: "read",
  routes: [callReply],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const sent = await ctx.core.command(callReply, input, { key: ctx.key });
    if (!sent.ok) return sent;
    return ok({
      summary: sent.value.closed ? "the call is closed" : "reply delivered",
      content: sent.value,
    });
  },
});

const cancel = defineCommand({
  name: "call.cancel",
  summary: "Cancel a call you sent",
  description:
    "Cancel a call you sent that has not ended, with call (its ID) and a one-line reason.",
  input: callCancel.input.required({ reason: true }),
  positional: ["call"],
  effect: "read",
  routes: [callCancel],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.command(callCancel, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary: `call ${done.value.call} is ${done.value.state}`,
      content: done.value,
    });
  },
});

export const CALL_COMMANDS = [send, reply, cancel];
