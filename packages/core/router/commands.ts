import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { defineCommand, parseActor } from "../../protocol/base/mod.ts";
import { z } from "zod";
import {
  agentCallSend,
  callCancel,
  type CallFrom,
  callReply,
} from "../../protocol/lophn-agent/calls.ts";
import type {
  CommandDefinition,
  RequestContext,
} from "../../protocol/server/mod.ts";
import { routerEnvironment, routerFor } from "./environment.ts";

// lophn을 켤 때 core가 한 번 부른다. 입력함과 앱 줄이 메모리라 잃어버린 call을 닫고 도는 turn을 닫는다.
// core 안 machine만 쓴다.
export const callsRecover = defineCommand({
  resource: "calls",
  method: "recover",
  name: "RecoverCalls",
  input: z.strictObject({
    // 보낸 session에 이유를 돌려줄 글의 blob이 준비됐는지.
    notify: z.boolean(),
  }),
  output: z.object({ failed: z.number().int(), interrupted: z.number().int() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "unavailable", "internal"],
});

// 호출한 agent의 session이다. agent 자격은 session에 묶인다.
function agentSession(ctx: RequestContext): Result<string> {
  const actor = parseActor(ctx.actor);
  if (
    actor === undefined ||
    actor.kind !== "agent" ||
    !idSchema("ses").safeParse(actor.id).success
  ) {
    return err({ code: "forbidden", message: "only an agent session calls" });
  }
  return ok(actor.id);
}

const sendCallCommand: CommandDefinition<typeof agentCallSend> = {
  route: agentCallSend,
  handle(tx, ctx, input) {
    const session = agentSession(ctx);
    if (!session.ok) return session;
    const router = routerFor(tx);
    if (!router.ok) return router;
    const routed = router.value.route(tx, {
      from: { kind: "agent", session: session.value },
      to: input.to,
      reply: input.reply,
      body: input.body,
      refs: input.refs,
      reply_to: null,
      dedup: input.dedup,
      kind: "call",
      delivery: "next_turn",
      unattended: input.unattended === true,
    });
    if (!routed.ok) return routed;
    if (routed.value.call === null) {
      return err({ code: "internal", message: "an agent call has an ID" });
    }
    return ok({
      call: routed.value.call,
      state: routed.value.state,
      fail_reason: routed.value.fail_reason,
    });
  },
};

const replyCallCommand: CommandDefinition<typeof callReply> = {
  route: callReply,
  handle(tx, ctx, input) {
    const session = agentSession(ctx);
    if (!session.ok) return session;
    const router = routerFor(tx);
    if (!router.ok) return router;
    return router.value.reply(tx, { session: session.value }, input);
  },
};

const cancelCallCommand: CommandDefinition<typeof callCancel> = {
  route: callCancel,
  handle(tx, ctx, input) {
    const kind = parseActor(ctx.actor)?.kind;
    let by: CallFrom;
    if (kind === "user") by = { kind: "human" };
    else {
      const session = agentSession(ctx);
      if (!session.ok) return session;
      by = { kind: "agent", session: session.value };
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    const cancelled = router.value.cancel(tx, by, input);
    if (!cancelled.ok) return cancelled;
    return ok({ call: cancelled.value.call, state: cancelled.value.state });
  },
};

const recoverCallsCommand: CommandDefinition<typeof callsRecover> = {
  route: callsRecover,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({ code: "forbidden", message: "only core recovers calls" });
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    const failed = router.value.failLostOnStart(tx, input.notify);
    if (!failed.ok) return failed;
    const environment = routerEnvironment();
    if (!environment.ok) return environment;
    const interrupted = environment.value.interruptRunningTurns?.(tx) ?? ok(0);
    if (!interrupted.ok) return interrupted;
    return ok({ failed: failed.value, interrupted: interrupted.value });
  },
};

export const ROUTER_COMMANDS = [
  sendCallCommand,
  replyCallCommand,
  cancelCallCommand,
  recoverCallsCommand,
] as const;
