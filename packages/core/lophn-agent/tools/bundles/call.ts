import { ok } from "../../../../base/mod.ts";
import {
  agentCallSend,
  agentCallSendable,
  callCancel,
  callReply,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { TurnMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import { listSendable } from "../call/sessions.ts";
import { defineTool, fitted, type ToolDefinition } from "../spi.ts";
import { z } from "zod";

const none = z.strictObject({});
// dedup은 입력이 아니라 tool call ID로, unattended는 turn의 mode로 채운다.
const callToolInput = agentCallSend.input.omit({
  dedup: true,
  unattended: true,
});
const replyToolInput = callReply.input.omit({ unattended: true });

// skip은 call을 따라 가지 않는다(roadmap). unattended turn만 표시를 싣는다.
const unattendedMark = (mode: TurnMode) =>
  mode === "unattended" ? { unattended: true as const } : {};

// 맡기기, 답하기, 취소하기, 보낼 수 있는 session 보기. Router가 받는 곳을 풀어 넣는다. 부르는 것 자체에는 묻지 않는다.
export const CALL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "call",
    input: callToolInput,
    routes: [agentCallSend],
    description:
      "Hand work to an agent asynchronously; returns a call ID. to.session uses an open session (session.list); to.agent/place opens a new one using exact names (no place means home). " +
      'Supply both with fallback:"new" to open a replacement when the session is closed. Closed sessions stay closed. ' +
      "reply: none requires no answer; result asks the receiver to reply; conversation lets both sides continue via reply.",
    effect: "read",
    handler: async (input, ctx) => {
      const sent = await ctx.router.send({
        ...input,
        dedup: ctx.tool_call,
        ...unattendedMark(ctx.mode),
      });
      if (!sent.ok) return sent;
      const { call, state, fail_reason } = sent.value;
      return ok(
        fitted(
          fail_reason === null
            ? `call ${call} is ${state}`
            : `call ${call} failed: ${fail_reason}`,
          {
            call,
            state,
            fail_reason,
            ...(fail_reason === "closed"
              ? {
                  hint: "that session is closed; call its agent and place to open a new session",
                }
              : {}),
          },
        ),
      );
    },
  }),
  defineTool({
    name: "reply",
    input: replyToolInput,
    routes: [callReply],
    description:
      "Answer a call you received, with call (its ID), body and refs. If you will not take the work, reply with the reason. closed: true means the call already ended and the reply was not delivered.",
    effect: "read",
    handler: async (input, ctx) => {
      const sent = await ctx.router.reply({
        ...input,
        ...unattendedMark(ctx.mode),
      });
      if (!sent.ok) return sent;
      return ok(
        fitted(
          sent.value.closed ? "the call is closed" : "reply delivered",
          sent.value,
        ),
      );
    },
  }),
  defineTool({
    name: "cancel",
    input: callCancel.input.required({ reason: true }),
    routes: [callCancel],
    description:
      "Cancel a call you sent that has not ended, with call (its ID) and a one-line reason.",
    effect: "read",
    handler: async (input, ctx) => {
      const cancelled = await ctx.router.cancel(input);
      if (!cancelled.ok) return cancelled;
      return ok(
        fitted(
          `call ${cancelled.value.call} is ${cancelled.value.state}`,
          cancelled.value,
        ),
      );
    },
  }),
  defineTool({
    name: "session.list",
    input: none,
    routes: [agentCallSendable],
    description:
      "List the open sessions you can send a call to (ID, agent, name, place, state).",
    effect: "read",
    handler: (_input, ctx) => listSendable(ctx),
  }),
];
