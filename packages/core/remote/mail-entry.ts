// 기계 사이 mail의 두 입구다. 보내는 입구 `calls/send_remote`는 agent가 부르고, 받는 입구 `a2a/mail`은 명단의 다른 컴퓨터의 core가
// link로 부른다. 판정은 이 기계의 자료(명단, call 정책, 터미널 입력 허락)로 하고 쓰기는 core 안 machine 자격의 `calls/mail-*`로 한다.
// 본보기는 다른 컴퓨터의 앱 command 호출(apps/calls/forward.ts, remote-entry.ts)이다. 다른 점: 보내는 쪽은 할당을 보지 않고(명단의
// 컴퓨터는 mail을 받는다) link를 기다리지 않는다. 받는 쪽은 터미널 입력 허락을 받을지가 아니라 skip을 따를지에만 쓴다.
import type { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
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
} from "../../protocol/lophn-agent/mail.ts";
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
  remoteWorkspaceOf,
} from "../router/mod.ts";
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
  // 이 기계의 명단이 아는 기기의 종류.
  kind(principal: string): "phone" | "computer" | null;
  // 그 기계의 컴퓨터가 이 컴퓨터에서 터미널 입력을 허락받았는가. 받은 mail로 연 session이 agent의 skip을 따를지다.
  granted(machine: string): boolean;
  // 기기 연결의 call 처리가 자격 옆에 실은 요청한 쪽(frame의 `by`).
  requesterOf(ctx: AuthenticatedContext): Requester | undefined;
  // 받는 session 기록에 쓰일 본문을 이 자격(core 안 machine)으로 미리 blob으로 준비한다.
  prepare(bodies: readonly (readonly ContentBlock[])[]): Promise<Result<void>>;
  now(): string;
};

const forbidden = (message: string): Result<never> =>
  err({ code: "forbidden", message });

// 다른 컴퓨터의 agent에게 call을 보낸다. mail을 outbox에 넣고 call id를 바로 돌려준다(link는 drain이 맡는다).
export function sendRemoteHandler(deps: MailEntryDeps): MemoryHandler {
  return async (ctx, body) => {
    const input = body as z.infer<typeof callSendRemote.input>;
    const session = ctx.conditions.session;
    if (session === undefined) {
      return forbidden("only an agent session sends to another computer");
    }
    // private workspace와 받은 mail로 열린 session은 다른 기계에 닿지 않는다. Router가 쓰는 tx에서 한 번 더 본다.
    const reach = remoteReach(deps.sql, session as Id<"ses">, deps.policy());
    if (!reach.ok) return reach;
    const resolved = deps.resolve(input.to.machine);
    if (!resolved.ok) return resolved;
    // 명단에 이 기계의 항목이 둘이면 self가 아닌 쪽도 이 기계다. 그 mail은 영영 닿지 않는다.
    if (resolved.value.self || resolved.value.machine === deps.self()) {
      return err({
        code: "invalid_input",
        message: "that is this computer; send the call without --on",
      });
    }
    const address = remoteAddressOf(deps, input.to, reach.value.workspace);
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
    const checked = mailBodySchema.safeParse(safe);
    if (!checked.success) {
      return err({
        code: "invalid_input",
        message:
          checked.error.issues[0]?.message ?? "the call text is too large",
      });
    }
    return await deps.command(callsMailSend, {
      session,
      turn: ctx.conditions.turn ?? null,
      dedup: input.dedup,
      self: deps.self(),
      peer: { machine: resolved.value.machine, computer: resolved.value.name },
      address: address.value,
      reply: input.reply,
      body: checked.data,
    });
  };
}

// 이 기계의 주소 꼴을 기계를 건너는 꼴로 바꾼다. session 꼴은 그대로다.
function remoteAddressOf(
  deps: MailEntryDeps,
  to: z.infer<typeof callSendRemote.input>["to"],
  callerWorkspace: Parameters<typeof remoteWorkspaceOf>[3],
): Result<RemoteAddress> {
  if (!("agent" in to)) return ok({ session: to.session });
  const workspace = remoteWorkspaceOf(
    deps.sql,
    to.workspace,
    to.agent,
    callerWorkspace,
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
  const applied = await deps.command(callsMailApply, {
    mail,
    origin,
    skip_allowed: deps.granted(computer.machine),
    via,
  });
  if (applied.ok) return ok(applied.value as MailApplied);
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

// `mail/holds`: 늦게 닿아 대기 목록에 선 call mail. 오래 기다린 것부터다. 만료된 줄은 sweep이 닫기 전에도 보이지 않는다.
export function holdsHandler(deps: MailEntryDeps): MemoryHandler {
  return async () => {
    const now = deps.now();
    const holds: MailHold[] = heldMails(deps.sql)
      .filter(({ mail }) => now <= mail.expires_at)
      .map(({ origin, computer, arrived_at, mail }) => ({
        origin,
        mail: mail.id,
        computer,
        from: mail.from,
        address: mail.address,
        reply: mail.reply,
        text: blocksText(mail.body).slice(0, HOLD_TEXT_MAX),
        sent_at: mail.sent_at,
        arrived_at,
        expires_at: mail.expires_at,
      }));
    return ok({ holds });
  };
}

// `mail/decide_hold`: 받는 기계의 사람이 [Start now]나 [Skip]을 고른다. 누가 부를 수 있는지는 route의 actor(사람)와 기기 목록(허락받은
// 기기의 화면만)이 정한다. skip을 따를지는 정하는 때의 허락으로 본다.
export function decideHoldHandler(deps: MailEntryDeps): MemoryHandler {
  return async (_ctx, body) => {
    const input = body as z.infer<typeof mailDecideHold.input>;
    if (input.decision === "run_now") {
      // 줄에 남은 본문은 받을 때 redaction을 거쳤다. 받는 session 기록에 쓰이도록 준비만 한다. 줄이 없거나 끝났으면 명령이 답한다.
      const held = heldMails(deps.sql).find(
        (each) => each.origin === input.origin && each.mail.id === input.mail,
      );
      if (held !== undefined) {
        const prepared = await deps.prepare([held.mail.body]);
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
