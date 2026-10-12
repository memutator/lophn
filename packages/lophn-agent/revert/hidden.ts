import { err, ok, type Result } from "../../base/mod.ts";
import type { Sql } from "../../protocol/platform/mod.ts";

// 숨김 구간과 접힘 구간(lophn-agent/revert "Revert 불변 조건", conversation#R25). Message는 바꾸지 않고
// reverts 행에서 읽는다.
//
// 숨김 구간은 rewind가 적용된 순간 있던 메시지, 곧 boundary_seq부터 그 결과 event(result_seq)까지다. 그
// 뒤에 새로 접수한 메시지는 숨기지 않는다. 숨김이 끝이 없으면 rewind 뒤의 대화가 모두 사라진다.

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// reverts 행에서 숨김·접힘을 읽는 데 쓰는 칸이다. rewind/list의 항목도 이 모양이라 읽는 쪽(runtime)이 같은
// 순수 함수를 쓴다.
export type RevertRow = {
  id: string;
  kind: "rewind" | "undo";
  choice: "restore_all" | "messages_only" | "summarize" | null;
  outcome: "applying" | "applied" | "partial" | "uncertain" | "blocked";
  redo: "none" | "available" | "done" | "closed";
  boundary_seq: string | null;
  result_seq: string | null;
  summary_call: string | null;
};

export type HiddenRange = { from_seq: string; through_seq: string };

// choice가 restore_all·messages_only이고 outcome이 applied·partial·uncertain인 rewind만 숨긴다. redo=done이면
// 다시 보여 숨김이 아니다. blocked·summarize·undo는 숨기지 않는다.
function hides(row: RevertRow): boolean {
  return row.kind === "rewind" &&
    (row.choice === "restore_all" || row.choice === "messages_only") &&
    (row.outcome === "applied" || row.outcome === "partial" ||
      row.outcome === "uncertain") &&
    row.redo !== "done" && row.boundary_seq !== null &&
    row.result_seq !== null;
}

// 겹치거나 이어진 숨김 구간은 하나로 합친다(가장 앞선 boundary_seq가 시작이다). 오래된 쪽부터다.
export function hiddenRangesOf(rows: readonly RevertRow[]): HiddenRange[] {
  const ranges = rows.filter(hides)
    .map((row) => ({
      from: Number(row.boundary_seq),
      through: Number(row.result_seq),
    }))
    .sort((left, right) => left.from - right.from);
  const merged: { from: number; through: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.from <= last.through + 1) {
      last.through = Math.max(last.through, range.through);
    } else merged.push({ ...range });
  }
  return merged.map((range) => ({
    from_seq: String(range.from),
    through_seq: String(range.through),
  }));
}

export function inHiddenRange(
  ranges: readonly HiddenRange[],
  seq: string,
): boolean {
  const at = Number(seq);
  return ranges.some((range) =>
    at >= Number(range.from_seq) && at <= Number(range.through_seq)
  );
}

export type FoldedRange = {
  revert: string;
  from_seq: string;
  // 접은 마지막 메시지의 seq. 요약을 접수한 시점의 결과 seq(result_seq)까지다.
  through_seq: string;
  summary_call: string;
};

// choice=summarize이고 applied인 rewind의 접힘 구간이다. 오래된 순서다. 접힌 구간 안의 메시지로 나중에 rewind해
// 숨김이 그 구간을 가르면, 요약이 숨긴 내용을 품고 있으므로 그 접힘은 쓰지 않는다(숨긴 내용이 입력에 새지
// 않게 한다). 숨김이 풀리면(redo) 접힘이 다시 선다.
export function foldsOf(rows: readonly RevertRow[]): FoldedRange[] {
  const hiding = rows.filter(hides);
  return rows
    .filter((row) =>
      row.kind === "rewind" && row.choice === "summarize" &&
      row.outcome === "applied" && row.boundary_seq !== null &&
      row.result_seq !== null && row.summary_call !== null
    )
    .filter((fold) =>
      !hiding.some((hidden) =>
        Number(hidden.result_seq) > Number(fold.result_seq) &&
        Number(hidden.boundary_seq) > Number(fold.boundary_seq) &&
        Number(hidden.boundary_seq) <= Number(fold.result_seq)
      )
    )
    .sort((left, right) => Number(left.result_seq) - Number(right.result_seq))
    .map((fold) => ({
      revert: fold.id,
      from_seq: fold.boundary_seq!,
      through_seq: fold.result_seq!,
      summary_call: fold.summary_call!,
    }));
}

function rowsOf(lookup: Lookup, session: string): RevertRow[] {
  const text = (value: unknown) => value === null ? null : String(value);
  return lookup.sql.all(
    `select id, kind, choice, outcome, redo, cast(boundary_seq as text) as boundary_seq,
            cast(result_seq as text) as result_seq, summary_call
       from reverts where session = ? order by rowid`,
    [session],
  ).map((row) => ({
    id: String(row["id"]),
    kind: String(row["kind"]) as RevertRow["kind"],
    choice: text(row["choice"]) as RevertRow["choice"],
    outcome: String(row["outcome"]) as RevertRow["outcome"],
    redo: String(row["redo"]) as RevertRow["redo"],
    boundary_seq: text(row["boundary_seq"]),
    result_seq: text(row["result_seq"]),
    summary_call: text(row["summary_call"]),
  }));
}

export function hiddenRanges(lookup: Lookup, session: string): HiddenRange[] {
  return hiddenRangesOf(rowsOf(lookup, session));
}

// 숨김 시작은 가장 앞선 boundary_seq다. 숨긴 구간이 없으면 null이다.
export function hiddenFromSeq(lookup: Lookup, session: string): string | null {
  return hiddenRanges(lookup, session)[0]?.from_seq ?? null;
}

export function foldedRanges(lookup: Lookup, session: string): FoldedRange[] {
  return foldsOf(rowsOf(lookup, session));
}

// 이미 숨긴 구간 안의 메시지는 checkpoint로 고를 수 없다. 숨김 구간(시작 seq 포함) 안의 메시지면
// invalid_input이다. 숨긴 구간 뒤에 접수한 메시지는 고를 수 있다.
export function assertCheckpointVisible(
  lookup: Lookup,
  session: string,
  message: string,
): Result<void> {
  const ranges = hiddenRanges(lookup, session);
  if (ranges.length === 0) return ok(undefined);
  const found = lookup.sql.get(
    "select cast(created_seq as text) as seq from messages where id = ? and session = ?",
    [message, session],
  );
  return found !== undefined && inHiddenRange(ranges, String(found["seq"]))
    ? err({
      code: "invalid_input",
      message: "this message is already in the hidden range",
    })
    : ok(undefined);
}
