import { err, ok, type Result } from "../../base/mod.ts";
import { questionList, questionRead } from "../../contracts/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  appliedOf,
  loadQuestion,
  loadRunRef,
  QUESTION_COLUMNS,
  questionRowOf,
  recordOf,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. user·machine·coding_agent는
// 모든 질문을 보고 agent는 자기 assignment의 run 질문만 본다. 그 밖(다른
// assignment의 agent, app)은 없는 질문과 똑같이 답한다. 닫힌 질문도 저장된 본문·
// 답·닫은 이유를 그대로 읽고, 답 접수와 적용은 applied로 구별한다(R10).

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "question not found" });
}

// null은 제한 없음, 문자열은 그 assignment만, undefined는 아무것도 보지 못함.
function visibleAssignment(
  ctx: RequestContext,
): string | null | undefined {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return undefined;
  if (
    actor.kind === "user" || actor.kind === "machine" ||
    actor.kind === "coding_agent"
  ) return null;
  if (actor.kind === "agent") return actor.id;
  return undefined;
}

function cursorAfter(cursor: string | undefined): Result<bigint | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after?: unknown };
    if (
      typeof parsed.after !== "string" || !/^[1-9][0-9]*$/.test(parsed.after)
    ) {
      throw new TypeError("cursor");
    }
    return ok(BigInt(parsed.after));
  } catch {
    return err({ code: "invalid_input", message: "invalid cursor" });
  }
}

function cursorOf(after: string): string {
  return btoa(JSON.stringify({ after }));
}

export function createQuestionReads(): {
  read: ReadDefinition<typeof questionRead>;
  list: ReadDefinition<typeof questionList>;
} {
  return {
    read: {
      route: questionRead,
      handle(snapshot, ctx, input) {
        const scope = visibleAssignment(ctx);
        if (scope === undefined) return notFound();
        const row = loadQuestion(snapshot, input.question);
        if (row === undefined) return notFound();
        if (scope !== null) {
          const run = loadRunRef(snapshot, row.run);
          if (run === undefined || run.assignment !== scope) return notFound();
        }
        return ok({
          question: recordOf(row, appliedOf(snapshot, row)),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: questionList,
      handle(snapshot, ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const scope = visibleAssignment(ctx);
        const empty = ok({
          questions: [],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
        if (scope === undefined) return empty;
        if (
          scope !== null && input.assignment !== undefined &&
          input.assignment !== scope
        ) return empty;
        const clauses = ["q.created_seq > ?"];
        const params: (string | bigint)[] = [after.value ?? 0n];
        const assignment = scope ?? input.assignment;
        if (assignment !== undefined && assignment !== null) {
          clauses.push("r.assignment = ?");
          params.push(assignment);
        }
        if (input.run !== undefined) {
          clauses.push("q.run = ?");
          params.push(input.run);
        }
        if (input.status !== undefined) {
          clauses.push("q.status = ?");
          params.push(input.status);
        }
        const columns = QUESTION_COLUMNS.split(",").map((column) =>
          `q.${column.trim()}`
        ).join(", ");
        const rows = snapshot.sql.all(
          `select ${columns} from questions q
           join runs r on r.id = q.run
           where ${clauses.join(" and ")} order by q.created_seq limit ?`,
          [...params, PAGE + 1],
        ).map(questionRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          questions: page.map((row) => recordOf(row, appliedOf(snapshot, row))),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(last.created_seq)
            : null,
        });
      },
    },
  };
}
