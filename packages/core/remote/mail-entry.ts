// 기계 사이 mail의 두 입구다. 보내는 입구 `calls/send_remote`는 agent가 부르고, 받는 입구 `a2a/mail`은 명단의 다른 컴퓨터의 core가
// link로 부른다. 판정은 이 기계의 자료(명단, call 정책, 터미널 입력 허락)로 하고 쓰기는 core 안 machine 자격의 `calls/mail-*`로 한다.
// 본보기는 다른 컴퓨터의 앱 command 호출(apps/calls/forward.ts, remote-entry.ts)이다. 다른 점: 보내는 쪽은 할당을 보지 않고(명단의
// 컴퓨터는 mail을 받는다) link를 기다리지 않는다. 받는 쪽은 터미널 입력 허락을 받을지가 아니라 skip을 따를지에만 쓴다.
import type { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { CallPolicy } from "../../protocol/lophn-agent/call-policy.ts";
import type { CallFailReason } from "../../protocol/lophn-agent/calls.ts";
import {
  blocksText,
  type ContentBlock,
} from "../../protocol/lophn-agent/content-block.ts";
import {
  type callSendRemote,
  type Mail,
  type MailApplied,
  mailBodySchema,
  type MailHold,
  type mailDecideHold,
  type RemoteAddress,
  type teamSpawnRemote,
} from "../../protocol/lophn-agent/mail.ts";
import { TEAM_MEMBER_PREAMBLE } from "../../protocol/lophn-agent/team.ts";
import type {
  MachineCandidate,
  Requester,
} from "../../protocol/machine/requester.ts";
import type { AuthenticatedContext, Sql } from "../../protocol/server/mod.ts";
import {
  callsMailApply,
  callsMailDecide,
  callsMailRefuse,
  callsMailSend,
  heldMails,
  remoteReach,
  remoteStepBody,
  remoteWorkspaceOf,
} from "../router/mod.ts";
import {
  appendAttachmentBlock,
  dataRootFromSql,
  localAppIdOf,
  mapTransferAttachments,
} from "../router/remote-reach.ts";
import type { MemoryHandler } from "../server/mod.ts";

// 폴더 길(mail-carry)도 link와 같은 입구로 적용한다. origin은 mail을 실어 온 컴퓨터의 기계다.
export type MailInbox = {
  apply(input: {
    mail: Mail;
    origin: Id<"mch">;
    via: "link" | "folder";
  }): Promise<Result<MailApplied>>;
};

export type MailEntryDeps = {
  // core 안 machine 자격으로 `calls/mail-*`를 부른다(접은 writer: 본문 준비와 commit 뒤 할 일을 지난다).
  command(route: { name: string }, input: unknown): Promise<Result<unknown>>;
  // main thread의 ledger 읽기 연결.
  sql: Pick<Sql, "get" | "all">;
  policy(): CallPolicy;
  // 명단의 컴퓨터(이 컴퓨터는 self)와 이름·기계 id·기기 id로 하나 고르기.
  computers(): MachineCandidate[];
  resolve(ref: string): Result<MachineCandidate>;
  self(): Id<"mch">;
  // 제품 redaction. 알려진 secret 목록이 아직 준비되지 않았으면 null이다.
  redact(blocks: readonly ContentBlock[]): ContentBlock[] | null;
  // 기계 사이 project id(`pri_`)를 지금이나 옛 id로 가진 이 컴퓨터의 project 이름. 없거나 private이면 null이다.
  projectName(identity: string): string | null;
  // 이 기계의 명단이 아는 기기의 종류.
  kind(principal: string): "phone" | "computer" | null;
  // 그 기계의 컴퓨터가 이 컴퓨터에서 터미널 입력을 허락받았는가. 받은 mail로 연 session이 agent의 skip을 따를지다.
  granted(machine: string): boolean;
  // 기기 연결의 call 처리가 자격 옆에 실은 요청한 쪽(frame의 `by`).
  requesterOf(ctx: AuthenticatedContext): Requester | undefined;
  // 받는 session 기록에 쓰일 본문을 이 자격(core 안 machine)으로 미리 blob으로 준비한다.
  prepare(bodies: readonly (readonly ContentBlock[])[]): Promise<Result<void>>;
  now(): string;
  // 이 컴퓨터가 다른 컴퓨터로 넘긴 workflow step의 report(reply mail)를 workflows에 넘긴다. 그 call로 넘긴 step이 없으면 null이고
  // 보통 길(`calls/mail-apply`)로 간다. 본 기록과 report 줄과 다음 넘기기가 한 command다.
  stepReport(
    mail: Extract<Mail, { kind: "reply" }>,
    origin: { machine: string; computer: string },
  ): Promise<Result<unknown | null>>;
};

const forbidden = (message: string): Result<never> =>
  err({ code: "forbidden", message });

type RemoteSend = {
  to: z.infer<typeof callSendRemote.input>["to"];
  reply: z.infer<typeof callSendRemote.input>["reply"];
  body: z.infer<typeof callSendRemote.input>["body"];
  attachments?: z.infer<typeof callSendRemote.input>["attachments"];
  dedup: string;
  spawn: boolean;
};

// 다른 컴퓨터의 agent에게 call을 보내거나(`call send --on`) 팀원을 연다(`team spawn --on`). 같은 검사와 주소 바꾸기를 거쳐
// mail을 outbox에 넣고 call id를 바로 돌려준다(link는 drain이 맡는다).
async function sendRemote(
  deps: MailEntryDeps,
  ctx: Parameters<MemoryHandler>[0],
  input: RemoteSend,
): Promise<Result<unknown>> {
  const session = ctx.conditions.session;
  if (session === undefined) {
    return forbidden("only an agent session sends to another computer");
  }
  // private workspace는 다른 기계에 닿지 않고, 받은 mail로 열린 session은 보내지 못한다. 다른 컴퓨터가 연 팀원은 자기를 연 기계에만
  // 닿는다. Router가 쓰는 tx에서 한 번 더 본다.
  const reach = remoteReach(
    deps.sql,
    session as Id<"ses">,
    deps.policy(),
    true,
  );
  if (!reach.ok) return reach;
  const resolved = deps.resolve(input.to.machine);
  if (!resolved.ok) return resolved;
  if (
    reach.value.opened_by_machine !== null &&
    reach.value.opened_by_machine !== resolved.value.machine
  ) {
    return forbidden(
      "a team member opened from another computer sends only to that computer",
    );
  }
  // 명단에 이 기계의 항목이 둘이면 self가 아닌 쪽도 이 기계다. 그 mail은 영영 닿지 않는다.
  if (resolved.value.self || resolved.value.machine === deps.self()) {
    return err({
      code: "invalid_input",
      message: input.spawn
        ? "that is this computer; spawn without --on"
        : "that is this computer; send the call without --on",
    });
  }
  const address = remoteAddressOf(
    deps,
    input.to,
    reach.value.workspace,
    input.spawn,
    resolved.value.machine as Id<"mch">,
  );
  if (!address.ok) return address;
  if (input.body.some((block) => block.type !== "text")) {
    return err({
      code: "invalid_input",
      message: "only text goes to another computer",
    });
  }
  const safe = deps.redact(input.body);
  if (safe === null) {
    return err({
      code: "unavailable",
      message: "call redaction did not finish",
    });
  }
  // team spawn의 첫 call은 이 컴퓨터의 spawn과 같은 고정 글을 앞에 붙인다.
  let body = input.spawn
    ? [{ type: "text" as const, text: TEAM_MEMBER_PREAMBLE }, ...safe]
    : safe;
  let validatedAttachments: RemoteSend["attachments"];
  if (input.attachments !== undefined && input.attachments.length > 0) {
    const mapped = mapTransferAttachments(input.attachments, null);
    if (!mapped.ok) return mapped;
    validatedAttachments = mapped.value.map((each) => each.attachment);
    body = appendAttachmentBlock(body, mapped.value);
  }
  const checked = mailBodySchema.safeParse(body);
  if (!checked.success) {
    return err({
      code: "invalid_input",
      message: checked.error.issues[0]?.message ?? "the call text is too large",
    });
  }
  return await deps.command(callsMailSend, {
    session,
    turn: ctx.conditions.turn ?? null,
    dedup: input.dedup,
    peer: { machine: resolved.value.machine, computer: resolved.value.name },
    address: address.value,
    reply: input.reply,
    body: checked.data,
    ...(validatedAttachments !== undefined
      ? { attachments: validatedAttachments }
      : {}),
    ...(input.spawn ? { spawn: true } : {}),
  });
}

export function sendRemoteHandler(deps: MailEntryDeps): MemoryHandler {
  return async (ctx, body) => {
    const input = body as z.infer<typeof callSendRemote.input>;
    const sent = await sendRemote(deps, ctx, { ...input, spawn: false });
    if (!sent.ok) return sent;
    const { call, state, fail_reason } = sent.value as {
      call: string;
      state: string;
      fail_reason: string | null;
    };
    return ok({ call, state, fail_reason });
  };
}

// `team spawn --on`. 받는 곳은 agent와 workspace이고, workspace를 빼면 부른 session의 workspace다(이 컴퓨터의 spawn과 같다).
export function spawnRemoteHandler(deps: MailEntryDeps): MemoryHandler {
  return async (ctx, body) => {
    const input = body as z.infer<typeof teamSpawnRemote.input>;
    const sent = await sendRemote(deps, ctx, {
      to: {
        agent: input.agent,
        machine: input.machine,
        ...(input.workspace === undefined
          ? {}
          : { workspace: input.workspace }),
      },
      reply: input.reply,
      body: input.body,
      attachments: input.attachments,
      dedup: input.dedup,
      spawn: true,
    });
    if (!sent.ok) return sent;
    const { call, session } = sent.value as {
      call: string;
      session: string | null;
    };
    if (session === null) {
      return err({
        code: "conflict",
        message: "that dedup was used for a call, not a spawn",
      });
    }
    return ok({ session, call });
  };
}

// 이 기계의 주소 꼴을 기계를 건너는 꼴로 바꾼다. session 꼴은 그대로다.
function remoteAddressOf(
  deps: MailEntryDeps,
  to: z.infer<typeof callSendRemote.input>["to"],
  callerWorkspace: Parameters<typeof remoteWorkspaceOf>[3],
  spawn: boolean,
  targetMachine: Id<"mch">,
): Result<RemoteAddress> {
  if (!("agent" in to)) return ok({ session: to.session });
  const workspace = remoteWorkspaceOf(
    deps.sql,
    to.workspace,
    to.agent,
    callerWorkspace,
    spawn,
    targetMachine,
  );
  if (!workspace.ok) return workspace;
  return ok(
    "session" in to
      ? {
          agent: to.agent,
          workspace: workspace.value,
          session: to.session,
          fallback: to.fallback,
        }
      : { agent: to.agent, workspace: workspace.value },
  );
}

// `a2a/mail`: 명단의 다른 컴퓨터의 core가 link로 넘긴 mail 하나. 이 route는 not_found를 내지 않는다(보낸 쪽은 not_found를 옛 판으로 읽는다).
export function mailHandler(deps: MailEntryDeps): MemoryHandler {
  return async (ctx, body) => {
    const { principal } = ctx;
    if (
      !principal.startsWith("device:") ||
      deps.kind(principal) !== "computer"
    ) {
      return forbidden("only a computer in the roster sends mail");
    }
    // 그 컴퓨터의 core가 agent 대신 보낸 것이다. 종류만 믿는다.
    if (deps.requesterOf(ctx)?.kind !== "agent") {
      return forbidden("mail comes from an agent on another computer");
    }
    const computer = deps.resolve(principal.slice("device:".length));
    if (!computer.ok) {
      return forbidden("this device is not a computer here");
    }
    const { mail } = body as { mail: Mail };
    return await applyFrom(deps, mail, computer.value, "link");
  };
}

export function createMailInbox(deps: MailEntryDeps): MailInbox {
  return {
    async apply({ mail, origin, via }) {
      const computer = deps
        .computers()
        .find((each) => each.machine === origin && !each.self);
      if (computer === undefined) {
        return forbidden("mail comes only from a computer in the roster");
      }
      return await applyFrom(deps, mail, computer, via);
    },
  };
}

// 오류로 되돌아간 tx는 본 기록도 남기지 않으므로 본 것으로 따로 적고 보낸 기계에 실패를 알린다. 아니면 그 기계가 같은 mail을 끝없이 다시 낸다.
// unavailable·internal은 그대로 돌려준다: 보낸 쪽이 다음 drain에 같은 id로 다시 보낸다.
const REFUSED: Partial<Record<string, CallFailReason>> = {
  not_found: "not_found",
  forbidden: "not_found",
  invalid_input: "not_found",
  conflict: "closed",
};

async function applyFrom(
  deps: MailEntryDeps,
  mail: Mail,
  computer: MachineCandidate,
  via: "link" | "folder",
): Promise<Result<MailApplied>> {
  // 그 컴퓨터가 쓴, 이 기계로 온 mail만 받는다.
  if (
    mail.from.machine !== computer.machine ||
    mail.to_machine !== deps.self()
  ) {
    return forbidden("this mail is not from that computer to this one");
  }
  const origin = { machine: computer.machine, computer: computer.name };
  if (mail.kind === "reply" && mail.report !== undefined) {
    const reported = await deps.stepReport(mail, origin);
    if (reported.ok && reported.value !== null) {
      return ok({ delivery: null, reason: null, session: null });
    }
    if (!reported.ok) return await refuse(deps, mail, origin, reported);
  }
  const resolvedMail = resolveIncomingAttachments(
    deps.sql,
    resolveIncomingAppSlug(deps.sql, mail),
  );
  const applied = await deps.command(callsMailApply, {
    mail: resolvedMail,
    origin,
    skip_allowed: deps.granted(computer.machine),
    via,
  });
  if (applied.ok) return ok(applied.value as MailApplied);
  return await refuse(deps, resolvedMail, origin, applied);
}

// 받는 call/reply mail에 첨부(`attachments`)가 실렸으면 이 기계의 `<dataRoot>/inbox/<trf>/` 아래 경로로
// 안전하게 매핑해 받는 agent가 바로 찾아 읽을 수 있도록 본문에 붙인다.
function resolveIncomingAttachments(
  sql: Pick<Sql, "get" | "all">,
  mail: Mail,
): Mail {
  if (
    (mail.kind !== "call" && mail.kind !== "reply") ||
    mail.attachments === undefined ||
    mail.attachments.length === 0 ||
    mail.body === null
  ) {
    return mail;
  }
  const mapped = mapTransferAttachments(mail.attachments, dataRootFromSql(sql));
  if (!mapped.ok || mapped.value.length === 0) return mail;
  const nextBody = appendAttachmentBlock(mail.body, mapped.value);
  const checked = mailBodySchema.safeParse(nextBody);
  if (!checked.success) return mail;
  return {
    ...mail,
    body: checked.data,
  };
}

// 받는 call mail의 workspace `{ app }`이 `app_` id 대신 slug면 이 기계의 apps 표에서 id로 푼다.
// 못 찾으면 그대로 넘겨 Router가 `delivery: "failed", reason: "not_found"`로 닫게 한다(이 route는 not_found를 내지 않는다).
function resolveIncomingAppSlug(
  sql: Pick<Sql, "get" | "all">,
  mail: Mail,
): Mail {
  if (
    mail.kind !== "call" ||
    !("agent" in mail.address) ||
    !("app" in mail.address.workspace) ||
    mail.address.workspace.app.startsWith("app_")
  ) {
    return mail;
  }
  const appId = localAppIdOf(sql, mail.address.workspace.app);
  if (appId === null) return mail;
  return {
    ...mail,
    address: {
      ...mail.address,
      workspace: { app: appId },
    },
  };
}

async function refuse(
  deps: MailEntryDeps,
  mail: Mail,
  origin: { machine: string; computer: string },
  applied: { ok: false; error: LophnError },
): Promise<Result<MailApplied>> {
  const reason = REFUSED[applied.error.code];
  if (reason === undefined) return applied;
  const refused = await deps.command(callsMailRefuse, { mail, origin, reason });
  if (!refused.ok) return refused;
  return ok({
    delivery: mail.kind === "call" ? "failed" : null,
    reason: mail.kind === "call" ? reason : null,
    session: null,
  });
}

// 대기 목록 card가 보이는 본문 글의 길이.
const HOLD_TEXT_MAX = 500;

// 보낸 기계가 지금 명단의 다른 컴퓨터인가. 명단에서 빠진 컴퓨터의 대기 줄은 보이지 않고 시작하지 못한다.
function inRoster(deps: MailEntryDeps, origin: string): boolean {
  return deps.computers().some((each) => each.machine === origin && !each.self);
}

// `mail/holds`: 늦게 닿아 대기 목록에 선 call mail. 오래 기다린 것부터다. 만료된 줄은 sweep이 닫기 전에도, 명단에서 빠진 컴퓨터의 줄은
// 정하기 전에도 보이지 않는다.
export function holdsHandler(deps: MailEntryDeps): MemoryHandler {
  return async () => {
    const now = deps.now();
    const holds: MailHold[] = heldMails(deps.sql)
      .filter(
        ({ origin, mail }) => now <= mail.expires_at && inRoster(deps, origin),
      )
      .map(({ origin, computer, arrived_at, mail }) => ({
        origin,
        mail: mail.id,
        computer,
        from: mail.from,
        address: mail.address,
        project_name:
          "workspace" in mail.address && "project" in mail.address.workspace
            ? deps.projectName(mail.address.workspace.project)
            : null,
        reply: mail.reply,
        text: blocksText(mail.body).slice(0, HOLD_TEXT_MAX),
        sent_at: mail.sent_at,
        arrived_at,
        expires_at: mail.expires_at,
      }));
    return ok({ holds });
  };
}

// `mail/decide_hold`: 사람이 이 컴퓨터나 자기 기기의 화면에서 [Start now]나 [Skip]을 고른다(job hold처럼 터미널 입력 허락은 보지 않는다).
// 누가 부를 수 있는지는 route의 actor(사람)와 기기 목록(터미널·다른 컴퓨터의 agent·앱 요청은 못 받는다)이 정한다. skip을 따를지는
// 누른 기기가 아니라 mail을 보낸 컴퓨터에 이 컴퓨터가 정하는 때 준 허락으로 본다.
export function decideHoldHandler(deps: MailEntryDeps): MemoryHandler {
  return async (_ctx, body) => {
    const input = body as z.infer<typeof mailDecideHold.input>;
    // 보낸 컴퓨터가 명단에서 빠졌다: 돌리지 않고 줄을 닫으며(돌려보낼 상대가 없다) 없는 줄처럼 답한다.
    if (!inRoster(deps, input.origin)) {
      const dropped = await deps.command(callsMailDecide, {
        origin: input.origin,
        mail: input.mail,
        decision: "drop",
        skip_allowed: false,
      });
      if (!dropped.ok && dropped.error.code === "unavailable") return dropped;
      return err({ code: "not_found", message: "no such mail on hold" });
    }
    if (input.decision === "run_now") {
      // 줄에 남은 본문은 받을 때 redaction을 거쳤다. 받는 session 기록에 쓰이도록 준비만 한다. 줄이 없거나 끝났으면 명령이 답한다.
      const held = heldMails(deps.sql).find(
        (each) => each.origin === input.origin && each.mail.id === input.mail,
      );
      if (held !== undefined) {
        // workflow step이면 받는 session에는 다른 컴퓨터 표시 줄이 붙은 본문이 들어간다.
        const prepared = await deps.prepare([
          held.mail.step === undefined
            ? held.mail.body
            : remoteStepBody(held.computer, held.mail.body),
        ]);
        if (!prepared.ok) return prepared;
      }
    }
    const decided = await deps.command(callsMailDecide, {
      origin: input.origin,
      mail: input.mail,
      decision: input.decision,
      skip_allowed: deps.granted(input.origin),
    });
    if (!decided.ok) return decided;
    const applied = decided.value as MailApplied;
    // 명령은 만료된 줄을 닫고 실패 mail을 낸 뒤 끝난다(오류면 그 닫음이 되돌아간다). 사람에게는 이미 끝난 줄이다.
    if (applied.reason === "expired") {
      return err({
        code: "conflict",
        message: "this mail expired before it was decided",
      });
    }
    return ok(applied);
  };
}
