import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import { createHash } from "node:crypto";
import {
  applyOperatorAssignment,
  ASSIGNMENT_SUBSCRIBER,
  assignmentChanged,
  assignmentCreated,
  assignmentPaused,
  assignmentResumed,
  assignmentWithdrawn,
  changeAssignmentPreset,
  createAppEngineerAssignment,
  createBuiltinAssignment,
  pauseAssignment,
  resumeAssignment,
  withdrawAssignment,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  type AssignmentDefinition,
  type AssignmentRow,
  bundleDefinition,
  isBuiltin,
  newFailureBundle,
  recordOf,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다(R12). machine pause는 repeated
// failures·archived target 근거만 내고 사람 pause는 user 근거다(R10, platform#T29).

function reject(
  code: "invalid_input" | "conflict" | "not_found" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

// CreateBuiltinAssignment·CreateAppEngineerAssignment·ApplyOperatorAssignment은
// machine만 내는 등록이다(T9가 AssignmentPaused 발생 자리다).
function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "assignment registration is machine only",
  });
}

// ChangeAssignmentPreset·ResumeAssignment·WithdrawAssignment은 사람만 옮긴다.
// agent는 lophn-agent/questions로 제안만 한다(domain model command 표).
function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "assignment changes are user only",
  });
}

// PauseAssignment는 사람과 machine 둘 다 내는 상태 전이다(R9, R10, R14).
function requireUserOrMachine(ctx: RequestContext): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  return kind === "user" || kind === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "pausing needs a user or machine",
  });
}

function definitionHash(definition: AssignmentDefinition): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

type RevisionDefinition = {
  definition: AssignmentDefinition;
  definition_hash: string;
};

function loadDefinition(
  tx: Tx,
  assignmentId: string,
  revision: number,
): RevisionDefinition | undefined {
  const row = tx.sql.get(
    `select definition, definition_hash from assignment_revisions
     where assignment_id = ? and revision = ?`,
    [assignmentId, revision],
  );
  if (row === undefined) return undefined;
  try {
    return {
      definition: JSON.parse(
        String(row["definition"]),
      ) as AssignmentDefinition,
      definition_hash: String(row["definition_hash"]),
    };
  } catch {
    return undefined;
  }
}

function loadRow(tx: Tx, id: string): AssignmentRow | undefined {
  const row = tx.sql.get(
    `select id, preset_id, preset_revision, role, scope_kind, scope_id, state,
       pause_reason_kind, pause_detail, pause_runs, pause_target, last_due_at,
       approval, revision
     from assignments where id = ?`,
    [id],
  );
  if (row === undefined) return undefined;
  // setReadBigInts(true)는 INTEGER 열을 bigint로 준다(platform/ledger#R9).
  // 화면 값은 number다.
  return {
    id: String(row["id"]),
    preset_id: String(row["preset_id"]),
    preset_revision: Number(row["preset_revision"]),
    role: String(row["role"]),
    scope_kind: String(row["scope_kind"]),
    scope_id: row["scope_id"] === null ? null : String(row["scope_id"]),
    state: String(row["state"]),
    pause_reason_kind: row["pause_reason_kind"] === null
      ? null
      : String(row["pause_reason_kind"]),
    pause_detail: row["pause_detail"] === null
      ? null
      : String(row["pause_detail"]),
    pause_runs: row["pause_runs"] === null ? null : String(row["pause_runs"]),
    pause_target: row["pause_target"] === null
      ? null
      : String(row["pause_target"]),
    last_due_at: row["last_due_at"] === null
      ? null
      : String(row["last_due_at"]),
    approval: row["approval"] === null ? null : String(row["approval"]),
    revision: Number(row["revision"]),
  };
}

function loadPresetKind(tx: Tx, preset: string): string | undefined {
  const row = tx.sql.get("select kind from presets where id = ?", [preset]);
  return row === undefined ? undefined : String(row["kind"]);
}

function presetBlobHash(
  tx: Tx,
  preset: string,
  revision: number,
): string | undefined {
  const row = tx.sql.get(
    "select definition_hash from preset_revisions where preset_id = ? and revision = ?",
    [preset, revision],
  );
  return row === undefined ? undefined : String(row["definition_hash"]);
}

function insertAssignment(
  tx: Tx,
  id: string,
  ctx: RequestContext,
  definition: AssignmentDefinition,
  role: string,
  approval: string | null,
): void {
  tx.sql.run(
    `insert into assignments (id, preset_id, preset_revision, role, scope_kind,
       scope_id, state, pause_reason_kind, pause_detail, pause_runs,
       pause_target, last_due_at, approval, revision)
     values (?, ?, ?, ?, ?, ?, 'enabled', null, null, null, null, null, ?, 1)`,
    [
      id,
      definition.preset,
      definition.preset_revision,
      role,
      definition.scope.kind,
      definition.scope.id,
      approval,
    ],
  );
  tx.sql.run(
    `insert into assignment_revisions (assignment_id, revision, definition,
       definition_hash, decided_by, reason, created_at)
     values (?, 1, ?, ?, ?, ?, ?)`,
    [
      id,
      JSON.stringify(definition),
      definitionHash(definition),
      ctx.principal,
      "assignment registration",
      tx.now(),
    ],
  );
}

export function createAssignmentCommands(): {
  createBuiltin: CommandDefinition<typeof createBuiltinAssignment>;
  createAppEngineer: CommandDefinition<typeof createAppEngineerAssignment>;
  applyOperator: CommandDefinition<typeof applyOperatorAssignment>;
  changePreset: CommandDefinition<typeof changeAssignmentPreset>;
  pause: CommandDefinition<typeof pauseAssignment>;
  resume: CommandDefinition<typeof resumeAssignment>;
  withdraw: CommandDefinition<typeof withdrawAssignment>;
} {
  return {
    createBuiltin: {
      route: createBuiltinAssignment,
      handle(tx, ctx, input: Input<typeof createBuiltinAssignment>) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const presetKind = loadPresetKind(tx, input.preset);
        if (presetKind === undefined) {
          return reject("not_found", "preset not found");
        }
        const blob = presetBlobHash(tx, input.preset, input.preset_revision);
        if (blob === undefined) {
          return reject("not_found", "preset revision is missing");
        }
        // 역할 kind가 참조한 preset kind와 같아야 한다(R17).
        if (presetKind !== input.role) {
          return reject("invalid_input", "preset kind does not match role");
        }
        const definition: AssignmentDefinition = {
          preset: input.preset,
          preset_revision: input.preset_revision,
          scope: input.scope,
          outputs: [],
          read_apps: [],
          read_commands: [],
          schedule: null,
        };
        const hash = definitionHash(definition);
        const existing = loadRow(tx, input.id);
        if (existing !== undefined) {
          // 같은 등록 처리의 재전송은 기존 결과다(domain model command 표).
          const same = existing.role === input.role &&
            existing.scope_kind === input.scope.kind &&
            existing.preset_id === input.preset;
          if (!same) {
            return reject("conflict", "assignment id already exists");
          }
          const revision = loadDefinition(tx, input.id, existing.revision);
          if (revision === undefined) {
            return reject("not_found", "assignment revision is missing");
          }
          return ok({ assignment: requireRecord(existing, revision) });
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
        const created = tx.emit(assignmentCreated, input.id, {
          revision: 1,
          definition_hash: hash,
          preset: input.preset,
          preset_revision: input.preset_revision,
          scope: input.scope,
          approval: null,
        });
        insertAssignment(tx, input.id, ctx, definition, input.role, null);
        void created;
        return ok({
          assignment: requireRecord(
            loadRow(tx, input.id)!,
            { definition, definition_hash: hash },
          ),
        });
      },
    },
    createAppEngineer: {
      route: createAppEngineerAssignment,
      handle(tx, ctx, input: Input<typeof createAppEngineerAssignment>) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const presetKind = loadPresetKind(tx, input.preset);
        if (presetKind === undefined) {
          return reject("not_found", "preset not found");
        }
        const blob = presetBlobHash(tx, input.preset, input.preset_revision);
        if (blob === undefined) {
          return reject("not_found", "preset revision is missing");
        }
        if (presetKind !== "app_engineer") {
          return reject("invalid_input", "preset kind is not app_engineer");
        }
        // emit은 그 event의 seq에서만 한다. AppCreated가 아직 없으면 not_found다.
        const created = tx.sql.get(
          "select cast(seq as text) as seq from events where seq = ? and type = 'AppCreated' and subject = ?",
          [BigInt(input.app_created_seq), input.app],
        );
        if (created === undefined) {
          return reject(
            "not_found",
            "the app creation event is missing",
          );
        }
        const definition: AssignmentDefinition = {
          preset: input.preset,
          preset_revision: input.preset_revision,
          scope: { kind: "app", id: input.app },
          outputs: [],
          read_apps: [],
          read_commands: [],
          schedule: null,
        };
        const hash = definitionHash(definition);
        const existing = loadRow(tx, input.id);
        if (existing !== undefined) {
          const same = existing.role === "app_engineer" &&
            existing.scope_id === input.app;
          if (!same) {
            return reject("conflict", "assignment id already exists");
          }
          const revision = loadDefinition(tx, input.id, existing.revision);
          if (revision === undefined) {
            return reject("not_found", "assignment revision is missing");
          }
          return ok({ assignment: requireRecord(existing, revision) });
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
        tx.emit(assignmentCreated, input.id, {
          revision: 1,
          definition_hash: hash,
          preset: input.preset,
          preset_revision: input.preset_revision,
          scope: definition.scope,
          approval: null,
        });
        insertAssignment(tx, input.id, ctx, definition, "app_engineer", null);
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
        return ok({
          assignment: requireRecord(
            loadRow(tx, input.id)!,
            { definition, definition_hash: hash },
          ),
        });
      },
    },
    applyOperator: {
      route: applyOperatorAssignment,
      handle(tx, ctx, input: Input<typeof applyOperatorAssignment>) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        // 승인 상태는 approval_requests의 현재 status로 본다. T23 결합 전까지
        // useApproval을 쓰지 않는다(남은 것).
        const approval = tx.sql.get(
          "select status from approval_requests where id = ?",
          [input.approval],
        );
        if (approval === undefined) {
          return reject("not_found", "approval request is missing");
        }
        if (String(approval["status"]) !== "granted") {
          return reject("forbidden", "approval is not granted");
        }
        const presetKind = loadPresetKind(tx, input.bundle.preset);
        if (presetKind === undefined) {
          return reject("not_found", "preset not found");
        }
        if (presetKind !== "operator") {
          return reject("invalid_input", "preset kind is not operator");
        }
        // 묶음의 Preset 판이 저장된 판 hash와 같아야 한다(R5).
        const blob = presetBlobHash(
          tx,
          input.bundle.preset,
          input.bundle.preset_revision,
        );
        if (blob === undefined) {
          return reject("not_found", "preset revision is missing");
        }
        if (blob !== input.bundle.preset_definition) {
          return reject(
            "conflict",
            "the reviewed preset revision changed",
          );
        }
        const definition = bundleDefinition(input.bundle);
        const hash = definitionHash(definition);
        const existing = loadRow(tx, input.id);
        const creating = existing === undefined;
        // 생성은 assignment가 없어야 하고 변경은 expected revision이다(R5).
        if (creating && input.bundle.assignment !== null) {
          return reject("not_found", "assignment not found");
        }
        if (
          !creating &&
          input.bundle.assignment !== input.id
        ) {
          return reject("invalid_input", "bundle targets another assignment");
        }
        if (
          !creating &&
          input.bundle.expected_assignment_revision !== existing!.revision
        ) {
          return reject("conflict", "assignment revision changed");
        }
        const createdAt = tx.now();
        // 새 주기는 적용 시각보다 미래에서 시작한다. 지난 회차를 다시 처리하지 않는다
        // (scheduling#R7).
        const before = creating
          ? undefined
          : loadDefinition(tx, input.id, existing!.revision);
        if (!creating && before === undefined) {
          return reject("not_found", "assignment revision is missing");
        }
        const scheduleChanged = before === undefined ||
          bundleScheduleChanged(before.definition, definition);
        if (
          scheduleChanged && definition.schedule !== null &&
          definition.schedule.first_at <= createdAt
        ) {
          return reject(
            "invalid_input",
            "a new schedule must start after the approval is applied",
          );
        }
        if (creating) {
          tx.emit(assignmentCreated, input.id, {
            revision: 1,
            definition_hash: hash,
            preset: input.bundle.preset,
            preset_revision: input.bundle.preset_revision,
            scope: definition.scope,
            approval: input.approval,
          });
        } else {
          tx.emit(assignmentChanged, input.id, {
            before: existing!.revision,
            after: existing!.revision + 1,
            before_hash: before!.definition_hash,
            after_hash: hash,
            preset: input.bundle.preset,
            preset_revision: input.bundle.preset_revision,
            approval: input.approval,
            schedule_changed: scheduleChanged,
          });
        }
        if (creating) {
          insertAssignment(
            tx,
            input.id,
            ctx,
            definition,
            "operator",
            input.approval,
          );
          // 남길 문서·읽기 선언 표 생성·변경은 같은 transaction이다(R5, R8).
          tx.sql.run(
            "delete from assignment_outputs where assignment_id = ?",
            [input.id],
          );
          for (const output of definition.outputs) {
            tx.sql.run(
              `insert into assignment_outputs (assignment_id, document_id,
                 content, owns_output) values (?, ?, ?, 1)`,
              [input.id, output.document, output.content],
            );
          }
          tx.sql.run(
            "delete from assignment_read_apps where assignment_id = ?",
            [input.id],
          );
          for (const app of definition.read_apps) {
            tx.sql.run(
              `insert into assignment_read_apps (assignment_id, app_id)
               values (?, ?)`,
              [input.id, app],
            );
          }
          tx.sql.run(
            "delete from assignment_read_commands where assignment_id = ?",
            [input.id],
          );
          for (const command of definition.read_commands) {
            tx.sql.run(
              `insert into assignment_read_commands (assignment_id, app_id,
                 command) values (?, ?, ?)`,
              [input.id, command.app, command.command],
            );
          }
        } else {
          // 생성·변경과 선언 표 갱신은 같은 transaction이다(domain model ledger 표).
          // 책임·상태만 바뀌면 처리한 예정 시점을 유지하고 주기를 바꿀 때만 새로
          // 계산한다. paused 상태는 이 적용으로 풀리지 않는다(scheduling#R7).
          tx.sql.run(
            `update assignments set preset_id = ?, preset_revision = ?,
               approval = ?, revision = ?,
               last_due_at = case when ? then null else last_due_at end
             where id = ?`,
            [
              definition.preset,
              definition.preset_revision,
              input.approval,
              existing!.revision + 1,
              scheduleChanged ? 1 : 0,
              input.id,
            ],
          );
          tx.sql.run(
            `insert into assignment_revisions (assignment_id, revision,
               definition, definition_hash, decided_by, reason, created_at)
             values (?, ?, ?, ?, ?, ?, ?)`,
            [
              input.id,
              existing!.revision + 1,
              JSON.stringify(definition),
              hash,
              ctx.principal,
              input.bundle.reason,
              createdAt,
            ],
          );
          tx.sql.run(
            "delete from assignment_outputs where assignment_id = ?",
            [input.id],
          );
          for (const output of definition.outputs) {
            tx.sql.run(
              `insert into assignment_outputs (assignment_id, document_id,
                 content, owns_output) values (?, ?, ?, 1)`,
              [input.id, output.document, output.content],
            );
          }
          tx.sql.run(
            "delete from assignment_read_apps where assignment_id = ?",
            [input.id],
          );
          for (const app of definition.read_apps) {
            tx.sql.run(
              `insert into assignment_read_apps (assignment_id, app_id)
               values (?, ?)`,
              [input.id, app],
            );
          }
          tx.sql.run(
            "delete from assignment_read_commands where assignment_id = ?",
            [input.id],
          );
          for (const command of definition.read_commands) {
            tx.sql.run(
              `insert into assignment_read_commands (assignment_id, app_id,
                 command) values (?, ?, ?)`,
              [input.id, command.app, command.command],
            );
          }
        }
        return ok({
          assignment: requireRecord(
            loadRow(tx, input.id)!,
            { definition, definition_hash: hash },
          ),
        });
      },
    },
    changePreset: {
      route: changeAssignmentPreset,
      handle(
        tx,
        ctx,
        input: Input<typeof changeAssignmentPreset>,
        compare,
      ) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = loadRow(tx, input.assignment);
        if (current === undefined) {
          return reject("not_found", "assignment not found");
        }
        if (current.role === "operator") {
          return reject(
            "forbidden",
            "operator assignment changes need a new approval",
          );
        }
        // CAS다. 이전 revision이 바뀌었으면 거절이고 이전 판 전체가 남는다(R12).
        if (current.revision !== compare.revision) {
          return reject("conflict", "assignment revision changed");
        }
        if (current.role !== compare.role) {
          return reject("conflict", "assignment role changed");
        }
        const presetKind = loadPresetKind(tx, input.preset);
        if (presetKind === undefined) {
          return reject("not_found", "preset not found");
        }
        const blob = presetBlobHash(tx, input.preset, input.preset_revision);
        if (blob === undefined) {
          return reject("not_found", "preset revision is missing");
        }
        // 같은 역할 kind의 preset 판만 고정한다(R17).
        if (presetKind !== current.role) {
          return reject(
            "invalid_input",
            "preset kind does not match the assignment role",
          );
        }
        const before = loadDefinition(
          tx,
          input.assignment,
          current.revision,
        );
        if (before === undefined) {
          return reject("not_found", "assignment revision is missing");
        }
        const definition: AssignmentDefinition = {
          ...before.definition,
          preset: input.preset,
          preset_revision: input.preset_revision,
        };
        const hash = definitionHash(definition);
        const createdAt = tx.now();
        tx.emit(assignmentChanged, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
          before_hash: before.definition_hash,
          after_hash: hash,
          preset: input.preset,
          preset_revision: input.preset_revision,
          approval: current.approval,
          schedule_changed: false,
        });
        tx.sql.run(
          `update assignments set preset_id = ?, preset_revision = ?,
             revision = ? where id = ?`,
          [
            input.preset,
            input.preset_revision,
            current.revision + 1,
            input.assignment,
          ],
        );
        tx.sql.run(
          `insert into assignment_revisions (assignment_id, revision,
             definition, definition_hash, decided_by, reason, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.assignment,
            current.revision + 1,
            JSON.stringify(definition),
            hash,
            ctx.principal,
            `changed preset to ${input.preset} rev ${input.preset_revision}`,
            createdAt,
          ],
        );
        return ok({
          assignment: requireRecord(
            loadRow(tx, input.assignment)!,
            { definition, definition_hash: hash },
          ),
        });
      },
    },
    pause: {
      route: pauseAssignment,
      handle(tx, ctx, input: Input<typeof pauseAssignment>, compare) {
        const actor = requireUserOrMachine(ctx);
        if (!actor.ok) return actor;
        const current = loadRow(tx, input.assignment);
        if (current === undefined) {
          return reject("not_found", "assignment not found");
        }
        // CAS다. state·revision이 같아야 pause를 진행한다(R9).
        if (current.revision !== compare.revision) {
          return reject("conflict", "assignment revision changed");
        }
        if (current.state !== compare.state) {
          return reject("conflict", "assignment state changed");
        }
        const kind = parseActor(ctx.actor)?.kind;
        // machine은 반복 실패·보관 근거만 내고 사람 근거는 거절이다(R10, R14).
        if (kind === "machine" && input.reason.kind === "user") {
          return reject(
            "forbidden",
            "machine pause needs repeated failures or an archived target",
          );
        }
        if (kind === "user" && input.reason.kind !== "user") {
          return reject(
            "forbidden",
            "user pause does not carry machine evidence",
          );
        }
        if (kind === "machine") {
          // machine pause는 근거를 다시 확인한다. 근거가 없으면 forbidden이다
          // (R10, R13, R14).
          const proved = proveEvidence(tx, current, input.reason);
          if (!proved.ok) return proved;
        }
        const before = loadDefinition(tx, input.assignment, current.revision);
        if (before === undefined) {
          return reject("not_found", "assignment revision is missing");
        }
        tx.emit(assignmentPaused, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
          reason: input.reason,
          definition_hash: before.definition_hash,
        });
        tx.sql.run(
          `update assignments set state = 'paused', pause_reason_kind = ?,
             pause_detail = ?, pause_runs = ?, pause_target = ?,
             revision = ? where id = ?`,
          [
            input.reason.kind,
            input.reason.detail,
            input.reason.runs.length === 0
              ? null
              : JSON.stringify(input.reason.runs),
            input.reason.target,
            current.revision + 1,
            input.assignment,
          ],
        );
        // 상태 변경도 revision 1 증가다(domain model 필드 표). 내용 판은 그대로
        // 새 판 row로 보존한다.
        tx.sql.run(
          `insert into assignment_revisions (assignment_id, revision,
             definition, definition_hash, decided_by, reason, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.assignment,
            current.revision + 1,
            JSON.stringify(before.definition),
            before.definition_hash,
            ctx.principal,
            `paused: ${input.reason.kind}`,
            tx.now(),
          ],
        );
        // AppArchived 반응이면 멈춤·event·cursor를 같은 transaction에 확정한다(R1).
        if (input.processed_through_seq !== undefined) {
          const advanced = tx.advanceSubscriberCursor(
            ASSIGNMENT_SUBSCRIBER,
            input.processed_through_seq,
          );
          if (!advanced.ok) return advanced;
        }
        return {
          ok: true,
          value: {
            assignment: requireRecord(
              loadRow(tx, input.assignment)!,
              before,
            ),
          },
        };
      },
    },
    resume: {
      route: resumeAssignment,
      handle(tx, ctx, input: Input<typeof resumeAssignment>, compare) {
        const person = requireUser(ctx);
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
        const before = loadDefinition(tx, input.assignment, current.revision);
        if (before === undefined) {
          return reject("not_found", "assignment revision is missing");
        }
        tx.emit(assignmentResumed, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
          definition_hash: before.definition_hash,
        });
        tx.sql.run(
          `update assignments set state = 'enabled', pause_reason_kind = null,
             pause_detail = null, pause_runs = null, pause_target = null,
             revision = ? where id = ?`,
          [current.revision + 1, input.assignment],
        );
        // 상태 변경도 revision 1 증가다(domain model 필드 표). 내용 판은 그대로
        // 새 판 row로 보존한다.
        tx.sql.run(
          `insert into assignment_revisions (assignment_id, revision,
             definition, definition_hash, decided_by, reason, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.assignment,
            current.revision + 1,
            JSON.stringify(before.definition),
            before.definition_hash,
            ctx.principal,
            "resumed",
            tx.now(),
          ],
        );
        return {
          ok: true,
          value: {
            assignment: requireRecord(
              loadRow(tx, input.assignment)!,
              before,
            ),
          },
        };
      },
    },
    withdraw: {
      route: withdrawAssignment,
      handle(tx, ctx, input: Input<typeof withdrawAssignment>, compare) {
        const person = requireUser(ctx);
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
        // lophn·CE 전체 범위 assignment는 회수할 수 없다(R9).
        if (isBuiltin(current.role)) {
          return reject(
            "forbidden",
            "a global builtin assignment cannot be withdrawn",
          );
        }
        const before = loadDefinition(tx, input.assignment, current.revision);
        if (before === undefined) {
          return reject("not_found", "assignment revision is missing");
        }
        tx.emit(assignmentWithdrawn, input.assignment, {
          before: current.revision,
          after: current.revision + 1,
          definition_hash: before.definition_hash,
        });
        tx.sql.run(
          `update assignments set state = 'withdrawn',
             pause_reason_kind = null, pause_detail = null,
             pause_runs = null, pause_target = null, revision = ?
           where id = ?`,
          [current.revision + 1, input.assignment],
        );
        // 상태 변경도 revision 1 증가다(domain model 필드 표). 내용 판은 그대로
        // 새 판 row로 보존한다.
        tx.sql.run(
          `insert into assignment_revisions (assignment_id, revision,
             definition, definition_hash, decided_by, reason, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.assignment,
            current.revision + 1,
            JSON.stringify(before.definition),
            before.definition_hash,
            ctx.principal,
            "withdrawn",
            tx.now(),
          ],
        );
        return {
          ok: true,
          value: {
            assignment: requireRecord(
              loadRow(tx, input.assignment)!,
              before,
            ),
          },
        };
      },
    },
  };
}

// bundle 정의에서 schedule이 바뀌었는지 본다.
function bundleScheduleChanged(
  before: AssignmentDefinition,
  after: AssignmentDefinition,
): boolean {
  if (before.schedule === null || after.schedule === null) {
    return before.schedule !== after.schedule;
  }
  return before.schedule.first_at !== after.schedule.first_at ||
    before.schedule.every_ms !== after.schedule.every_ms;
}

function requireRecord(row: AssignmentRow, revision: RevisionDefinition) {
  return recordOf(row, revision.definition);
}

// machine pause 근거 재확인. events SQL로 근거를 다시 본다.
function proveEvidence(
  tx: Tx,
  current: AssignmentRow,
  reason: Input<typeof pauseAssignment>["reason"],
): Result<void> {
  if (reason.kind === "consecutive_failures") {
    return proveConsecutiveFailures(tx, current, reason.runs);
  }
  if (reason.kind === "scope_archived") {
    const scopeTarget = current.scope_id;
    if (reason.target !== scopeTarget) {
      return reject(
        "forbidden",
        "scope pause target does not match the assignment scope",
      );
    }
    const archived = tx.sql.get(
      "select seq from events where subject = ? and type in ('AppArchived', 'ProjectArchived') order by seq desc limit 1",
      [reason.target],
    );
    if (archived === undefined) {
      return reject("forbidden", "the scope target is not archived");
    }
    return ok(undefined);
  }
  // output_archived다. 문서가 이 assignment의 남길 문서여야 한다.
  const owned = tx.sql.get(
    "select document_id from assignment_outputs where assignment_id = ? and document_id = ?",
    [current.id, reason.target],
  );
  if (owned === undefined) {
    return reject(
      "forbidden",
      "the archived document is not an assignment output",
    );
  }
  const archived = tx.sql.get(
    "select seq from events where subject = ? and type = 'DocumentArchived' order by seq desc limit 1",
    [reason.target],
  );
  if (archived === undefined) {
    return reject("forbidden", "the output document is not archived");
  }
  return ok(undefined);
}

// 마지막 resume(처음엔 created) 이후의 RunFinished를 종료 seq 순으로 읽어
// 시작한 최종 실패가 연속 3회인지 본다(R10, R11, Q17).
function proveConsecutiveFailures(
  tx: Tx,
  current: AssignmentRow,
  claimedRuns: readonly string[],
): Result<void> {
  const start = tx.sql.get(
    `select type, cast(seq as text) as seq from events where subject = ? and type in ('AssignmentResumed', 'AssignmentCreated') order by seq desc limit 1`,
    [current.id],
  );
  if (start === undefined) {
    return reject("forbidden", "assignment is not started");
  }
  const afterSeq = BigInt(String(start["seq"]));
  const rows = tx.sql.all(
    `select subject, payload, cast(seq as text) as seq from events
     where type = 'RunFinished' and seq > ? order by seq`,
    [afterSeq],
  );
  const ended: {
    run: string;
    started: boolean;
    outcome: { kind: string; reason: string };
  }[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(String(row["payload"])) as {
        assignment?: unknown;
        started?: unknown;
        outcome?: { kind?: unknown; reason?: unknown };
      };
      if (payload.assignment !== current.id) continue;
      ended.push({
        run: String(row["subject"]),
        started: payload.started === true,
        outcome: {
          kind: String(payload.outcome?.kind ?? ""),
          reason: String(payload.outcome?.reason ?? ""),
        },
      });
    } catch {
      continue;
    }
  }
  const bundle = newFailureBundle(ended);
  if (bundle === null) {
    return reject(
      "forbidden",
      "the last three runs are not started final failures",
    );
  }
  // 근거로 신고한 run 3개가 실제 묶음과 같아야 한다(R10).
  if (
    claimedRuns.length !== 3 ||
    bundle.some((run) => !claimedRuns.includes(run))
  ) {
    return reject("forbidden", "claimed failure evidence does not match");
  }
  return ok(undefined);
}
