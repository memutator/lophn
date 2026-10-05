import { err, ok, type Result } from "../../base/mod.ts";
import {
  type acceptRun,
  assignmentScheduleAdvanced,
  processAssignmentOccurrence,
  type Schedule,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Compare,
  type Input,
  type Output,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  loadOccurrence,
  type OccurrenceRow,
  recordOf,
  type Round,
  roundFor,
  sameRound,
  UNFINISHED_RUN_STATES,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 회차 접수(Run 접수)·회차 기록·last_due_at 이동은 같은 transaction이고
// 하나라도 실패하면 이전 판 전체가 남는다(domain-model lophn-agent/scheduling).

export type SchedulingDeps = {
  // 같은 Tx에서 run을 접수한다(run-loop AcceptRun). 회차 접수와 run 접수는 한
  // transaction이어야 한다(R4). 조립이 run-loop의 accept handler를 건다.
  acceptRun: (
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof acceptRun>,
    compare: Compare<typeof acceptRun>,
  ) => Result<Output<typeof acceptRun>>;
};

type Code = "invalid_input" | "conflict" | "not_found" | "forbidden";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : reject(
    "forbidden",
    "schedule occurrences are machine only",
  );
}

type AssignmentRef = {
  role: string;
  state: string;
  revision: number;
  last_due_at: string | null;
};

function loadAssignment(tx: Tx, id: string): AssignmentRef | undefined {
  const row = tx.sql.get(
    "select role, state, revision, last_due_at from assignments where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    role: String(row["role"]),
    state: String(row["state"]),
    revision: Number(row["revision"]),
    last_due_at: row["last_due_at"] === null
      ? null
      : String(row["last_due_at"]),
  };
}

// 현재 판의 승인된 주기. 판 blob은 한 번 쓰면 바뀌지 않는다.
function loadSchedule(
  tx: Tx,
  assignment: string,
  revision: number,
): Schedule | undefined {
  const row = tx.sql.get(
    `select definition from assignment_revisions
     where assignment_id = ? and revision = ?`,
    [assignment, revision],
  );
  if (row === undefined) return undefined;
  try {
    const definition = JSON.parse(String(row["definition"])) as {
      schedule: Schedule | null;
    };
    return definition.schedule ?? undefined;
  } catch {
    return undefined;
  }
}

// 같은 키의 재전송은 이전 결과다. 입력이 다르면 같은 회차에 다른 판단을 하려는 것이다.
function replay(
  stored: OccurrenceRow,
  input: Input<typeof processAssignmentOccurrence>,
  compare: Compare<typeof processAssignmentOccurrence>,
): Result<Output<typeof processAssignmentOccurrence>> {
  const same = stored.previous_due_at === compare.previous_due_at &&
    stored.missed_first_at === input.missed_first_at &&
    stored.missed_last_at === input.missed_last_at &&
    stored.missed_count === input.missed_count;
  if (!same) {
    return reject("conflict", "the occurrence was recorded with other input");
  }
  return ok({ occurrence: recordOf(stored) });
}

export function createSchedulingCommands(deps: SchedulingDeps): {
  process: CommandDefinition<typeof processAssignmentOccurrence>;
} {
  return {
    process: {
      route: processAssignmentOccurrence,
      handle(tx, ctx, input, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const assignment = loadAssignment(tx, input.assignment);
        if (assignment === undefined) {
          return reject("not_found", "assignment not found");
        }
        const stored = loadOccurrence(
          tx,
          input.assignment,
          compare.assignment_revision,
          input.due_at,
        );
        if (stored !== undefined) return replay(stored, input, compare);
        // 멈춘·철회한·역할이 다른 assignment의 회차는 skip으로 바꾸지 않고 거절한다.
        if (assignment.role !== "operator" || assignment.state !== "enabled") {
          return reject("forbidden", "assignment does not take periodic runs");
        }
        if (assignment.revision !== compare.assignment_revision) {
          return reject("conflict", "assignment changed");
        }
        if (assignment.last_due_at !== compare.previous_due_at) {
          return reject("conflict", "the previous due time moved");
        }
        const schedule = loadSchedule(
          tx,
          input.assignment,
          assignment.revision,
        );
        if (schedule === undefined) {
          return reject("invalid_input", "assignment has no schedule");
        }
        // machine이 ledger 밖에서 계산한 회차는 지금까지의 미처리 예정 시점 중 가장 최근
        // 하나와 그 앞 놓친 구간이어야 한다(R6). 주기와 직전 처리 시점에서 다시 계산해
        // 비교한다.
        const given: Round = {
          due_at: input.due_at,
          missed_first_at: input.missed_first_at,
          missed_last_at: input.missed_last_at,
          missed_count: input.missed_count,
        };
        const current = roundFor(schedule, assignment.last_due_at, tx.now());
        if (!current.ok) return current;
        if (current.value === null || input.due_at > current.value.due_at) {
          return reject("invalid_input", "the due time has not come");
        }
        if (!sameRound(current.value, given)) {
          // 주기 위의 올바른 회차지만 더 최근 회차가 이미 와 있으면 낡은 입력이다.
          const own = roundFor(schedule, assignment.last_due_at, input.due_at);
          if (!own.ok) return own;
          return own.value !== null && sameRound(own.value, given)
            ? reject("conflict", "a more recent due time is current")
            : reject(
              "invalid_input",
              "the due time and missed range do not follow the schedule",
            );
        }
        const blocking = tx.sql.all(
          `select id from runs
           where assignment = ? and state in (${
            UNFINISHED_RUN_STATES.map(() => "?").join(", ")
          })
           order by accepted_seq`,
          [input.assignment, ...UNFINISHED_RUN_STATES],
        ).map((row) => String(row["id"]));
        let run: string | null = null;
        if (blocking.length === 0) {
          const accepted = deps.acceptRun(tx, ctx, {
            id: tx.newId("run"),
            assignment: input.assignment,
            session: null,
            source: {
              kind: "schedule",
              assignment_revision: assignment.revision,
              scheduled_at: input.due_at,
            },
            continued_from: null,
            start_after: null,
          }, { assignment_revision: assignment.revision });
          if (!accepted.ok) return accepted;
          run = accepted.value.id;
        }
        const outcome = run === null ? "skipped" : "accepted";
        const skipReason = run === null ? "unfinished_run" : null;
        const seq = tx.emit(assignmentScheduleAdvanced, input.assignment, {
          assignment_revision: assignment.revision,
          previous_due_at: assignment.last_due_at,
          due_at: input.due_at,
          missed_first_at: input.missed_first_at,
          missed_last_at: input.missed_last_at,
          missed_count: input.missed_count,
          outcome,
          run,
          skip_reason: skipReason,
          blocking_runs: blocking,
        });
        tx.sql.run(
          `insert into assignment_schedule_occurrences (assignment_id,
             assignment_revision, due_at, previous_due_at, outcome, run_id,
             skip_reason, blocking_runs, missed_first_at, missed_last_at,
             missed_count, event_seq)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.assignment,
            assignment.revision,
            input.due_at,
            assignment.last_due_at,
            outcome,
            run,
            skipReason,
            JSON.stringify(blocking),
            input.missed_first_at,
            input.missed_last_at,
            input.missed_count,
            Number(seq),
          ],
        );
        // skip도 이 회차를 처리한 것이다. due로 남겨 다음 tick에 다시 시도하지 않는다(R5).
        tx.sql.run("update assignments set last_due_at = ? where id = ?", [
          input.due_at,
          input.assignment,
        ]);
        const row = loadOccurrence(
          tx,
          input.assignment,
          assignment.revision,
          input.due_at,
        );
        if (row === undefined) {
          return reject("conflict", "the occurrence record was not stored");
        }
        return ok({ occurrence: recordOf(row) });
      },
    },
  };
}
