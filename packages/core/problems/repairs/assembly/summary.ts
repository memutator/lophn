// 세션 시작 summary 조립이다. 요청자 connection의
// credential로 같은 범위의 정본(문제·ticket·connection 읽기)을 읽어 요약만 만든다. 본문·log·첨부·수리
// 묶음은 읽지 않고 claim·상태를 바꾸는 호출이 이 module에 없다. 어느 읽기든 실패하면 빈 목록으로
// 바꾸지 않고 그 오류를 그대로 돌려준다. 범위 밖 앱은 없는 앱과 같은 not_found다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type CodingAgentSessionSummary,
  type ConnectionId,
  connectionIdSchema,
  type ConnectionScope,
  connectionShow,
  ticketChecks,
  ticketList,
  ticketShow,
} from "../../../../protocol/coding-agent/mod.ts";
import type { ReadRoute, Route } from "../../../../protocol/base/mod.ts";
import { getProblem, listProblems } from "../../../../protocol/problems/mod.ts";
import { UNREADABLE_MESSAGE } from "./model.ts";

export const PROBLEM_PAGE = 12;
export const TICKET_PAGE = 20;
export const CLAIM_LIMIT = 12;
export const REMAINING_LIMIT = 20;
// 한 상태의 목록을 모으는 쪽 수 상한이다. 읽을 수 있는 것이 이보다 많으면 앞쪽만 요약한다.
const LIST_PAGES = 5;
const PROBLEM_LIST_LIMIT = 100;

// 착수 지시가 아니라는 안내다. 시작 summary와 skill이 같은 문장을 쓴다.
export const CLAIM_RULE =
  "목록 발견과 이 summary 읽기는 착수 지시가 아니다. 사람이 이 터미널에서 지정했거나 [Start] 첫 prompt가 가리킨 ticket 하나만 MCP로 claim한다";

export type SummaryReadClient = {
  read(route: Route, input: unknown): Promise<Result<unknown>>;
};

type Output<R extends ReadRoute> = ReturnType<R["output"]["parse"]>;

async function parsed<R extends ReadRoute>(
  client: SummaryReadClient,
  route: R,
  input: unknown,
): Promise<Result<Output<R>>> {
  const read = await client.read(route, input);
  if (!read.ok) return read;
  const output = route.output.safeParse(read.value);
  if (!output.success) {
    return err({
      code: "unavailable",
      message: "읽기 응답이 contract와 다르다",
    });
  }
  return ok(output.data as Output<R>);
}

type Page<T> = { items: T[]; next: string | null; asOf: string };

// 쪽 단위 읽기 목록을 상한까지 이어 모은다.
async function collect<T>(
  fetchPage: (cursor: string | undefined) => Promise<Result<Page<T>>>,
): Promise<Result<{ items: T[]; asOf: string }>> {
  const items: T[] = [];
  let cursor: string | undefined;
  let asOf = "0";
  for (let page = 0; page < LIST_PAGES; page += 1) {
    const read = await fetchPage(cursor);
    if (!read.ok) return read;
    items.push(...read.value.items);
    asOf = laterSeq(asOf, read.value.asOf);
    if (read.value.next === null) break;
    cursor = read.value.next;
  }
  return ok({ items, asOf });
}

function laterSeq(left: string, right: string): string {
  return BigInt(right) > BigInt(left) ? right : left;
}

function compareSeqDesc(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? 1 : -1;
}

// cursor는 문제와 ticket 목록의 읽기 시작 위치다. 범위를 넓히는 값이 없다(위치만 담는다).
function parseCursor(
  cursor: string | undefined,
): Result<{ problems: number; tickets: number }> {
  if (cursor === undefined) return ok({ problems: 0, tickets: 0 });
  const match = /^p(\d{1,6})\.t(\d{1,6})$/.exec(cursor);
  if (match === null) {
    return err({ code: "invalid_input", message: "invalid summary cursor" });
  }
  return ok({ problems: Number(match[1]), tickets: Number(match[2]) });
}

function safeLine(text: string): string {
  const line = text.replace(/\p{Cc}+/gu, " ").trim();
  return line === "" ? "-" : line;
}

function ownConnection(principal: string): Result<ConnectionId> {
  const id = principal.startsWith("coding_agent:")
    ? principal.slice("coding_agent:".length)
    : "";
  const checked = connectionIdSchema.safeParse(id);
  return checked.success ? ok(checked.data) : err({
    code: "unauthorized",
    message: "credential이 현재 유효하지 않다",
  });
}

export type SessionSummaryResult = {
  summary: CodingAgentSessionSummary;
  as_of_seq: string;
};

type TicketListState = "open" | "check_failed" | "claimed" | "reported";

// 한 요청의 summary다. principal은 요청 credential의 주체(`coding_agent:<connection>`)다.
export async function assembleSessionSummary(
  client: SummaryReadClient,
  request: {
    principal: string;
    input: { app?: string; cursor?: string };
    now(): string;
  },
): Promise<Result<SessionSummaryResult>> {
  const id = ownConnection(request.principal);
  if (!id.ok) return id;
  const position = parseCursor(request.input.cursor);
  if (!position.ok) return position;
  const shown = await parsed(client, connectionShow, { connection: id.value });
  if (!shown.ok) return shown;
  const scope: ConnectionScope = shown.value.connection.scope;
  // 앱 하나 범위 연결이 다른 앱을 물으면 없는 앱과 같은 답이다.
  if (
    scope.kind === "app" && request.input.app !== undefined &&
    request.input.app !== scope.app
  ) {
    return err({ code: "not_found", message: UNREADABLE_MESSAGE });
  }
  const app = request.input.app ??
    (scope.kind === "app" ? scope.app : undefined);
  const appFilter = app === undefined ? {} : { app };
  let asOf = shown.value.as_of_seq;

  // 열린·고치는 중인 문제. 최근 변화(seq)가 큰 것이 앞이다.
  const problems = [];
  for (const status of ["open", "fixing"] as const) {
    const read = await collect(async (cursor) => {
      const page = await parsed(client, listProblems, {
        ...appFilter,
        status,
        limit: PROBLEM_LIST_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return page.ok
        ? ok({
          items: page.value.problems,
          next: page.value.next_cursor,
          asOf: page.value.as_of_seq,
        })
        : page;
    });
    if (!read.ok) return read;
    problems.push(...read.value.items);
    asOf = laterSeq(asOf, read.value.asOf);
  }
  problems.sort((a, b) => compareSeqDesc(a.seq, b.seq));
  const problemPage = problems.slice(
    position.value.problems,
    position.value.problems + PROBLEM_PAGE,
  );
  const problemRows = [];
  for (const item of problemPage) {
    const detail = await parsed(client, getProblem, { problem: item.id });
    if (!detail.ok) return detail;
    asOf = laterSeq(asOf, detail.value.as_of_seq);
    problemRows.push({
      ...item,
      symptom: safeLine(item.symptom),
      repair_state: detail.value.detail?.repair.state ?? "unknown",
    });
  }

  // ticket 목록은 state별 읽기를 합친다(list는 state 하나만 받는다).
  const ticketsIn = (state: TicketListState) =>
    collect(async (cursor) => {
      const page = await parsed(client, ticketList, {
        ...appFilter,
        state,
        limit: TICKET_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return page.ok
        ? ok({
          items: page.value.tickets,
          next: page.value.next_cursor,
          asOf: page.value.as_of_seq,
        })
        : page;
    });
  const open = [];
  for (const state of ["open", "check_failed"] as const) {
    const read = await ticketsIn(state);
    if (!read.ok) return read;
    open.push(...read.value.items);
    asOf = laterSeq(asOf, read.value.asOf);
  }
  open.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ticketPage = open.slice(
    position.value.tickets,
    position.value.tickets + TICKET_PAGE,
  );
  const ticketRows = [];
  for (const item of ticketPage) {
    const detail = await parsed(client, ticketShow, { ticket: item.id });
    if (!detail.ok) return detail;
    asOf = laterSeq(asOf, detail.value.as_of_seq);
    ticketRows.push({
      id: item.id,
      app: item.app,
      kind: item.kind,
      title: safeLine(item.title),
      state: item.state === "check_failed"
        ? "check_failed" as const
        : "open" as const,
      readiness: item.readiness,
      problems: detail.value.ticket.problems,
    });
  }

  // 자기 claim과 기한. 다른 연결의 claim은 넣지 않는다.
  const claimed = await ticketsIn("claimed");
  if (!claimed.ok) return claimed;
  const claims = [];
  for (const item of claimed.value.items) {
    const detail = await parsed(client, ticketShow, { ticket: item.id });
    if (!detail.ok) return detail;
    const claim = detail.value.ticket.claim;
    if (claim !== null && claim.connection === id.value) {
      claims.push({
        ticket: item.id,
        connection: id.value,
        claim_seq: claim.claim_seq,
        expires_at: claim.expires_at,
      });
    }
  }

  // 완료 보고 뒤 남은 검사 조건(통과하지 않은 조건 번호)이다. 원문은 읽지 않는다.
  const reported = await ticketsIn("reported");
  if (!reported.ok) return reported;
  const remaining = [];
  for (const item of reported.value.items) {
    const checks = await parsed(client, ticketChecks, { ticket: item.id });
    if (!checks.ok) return checks;
    if (checks.value.completion_seq === null) continue;
    let conditions: number[];
    let reason: string;
    if (checks.value.checks.length === 0) {
      const detail = await parsed(client, ticketShow, { ticket: item.id });
      if (!detail.ok) return detail;
      conditions = detail.value.ticket.conditions.map((one) => one.position);
      reason = "검사 전";
    } else {
      const left = checks.value.checks.filter((one) => one.result !== "pass");
      conditions = left.map((one) => one.condition);
      const first = left[0];
      reason = first === undefined
        ? ""
        : safeLine(first.reason === "" ? first.result : first.reason);
    }
    if (conditions.length === 0) continue;
    remaining.push({
      ticket: item.id,
      completion_seq: checks.value.completion_seq,
      conditions,
      reason,
    });
  }

  const nextProblems = Math.min(
    position.value.problems + PROBLEM_PAGE,
    problems.length,
  );
  const nextTickets = Math.min(
    position.value.tickets + TICKET_PAGE,
    open.length,
  );
  const more = nextProblems < problems.length || nextTickets < open.length;
  return ok({
    as_of_seq: asOf,
    summary: {
      connection: id.value,
      scope,
      observed_seq: asOf,
      observed_at: request.now(),
      problems: problemRows,
      tickets: ticketRows,
      claims: claims.slice(0, CLAIM_LIMIT),
      remaining_checks: remaining.slice(0, REMAINING_LIMIT),
      project: null,
      folder: null,
      claim_rule: CLAIM_RULE,
      next_cursor: more ? `p${nextProblems}.t${nextTickets}` : null,
    },
  });
}
