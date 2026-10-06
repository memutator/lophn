import { err, ok } from "../../base/mod.ts";
import {
  TERM_EVENTS,
  termArchive,
  termArchived,
  termProposed,
  termUnarchive,
  termUnarchived,
  termUpdate,
  termUpdated,
} from "../../contracts/documents/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import {
  applySteps,
  bySubject,
  callOf,
  currentRevision,
  draftOf,
  hasForeignChange,
  type Step,
} from "./chain.ts";
import {
  type GroupDraft,
  type RevertOwner,
  type RunEvent,
  subjectEvents,
  targetOf,
} from "./model.ts";

// term 변경의 복원 판정(documents/terms, documents/terms#R6). Context Engineer agent가 만든 후보의 변경만
// 되돌린다: 후보 제안은 보관하고(근거를 지우지 않는다), 이름·근거 수정은 event가 남긴 이전 값으로, 보관·
// 해제는 반대로 되돌린다. 사람이 정의한 것(`TermDefined`)과 정의의 수정은 대상이 아니다. 복원은 documents가
// dispatchable로 선언한 `term.update`·`archive`·`unarchive`를 같은 Tx에서 부르고 revision CAS와 범위
// 검사는 그 command가 다시 한다.

export const TERM_REVERT_OWNER = "documents/terms";

const OWN_TYPES = new Set<string>(TERM_EVENTS.map((event) => event.type));

const draft = (
  target: string | null,
  seqs: readonly string[],
  capability: GroupDraft["capability"],
  reason: GroupDraft["reason"],
  comparison: JsonObject | null,
  beforeRef: JsonObject | null,
) =>
  draftOf(
    TERM_REVERT_OWNER,
    target,
    seqs,
    capability,
    reason,
    comparison,
    beforeRef,
  );

// event를 거꾸로 되돌리는 호출의 열이다. 풀 수 없는 event(정의 변경, 근거 blob 참조)가 있으면 null이다.
function stepsOf(own: readonly RunEvent[]): Step[] | null {
  const steps: Step[] = [];
  for (const event of [...own].reverse()) {
    if (event.type === termUpdated.type) {
      const parsed = termUpdated.payload.safeParse(event.payload);
      if (!parsed.success) return null;
      const { before } = parsed.data;
      // 정의는 agent가 바꾸지 못한다. 정의가 낀 변경은 이 owner가 되돌리지 않는다. 근거가 blob 참조로만
      // 남은 변경은 이전 값을 복원할 수 없다.
      if (before.definition !== undefined) return null;
      if (before.evidence !== undefined && !Array.isArray(before.evidence)) {
        return null;
      }
      steps.push({ op: "update", ...before } as Step);
    } else if (event.type === termArchived.type) {
      steps.push({ op: "unarchive" });
    } else if (event.type === termUnarchived.type) {
      steps.push({ op: "archive" });
    } else {
      return null;
    }
  }
  return steps;
}

function endsActive(own: readonly RunEvent[]): boolean {
  let active = true;
  for (const event of own) {
    if (event.type === termArchived.type) active = false;
    if (event.type === termUnarchived.type) active = true;
  }
  return active;
}

function classifyTerm(
  term: string,
  own: readonly RunEvent[],
  all: readonly RunEvent[],
): GroupDraft[] {
  const seqs = own.map((event) => event.seq);
  const revision = currentRevision(all, OWN_TYPES);
  if (hasForeignChange(own, all, OWN_TYPES)) {
    return [
      draft(term, seqs, "conflict", "later_change", {
        kind: "term",
        term,
        base_revision: revision,
      }, null),
    ];
  }
  // 사람 정의와 사람·machine의 변경은 되돌리지 않는다.
  if (!own.every((event) => event.actor.startsWith("agent:"))) {
    return [draft(term, seqs, "irreversible", "not_agent_output", null, null)];
  }
  const proposed = own[0].type === termProposed.type;
  const rest = proposed ? own.slice(1) : own;
  const steps = proposed
    ? rest.every((event) =>
        event.type === termArchived.type || event.type === termUnarchived.type
      )
      ? (endsActive(rest) ? [{ op: "archive" } as Step] : [])
      : null
    : stepsOf(own);
  if (steps === null) {
    return [
      draft(term, seqs, "irreversible", "unclassified_event", null, null),
    ];
  }
  const first = own[0].payload as { before_revision?: unknown } | undefined;
  return [
    draft(
      term,
      seqs,
      "reversible",
      null,
      {
        kind: "term",
        term,
        base_revision: revision,
        steps,
      },
      proposed ? { kind: "proposed_term", term } : {
        kind: "term_state",
        term,
        revision: String(first?.before_revision ?? ""),
      },
    ),
  ];
}

export function createTermOwner(): RevertOwner {
  return {
    concern: TERM_REVERT_OWNER,
    claims: (type) => OWN_TYPES.has(type),
    classify({ events, lookup }) {
      const drafts: GroupDraft[] = [];
      for (const { subject, own } of bySubject(events)) {
        const term = targetOf(subject === "" ? null : subject);
        if (term === null) {
          drafts.push(draft(
            null,
            own.map((event) => event.seq),
            "irreversible",
            "unclassified_event",
            null,
            null,
          ));
          continue;
        }
        drafts.push(...classifyTerm(term, own, subjectEvents(lookup, term)));
      }
      return drafts;
    },
    restore(tx, group) {
      const term = group.target;
      if (term === null) {
        return err({
          code: "invalid_input",
          message: "this group has nothing to restore",
        });
      }
      const applied = applySteps(tx, group.comparison, (tx, step, base) => {
        switch (step.op) {
          case "update": {
            const { op: _op, ...fields } = step;
            return callOf(tx, termUpdate, { term, ...fields }, base);
          }
          case "archive":
            return callOf(tx, termArchive, { term }, base);
          case "unarchive":
            return callOf(tx, termUnarchive, { term }, base);
          default:
            return err({
              code: "invalid_input",
              message: "this step is not a term restore",
            });
        }
      });
      return applied.ok ? ok(undefined) : applied;
    },
  };
}
