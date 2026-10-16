import { ok } from "../../../../base/mod.ts";
import { listSendable } from "../call/sessions.ts";
import { callAgentOf } from "../call/target.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted } from "../domain/result.ts";
import type { ToolDefinition } from "../registry.ts";
import { defineBuiltin } from "./common.ts";

// 맡기기, 답하기, 취소하기, 보낼 수 있는 session 보기. 판정은 Router가 보낸 agent의 agent grant로 한다.
// 묻는 grant는 Router가 tx 안이라 물을 수 없어 거절하므로, call은 보내기 전에 여기서 Gate에 묻는다.
export const CALL_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "call",
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
        (input as ToolInput<"call">).to,
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
      const sent = await ctx.router.send({
        ...(input as ToolInput<"call">),
        dedup: ctx.tool_call,
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
  defineBuiltin({
    name: "reply",
    description:
      "Answer a call you received, with call (its ID), body and refs. If you will not take the work, reply with the reason. closed: true means the call already ended and the reply was not delivered.",
    effect: "read",
    handler: async (input, ctx) => {
      const sent = await ctx.router.reply(input as ToolInput<"reply">);
      if (!sent.ok) return sent;
      return ok(fitted(
        sent.value.closed ? "the call is closed" : "reply delivered",
        sent.value,
      ));
    },
  }),
  defineBuiltin({
    name: "cancel",
    description:
      "Cancel a call you sent that has not ended, with call (its ID) and a one-line reason.",
    effect: "read",
    handler: async (input, ctx) => {
      const cancelled = await ctx.router.cancel(input as ToolInput<"cancel">);
      if (!cancelled.ok) return cancelled;
      return ok(fitted(
        `call ${cancelled.value.call} is ${cancelled.value.state}`,
        cancelled.value,
      ));
    },
  }),
  defineBuiltin({
    name: "session.list",
    description:
      "List the open sessions you can send a call to (ID, role, place, name, state) and the coding agent handoffs waiting in an app's line.",
    effect: "read",
    handler: (_input, ctx) => listSendable(ctx),
  }),
];
