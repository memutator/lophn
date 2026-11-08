import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { contentBlocksSchema } from "../../protocol/lophn-agent/content-block.ts";
import { defineCommand, parseActor } from "../../protocol/base/mod.ts";
import { z } from "zod";
import {
  agentCallSend,
  callCancel,
  type CallFrom,
  callReply,
} from "../../protocol/lophn-agent/calls.ts";
import { teamSpawn } from "../../protocol/lophn-agent/team.ts";
import { afterCommit } from "../storage/ledger/after-commit.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import { routerEnvironment, routerFor } from "./environment.ts";
import {
  calId,
  FAILURE_TEXTS,
  failureCode,
  sesId,
  TEAM_SPAWNED_TOPIC,
} from "./model.ts";

// lophn을 켤 때 core가 한 번 부른다. queue와 앱 줄이 메모리라 잃어버린 call을 닫고 도는 turn을 닫는다.
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

// bare session이 result call을 받은 turn을 끝내면 core가 마지막 응답 글을 그 call의 답으로 보낸다. agent가 부르는
// ReplyCall과 같은 규칙을 받는 session 이름으로 한 번 더 건다. core 안 machine만 쓴다.
export const callsAutoReply = defineCommand({
  resource: "calls",
  method: "auto-reply",
  name: "AutoReplyCall",
  input: z.strictObject({
    session: idSchema("ses"),
    call: idSchema("cal"),
    body: contentBlocksSchema,
    unattended: z.boolean(),
  }),
  output: z.object({ delivered: z.boolean(), closed: z.boolean() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "conflict", "unavailable", "internal"],
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

// 호출한 agent의 turn이 unattended면 call과 답에 표시를 찍는다. 보낸 쪽이 아니라 core가 credential의 turn에서 읽는다.
function unattendedOf(tx: Tx, ctx: RequestContext): Result<boolean> {
  const environment = routerEnvironment();
  if (!environment.ok) return environment;
  if (ctx.turn === undefined) {
    return err({ code: "forbidden", message: "an agent call needs its turn" });
  }
  return ok(environment.value.unattendedTurn(tx, ctx.turn));
}

const sendCallCommand: CommandDefinition<typeof agentCallSend> = {
  route: agentCallSend,
  handle(tx, ctx, input) {
    const session = agentSession(ctx);
    if (!session.ok) return session;
    const unattended = unattendedOf(tx, ctx);
    if (!unattended.ok) return unattended;
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
      unattended: unattended.value,
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

// 새 session을 보낸 session의 자식으로 열고 첫 입력(call)을 보낸다. 받는 곳 풀기, workspace 정책, 명함 검사는 call.send와 같다.
// 열지 못하면 call 행도 session도 남기지 않고 오류다. 자식 탭은 commit 뒤 main thread가 연다(탭 표는 core 메모리).
const teamSpawnCommand: CommandDefinition<typeof teamSpawn> = {
  route: teamSpawn,
  handle(tx, ctx, input) {
    const parent = agentSession(ctx);
    if (!parent.ok) return parent;
    const unattended = unattendedOf(tx, ctx);
    if (!unattended.ok) return unattended;
    const router = routerFor(tx);
    if (!router.ok) return router;
    const routed = router.value.route(tx, {
      from: { kind: "agent", session: parent.value },
      to: {
        agent: input.agent,
        ...(input.workspace === undefined
          ? {}
          : { workspace: input.workspace }),
      },
      reply: input.reply,
      body: input.body,
      refs: [],
      reply_to: null,
      dedup: input.dedup,
      kind: "call",
      delivery: "next_turn",
      unattended: unattended.value,
      spawn: true,
    });
    if (!routed.ok) return routed;
    const { call, session, fail_reason } = routed.value;
    if (call === null || session === null) {
      const reason = fail_reason ?? "not_found";
      return err({ code: failureCode(reason), message: FAILURE_TEXTS[reason] });
    }
    tx.port(afterCommit).push(TEAM_SPAWNED_TOPIC, {
      parent: parent.value,
      child: session,
    });
    return ok({ session: sesId(session), call: calId(call) });
  },
};

const replyCallCommand: CommandDefinition<typeof callReply> = {
  route: callReply,
  handle(tx, ctx, input) {
    const session = agentSession(ctx);
    if (!session.ok) return session;
    const unattended = unattendedOf(tx, ctx);
    if (!unattended.ok) return unattended;
    const router = routerFor(tx);
    if (!router.ok) return router;
    return router.value.reply(
      tx,
      { session: session.value },
      { ...input, unattended: unattended.value },
    );
  },
};

const autoReplyCallCommand: CommandDefinition<typeof callsAutoReply> = {
  route: callsAutoReply,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({
        code: "forbidden",
        message: "only core replies for a turn",
      });
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    return router.value.reply(
      tx,
      { session: input.session },
      {
        call: input.call,
        body: input.body,
        refs: [],
        unattended: input.unattended,
      },
    );
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
  teamSpawnCommand,
  replyCallCommand,
  autoReplyCallCommand,
  cancelCallCommand,
  recoverCallsCommand,
] as const;
