import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { contentBlocksSchema } from "../../protocol/lophn-agent/content-block.ts";
import { defineCommand, parseActor } from "../../protocol/base/mod.ts";
import { z } from "zod";
import {
  agentCallSend,
  callAddressInputSchema,
  callAskKindSchema,
  callCancel,
  callFailReasonSchema,
  type CallFrom,
  callReply,
  callReplySchema,
  callStateSchema,
} from "../../protocol/lophn-agent/calls.ts";
import {
  mailAppliedSchema,
  mailBodySchema,
  mailSchema,
  remoteAddressSchema,
} from "../../protocol/lophn-agent/mail.ts";
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
  changes: [],
  input: z.strictObject({
    // 보낸 session에 이유를 돌려줄 글의 blob이 준비됐는지.
    notify: z.boolean(),
  }),
  output: z.object({ failed: z.number().int(), interrupted: z.number().int() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "unavailable", "internal"],
});

// custom session이 result call을 받은 turn을 끝내면 core가 마지막 응답 글을 그 call의 답으로 보낸다. agent가 부르는
// ReplyCall과 같은 규칙을 받는 session 이름으로 한 번 더 건다. core 안 machine만 쓴다.
export const callsAutoReply = defineCommand({
  resource: "calls",
  method: "auto-reply",
  name: "AutoReplyCall",
  changes: [],
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

// 팀 자식의 질문이나 shell 승인을 부모에게 가는 result call로 연다. 자식 session 이름으로 보내고 call.send와 같은 거름(call 정책,
// 팀 규칙, 명함)을 거친다. 부모에게 닿지 않으면 call이 failed로 돌아오고 main thread가 기다리는 쪽을 바로 푼다.
// core 안 machine만 쓴다.
export const callsAskOpen = defineCommand({
  resource: "calls",
  method: "ask-open",
  name: "OpenAskCall",
  changes: [],
  input: z.strictObject({
    from: idSchema("ses"),
    to: idSchema("ses"),
    ask: callAskKindSchema,
    body: contentBlocksSchema,
    // 자식 turn의 mode가 unattended인지.
    unattended: z.boolean(),
  }),
  output: z.object({
    call: idSchema("cal"),
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "conflict", "unavailable", "internal"],
});

// 기다리던 request·질문이 부모 답 말고 다른 것으로 닫혔다. 자식 이름으로 ask call을 취소한다(부모에게 취소 알림이 간다).
// 이미 끝난 call은 그대로다. core 안 machine만 쓴다.
export const callsAskWithdraw = defineCommand({
  resource: "calls",
  method: "ask-withdraw",
  name: "WithdrawAskCall",
  changes: [],
  input: z.strictObject({ call: idSchema("cal"), session: idSchema("ses") }),
  output: z.object({ call: idSchema("cal"), state: callStateSchema }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "unavailable", "internal"],
});

// 앱 화면이 보내는 call(view-first: 앱 process에는 이 길이 없다). 사람이 앱 화면에서 보낸 것이라 받는 turn은 attended다. shell main이 앱을
// 정해 부른 core wiring이 이 command를 core 안 machine 자격으로 불러 그 앱 이름으로 Router에 넣는다.
// 받을 곳 풀기, workspace 정책(앱 workspace에서 닿을 수 있는 workspace), 명함 검사는 agent의 call.send와 같다. core 안 machine만 쓴다.
export const callsAppSend = defineCommand({
  resource: "calls",
  method: "app-send",
  name: "SendAppCall",
  changes: [],
  input: z.strictObject({
    app: idSchema("app"),
    to: callAddressInputSchema,
    // 앱은 답 없는 call과 결과 하나를 받는 call만 보낸다. 대화(conversation)는 앱에 받을 queue가 없어 열지 않는다.
    reply: z.enum(["none", "result"]),
    body: contentBlocksSchema,
    // 같은 앱의 같은 key는 첫 call을 돌려준다.
    key: z.string().min(1).max(200).optional(),
  }),
  output: z.object({
    call: idSchema("cal"),
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
    "internal",
  ],
});

// 앱이 자기가 보낸 call을 취소한다. 받는 session에 취소 알림이 간다. core 안 machine만 쓴다.
export const callsAppCancel = defineCommand({
  resource: "calls",
  method: "app-cancel",
  name: "CancelAppCall",
  changes: [],
  input: z.strictObject({
    app: idSchema("app"),
    call: idSchema("cal"),
    reason: z.string().min(1).optional(),
  }),
  output: z.object({ call: idSchema("cal"), state: callStateSchema }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "conflict", "unavailable", "internal"],
});

const originSchema = z.strictObject({
  machine: idSchema("mch"),
  computer: z.string().min(1),
});

// 다른 컴퓨터의 agent에게 call mail을 낸다. 보낸 session의 agent credential이 아니라 main thread의 보내는 입구가 검사(private, mail이 연
// session, 명단, 주소 풀기)를 마친 뒤 core 안 machine 자격으로 부른다. 행과 outbox 줄을 한 tx에 쓴다.
export const callsMailSend = defineCommand({
  resource: "calls",
  method: "mail-send",
  name: "SendCallMail",
  changes: [],
  input: z.strictObject({
    session: idSchema("ses"),
    // 보낸 turn. unattended 표시를 그 turn의 mode에서 찍는다.
    turn: idSchema("trn").nullable(),
    dedup: z.string().min(1),
    peer: originSchema,
    address: remoteAddressSchema,
    reply: callReplySchema,
    body: mailBodySchema,
    // `team spawn --on`: 보낸 session 밑에 그 컴퓨터에서 도는 팀원의 자리를 연다.
    spawn: z.boolean().optional(),
  }),
  output: z.object({
    call: idSchema("cal"),
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
    session: idSchema("ses").nullable(),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
    "internal",
  ],
});

// 다른 컴퓨터에서 온 mail 하나를 이 기계의 Router에 적용한다. 같은 mail id는 한 번만 돈다. core 안 machine만 쓴다.
export const callsMailApply = defineCommand({
  resource: "calls",
  method: "mail-apply",
  name: "ApplyCallMail",
  changes: [],
  input: z.strictObject({
    mail: mailSchema,
    origin: originSchema,
    // 받는 기계의 사람이 그 기계에 허락을 주었으면 agent 정의의 skip을 따른다.
    skip_allowed: z.boolean(),
    via: z.enum(["link", "folder"]),
  }),
  output: mailAppliedSchema,
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable", "internal"],
});

// 다른 컴퓨터에서 받은 workflow step을 그 session이 report한다. 보낸 컴퓨터로 reply mail을 낸다. 부른 session이 그 step을 받은
// session인지는 Router가 본다(아니면 not_found, 이미 report로 끝났으면 conflict). core 안 machine만 쓴다.
export const callsStepReport = defineCommand({
  resource: "calls",
  method: "step-report",
  name: "ReportRemoteStep",
  changes: [],
  input: z.strictObject({
    call: idSchema("cal"),
    session: idSchema("ses"),
    text: z.string().min(1),
    next: z.string().min(1).max(63).nullable(),
    choice: z.enum(["new", "same"]),
    unattended: z.boolean(),
  }),
  output: z.strictObject({}),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "conflict", "unavailable", "internal"],
});

// mail-apply가 오류로 되돌아간 mail을 본 것으로 적고, call mail이면 실패 mail을 낸다. core 안 machine만 쓴다.
export const callsMailRefuse = defineCommand({
  resource: "calls",
  method: "mail-refuse",
  name: "RefuseCallMail",
  changes: [],
  input: z.strictObject({
    mail: mailSchema,
    origin: originSchema,
    reason: callFailReasonSchema,
  }),
  output: z.strictObject({}),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable", "internal"],
});

// 낸 mail의 결과를 적는다: 받았음(그 기계가 적용한 결과), 답을 잃음, 상대가 mail route를 모름(옛 판). core 안 machine만 쓴다.
export const callsMailSent = defineCommand({
  resource: "calls",
  method: "mail-sent",
  name: "RecordCallMailSent",
  changes: [],
  input: z.strictObject({
    mail: idSchema("mal"),
    result: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("acked"), applied: mailAppliedSchema }),
      z.strictObject({ kind: z.literal("unknown") }),
      z.strictObject({ kind: z.literal("refused") }),
    ]),
  }),
  output: z.strictObject({}),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable", "internal"],
});

// 받는 기계의 사람이 대기 목록의 mail을 정한다(`mail/decide_hold`가 본문을 준비하고 부른다). 줄이 없으면 not_found, 이미 끝났으면 conflict다.
// 만료된 줄은 expired로 닫고 {failed, expired}를 돌려준다. core 안 machine만 쓴다.
export const callsMailDecide = defineCommand({
  resource: "calls",
  method: "mail-decide",
  name: "DecideCallMail",
  changes: [],
  input: z.strictObject({
    origin: idSchema("mch"),
    mail: idSchema("mal"),
    // drop: 보낸 컴퓨터가 명단에서 빠져 돌리지 않고 줄만 닫는다(실패 mail도 없다).
    decision: z.enum(["run_now", "skip", "drop"]),
    // 정하는 때 그 기계에 준 터미널 입력 허락. 열리는 session이 agent의 skip을 따를지다.
    skip_allowed: z.boolean(),
  }),
  output: mailAppliedSchema,
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
    "internal",
  ],
});

// 만료된 mail을 닫는다(낸 줄, 대기 목록의 줄)과 오래 지난 받은 기록을 지운다. drain의 주기 timer가 부른다. core 안 machine만 쓴다.
export const callsMailSweep = defineCommand({
  resource: "calls",
  method: "mail-sweep",
  name: "SweepCallMail",
  changes: [],
  // 사람의 명단에서 정해진 빼기로 빠진 기계(부르는 쪽이 명단으로 정한다).
  input: z.strictObject({ removed: z.array(idSchema("mch")) }),
  output: z.strictObject({
    expired: z.number().int(),
    gone: z.number().int(),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "unavailable", "internal"],
});

function machineOnly(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : err({ code: "forbidden", message: "only core handles call mail" });
}

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
      relation: input.relation ?? "peer",
    });
    return ok({ session: sesId(session), call: calId(call) });
  },
};

const askOpenCommand: CommandDefinition<typeof callsAskOpen> = {
  route: callsAskOpen,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({ code: "forbidden", message: "only core opens an ask call" });
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    const routed = router.value.route(tx, {
      from: { kind: "agent", session: input.from },
      to: { session: input.to },
      reply: "result",
      body: input.body,
      refs: [],
      reply_to: null,
      dedup: null,
      kind: "call",
      delivery: "next_turn",
      unattended: input.unattended,
      ask: input.ask,
    });
    if (!routed.ok) return routed;
    if (routed.value.call === null) {
      return err({ code: "internal", message: "an agent call has an ID" });
    }
    return ok({
      call: calId(routed.value.call),
      state: routed.value.state,
      fail_reason: routed.value.fail_reason,
    });
  },
};

const askWithdrawCommand: CommandDefinition<typeof callsAskWithdraw> = {
  route: callsAskWithdraw,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({
        code: "forbidden",
        message: "only core withdraws an ask call",
      });
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    const cancelled = router.value.cancel(
      tx,
      { kind: "agent", session: input.session },
      { call: input.call },
    );
    if (!cancelled.ok) return cancelled;
    return ok({ call: cancelled.value.call, state: cancelled.value.state });
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
        auto: true,
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

const appSendCommand: CommandDefinition<typeof callsAppSend> = {
  route: callsAppSend,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({ code: "forbidden", message: "only core sends for an app" });
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    const from = router.value.appSender(input.app);
    if (!from.ok) return from;
    const routed = router.value.route(tx, {
      from: from.value,
      to: input.to,
      reply: input.reply,
      body: input.body,
      refs: [],
      reply_to: null,
      dedup: input.key ?? null,
      kind: "call",
      delivery: "next_turn",
      unattended: false,
    });
    if (!routed.ok) return routed;
    if (routed.value.call === null) {
      return err({ code: "internal", message: "an app call has an ID" });
    }
    return ok({
      call: calId(routed.value.call),
      state: routed.value.state,
      fail_reason: routed.value.fail_reason,
    });
  },
};

const appCancelCommand: CommandDefinition<typeof callsAppCancel> = {
  route: callsAppCancel,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({
        code: "forbidden",
        message: "only core cancels for an app",
      });
    }
    const router = routerFor(tx);
    if (!router.ok) return router;
    const by = router.value.appSender(input.app);
    if (!by.ok) return by;
    const cancelled = router.value.cancel(tx, by.value, input);
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
    const interrupted =
      environment.value.interruptRunningTurns?.(tx, input.notify) ?? ok(0);
    if (!interrupted.ok) return interrupted;
    return ok({ failed: failed.value, interrupted: interrupted.value });
  },
};

const mailSendCommand: CommandDefinition<typeof callsMailSend> = {
  route: callsMailSend,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const environment = routerEnvironment();
    if (!environment.ok) return environment;
    const router = routerFor(tx);
    if (!router.ok) return router;
    const sent = router.value.sendRemote(tx, {
      session: input.session,
      dedup: input.dedup,
      peer: input.peer,
      address: input.address,
      reply: input.reply,
      body: input.body,
      unattended:
        input.turn !== null && environment.value.unattendedTurn(tx, input.turn),
      spawn: input.spawn,
    });
    if (!sent.ok) return sent;
    return ok({
      ...sent.value,
      call: calId(sent.value.call),
      session: sent.value.session === null ? null : sesId(sent.value.session),
    });
  },
};

const mailApplyCommand: CommandDefinition<typeof callsMailApply> = {
  route: callsMailApply,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const router = routerFor(tx);
    if (!router.ok) return router;
    return router.value.applyMail(tx, {
      mail: input.mail,
      origin: input.origin,
      skipAllowed: input.skip_allowed,
      via: input.via,
    });
  },
};

const mailRefuseCommand: CommandDefinition<typeof callsMailRefuse> = {
  route: callsMailRefuse,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const router = routerFor(tx);
    if (!router.ok) return router;
    const refused = router.value.refuseMail(tx, input);
    return refused.ok ? ok({}) : refused;
  },
};

const stepReportCommand: CommandDefinition<typeof callsStepReport> = {
  route: callsStepReport,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const router = routerFor(tx);
    if (!router.ok) return router;
    const sent = router.value.reportStep(tx, input);
    return sent.ok ? ok({}) : sent;
  },
};

const mailSentCommand: CommandDefinition<typeof callsMailSent> = {
  route: callsMailSent,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const router = routerFor(tx);
    if (!router.ok) return router;
    const recorded = router.value.mailSent(tx, input);
    return recorded.ok ? ok({}) : recorded;
  },
};

const mailDecideCommand: CommandDefinition<typeof callsMailDecide> = {
  route: callsMailDecide,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const router = routerFor(tx);
    if (!router.ok) return router;
    return router.value.decideHold(tx, {
      origin: input.origin,
      mail: input.mail,
      decision: input.decision,
      skipAllowed: input.skip_allowed,
    });
  },
};

const mailSweepCommand: CommandDefinition<typeof callsMailSweep> = {
  route: callsMailSweep,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx);
    if (!allowed.ok) return allowed;
    const router = routerFor(tx);
    if (!router.ok) return router;
    return router.value.sweepMail(tx, input.removed);
  },
};

export const ROUTER_COMMANDS = [
  sendCallCommand,
  teamSpawnCommand,
  askOpenCommand,
  askWithdrawCommand,
  replyCallCommand,
  autoReplyCallCommand,
  cancelCallCommand,
  recoverCallsCommand,
  appSendCommand,
  appCancelCommand,
  mailSendCommand,
  mailApplyCommand,
  mailRefuseCommand,
  mailSentCommand,
  stepReportCommand,
  mailDecideCommand,
  mailSweepCommand,
] as const;
