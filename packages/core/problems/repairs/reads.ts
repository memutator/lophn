import { err, ok, type Result } from "../../../base/mod.ts";
import type { z } from "zod";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  fixRecordSchema,
  listProblemFixes,
} from "../../../protocol/problems/mod.ts";
import {
  NOT_FOUND,
  parseSeqCursor,
  requireOperation,
  scanVisible,
  targetVisible,
} from "../reporting/mod.ts";

const FIX_PAGE = 100;

type FixRowSeq = { seq: bigint; row: Record<string, unknown> };

// 고친 기록은 event seq가 identity다. 과거 null 출처도 그 당시 payload 그대로
// 읽는다. 정렬은 기록 event seq 내림차순이고 cursor는 마지막 seq다.
export const listProblemFixesRead: ReadDefinition<typeof listProblemFixes> = {
  route: listProblemFixes,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof listProblemFixes>,
  ): Result<Output<typeof listProblemFixes>> {
    const granted = requireOperation(ctx, listProblemFixes.name);
    if (!granted.ok) return granted;
    const cursor = parseSeqCursor(input.cursor);
    if (!cursor.ok) return cursor;
    // 없는 문제와 범위 밖 문제는 같은 답이다.
    const row = snapshot.sql.get(
      `select app from problems where id = ?`,
      [input.problem],
    );
    const visible = row === undefined ? ok(false) : targetVisible(
      snapshot,
      ctx,
      listProblemFixes.name,
      { app: String(row["app"]), problem: input.problem },
    );
    if (!visible.ok) return visible;
    if (row === undefined || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const page = scanVisible<FixRowSeq>({
      limit: FIX_PAGE,
      before: cursor.value,
      load: (before, size) => {
        const clauses = before === null
          ? ["type = ?", "subject = ?"]
          : ["type = ?", "subject = ?", "seq < ?"];
        const params: (string | number | bigint)[] = before === null
          ? ["ProblemFixRecorded", input.problem]
          : ["ProblemFixRecorded", input.problem, before];
        params.push(size);
        return snapshot.sql.all(
          `select seq, payload from events where ${
            clauses.join(" and ")
          } order by seq desc limit ?`,
          params,
        ).map((row) => ({ seq: BigInt(String(row["seq"])), row }));
      },
      visible: () => ok(true),
    });
    if (!page.ok) return page;
    const fixes: { seq: string; fix: z.infer<typeof fixRecordSchema> }[] = [];
    for (const { seq, row } of page.value.rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(row["payload"]));
      } catch {
        return err({ code: "internal", message: "기록을 읽을 수 없다" });
      }
      const fix = fixRecordSchema.safeParse(parsed);
      if (!fix.success) {
        return err({ code: "internal", message: "기록을 읽을 수 없다" });
      }
      fixes.push({ seq: seq.toString(10), fix: fix.data });
    }
    return ok({
      fixes,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: page.value.next,
    });
  },
};
