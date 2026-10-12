import { err, ok, type Result } from "../../base/mod.ts";
import {
  ASSIGNMENT_SUBSCRIBER,
  assignmentCreated,
  assignmentPaused,
  assignmentResumed,
  assignmentWithdrawn,
  createAppEngineerAssignment,
  createBuiltinAssignment,
  createOperatorAssignment,
  pauseAssignment,
  resumeAssignment,
  withdrawAssignment,
} from "../../protocol/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../protocol/platform/mod.ts";
import {
  ASSIGNMENT_COLUMNS,
  type AssignmentRow,
  isBuiltin,
  recordOf,
  rowOf,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 멈춤과 재개는 machine이 자리 보관 event를 근거로만 낸다(assignments#Q4, Q7).

function reject(
  code: "invalid_input" | "conflict" | "not_found" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

function requireActor(
  ctx: RequestContext,
  kind: "user" | "machine",
): Result<void> {
  return parseActor(ctx.actor)?.kind === kind ? ok(undefined) : err({
    code: "forbidden",
    message: kind === "machine"
      ? "assignment registration is machine only"
      : "assignment changes are user only",
  });
}

function loadRow(tx: Tx, id: string): AssignmentRow | undefined {
  const row = tx.sql.get(
    `select ${ASSIGNMENT_COLUMNS} from assignments where id = ?`,
    [id],
  );
  return row === undefined ? undefined : rowOf(row);
}

function insertAssignment(
  tx: Tx,
  id: string,
  role: string,
  scope: { kind: string; id: string | null },
): void {
  tx.emit(assignmentCreated, id, {
    revision: 1,
    role: role as never,
    scope: scope as never,
  });
  tx.sql.run(
    `insert into assignments (id, role, scope_kind, scope_id, state,
       pause_detail, pause_target, revision)
     values (?, ?, ?, ?, 'enabled', null, null, 1)`,
    [id, role, scope.kind, scope.id],
  );
}

// 자리가 있는지 생성 event로 본다. 다른 concern의 표를 읽지 않는다.
function placeCreated(tx: Tx, place: string): boolean {
  return tx.sql.get(
    `select 1 as found from events where subject = ?
     and type in ('ProjectCreated', 'AppCreated') limit 1`,
    [place],
  ) !== undefined;
}

export function createAssignmentCommands(): {
  createBuiltin: CommandDefinition<typeof createBuiltinAssignment>;
  createAppEngineer: CommandDefinition<typeof createAppEngineerAssignment>;
  createOperator: CommandDefinition<typeof createOperatorAssignment>;
  pause: CommandDefinition<typeof pauseAssignment>;
  resume: CommandDefinition<typeof resumeAssignment>;
  withdraw: CommandDefinition<typeof withdrawAssignment>;
} {
  return {
    createBuiltin: {
      route: createBuiltinAssignment,
      handle(tx, ctx, input: Input<typeof createBuiltinAssignment>) {
        const machine = requireActor(ctx, "machine");
        if (!machine.ok) return machine;
        const existing = loadRow(tx, input.id);
        if (existing !== undefined) {
          // 같은 등록 처리의 재전송은 기존 결과다(domain model command 표).
          if (
            existing.role !== input.role ||
            existing.scope_kind !== input.scope.kind
          ) {
            return reject("conflict", "assignment id already exists");
          }
          return ok({ assignment: recordOf(existing) });
        }
        // builtin은 역할별 전역 하나다(R2). partial unique index가 지키지만
        // command에서 먼저 본다.
        const sameRole = tx.sql.get(
          "select id from assignments where role = ? and state != 'withdrawn'",
          [input.role],
        );
        if (sameRole !== undefined) {
          return reject(
            "conflict",
            "a global assignment for this role already exists",
          );
        }
        insertAssignment(tx, input.id, input.role, input.scope);
        return ok({ assignment: recordOf(loadRow(tx, input.id)!) });
      },
    },
    createAppEngineer: {
      route: createAppEngineerAssignment,
      handle(tx, ctx, input: Input<typeof createAppEngineerAssignment>) {
        const machine = requireActor(ctx, "machine");
        if (!machine.ok) return machine;
        // emit은 그 event의 seq에서만 한다. AppCreated가 아직 없으면 not_found다.
        const created = tx.sql.get(
          "select cast(seq as text) as seq from events where seq = ? and type = 'AppCreated' and subject = ?",
          [BigInt(input.app_created_seq), input.app],
        );
        if (created === undefined) {
          return reject("not_found", "the app creation event is missing");
        }
        const existing = loadRow(tx, input.id);
        if (existing !== undefined) {
          if (
            existing.role !== "app_engineer" || existing.scope_id !== input.app
          ) {
            return reject("conflict", "assignment id already exists");
          }
          return ok({ assignment: recordOf(existing) });
        }
        // 앱마다 거두지 않은 AE 하나다(R1, R2). 재전송 key가 달라도 등록된 앱의
        // 둘째 AE는 거절이다.
        const sameApp = tx.sql.get(
          `select id from assignments where role = 'app_engineer'
           and scope_id = ? and state != 'withdrawn'`,
          [input.app],
        );
        if (sameApp !== undefined) {
          return reject(
            "conflict",
            "an app engineer assignment for this app already exists",
          );
        }
        insertAssignment(tx, input.id, "app_engineer", {
          kind: "app",
          id: input.app,
        });
        // assignment·event·cursor를 같은 transaction에 확정한다(R1,
        // architecture 5.10, createNotification과 같은 모양). 반응 없이 직접
        // 내는 등록은 cursor를 건드리지 않는다.
        if (input.processed_through_seq !== undefined) {
          const advanced = tx.advanceSubscriberCursor(
            ASSIGNMENT_SUBSCRIBER,
            input.processed_through_seq,
          );
          if (!advanced.ok) return advanced;
        }
        return ok({ assignment: recordOf(loadRow(tx, input.id)!) });
      },
    },
    createOperator: {
      route: createOperatorAssignment,
      // 새 Operator 저장(SaveAgent)이 같은 transaction에서 부른다(R4).
      dispatchable: true,
      handle(tx, ctx, input: Input<typeof createOperatorAssignment>) {
        const person = requireActor(ctx, "user");
        if (!person.ok) return person;
        if (loadRow(tx, input.id) !== undefined) {
          return reject("conflict", "assignment id already exists");
        }
        // 담당 자리는 있어야 하고 같은 자리에 Operator를 몇 개든 둘 수 있다(R2).
        if (!placeCreated(tx, input.scope.id)) {
          return reject("not_found", "the operator place is missing");
        }
        insertAssignment(tx, input.id, "operator", input.scope);
        return ok({ assignment: recordOf(loadRow(tx, input.id)!) });
      },
    },
    pause: {
      route: pauseAssignment,
      handle(tx, ctx, input: Input<typeof pauseAssignment>, compare) {
        const machine = requireActor(ctx, "machine");
        if (!machine.ok) return machine;
        const current = loadRow(tx, input.assignment);
        if (current === undefined) {
          return reject("not_found", "assignment not found");
        }
        // CAS다. state·revision이 같아야 pause를 진행한다.
        if (current.revision !== compare.revision) {
          return reject("conflict", "assignment revision changed");
        }
        if (current.state !== compare.state) {
          return reject("conflict", "assignment state changed");
        }
        // 근거는 담당 자리가 보관됐다는 event다. 신고만으로 멈추지 않는다. 보관 뒤 곧바로
        // 풀린 자리도 반응이 event 순서대로 멈춤 다음 재개를 내므로 보관 event의 존재만 본다.
        if (input.reason.target !== current.scope_id) {
          return reject(
            "forbidden",
            "scope pause target does not match the assignment scope",
          );
        }
        const archived = tx.sql.get(
          `select 1 as found from events where subject = ?
           and type in ('ProjectArchived', 'AppArchived') limit 1`,
          [input.reason.target],
        );
        if (archived === undefined) {
          return reject("forbidden", "the scope target is not archived");
        }
        tx.emit(assignmentPaused, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
          reason: input.reason,
        });
        tx.sql.run(
          `update assignments set state = 'paused', pause_detail = ?,
             pause_target = ?, revision = ? where id = ?`,
          [
            input.reason.detail,
            input.reason.target,
            current.revision + 1,
            input.assignment,
          ],
        );
        // 자리 보관 반응이면 멈춤·event·cursor를 같은 transaction에 확정한다(R1).
        if (input.processed_through_seq !== undefined) {
          const advanced = tx.advanceSubscriberCursor(
            ASSIGNMENT_SUBSCRIBER,
            input.processed_through_seq,
          );
          if (!advanced.ok) return advanced;
        }
        return ok({ assignment: recordOf(loadRow(tx, input.assignment)!) });
      },
    },
    resume: {
      route: resumeAssignment,
      handle(tx, ctx, input: Input<typeof resumeAssignment>, compare) {
        const machine = requireActor(ctx, "machine");
        if (!machine.ok) return machine;
        const current = loadRow(tx, input.assignment);
        if (current === undefined) {
          return reject("not_found", "assignment not found");
        }
        if (current.revision !== compare.revision) {
          return reject("conflict", "assignment revision changed");
        }
        if (current.state !== compare.state) {
          return reject("conflict", "assignment state changed");
        }
        // 멈춤을 푸는 근거는 멈춘 자리의 보관이 풀렸다는 event다(assignments#Q7). 반응이
        // event 순서대로 멈춤과 재개를 내므로 해제 event의 존재만 본다.
        const unarchived = current.pause_target === null
          ? undefined
          : tx.sql.get(
            `select 1 as found from events where subject = ?
           and type in ('ProjectUnarchived', 'AppUnarchived') limit 1`,
            [current.pause_target],
          );
        if (unarchived === undefined) {
          return reject("forbidden", "the scope target was not unarchived");
        }
        tx.emit(assignmentResumed, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
        });
        tx.sql.run(
          `update assignments set state = 'enabled', pause_detail = null,
             pause_target = null, revision = ? where id = ?`,
          [current.revision + 1, input.assignment],
        );
        if (input.processed_through_seq !== undefined) {
          const advanced = tx.advanceSubscriberCursor(
            ASSIGNMENT_SUBSCRIBER,
            input.processed_through_seq,
          );
          if (!advanced.ok) return advanced;
        }
        return ok({ assignment: recordOf(loadRow(tx, input.assignment)!) });
      },
    },
    withdraw: {
      route: withdrawAssignment,
      // Operator 삭제(DeleteAgent)가 같은 transaction에서 부른다(R9).
      dispatchable: true,
      handle(tx, ctx, input: Input<typeof withdrawAssignment>, compare) {
        const person = requireActor(ctx, "user");
        if (!person.ok) return person;
        const current = loadRow(tx, input.assignment);
        if (current === undefined) {
          return reject("not_found", "assignment not found");
        }
        if (current.revision !== compare.revision) {
          return reject("conflict", "assignment revision changed");
        }
        if (current.state !== compare.state) {
          return reject("conflict", "assignment state changed");
        }
        // lophn·Context Engineer·App Engineer는 거둘 수 없다. Operator만 거둔다(R9).
        if (current.role !== "operator") {
          return reject(
            "forbidden",
            isBuiltin(current.role)
              ? "a global builtin assignment cannot be withdrawn"
              : "only an operator assignment can be withdrawn",
          );
        }
        tx.emit(assignmentWithdrawn, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
        });
        tx.sql.run(
          `update assignments set state = 'withdrawn', pause_detail = null,
             pause_target = null, revision = ? where id = ?`,
          [current.revision + 1, input.assignment],
        );
        return ok({ assignment: recordOf(loadRow(tx, input.assignment)!) });
      },
    },
  };
}
