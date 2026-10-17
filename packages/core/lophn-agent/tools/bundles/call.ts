import { ok } from "../../../../base/mod.ts";
import {
  agentDefinitionList,
  callCancel,
  callReply,
  callSend,
  callSendable,
} from "../../../../protocol/lophn-agent/mod.ts";
import { appList } from "../../../../protocol/apps/mod.ts";
import { projectList } from "../../../../protocol/projects/mod.ts";
import { listSendable } from "../call/sessions.ts";
import { callAgentOf } from "../call/target.ts";
import { defineTool, fitted, type ToolDefinition } from "../spi.ts";
import { z } from "zod";
import { callSendInputSchema } from "../../../../protocol/lophn-agent/calls.ts";

const none = z.strictObject({});
// dedup은 입력이 아니라 tool call ID로, gate_allowed는 ToolGate의 결과로 채운다.
const callToolInput = callSendInputSchema.omit({
  dedup: true,
  gate_allowed: true,
});

// 맡기기, 답하기, 취소하기, 보낼 수 있는 session 보기. 판정은 Router가 보낸 agent의 agent grant로 한다.
// 묻는 grant는 Router가 tx 안이라 물을 수 없어 거절하므로, call은 보내기 전에 여기서 Gate에 묻는다.
export const CALL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "call",
    input: callToolInput,
    routes: [callSend, agentDefinitionList, projectList, appList],
    description:
      "Hand work to another agent. Returns the call ID at once and your turn goes on. " +
      "to: {session} an open session (see session.list), or {role, place, name?} a new session " +
      "(role is project_manager, app_engineer, operator, lophn or coding_agent; place is {project: name} or {app: name}, lophn has none, an Operator needs name), " +
      'or both with fallback: "new" to use the open session and open a new one if it is closed. Names must match exactly. ' +
      "reply: none (no answer), result (the receiver answers with reply) or conversation (App Engineer and coding agent only). " +
      "body: what you hand over. refs: links {kind: ticket|problem|file|session|annotation, ...}. " +
      'To hand a ticket to a coding agent use to: {role: "coding_agent", place: {app}} with a ticket ref and optional options {harness, model}. ' +
      "If it fails, the result says why (not_found, not_allowed, closed). A closed session is not reopened; call its role and place to open a new one.",
    effect: "read",
    gate: async (input, ctx) => {
      const agent = await callAgentOf(
        input.to,
        ctx,
      );
      return agent === null ? null : {
        kind: "agent_call",
        target: { kind: "agent_call", agent },
        effect: "read",
        input: {},
      };
    },
    handler: async (input, ctx) => {
      const wanted = input;
      // gate가 받는 agent를 풀어 물었으면 여기까지 온 호출은 허락을 받은 것이다. 못 풀었으면 묻지 않았다.
      const asked = await callAgentOf(wanted.to, ctx) !== null;
      const sent = await ctx.router.send({
        ...wanted,
        dedup: ctx.tool_call,
        ...(asked ? { gate_allowed: true as const } : {}),
      });
      if (!sent.ok) return sent;
      const { call, state, fail_reason } = sent.value;
      return ok(fitted(
        fail_reason === null
          ? `call ${call} is ${state}`
          : `call ${call} failed: ${fail_reason}`,
        {
          call,
          state,
          fail_reason,
          ...(fail_reason === "closed"
            ? {
              hint:
                "that session is closed; call its role and place to open a new session",
            }
            : {}),
        },
      ));
    },
  }),
  defineTool({
    name: "reply",
    input: callReply.input,
    routes: [callReply],
    description:
      "Answer a call you received, with call (its ID), body and refs. If you will not take the work, reply with the reason. closed: true means the call already ended and the reply was not delivered.",
    effect: "read",
    handler: async (input, ctx) => {
      const sent = await ctx.router.reply(input);
      if (!sent.ok) return sent;
      return ok(fitted(
        sent.value.closed ? "the call is closed" : "reply delivered",
        sent.value,
      ));
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
      return ok(fitted(
        `call ${cancelled.value.call} is ${cancelled.value.state}`,
        cancelled.value,
      ));
    },
  }),
  defineTool({
    name: "session.list",
    input: none,
    routes: [callSendable],
    description:
      "List the open sessions you can send a call to (ID, role, place, name, state) and the coding agent handoffs waiting in an app's line.",
    effect: "read",
    handler: (_input, ctx) => listSendable(ctx),
  }),
];
