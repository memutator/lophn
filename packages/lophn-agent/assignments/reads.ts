import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  assignmentList,
  assignmentRead,
} from "../../contracts/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../contracts/platform/mod.ts";
import { ASSIGNMENT_COLUMNS, recordOf, rowOf } from "./model.ts";

// assignment read는 읽힌 자체를 화면 값으로 준다. 현재 run 상태·진행은
// lophn-agent/harness/run-loop의 run read다(R3). withdrawn도 과거 기록을
// 그대로 돌려준다(R9, R16).

const PAGE = 50;

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid assignment cursor" });
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
} {
  return {
    read: {
      route: assignmentRead,
      handle(snapshot, _ctx, input) {
        const row = snapshot.sql.get(
          `select ${ASSIGNMENT_COLUMNS} from assignments where id = ?`,
          [input.assignment],
        );
        if (row === undefined) {
          return err({ code: "not_found", message: "assignment not found" });
        }
        return ok({
          assignment: recordOf(rowOf(row)),
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
        const filters = ["id > ?"];
        const params: (string | number)[] = [after.value ?? ""];
        if (input.role !== undefined) {
          filters.push("role = ?");
          params.push(input.role);
        }
        if (input.state !== undefined) {
          filters.push("state = ?");
          params.push(input.state);
        }
        const rows = snapshot.sql.all(
          `select ${ASSIGNMENT_COLUMNS} from assignments
           where ${filters.join(" and ")} order by id limit ?`,
          [...params, PAGE + 1],
        );
        const page = rows.slice(0, PAGE);
        const next = rows.length > PAGE && page.length > 0
          ? cursorOf(String(page[page.length - 1]!["id"]))
          : null;
        return ok({
          assignments: page.map((row) => recordOf(rowOf(row))),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next,
        });
      },
    },
  };
}
