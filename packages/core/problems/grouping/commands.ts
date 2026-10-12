// 문제 진행(work)과 해석 연결 command.
// handler는 동기이고 같은 transaction에서 coding-agent의 ticket 표와 lophn-agent의
// assignment 표를 직접 읽는다(repairs/commands.ts가 ticket 표를 읽는 선례). 다른 최상위의
// 코드는 import하지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  linkProblemInterpretation,
  problemInterpretationLinked,
  problemWorkEnded,
  problemWorkStarted,
  reconcileProblemWork,
  type WORK_END_REASONS,
} from "../../../protocol/problems/mod.ts";
import { NOT_FOUND } from "../reporting/mod.ts";
import { problemSeq } from "./model.ts";

type WorkEndReason = (typeof WORK_END_REASONS)[number];

const notFound = (): Result<never, LophnError> =>
  err({ code: "not_found", message: NOT_FOUND });
const conflict = (message: string): Result<never, LophnError> =>
  err({ code: "conflict", message });

// 열린 repair ticket의 상태다(coding-agent/tickets). confirmed·cancelled는 끝난 ticket이다.
const OPEN_TICKET_STATES: ReadonlySet<string> = new Set([
  "open",
  "claimed",
  "reported",
  "check_failed",
]);

type TicketRow = { app: string; kind: string; state: string };

function findTicket(
  sql: Pick<Tx["sql"], "get">,
  ticket: string,
): TicketRow | null {
  const row = sql.get(
    `select app, kind, state from tickets where id = ?`,
    [ticket],
  );
  if (row === undefined) return null;
  return {
    app: String(row["app"]),
    kind: String(row["kind"]),
    state: String(row["state"]),
  };
}

function seqText(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ||
      typeof value === "bigint"
    ? String(value)
    : null;
}

// 끝난 쪽 이유는 ticket 현재 상태가 정하고, open이면 근거 event가 만료인지로 가른다.
// 근거 event가 `TicketClaimReleased` 만료가 아니면 반납이다.
function endReason(
  ticket: TicketRow,
  cause: { type: string; payload: unknown },
): WorkEndReason {
  if (ticket.state === "cancelled") return "cancelled";
  if (ticket.state === "confirmed") return "confirmed";
  if (ticket.state === "reported" || ticket.state === "check_failed") {
    return "completion_reported";
  }
  const payload = cause.payload as { reason?: unknown } | null;
  return cause.type === "TicketClaimReleased" && payload?.reason === "expired"
    ? "expired"
    : "released";
}

// 열린 repair ticket 하나만 문제의 work로 잇는다. 유효 claim이 있을 때만 fixing이고
// 그 밖에는 open이다. ticket 정본의 현재 상태에서 다시 계산하므로 같은 입력은 같은 결과다.
// 닫힌 문제는 status를 건드리지 않는다: ticket event가 열거나 닫지 않는다.
export function handleReconcileProblemWork(
  tx: Tx,
  _ctx: RequestContext,
  input: Input<typeof reconcileProblemWork>,
  compare: { problem_seq: string; work: string | null },
): Result<Output<typeof reconcileProblemWork>, LophnError> {
  const row = tx.sql.get(
    `select app, status, work from problems where id = ?`,
    [input.problem],
  );
  if (row === undefined) return notFound();
  const app = String(row["app"]);
  const status = String(row["status"]) as "open" | "fixing" | "closed";
  const work = row["work"] === null ? null : String(row["work"]);
  const ticket = findTicket(tx.sql, input.ticket);
  if (ticket === null || ticket.kind !== "repair" || ticket.app !== app) {
    return notFound();
  }
  const listed = tx.sql.get(
    `select 1 as found from ticket_problems where ticket = ? and problem = ?`,
    [input.ticket, input.problem],
  );
  if (listed === undefined) return notFound();
  const cause = tx.sql.get(
    `select type, subject, payload from events where seq = ?`,
    [input.ticket_event_seq],
  );
  if (cause === undefined || cause["subject"] !== input.ticket) {
    return notFound();
  }
  // 읽은 문제 기준이 그대로일 때만 바꾼다.
  if (problemSeq(tx.sql, input.problem) !== compare.problem_seq) {
    return conflict("문제가 바뀌었다");
  }
  if (work !== compare.work) return conflict("문제가 바뀌었다");

  let payload: unknown = null;
  try {
    payload = JSON.parse(String(cause["payload"]));
  } catch { /* 이유만 읽는 값이라 깨졌으면 반납으로 본다 */ }
  const causeEvent = { type: String(cause["type"]), payload };

  // 이미 다른 ticket이 work면 열린 ticket 둘은 연결하지 않는다. 그 ticket이 끝났거나
  // 사라졌으면 낡은 연결이라 바꿔 이을 수 있다.
  let stale: { ticket: string; state: TicketRow } | null = null;
  if (work !== null && work !== input.ticket) {
    const other = findTicket(tx.sql, work);
    if (other !== null && OPEN_TICKET_STATES.has(other.state)) {
      if (OPEN_TICKET_STATES.has(ticket.state)) {
        return err({
          code: "invalid_input",
          message: "문제에는 열린 repair ticket이 하나만 이어진다",
        });
      }
      // 끝난 ticket의 일이 지금 work와 상관없다.
      return ok({ status, work, changed: false });
    }
    stale = {
      ticket: work,
      state: other ?? { app, kind: "repair", state: "cancelled" },
    };
  }

  const ticketOpen = OPEN_TICKET_STATES.has(ticket.state);
  const nextWork = ticketOpen ? input.ticket : null;
  const claim = ticket.state === "claimed"
    ? tx.sql.get(`select claim_seq from ticket_claims where ticket = ?`, [
      input.ticket,
    ])
    : undefined;
  const claimSeq = claim === undefined ? null : seqText(claim["claim_seq"]);
  const nextStatus = status === "closed"
    ? "closed"
    : nextWork !== null && claimSeq !== null
    ? "fixing"
    : "open";
  if (nextWork === work && nextStatus === status) {
    return ok({ status, work, changed: false });
  }
  tx.sql.run(`update problems set status = ?, work = ? where id = ?`, [
    nextStatus,
    nextWork,
    input.problem,
  ]);
  if (work !== null && work !== nextWork) {
    // 낡은 연결이면 그 ticket의 상태가, 아니면 이 ticket의 상태가 이유다.
    tx.emit(problemWorkEnded, input.problem, {
      ticket: work,
      reason: endReason(stale === null ? ticket : stale.state, causeEvent),
      ticket_event_seq: input.ticket_event_seq,
    });
  } else if (status === "fixing" && nextStatus !== "fixing") {
    tx.emit(problemWorkEnded, input.problem, {
      ticket: input.ticket,
      reason: endReason(ticket, causeEvent),
      ticket_event_seq: input.ticket_event_seq,
    });
  }
  const linked = nextWork !== null && nextWork !== work;
  const startedFixing = nextStatus === "fixing" && status !== "fixing";
  if (nextWork !== null && (linked || startedFixing)) {
    tx.emit(problemWorkStarted, input.problem, {
      ticket: nextWork,
      claim_seq: nextStatus === "fixing" ? claimSeq : null,
      ticket_event_seq: input.ticket_event_seq,
    });
  }
  return ok({ status: nextStatus, work: nextWork, changed: true });
}

export const reconcileProblemWorkCommand: CommandDefinition<
  typeof reconcileProblemWork
> = {
  route: reconcileProblemWork,
  handle(tx, ctx, input, compare) {
    return handleReconcileProblemWork(tx, ctx, input, compare);
  },
};

type Link = { version: string; section: string | null };

function sameLink(left: Link | null, right: Link | null): boolean {
  if (left === null || right === null) return left === right;
  return left.version === right.version && left.section === right.section;
}

// 해석 연결은 담당 App Engineer만 한다. 그 앱의 enabled App Engineer assignment가 호출자일
// 때만이고, assignment가 아닌 agent는 forbidden이다. 다른 앱의 AE와 없는 문제는 같은
// not_found다. 문제 진행은 건드리지 않는다. version·section 존재는 command 전 read 단계가
// 보므로(interpretation.ts) 이 handler는 version 참조와 문제 seq만 CAS로 본다.
export function handleLinkProblemInterpretation(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof linkProblemInterpretation>,
  compare: { problem_seq: string; previous: Link | null },
): Result<Output<typeof linkProblemInterpretation>, LophnError> {
  const actor = parseActor(ctx.actor);
  if (actor === undefined || actor.kind !== "agent") {
    return err({ code: "forbidden", message: "agent가 아니다" });
  }
  const assignment = tx.sql.get(
    `select scope_id from assignments
      where id = ? and role = 'app_engineer' and scope_kind = 'app'
        and state = 'enabled'`,
    [actor.id],
  );
  if (assignment === undefined) {
    return err({ code: "forbidden", message: "담당 App Engineer가 아니다" });
  }
  const row = tx.sql.get(
    `select app, interpretation_version, interpretation_section
       from problems where id = ?`,
    [input.problem],
  );
  if (
    row === undefined || String(row["app"]) !== String(assignment["scope_id"])
  ) {
    return notFound();
  }
  const current: Link | null = row["interpretation_version"] === null ? null : {
    version: String(row["interpretation_version"]),
    section: row["interpretation_section"] === null
      ? null
      : String(row["interpretation_section"]),
  };
  // 같은 이전 상태를 읽은 두 변경 중 뒤의 것이 낡았다.
  if (problemSeq(tx.sql, input.problem) !== compare.problem_seq) {
    return conflict("문제가 바뀌었다");
  }
  if (!sameLink(current, compare.previous)) {
    return conflict("해석 참조가 바뀌었다");
  }
  const next = input.interpretation;
  if (sameLink(current, next)) return ok({ interpretation: current });
  tx.sql.run(
    `update problems set interpretation_version = ?, interpretation_section = ?
      where id = ?`,
    [next?.version ?? null, next?.section ?? null, input.problem],
  );
  // 이전 참조는 event에 남는다. 상태는 그대로다.
  tx.emit(problemInterpretationLinked, input.problem, {
    previous: current,
    current: next,
  });
  return ok({ interpretation: next });
}

// tx.call로 lophn-agent의 ToolCall 성공과 같은 transaction에서 부를 수 있다(질문 Q13).
export const linkProblemInterpretationCommand: CommandDefinition<
  typeof linkProblemInterpretation
> = {
  route: linkProblemInterpretation,
  dispatchable: true,
  handle(tx, ctx, input, compare) {
    return handleLinkProblemInterpretation(tx, ctx, input, compare);
  },
};
