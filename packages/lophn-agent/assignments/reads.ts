import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type Assignment,
  assignmentList,
  assignmentOutputs,
  assignmentRead,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  SqlParams,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  type AssignmentDefinition,
  type AssignmentRow,
  recordOf,
} from "./model.ts";

// assignment read는 읽힌 자체를 화면 값으로 준다. 현재 run 상태·진행은
// lophn-agent/harness/run-loop의 run read다(R3). withdrawn도 과거 기록을
// 그대로 돌려주고(R9, R16) outputs read도 withdrawn 연산자를 포함한다(R8).
// 과거 revision은 assignment_revisions blob으로 본다(R12).

const PAGE = 50;

type Lookup = {
  sql: {
    get: (query: string, params: SqlParams) => SqlRow | undefined;
  };
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "assignment not found" });
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid assignment cursor" });
}

function rowOf(record: SqlRow): AssignmentRow {
  return {
    id: String(record["id"]),
    preset_id: String(record["preset_id"]),
    preset_revision: Number(record["preset_revision"]),
    role: String(record["role"]),
    scope_kind: String(record["scope_kind"]),
    scope_id: record["scope_id"] === null ? null : String(record["scope_id"]),
    state: String(record["state"]),
    pause_reason_kind: record["pause_reason_kind"] === null
      ? null
      : String(record["pause_reason_kind"]),
    pause_detail: record["pause_detail"] === null
      ? null
      : String(record["pause_detail"]),
    pause_runs: record["pause_runs"] === null
      ? null
      : String(record["pause_runs"]),
    pause_target: record["pause_target"] === null
      ? null
      : String(record["pause_target"]),
    last_due_at: record["last_due_at"] === null
      ? null
      : String(record["last_due_at"]),
    approval: record["approval"] === null ? null : String(record["approval"]),
    revision: Number(record["revision"]),
  };
}

function rowColumns(table: string): string {
  return [
    `${table}.id`,
    `${table}.preset_id`,
    `${table}.preset_revision`,
    `${table}.role`,
    `${table}.scope_kind`,
    `${table}.scope_id`,
    `${table}.state`,
    `${table}.pause_reason_kind`,
    `${table}.pause_detail`,
    `${table}.pause_runs`,
    `${table}.pause_target`,
    `${table}.last_due_at`,
    `${table}.approval`,
    `${table}.revision`,
  ].join(", ");
}

function loadDefinition(
  lookup: Lookup,
  assignmentId: string,
  revision: number,
): AssignmentDefinition | undefined {
  const blob = lookup.sql.get(
    `select definition from assignment_revisions
     where assignment_id = ? and revision = ?`,
    [assignmentId, revision],
  );
  if (blob === undefined) return undefined;
  try {
    return JSON.parse(String(blob["definition"])) as AssignmentDefinition;
  } catch {
    return undefined;
  }
}

function currentRow(
  lookup: Lookup,
  assignmentId: string,
): AssignmentRow | undefined {
  const row = lookup.sql.get(
    `select ${rowColumns("assignments")} from assignments where id = ?`,
    [assignmentId],
  );
  return row === undefined ? undefined : rowOf(row);
}

function screenOf(
  lookup: Lookup,
  row: AssignmentRow,
  revision: number,
): Result<Assignment> {
  const definition = loadDefinition(lookup, row.id, revision);
  if (definition === undefined) {
    return err({ code: "internal", message: "assignment blob을 읽지 못했다" });
  }
  return ok(recordOf(row, definition));
}

function cursorAfter(cursor: string | undefined): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_id?: unknown };
    if (typeof parsed["after_id"] !== "string") return invalidCursor();
    return ok(parsed["after_id"]);
  } catch {
    return invalidCursor();
  }
}

function cursorOf(afterId: string): string {
  const bytes = new TextEncoder().encode(canonicalize({ after_id: afterId }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function createAssignmentReads(): {
  read: ReadDefinition<typeof assignmentRead>;
  list: ReadDefinition<typeof assignmentList>;
  outputs: ReadDefinition<typeof assignmentOutputs>;
} {
  return {
    read: {
      route: assignmentRead,
      handle(snapshot, _ctx, input) {
        // 현재 판 또는 지정 revision이다. 과거 revision blob은 immutable이다(R12).
        const row = currentRow(snapshot, input.assignment);
        if (row === undefined) return notFound();
        if (input.revision !== undefined && input.revision > row.revision) {
          return notFound();
        }
        const record = screenOf(snapshot, row, input.revision ?? row.revision);
        if (!record.ok) return record;
        return ok({
          assignment: record.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: assignmentList,
      handle(snapshot, _ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        // 현재 판만 낸다. 과거 revision은 assignment read로 본다(R12).
        const rows = input.role === undefined && input.state === undefined
          ? snapshot.sql.all(
            `select ${rowColumns("assignments")} from assignments
             where id > ? order by id limit ?`,
            [after.value ?? "", PAGE + 1],
          )
          : input.state === undefined
          ? snapshot.sql.all(
            `select ${rowColumns("assignments")} from assignments
             where role = ? and id > ? order by id limit ?`,
            [input.role as string, after.value ?? "", PAGE + 1],
          )
          : input.role === undefined
          ? snapshot.sql.all(
            `select ${rowColumns("assignments")} from assignments
             where state = ? and id > ? order by id limit ?`,
            [input.state as string, after.value ?? "", PAGE + 1],
          )
          : snapshot.sql.all(
            `select ${rowColumns("assignments")} from assignments
             where role = ? and state = ? and id > ? order by id limit ?`,
            [
              input.role as string,
              input.state as string,
              after.value ?? "",
              PAGE + 1,
            ],
          );
        const page = rows.slice(0, PAGE);
        const assignments: Assignment[] = [];
        for (const record of page) {
          const row = rowOf(record);
          const definition = loadDefinition(snapshot, row.id, row.revision);
          if (definition === undefined) continue;
          assignments.push(recordOf(row, definition));
        }
        const next = rows.length > PAGE && page.length > 0
          ? cursorOf(String(page[page.length - 1]!["id"]))
          : null;
        return ok({
          assignments,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next,
        });
      },
    },
    outputs: {
      route: assignmentOutputs,
      handle(snapshot, _ctx, input) {
        // 그 문서를 남길 문서로 선언한 Operator다. withdrawn도 그대로 돌려준다(R8).
        const found = snapshot.sql.get(
          `select ${rowColumns("a")} from assignments a
           join assignment_outputs o on o.assignment_id = a.id
           where o.document_id = ? and o.owns_output = 1
           order by a.id limit 1`,
          [input.document],
        );
        if (found === undefined) {
          return ok({
            output: null,
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        }
        const owner = rowOf(found);
        const definition = loadDefinition(snapshot, owner.id, owner.revision);
        if (definition === undefined) {
          return err({
            code: "internal",
            message: "assignment blob을 읽지 못했다",
          });
        }
        // 남길 문서가 지금도 선언에 있는지 본다. 과거 blob의 선언은 지웠다.
        const still = definition.outputs.some((output) =>
          output.document === input.document
        );
        return ok({
          output: still
            ? {
              assignment: owner.id,
              revision: owner.revision,
              state: owner.state as "enabled" | "paused" | "withdrawn",
            }
            : null,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
