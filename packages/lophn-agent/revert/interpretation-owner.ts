import { err, ok } from "../../base/mod.ts";
import {
  linkProblemInterpretation,
  problemInterpretationLinked,
} from "../../contracts/problems/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import {
  type GroupDraft,
  type RevertOwner,
  type RunEvent,
  sortSeqs,
  targetOf,
} from "./model.ts";

// 문제 해석 참조의 복원 판정(problems/grouping). 이 leaf는 문제 표를 읽지 않는다. 해석은
// 문서 근거로 남기고 machine 상태와 분리된다(roles/app-engineer#R15): 복원은 예전 해석
// 참조를 가리키는 LinkProblemInterpretation command(tx.call과 같은 Tx)의 새 변경이다.
// 최종 안전 검사(문제 seq CAS, 이전 참조 일치, 담당 App Engineer)는 그 command가 다시 한다.
//
// event의 참조는 payload.previous·current에 남는다. run이 만든 첫 연결의 previous는 run
// 이전 참조이고, 마지막 연결의 current는 run 이후 참조다. 복원은 현재 참조(run 이후)를
// previous로 싣고 run 이전 참조를 다시 연결하므로 문제가 그 사이 바뀌지 않았을 때만
// 통과한다.

export const INTERPRETATION_REVERT_OWNER = "problems/grouping";

const OWNED = problemInterpretationLinked.type;

type Link = { version: string; section: string | null };

// 참조다. 없는 참조(undefined)와 빈 참조(null)를 구별한다: 첫 연결의 previous는 없었던
// 참조(null)를 가리키고, payload의 키 자체가 없는 것은 깨진 event다.
function linkOf(value: unknown): Link | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const link = value as Record<string, unknown>;
  if (typeof link["version"] !== "string") return undefined;
  return {
    version: link["version"],
    section: typeof link["section"] === "string" ? link["section"] : null,
  };
}

const draft = (
  target: string | null,
  seqs: readonly string[],
  capability: GroupDraft["capability"],
  reason: GroupDraft["reason"],
  comparison: JsonObject | null,
  beforeRef: JsonObject | null,
): GroupDraft => ({
  owner: INTERPRETATION_REVERT_OWNER,
  target,
  source_seqs: sortSeqs(seqs),
  capability,
  reason,
  comparison,
  before_ref: beforeRef,
  dependencies: [],
});

// 하나의 해석 변경 묶음이다. run이 아닌 변경이 끼었으면 값이 같아도 충돌이고(counting은
// engine이 분류한다), 사람이 직접 바꾼 문제 표 변경은 복원 대상이 아니다(documents-owner와
// 같은 규칙).
function classifyProblem(
  problem: string,
  own: readonly RunEvent[],
): GroupDraft[] {
  const seqs = own.map((event) => event.seq);
  // 해석 연결은 담당 App Engineer assignment 자격이라 agent actor뿐이다. 사람의 직접 문제
  // 표 변경(run의 event가 아닌 actor)은 복원 대상이 아니다.
  if (!own.every((event) => event.actor.startsWith("agent:"))) {
    return [
      draft(problem, seqs, "irreversible", "not_agent_output", null, null),
    ];
  }
  const first = own[0].payload as { previous?: unknown } | null;
  const last = own[own.length - 1].payload as { current?: unknown } | null;
  // first.previous는 없었던 참조(null)일 수 있다(처음 연결이다). undefined는 깨진 event다.
  const runBefore = first === null ? undefined : linkOf(first.previous);
  const runAfter = last === null ? undefined : linkOf(last.current);
  if (runBefore === undefined || runAfter === undefined) {
    return [
      draft(problem, seqs, "irreversible", "unclassified_event", null, null),
    ];
  }
  return [
    draft(
      problem,
      seqs,
      "reversible",
      null,
      {
        kind: "interpretation",
        problem,
        // 마지막 연결의 current가 run 이후 참조다. 복원은 이 참조를 previous로 싣는다.
        previous: runAfter,
        interpretation: runBefore,
      },
      { kind: "interpretation_reference", problem },
    ),
  ];
}

export function createInterpretationOwner(): RevertOwner {
  return {
    concern: INTERPRETATION_REVERT_OWNER,
    claims: (type) => type === OWNED,
    classify({ events }) {
      const bySubject = new Map<string, RunEvent[]>();
      for (const event of events) {
        const subject = event.subject ?? "";
        const list = bySubject.get(subject) ?? [];
        list.push(event);
        bySubject.set(subject, list);
      }
      const drafts: GroupDraft[] = [];
      for (const [subject, own] of bySubject) {
        const problem = targetOf(subject);
        if (problem === null) {
          drafts.push(
            draft(
              null,
              own.map((event) => event.seq),
              "irreversible",
              "unclassified_event",
              null,
              null,
            ),
          );
          continue;
        }
        drafts.push(...classifyProblem(problem, own));
      }
      return drafts;
    },
    restore(tx, group) {
      const problem = group.target;
      const comparison = group.comparison;
      if (comparison === null || problem === null) {
        return err({
          code: "invalid_input",
          message: "this group has nothing to restore",
        });
      }
      // 문제의 현재 seq는 문제 표에 별도 counter가 없어 subject event에서 읽는다
      // (problems/grouping과 같은 규칙). compare는 {problem_seq, previous}다.
      const row = tx.sql.get(
        `select cast(max(seq) as text) as seq from events where subject = ?`,
        [problem],
      );
      const problemSeq = row === undefined || row["seq"] === null
        ? "0"
        : String(row["seq"]);
      const done = tx.call(
        linkProblemInterpretation as never,
        {
          problem,
          interpretation: comparison["interpretation"] ?? null,
        } as never,
        {
          problem_seq: problemSeq,
          previous: comparison["previous"] ?? null,
        } as never,
      );
      if (!done.ok) return err(done.error);
      return ok(undefined);
    },
  };
}
