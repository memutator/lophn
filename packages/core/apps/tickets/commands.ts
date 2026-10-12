// ticket 생성·ready 전환 command.
// 생성·문제 예약은 한 transaction이며 문제당 열린 repair 제약을
// ticket_open_repair_problems unique로 강제한다. handler는 동기이고
// condition_hash는 transaction 안에서 node:crypto로 정규 JSON sha256을 낸다
// (problems/tests canonical 선례).
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import {
  type AcceptanceCheck,
  ticketCreate,
  ticketCreated,
  type TicketCreateInput,
  ticketMadeReady,
  ticketMakeReady,
  type TicketMakeReadyInput,
} from "../../../protocol/coding-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  adoptionMatches,
  conditionInputsValid,
  createActorAllowed,
  humanConfirmationCoupled,
  outsideAppCondition,
  readinessOf,
  readyKindsComplete,
  uniqueConditions,
} from "./model.ts";

// 문제 read·question read·documents resolve는 소유 구현이 아직 없다.
// handler는 port로 대신 주입받는다.
export const QUESTION_ADOPTIONS_PORT = {
  name: "coding-agent.tickets.QuestionAdoptions",
} as const;
export const PROBLEM_STATUSES_PORT = {
  name: "coding-agent.tickets.ProblemStatuses",
} as const;

type QuestionAdoption = { document: string; version: string };
type ProblemStatus = { id: string; status: string };
type AdoptionLookup = {
  adoptions(questions: readonly string[]): Result<
    Map<string, QuestionAdoption>
  >;
};
type ProblemLookup = {
  problems(ids: readonly string[]): Result<ProblemStatus[]>;
};

function conditionHash(input: AcceptanceCheck): string {
  return createHash("sha256").update(canonicalize(input), "utf8").digest("hex");
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

export function createTicketCommands(): {
  create: CommandDefinition<typeof ticketCreate>;
  make_ready: CommandDefinition<typeof ticketMakeReady>;
} {
  return {
    create: {
      route: ticketCreate,
      handle(tx, ctx, input) {
        return createTicket(tx, ctx, input);
      },
    },
    make_ready: {
      route: ticketMakeReady,
      handle(tx, ctx, input, compare) {
        return makeReady(tx, ctx, input, compare);
      },
    },
  };
}

type TicketCreateOutput = {
  ticket: string;
  state: "open";
  readiness: "needs_confirmation" | "ready";
  revision: string;
};

function createTicket(
  tx: Tx,
  ctx: RequestContext,
  input: TicketCreateInput,
): Result<TicketCreateOutput> {
  if (!createActorAllowed(ctx.actor)) {
    return err({
      code: "forbidden",
      message: "actor is not allowed to create tickets",
    });
  }
  const readiness = readinessOf(input.readiness, input.needs);
  if (!readiness.ok) return readiness;
  // 구현 ticket은 문제를 묶지 않고 repair는 1개 이상이다. order는 contract
  // validCreate가 검사하지만 동시 생성의 승자는 예약 unique가 만든다.
  if (outsideAppCondition(ctx, input.app)) {
    return notFound("app does not exist");
  }
  const registered = tx.port(appRegistrationLookup).get(input.app);
  if (!registered.ok) return registered;
  if (registered.value === null) return notFound("app does not exist");
  const adopted = new Map<string, QuestionAdoption>();
  if (input.adoption_questions.length > 0) {
    const read = tx.port(QUESTION_ADOPTIONS_PORT) as AdoptionLookup;
    const found = read.adoptions(input.adoption_questions);
    if (!found.ok) return found;
    for (const [question, adoption] of found.value) {
      adopted.set(question, adoption);
    }
  }
  // ready 생성도 make_ready와 같은 근거 일치 검사를 거친다.
  if (readiness.value === "ready") {
    const matched = adoptionMatches(input.references, adopted);
    if (!matched.ok) return matched;
  }
  if (input.conditions.length > 0) {
    const parsed = conditionInputsValid(input.conditions);
    if (!parsed.ok) return parsed;
    const unique = uniqueConditions(parsed.value);
    if (!unique.ok) return unique;
    const coupled = humanConfirmationCoupled(parsed.value);
    if (!coupled.ok) return coupled;
  }
  if (input.problems.length > 0) {
    const statuses = tx.port(PROBLEM_STATUSES_PORT) as ProblemLookup;
    const loaded = statuses.problems(input.problems);
    if (!loaded.ok) return loaded;
    const closed = loaded.value.find(
      (problem) => problem.status === "closed",
    );
    if (closed !== undefined) {
      return invalid("closed problem cannot be repaired");
    }
    for (const problem of input.problems) {
      if (reserved(tx, problem)) {
        return conflict("an open repair ticket already reserves this problem");
      }
    }
  }
  return writeCreate(tx, input, readiness.value);
}

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

function reserved(tx: Tx, problem: string): boolean {
  return tx.sql.get(
    "SELECT problem FROM ticket_open_repair_problems WHERE problem = ?",
    [problem],
  ) !== undefined;
}

function writeCreate(
  tx: Tx,
  input: TicketCreateInput,
  readiness: "needs_confirmation" | "ready",
): Result<TicketCreateOutput> {
  // ID는 입력이 아니라 ledger ID source가 만든다(createShape에 id가 없다).
  const id = tx.newId("tkt");
  const seq = tx.emit(ticketCreated, id, {
    app: input.app,
    kind: input.kind,
    problems: input.problems,
    readiness,
  });
  tx.sql.run(
    `INSERT INTO tickets (id, app, kind, title, what, why, inspect, preserve,
       problems, state, readiness, needs, cancel_reason, completion_seq, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, NULL, ?)`,
    [
      id,
      input.app,
      input.kind,
      input.title,
      input.what,
      input.why,
      JSON.stringify(input.inspect),
      JSON.stringify(input.preserve),
      JSON.stringify(input.problems),
      readiness,
      JSON.stringify(input.needs),
      seq,
    ],
  );
  input.references.forEach((reference, position) => {
    tx.sql.run(
      `INSERT INTO ticket_references (ticket, position, kind, target, address, section)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        position,
        reference.kind,
        reference.target,
        reference.address === null ? null : canonicalize(reference.address),
        reference.section,
      ],
    );
  });
  input.adoption_questions.forEach((question, position) => {
    tx.sql.run(
      `INSERT INTO ticket_adoption_questions (ticket, position, question)
       VALUES (?, ?, ?)`,
      [id, position, question],
    );
  });
  input.problems.forEach((problem, position) => {
    tx.sql.run(
      `INSERT INTO ticket_problems (ticket, position, problem) VALUES (?, ?, ?)`,
      [id, position, problem],
    );
    // repair 예약은 같은 transaction이다.
    tx.sql.run(
      `INSERT INTO ticket_open_repair_problems (problem, ticket) VALUES (?, ?)`,
      [problem, id],
    );
  });
  input.conditions.forEach((condition, position) => {
    tx.sql.run(
      `INSERT INTO ticket_conditions (ticket, position, kind, input, condition_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        position,
        condition.kind,
        canonicalize(condition),
        conditionHash(condition),
      ],
    );
  });
  return ok({ ticket: id, state: "open", readiness, revision: seq });
}

function makeReady(
  tx: Tx,
  ctx: RequestContext,
  input: TicketMakeReadyInput,
  compare: { base_revision: string },
): Result<{ ticket: string; readiness: "ready"; revision: string }> {
  if (!createActorAllowed(ctx.actor)) {
    return err({
      code: "forbidden",
      message: "actor is not allowed to make tickets ready",
    });
  }
  const row = loadTicket(tx, input.ticket);
  if (!row.ok) return row;
  if (row.value === null) return notFound("ticket does not exist");
  const stored = row.value;
  if (outsideAppCondition(ctx, stored.app)) {
    return notFound("ticket does not exist");
  }
  // 종료(confirm·취소)와 이미 ready인 ticket은 전환하지 않는다.
  if (stored.state !== "open" || stored.readiness !== "needs_confirmation") {
    return conflict("ticket is not waiting for confirmation");
  }
  if (compare.base_revision !== input.base_revision) {
    return conflict("ticket revision changed");
  }
  if (stored.revision !== input.base_revision) {
    return conflict("ticket revision changed");
  }
  const parsed = conditionInputsValid(input.conditions);
  if (!parsed.ok) return parsed;
  const unique = uniqueConditions(parsed.value);
  if (!unique.ok) return unique;
  const coupled = humanConfirmationCoupled(parsed.value);
  if (!coupled.ok) return coupled;
  const kinds = readyKindsComplete(
    stored.kind === "repair" ? "repair" : "implementation",
    stored.problems,
    parsed.value,
  );
  if (!kinds.ok) return kinds;
  const registered = tx.port(appRegistrationLookup).get(stored.app);
  if (!registered.ok) return registered;
  if (registered.value === null) return notFound("app does not exist");
  const read = tx.port(QUESTION_ADOPTIONS_PORT) as AdoptionLookup;
  const found = read.adoptions(input.adoption_questions);
  if (!found.ok) return found;
  const matched = adoptionMatches(
    input.references,
    found.value,
  );
  if (!matched.ok) return matched;
  const seq = tx.emit(ticketMadeReady, input.ticket, {
    app: stored.app,
    kind: stored.kind,
    problems: stored.problems,
  });
  tx.sql.run(
    `UPDATE tickets SET readiness = 'ready', needs = '[]', revision = ?
     WHERE id = ?`,
    [seq, input.ticket],
  );
  // make_ready는 근거·조건을 입력 값으로 덮어쓴다(한 번에 채운다).
  input.references.forEach((reference, position) => {
    tx.sql.run(
      `INSERT INTO ticket_references (ticket, position, kind, target, address, section)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.ticket,
        position,
        reference.kind,
        reference.target,
        reference.address === null ? null : canonicalize(reference.address),
        reference.section,
      ],
    );
  });
  input.adoption_questions.forEach((question, position) => {
    tx.sql.run(
      `INSERT INTO ticket_adoption_questions (ticket, position, question)
       VALUES (?, ?, ?)`,
      [input.ticket, position, question],
    );
  });
  input.conditions.forEach((condition, position) => {
    tx.sql.run(
      `INSERT INTO ticket_conditions (ticket, position, kind, input, condition_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.ticket,
        position,
        condition.kind,
        canonicalize(condition),
        conditionHash(condition),
      ],
    );
  });
  return ok({ ticket: input.ticket, readiness: "ready", revision: seq });
}

function loadTicket(
  tx: Tx,
  id: string,
): Result<
  {
    app: string;
    kind: "implementation" | "repair";
    state: string;
    readiness: string;
    problems: string[];
    revision: string;
  } | null
> {
  const row = tx.sql.get(
    `SELECT app, kind, state, readiness, problems, revision FROM tickets
     WHERE id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  const problems = JSON.parse(String(row.problems)) as unknown;
  return ok({
    app: String(row.app),
    kind: row.kind === "repair" ? "repair" : "implementation",
    state: String(row.state),
    readiness: row.readiness === "ready" ? "ready" : "needs_confirmation",
    problems: Array.isArray(problems) ? problems.map(String) : [],
    revision: String(row.revision),
  });
}
